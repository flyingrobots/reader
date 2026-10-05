"""Create provenance-bearing, unwrapped reading copies without editing originals."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import resource
import stat
import subprocess
import tempfile
from urllib.parse import quote
from uuid import uuid4

import yaml

from .metadata import frontmatter, CatalogEnvelope

REVISION = 'c167101b32bbe37954429e9de5db33efcdc0a16c'
MAX_INPUT = 4 * 1024 ** 2


def digest(data):
    return hashlib.sha256(data).hexdigest()


def format_markdown(root: Path, data: bytes) -> tuple[bytes, str]:
    tool = root / '.reader/tooling/bin/wide-md'
    installed = root / '.reader/tooling/installed.json'
    if not tool.is_file() or not installed.is_file():
        raise ValueError('Install wide-md first: python3 scripts/install_wide_md.py')
    receipt = json.loads(installed.read_text())
    tool_hash = digest(tool.read_bytes())
    if receipt.get('revision') != REVISION or receipt.get('executable_sha256') != tool_hash:
        raise ValueError('wide-md installation does not match its pinned receipt; reinstall it')
    work = root / '.reader/reading-runtime'
    work.mkdir(parents=True, exist_ok=True)
    def limits():
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 ** 2, 16 * 1024 ** 2))
    with tempfile.TemporaryDirectory(dir=work) as directory:
        cwd = Path(directory)
        # Nearest config deliberately has no width: never inherit a parent's reflow setting.
        (cwd / '.wide-md.toml').write_text('jobs = 1\n')
        with (cwd / 'stdout').open('w+b') as out, (cwd / 'stderr').open('w+b') as err:
            try:
                result = subprocess.run([str(tool)], input=data, stdout=out, stderr=err,
                                        cwd=cwd, timeout=15, preexec_fn=limits)
            except subprocess.TimeoutExpired as exc:
                raise ValueError('wide-md exceeded its 15-second limit; no reading copy was written') from exc
            if result.returncode:
                err.seek(0)
                raise ValueError('wide-md refused the source; no reading copy was written: ' + err.read(2000).decode('utf-8', errors='replace'))
            out.seek(0)
            formatted = out.read(MAX_INPUT + 1)
    if len(formatted) > MAX_INPUT:
        raise ValueError('Formatted output exceeds the 4 MiB reading-copy limit')
    formatted.decode('utf-8')
    return formatted, tool_hash


def reading_copy(root: Path, source_path: str) -> dict:
    root = root.resolve(strict=True)
    parts = source_path.split('/')
    if (not source_path.startswith('library/') or any(p in ('', '.', '..') or p.startswith('.') for p in parts)
            or '\\' in source_path or any(ord(c) < 32 for c in source_path)):
        raise ValueError('Source must be an explicit library-relative Markdown path')
    source = root / source_path
    if source.suffix.lower() not in ('.md', '.markdown') or source.name.endswith('.reading.md'):
        raise ValueError('Select a Markdown original, not MDX or a generated reading copy')
    for parent in (source, *source.parents):
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError('Reading-copy sources must not cross symlinks')
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW), 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('Source must be a regular file')
        original = stream.read(MAX_INPUT + 1)
    if len(original) > MAX_INPUT:
        raise ValueError('Reading-copy source exceeds 4 MiB')
    original.decode('utf-8')
    source_metadata, _ = frontmatter(original)
    if source_metadata.get('reading_source') or '/reading/' in source_path:
        raise ValueError('Select the original rather than an existing reading derivative')
    formatted, tool_hash = format_markdown(root, original)
    metadata, body = frontmatter(formatted)
    destination = source.with_name(source.stem + '.reading.md')
    path = destination.relative_to(root).as_posix()
    source_hash = digest(original)
    notice = (f'# Reading copy\n\n[Unchanged original]({quote(source.name, safe="")}). '
              'Artificial prose line wrapping was removed with wide-md; this is a reading derivative.\n\n').encode()
    body = notice + body.removeprefix(b'\xef\xbb\xbf')
    result = dict(source=source_path, source_sha256=source_hash, formatter='wide-md', formatter_revision=REVISION)
    with source.open('rb') as stream:
        if digest(stream.read(MAX_INPUT + 1)) != source_hash:
            raise ValueError('Source changed during formatting; retry after its writer finishes')
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink():
            raise ValueError('Reading-copy destination is a symlink')
        if destination.stat().st_size > MAX_INPUT + 65536:
            raise ValueError('Existing reading copy exceeds the size limit')
        old, old_body = frontmatter(destination.read_bytes())
        if (old.get('reading_source') == source_path and old.get('reading_source_sha256') == source_hash
                and old.get('reading_formatter_sha256') == tool_hash and old_body == body):
            return dict(result, status='existing', reading_copy=path)
        raise ValueError('Reading-copy destination already exists with different content; preserve it and reconcile explicitly')
    if formatted == original:
        return dict(result, status='unchanged', reading_copy=None)
    today = datetime.now(timezone.utc).date().isoformat()
    fields = dict(frontmatter_schema_version=1, document_revision=1, document_id=str(uuid4()),
                  document_path=path, metadata_created=today, title=str(metadata.get('title') or source.stem) + ' — reading copy',
                  type='document', added=today, author=metadata.get('author'), kind='reading-copy',
                  source=source_path, tags=[], reading_source=source_path, reading_source_sha256=source_hash,
                  reading_formatter='wide-md', reading_formatter_revision=REVISION, reading_formatter_sha256=tool_hash,
                  original_metadata=metadata)
    if not metadata:
        fields.pop('original_metadata')
    CatalogEnvelope.model_validate(fields)
    output = b'---\n' + yaml.safe_dump(fields,allow_unicode=True,sort_keys=False).encode() + b'---\n' + body
    frontmatter(output)  # Verify the generated header is accepted by the shared catalog codec.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=source.parent, prefix='.reader-reading-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(output); stream.flush(); os.fsync(stream.fileno())
        # Hard-link publication is atomic and refuses an existing name; no overwrite race.
        os.link(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return dict(result, status='created', reading_copy=path, reading_sha256=digest(output))
