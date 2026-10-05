"""Atomic inbox bundles. Original payloads are never edited by ingestion."""

from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import unicodedata
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

MANIFEST = "receipt.json"
MAX_FILE = 32 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024


class Attachment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_path: str = Field(description="Absolute path to an existing local regular file")
    path: str = Field(description="Relative destination within the bundle, matching report links")


class Provenance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project: str | None = Field(default=None, max_length=1000)
    source: str | None = Field(default=None, max_length=4000)
    author: str | None = Field(default=None, max_length=1000)
    report_date: str | None = Field(default=None, max_length=100)
    commit: str | None = Field(default=None, max_length=100)


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID = Field(description="Generate once per delivery; reuse for retries")
    title: str = Field(min_length=1, max_length=500)
    filename: str = Field(default="report.md", description="Relative document path in the bundle")
    markdown: str | None = Field(default=None, max_length=8 * 1024 * 1024)
    document_path: str | None = Field(default=None, description="Absolute local file path; preserves bytes")
    attachments: list[Attachment] = Field(default_factory=list, max_length=63)
    provenance: Provenance = Field(default_factory=Provenance)

    @model_validator(mode="after")
    def one_document(self):
        if (self.markdown is None) == (self.document_path is None):
            raise ValueError("Provide exactly one of markdown or document_path")
        if not self.title.strip():
            raise ValueError("title must not be blank")
        return self


