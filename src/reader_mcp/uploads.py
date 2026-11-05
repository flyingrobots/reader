"""Deliveries over HTTP: the web upload route's framing, limits and privacy levels.

A body is one JSON header line followed by each file's bytes, in the header's order. The server checks every length
and SHA-256 while staging, then runs the ordinary ingest, so receipts, retries and path rules match every other
delivery. It decides the uploader's name and refuses what it cannot honor: an unknown or unavailable privacy level
stores nothing rather than a weaker level. A machine-only upload never touches the vault or a staging file: it stays in
memory until the encrypted store has it."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import time
from uuid import UUID

from pydantic import ValidationError

from .resources import has_capacity
from .store import MAX_FILE, MAX_TOTAL, Attachment, Provenance, Store, Submission, relative_path

CONTENT_TYPE = 'application/vnd.reader.delivery'
NORMAL, NO_CLOUD, MACHINE_ONLY = 'normal', 'no-cloud', 'machine-only'
DEFAULT_PRIVACY = NO_CLOUD
MAX_FILES = 64
MAX_HEADER = 256 * 1024
MAX_BODY = MAX_TOTAL + MAX_HEADER
DEADLINE = 300  # Seconds for one whole upload, beyond the socket's per-read timeout.
CHUNK = 1024 * 1024
HEADER_FIELDS = {'upload', 'request_id', 'title', 'filename', 'privacy', 'provenance', 'files'}
CLIENT_PROVENANCE = {'project', 'source', 'author', 'report_date', 'commit'}


def uploader(identity):
    """The name a receipt records. It comes from how the server identified the request, never from the request."""
    if not identity or identity.get('via') == 'local':
        return 'browser on this machine'
    if identity.get('via') == 'token':
        return 'token: ' + identity['name']
    return identity.get('login') or identity.get('via') or 'unknown'


def parse_header(line):
    if not line.endswith(b'\n') or len(line) > MAX_HEADER:
        raise ValueError('Missing or oversized upload header')
    try:
        header = json.loads(line)
    except (ValueError, RecursionError):
        raise ValueError('Unrecognized upload header') from None
    if not isinstance(header, dict) or header.get('upload') != 1 or set(header) - HEADER_FIELDS:
        raise ValueError('Unrecognized upload header')
    privacy = header.get('privacy', DEFAULT_PRIVACY)
    if privacy not in (NORMAL, NO_CLOUD, MACHINE_ONLY):
        raise ValueError('Unknown privacy level; nothing was stored')
    provenance = header.get('provenance', {})
    if not isinstance(provenance, dict) or set(provenance) - CLIENT_PROVENANCE:
        raise ValueError('Upload provenance is project, source, author, report_date and commit')
    files = header.get('files')
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise ValueError(f'An upload has 1 to {MAX_FILES} files')
    sizes = []
    for item in files:
        if (not isinstance(item, dict) or set(item) != {'path', 'bytes', 'sha256'} or not isinstance(item['path'], str)
                or type(item['bytes']) is not int or not 0 <= item['bytes'] <= MAX_FILE or not isinstance(item['sha256'], str)):
            raise ValueError('Each uploaded file names its path, bytes and sha256, at most 32 MiB')
        sizes.append(item['bytes'])
    if sum(sizes) > MAX_TOTAL:
        raise ValueError('An upload is at most 64 MiB')
    return header, privacy, provenance, files


def stage(stream, files, staging, length, used, deadline, clock=time.monotonic):
    """Write each declared file to private staging, checking its size and SHA-256. Returns the staged paths."""
    if used + sum(item['bytes'] for item in files) != length:
        raise ValueError('The upload’s length does not match its header')
    paths = []
    for index, item in enumerate(files):
        target, digest, remaining = staging / f'payload-{index}', hashlib.sha256(), item['bytes']
        with open(target, 'xb') as out:
            while remaining:
                if clock() > deadline:
                    raise ValueError('The upload took too long')
                chunk = stream.read(min(remaining, CHUNK))
                if not chunk:
                    raise ValueError('The upload ended early')
                digest.update(chunk)
                out.write(chunk)
                remaining -= len(chunk)
        if digest.hexdigest() != item['sha256']:
            raise ValueError('An uploaded file does not match its SHA-256')
        paths.append(str(target))
    return paths


def receive_private(stream, header, provenance, files, length, used, identity, private, session, deadline, clock):
    """Check one upload in memory and hand it to the encrypted store. Nothing is written in plaintext."""
    if not identity or identity.get('via') != 'local' or private is None:
        raise ValueError('“This machine only” needs a browser on this machine, so nothing was stored.')
    if not private.unlocked(session):
        raise ValueError('Unlock encrypted storage first, so nothing was stored.')
    if used + sum(item['bytes'] for item in files) != length:
        raise ValueError('The upload’s length does not match its header')
    title = header.get('title')
    if not isinstance(title, str) or not title.strip() or len(title) > 500:
        raise ValueError('The upload’s title, request ID or provenance is invalid')
    payloads = []
    for item in files:
        relative_path(item['path'])
        parts, digest, remaining = [], hashlib.sha256(), item['bytes']
        while remaining:
            if clock() > deadline:
                raise ValueError('The upload took too long')
            chunk = stream.read(min(remaining, CHUNK))
            if not chunk:
                raise ValueError('The upload ended early')
            digest.update(chunk)
            parts.append(chunk)
            remaining -= len(chunk)
        if digest.hexdigest() != item['sha256']:
            raise ValueError('An uploaded file does not match its SHA-256')
        payloads.append((item['path'], b''.join(parts)))
    meta = {'title': title.strip(), 'author': provenance.get('author'), 'uploaded_by': uploader(identity),
            'received_at': datetime.now(timezone.utc).isoformat()}
    return private.store(session, UUID(header.get('request_id')), meta, payloads)


def receive(root, stream, length, identity, clock=time.monotonic, private=None, session=None):
    """Stage one framed upload and deliver it to the inbox, or to encrypted storage. Returns its status."""
    if not 0 < length <= MAX_BODY:
        raise ValueError('An upload is at most 64 MiB')
    root = Path(root)
    if not has_capacity(root):
        raise ValueError('Reader is at its free-space reserve, so nothing was stored')
    deadline = clock() + DEADLINE
    line = stream.readline(MAX_HEADER + 1)
    header, privacy, provenance, files = parse_header(line)
    if privacy == MACHINE_ONLY:
        return receive_private(stream, header, provenance, files, length, len(line), identity, private, session, deadline, clock)
    state = root / '.reader/upload-staging'
    if state.is_symlink():
        raise ValueError('Upload staging must not be a symlink')
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    staging = Path(tempfile.mkdtemp(prefix='upload-', dir=state))
    try:
        paths = stage(stream, files, staging, length, len(line), deadline, clock)
        try:
            submission = Submission(
                request_id=UUID(header.get('request_id')), title=header.get('title'), filename=files[0]['path'], document_path=paths[0],
                attachments=[Attachment(source_path=path, path=item['path']) for path, item in zip(paths[1:], files[1:])],
                provenance=Provenance(**provenance, privacy=privacy, uploaded_by=uploader(identity)))
        except (ValidationError, TypeError, AttributeError) as exc:
            raise ValueError('The upload’s title, request ID or provenance is invalid') from exc
        return Store(root).ingest(submission)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def public_status(root, request_id, sender=None):
    """A delivery's state for the page that uploaded it, without local paths or the file list's hashes.

    A token only sees receipts it uploaded; anyone else's look exactly like ones that don't exist."""
    result = Store(root).status(str(UUID(request_id)))
    if sender is not None and result.get('provenance', {}).get('uploaded_by') != uploader(sender):
        return {'id': str(UUID(request_id)), 'status': 'not_found', 'integrity': None, 'title': None, 'bundle_path': None}
    return {key: result.get(key) for key in ('id', 'status', 'integrity', 'title', 'bundle_path')}
