"""A permanent archive of every LLM run's raw artifacts, inside the vault.

Each run gets `logs/llm/<kind>/<YYYY>/<MM>/<DD>/<run-id>/`. While it runs, artifacts are
streamed uncompressed as `<name>.partial` beside a `meta.json` whose status is
`running`, so a crash still leaves a readable record. `finish()` gzips every artifact
to `<name>.gz` and rewrites `meta.json` (always plain JSON) with the outcome and each
file's size and SHA-256. Nothing here prunes or expires: by the user's explicit
decision, LLM logs are kept forever. Runners refuse to start when free space is low
instead of dropping logs. Commit the run directory with the vault's other writes
(`Reader-Log: <kind>/<run-id>` trailer)."""
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

ROOT = 'logs/llm'
KINDS = ('chat', 'listen', 'inbox', 'local-model', 'art', 'coding-job')
META = 'meta.json'
RUN_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}')
RELATIVE = re.compile(r'logs/llm/(' + '|'.join(KINDS) + r')/\d{4}/\d{2}/\d{2}/([A-Za-z0-9][A-Za-z0-9._-]{0,79})')
NAME = re.compile(r'[a-z][a-z0-9_-]{0,40}\.(txt|jsonl|log|md|json)')
SECRET_FLAG = re.compile(r'(api[-_]?key|token|secret|password|passwd|auth|credential)', re.I)
SECRET_VALUE = re.compile(r'(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[a-z]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})')
REDACTED = '<redacted>'


def stamp():
    return datetime.now(timezone.utc).isoformat()


def reader_version():
    try:
        from importlib.metadata import version
        return version('reader-library')
    except Exception:
        return None


def redact_argv(argv, labels=None):
    """Argv safe to archive: long content values become labels, secrets are redacted."""
    labels = labels or {}
    out, hide_next = [], False
    for item in argv:
        item = str(item)
        if hide_next:
            out.append(REDACTED); hide_next = False; continue
        label = next((name for value, name in labels.items() if value and item == value), None)
        if label:
            out.append(label); continue
        if item.startswith('-') and SECRET_FLAG.search(item):
            if '=' in item:
                out.append(item.split('=', 1)[0] + '=' + REDACTED)
            else:
                out.append(item); hide_next = True
            continue
        key, eq, _ = item.partition('=')
        if eq and SECRET_FLAG.search(key) and ' ' not in key:
            out.append(key + '=' + REDACTED); continue
        out.append(SECRET_VALUE.sub(REDACTED, item))
    return out


def safe_dir(root, relative, create=False):
    """The run directory for a validated relative path, refusing symlinks on the way."""
    root = Path(root).resolve(strict=True)
    if not isinstance(relative, str) or not RELATIVE.fullmatch(relative):
        raise ValueError('Not an LLM log path')
    path = root
    for part in relative.split('/'):
        path = path / part
        if path.is_symlink():
            raise ValueError('LLM log paths must not contain symlinks')
        if create and not path.exists():
            path.mkdir()
    return path


class RunLog:
    """One run's archive directory. Stream artifacts with `open()`/`write()`, then `finish()`."""

    def __init__(self, root, kind, run_id, meta=None, now=None):
        if kind not in KINDS:
            raise ValueError('Unknown LLM log kind: ' + str(kind))
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            raise ValueError('Run IDs are 1–80 letters, digits, dots, dashes or underscores')
        started = now or datetime.now(timezone.utc)
        self.root = Path(root).resolve(strict=True)
        self.relative = f'{ROOT}/{kind}/{started:%Y/%m/%d}/{run_id}'
        self.dir = safe_dir(self.root, self.relative, create=True)
        self.meta = {'schema_version': 1, 'kind': kind, 'run_id': run_id, 'started_at': started.isoformat(),
                     'ended_at': None, 'status': 'running', 'reader_version': reader_version(), **(meta or {})}
        self.write_meta()

    def path(self, name):
        if not NAME.fullmatch(name):
            raise ValueError('Bad artifact name')
        return self.dir / name

    def open(self, name):
        """A binary append handle for a streamed artifact, `<name>.partial`."""
        return (self.dir / (self.path(name).name + '.partial')).open('ab')

    def write(self, name, data):
        with self.open(name) as out:
            out.write(data.encode() if isinstance(data, str) else data)

    def update(self, **fields):
        self.meta.update(fields)
        self.write_meta()

    def write_meta(self):
        temporary = self.dir / '.meta.next'
        temporary.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(self.dir / META)

    def finish(self, status, **fields):
        """Compress every artifact, record the outcome, and return the vault-relative path."""
        self.meta['files'] = compress(self.dir)
        self.meta.update(fields, status=status, ended_at=stamp())
        self.write_meta()
        return self.relative


def compress(folder):
    """Gzip each artifact in a run directory (dropping `.partial`); return {name: {bytes, sha256}}."""
    files = {}
    for path in sorted(Path(folder).iterdir()):
        if path.name in (META, '.meta.next') or path.is_symlink() or not path.is_file() or path.name.endswith('.gz'):
            continue
        name = path.name[:-len('.partial')] if path.name.endswith('.partial') else path.name
        target = path.with_name(name + '.gz')
        digest, size = hashlib.sha256(), 0
        with path.open('rb') as source, open(target, 'wb') as raw, gzip.GzipFile(filename=name, mode='wb', fileobj=raw, mtime=0) as out:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk); size += len(chunk); out.write(chunk)
        with open(target, 'rb') as written:
            os.fsync(written.fileno())
        path.unlink()
        files[name] = {'bytes': size, 'sha256': digest.hexdigest(), 'stored': target.name}
    for path in Path(folder).glob('*.gz'):
        name = path.name[:-3]
        files.setdefault(name, {'stored': path.name})
    return files