def relative_path(value: str) -> Path:
    parts = value.split("/")
    if (not value or len(value) > 500 or PurePosixPath(value).is_absolute()
            or any(p in ("", ".", "..") or p.startswith(".") for p in parts)
            or any(ord(c) < 32 or c in '\\:*?"<>|' for c in value)
            or any(p.endswith((" ", ".")) for p in parts)):
        raise ValueError(f"Unsafe bundle path: {value!r}")
    if parts[0].casefold() in (MANIFEST, "index.md"):
        raise ValueError("receipt.json and index.md are reserved at the bundle root")
    return Path(*parts)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def read_source(value: str) -> bytes:
    source = Path(value).expanduser()
    if not source.is_absolute():
        raise ValueError("Source paths must be absolute; the server does not share the caller's cwd")
    # Nonblocking open lets us reject FIFOs without waiting for a writer.
    fd = os.open(source, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Source must be a regular file")
        data = stream.read(MAX_FILE + 1)
        after = os.fstat(stream.fileno())
    if len(data) > MAX_FILE:
        raise ValueError("File exceeds the 32 MiB delivery limit")
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("Source changed while being read; retry after the writer finishes")
    return data


class Store:
    def __init__(self, root: Path):
        self.root = root.expanduser().resolve(strict=True)
        for name in ("inbox", "library"):
            path = self.root / name
            if path.is_symlink() or not path.is_dir():
                raise ValueError(f"Reader root must contain a real {name}/ directory")
        self.state = self.root / ".reader"
        if self.state.is_symlink():
            raise ValueError(".reader must not be a symlink")
        self.state.mkdir(exist_ok=True)

    @contextmanager
    def locked(self):
        lock = self.state / "ingest.lock"
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "a") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            yield

    def locate(self, request_id: str):
        request_id = str(UUID(request_id))
        found = []
        for section in ("inbox", "library"):
            for manifest in (self.root / section).rglob(MANIFEST):
                if manifest.is_symlink() or not manifest.resolve().is_relative_to(self.root / section):
                    continue
                # Other documents may have an unrelated receipt.json attachment.
                if manifest.stat().st_size > 128 * 1024:
                    continue
                try:
                    data = json.loads(manifest.read_text())
                except (ValueError, UnicodeError):
                    continue
                if isinstance(data, dict) and data.get("reader_receipt") == 1 and data.get("id") == request_id:
                    found.append((manifest.parent, data, section))
        if len(found) > 1:
            raise ValueError("Duplicate receipt IDs found; librarian reconciliation is required")
        return found[0] if found else None

    def _status(self, request_id: str) -> dict:
        located = self.locate(request_id)
        if located is None:
            return {"id": str(UUID(request_id)), "status": "not_found"}
        folder, receipt, section = located
        issues = []
        for item in receipt["files"]:
            path = folder / relative_path(item["path"])
            if path.is_symlink() or not path.resolve().is_relative_to(folder.resolve()):
                issues.append({"path": item["path"], "issue": "unsafe_path"})
            elif not path.is_file():
                issues.append({"path": item["path"], "issue": "missing"})
            elif path.stat().st_size != item["bytes"] or digest(path.read_bytes()) != item["sha256"]:
                issues.append({"path": item["path"], "issue": "changed"})
        return {
            **receipt,
            "status": "awaiting_filing" if section == "inbox" else "filed",
            "integrity": "intact" if not issues else "needs_attention",
            "issues": issues,
            "bundle_path": str(folder.relative_to(self.root)),
            "document_path": str(folder / relative_path(receipt["document"])),
        }

    def status(self, request_id: str) -> dict:
        with self.locked():
            return self._status(request_id)

    def ingest(self, submission: Submission) -> dict:
        document = relative_path(submission.filename)
        paths = [document, *(relative_path(a.path) for a in submission.attachments)]
        # Reject case collisions and file/directory collisions before writing anything.
        names = [unicodedata.normalize("NFC", p.as_posix()).casefold() for p in paths]
        for i, name in enumerate(names):
            if any(name == other or name.startswith(other + "/") or other.startswith(name + "/")
                   for other in names[:i]):
                raise ValueError("Conflicting document/attachment paths")
        content = (submission.markdown.encode("utf-8") if submission.markdown is not None
                   else read_source(submission.document_path))
        payloads = [(document, content)]
        total = len(content)
        if total > MAX_FILE:
            raise ValueError("Document exceeds the 32 MiB delivery limit")
        for attachment, path in zip(submission.attachments, paths[1:]):
            data = read_source(attachment.source_path)
            total += len(data)
            if total > MAX_TOTAL:
                raise ValueError("Bundle exceeds the 64 MiB delivery limit")
            payloads.append((path, data))
        files = sorted([{"path": p.as_posix(), "bytes": len(b), "sha256": digest(b)} for p, b in payloads],
                       key=lambda item: item["path"])
        identity = {"title": submission.title, "document": document.as_posix(),
                    "provenance": submission.provenance.model_dump(exclude_none=True), "files": files}
        fingerprint = digest(json_bytes(identity))
        request_id = str(submission.request_id)
        with self.locked():
            existing = self.locate(request_id)
            if existing:
                if existing[1]["fingerprint"] != fingerprint:
                    raise ValueError("Request ID already belongs to a different submission")
                result = self._status(request_id)
                if result["integrity"] != "intact":
                    raise ValueError("Existing delivery has changed or missing files; inspect reader_status")
                return result
            receipt = {"reader_receipt": 1, "id": request_id, "fingerprint": fingerprint,
                       "received_at": datetime.now(timezone.utc).isoformat(), **identity}
            destination = self.root / "inbox" / request_id
            if destination.exists() or destination.is_symlink():
                raise ValueError("Destination already exists without a matching receipt")
            staging_root = self.state / "staging"
            if staging_root.is_symlink():
                raise ValueError("Staging directory must not be a symlink")
            staging_root.mkdir(exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix=request_id + "-", dir=staging_root))
            try:
                for path, data in payloads:
                    output = staging / path
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with output.open("xb") as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                with (staging / MANIFEST).open("xb") as stream:
                    stream.write(json_bytes(receipt))
                    stream.flush()
                    os.fsync(stream.fileno())
                staging.rename(destination)
            finally:
                if staging.exists():
                    shutil.rmtree(staging)
            return self._status(request_id)