def seal(root, relative, status='interrupted', note=None):
    """Finish a run a crashed process left behind; a no-op once it is sealed."""
    folder = safe_dir(root, relative)
    meta_file = folder / META
    meta = json.loads(meta_file.read_text()) if meta_file.is_file() else {}
    if meta.get('status') not in (None, 'running') and not any(folder.glob('*.partial')):
        return relative
    meta['files'] = compress(folder)
    meta.update(status=status if meta.get('status') in (None, 'running') else meta['status'], ended_at=meta.get('ended_at') or stamp())
    if note:
        meta['note'] = note
    (folder / '.meta.next').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
    (folder / '.meta.next').replace(meta_file)
    return relative


def trailer(relative):
    """The `Reader-Log: <kind>/<run-id>` trailer value for a run directory."""
    return '/'.join(RELATIVE.fullmatch(relative).group(1, 2))


def commit(root, paths, subject, trailers, *, git_locks=None, holder='reader-llm-log', note='Reader LLM log commit'):
    """Commit exactly `paths` (vault-relative; LLM run directories and their companions) with trailers.

    Serialized with chat commits: the vault repository's `.git/` git-locks key when git-locks is
    installed (`git_locks` names it; False never uses it) and always the `.reader/voice-runner/
    chat-commit.lock` flock. Directories are added with `git add -A -f`, so compressed files replace
    streamed partials and an ignore rule never hides an archive. Returns {'commit', 'status'[, 'error']}."""
    root = Path(root).resolve(strict=True)
    git = shutil.which('git')
    if not git:
        return {'commit': None, 'status': 'no-git'}
    inside = subprocess.run([git, 'rev-parse', '--show-toplevel'], cwd=root, capture_output=True, text=True, timeout=10)
    if inside.returncode or Path(inside.stdout.strip()).resolve() != root:
        return {'commit': None, 'status': 'not-a-repository'}
    from .companions import find_git_locks, repo_env
    message = subject + '\n\n' + ''.join(f'{k}: {v}\n' for k, v in trailers)
    runtime = root / '.reader' / 'voice-runner'
    runtime.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', dir=runtime, prefix='.commit-', suffix='.txt', delete=False) as out:
        out.write(message); message_file = Path(out.name)
    try:
        script = ('note="$1"; shift; git add -A -f -- "$@" || exit 1; '
                  'if git diff --cached --quiet -- "$@"; then echo nothing-to-commit; else git commit -q -F "$note" -- "$@"; fi')
        command = ['sh', '-c', script, 'reader-log-commit', str(message_file), *paths]
        tool = None if git_locks is False else (git_locks or find_git_locks(root=root))
        if tool:
            command = [tool, 'with', '--job', holder + '-' + uuid.uuid4().hex, '--holder', holder, '--ttl', '300',
                       '--wait', '120', '--note', note, '.git/', '--'] + command
        with (runtime / 'chat-commit.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            # The .git/ key lives in the vault repository's default store, never GIT_LOCKS_STORE's host store.
            result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=180, env=repo_env())
    finally:
        message_file.unlink(missing_ok=True)
    if result.returncode:
        return {'commit': None, 'status': 'failed', 'error': (result.stderr or result.stdout)[-600:].strip()}
    if 'nothing-to-commit' in result.stdout:
        return {'commit': None, 'status': 'unchanged'}
    head = subprocess.run([git, 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True, timeout=10)
    return {'commit': head.stdout.strip() or None, 'status': 'committed'}


def read(root, relative, name, limit):
    """(text, total_bytes, truncated) for one artifact, from its `.gz` or a live `.partial`."""
    folder = safe_dir(root, relative)
    if not NAME.fullmatch(name):
        raise ValueError('Bad artifact name')
    if name == META:
        path = folder / META
        if not path.is_file() or path.is_symlink():
            return None, 0, False
        data = path.read_bytes()[:limit]
        return data.decode('utf-8', 'replace'), len(data), False
    for candidate, opener in ((folder / (name + '.partial'), open), (folder / (name + '.gz'), gzip.open), (folder / name, open)):
        if candidate.is_file() and not candidate.is_symlink():
            with opener(candidate, 'rb') as handle:
                data = handle.read(limit + 1)
                total = len(data)
                if total > limit:
                    while handle.read(1024 * 1024):
                        pass
                    total = None if opener is gzip.open else candidate.stat().st_size
            truncated = len(data) > limit
            return data[:limit].decode('utf-8', 'replace'), total, truncated
    return None, 0, False


_usage = {}
_usage_lock = threading.Lock()


def usage(root, ttl=30):
    """Total bytes and runs under `logs/llm/`, cached for `ttl` seconds."""
    root = Path(root).resolve(strict=True)
    with _usage_lock:
        cached = _usage.get(root)
        if cached and time.monotonic() - cached[0] < ttl:
            return cached[1]
    total, runs = 0, 0
    base = root / ROOT
    if base.is_dir() and not base.is_symlink():
        for folder, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if not (Path(folder) / d).is_symlink()]
            if META in files:
                runs += 1
            for name in files:
                try:
                    path = Path(folder) / name
                    if not path.is_symlink():
                        total += path.stat().st_size
                except FileNotFoundError:
                    pass
    result = {'path': ROOT, 'bytes': total, 'runs': runs, 'retention': 'forever'}
    with _usage_lock:
        _usage[root] = (time.monotonic(), result)
    return result


def forget_usage(root):
    with _usage_lock:
        _usage.pop(Path(root).resolve(), None)

