"""Encrypted machine-only storage: documents that never reach the vault, Git remotes, models or agents.

Files live in a bare Git repository outside the vault, `~/.reader/private.git`, encrypted by git-cas under a passphrase
only the user knows. Unlocking keeps the derived key in this server's memory and hands the browser an HttpOnly cookie,
so another program on this machine can't use the unlocked session through the API. Plaintext reaches git-cas over stdin
and is never written to disk. Reader's own tools can't find these documents: search, MCP, voices and intake read the
vault, and this is not in the vault.

This protects Reader's copy. It can't protect a document while it is open, the original file wherever it came from, or
anything from a program that can read this server's memory. There is no recovery: a lost passphrase loses the files."""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote
import re
import secrets
import shutil
import stat
import subprocess
import threading
import time
from uuid import UUID

MIN_PASSPHRASE = 12
MAX_PASSPHRASE = 1024
IDLE_LIMIT = 15 * 60
ATTEMPTS = 5
BACKOFF = 60
CALL_TIMEOUT = 180
INSTALL_TIMEOUT = 300
MAX_ITEMS = 1000
MAX_PREVIEW = 2 * 1024 ** 2
COOKIE = 'reader_private'
BRIDGE = Path(__file__).with_name('private_bridge')
NEVER_PUSH = '#!/bin/sh\necho "Reader: this repository never leaves this machine." >&2\nexit 1\n'
TOOL_DIRECTORIES = ('~/.local/bin', '~/.local/share/mise/shims', '/opt/homebrew/bin', '/usr/local/bin')
ERRORS = {'INTEGRITY_ERROR': 'That passphrase doesn’t match.', 'NO_VAULT': 'Encrypted storage isn’t set up yet.'}


class Locked(PermissionError):
    pass


def reader_home(environ=None):
    environ = os.environ if environ is None else environ
    return Path(environ.get('READER_HOME') or '~/.reader').expanduser()


def checked_id(value):
    return str(UUID(str(value)))


def cookie_value(header):
    """This feature's cookie from a Cookie header, or None."""
    for part in (header or '').split(';'):
        name, _, value = part.strip().partition('=')
        if name == COOKIE and re.fullmatch(r'[A-Za-z0-9_-]{20,100}', value):
            return value
    return None


class PrivateStore:
    def __init__(self, environ=None, clock=time.monotonic):
        self.environ = os.environ if environ is None else environ
        self.clock = clock
        self.home = reader_home(self.environ)
        self.repo = self.home / 'private.git'
        self.tool = self.home / 'tools/git-cas-bridge'
        self.lock = threading.RLock()
        self.session = None
        self.failures = 0
        self.blocked_until = 0

    # Tools ---------------------------------------------------------------

    def search_path(self):
        directories = [os.path.expanduser(d) for d in TOOL_DIRECTORIES]
        return ':'.join(p for p in [self.environ.get('PATH', ''), *directories] if p)

    def installed(self):
        return (self.tool / 'node_modules/@git-stunts/git-cas/index.js').is_file() and bool(shutil.which('node', path=self.search_path()))

    def initialized(self):
        return (self.repo / 'refs/cas/vault').is_file() or (self.repo / 'packed-refs').is_file()

    def install(self):
        npm = shutil.which('npm', path=self.search_path())
        if not npm:
            raise ValueError('Encrypted storage needs Node.js and npm, which weren’t found on this machine.')
        with self.lock:
            self.tool.mkdir(parents=True, exist_ok=True, mode=0o700)
            for name in ('package.json', 'package-lock.json'):
                shutil.copyfile(BRIDGE / name, self.tool / name)
            # The lockfile pins every package's integrity hash, and no install script runs.
            done = subprocess.run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=self.tool, capture_output=True, text=True,
                                  timeout=INSTALL_TIMEOUT, env=dict(self.environ, PATH=self.search_path()))
            if done.returncode:
                raise ValueError('Installing encrypted storage failed: ' + done.stderr[-300:].strip())
        return self.status(None)

    def status(self, session_id):
        return {'installed': self.installed(), 'initialized': self.initialized(), 'unlocked': self.unlocked(session_id),
                'idle_limit_seconds': IDLE_LIMIT}

    # The bridge ----------------------------------------------------------

    def call(self, request, payload=b''):
        node = shutil.which('node', path=self.search_path())
        if not node or not self.installed():
            raise ValueError('Encrypted storage isn’t installed yet.')
        done = subprocess.run([node, str(BRIDGE / 'bridge.mjs'), str(self.repo), str(self.tool)],
                              input=json.dumps(request).encode() + b'\n' + payload, capture_output=True, timeout=CALL_TIMEOUT,
                              cwd=self.repo, env=dict(self.environ, PATH=self.search_path()))
        header, _, body = done.stdout.partition(b'\n')
        try:
            reply = json.loads(header)
        except ValueError:
            raise ValueError('Encrypted storage could not run.') from None  # Its stderr can't be shown: it might quote anything.
        if not reply.get('ok'):
            raise ValueError(ERRORS.get(reply.get('code'), 'Encrypted storage refused that: ' + str(reply.get('code'))[:40]))
        return reply, body

    def ensure_private(self):
        """Refuse to write if this repository could be pushed: it must have no remote, and keep its guards."""
        mode = stat.S_IMODE(self.repo.stat().st_mode)
        if mode & 0o077:
            os.chmod(self.repo, 0o700)
        remotes = subprocess.run(['git', '--git-dir', str(self.repo), 'remote'], capture_output=True, text=True, timeout=30)
        if remotes.returncode or remotes.stdout.strip():
            raise ValueError('The encrypted repository has a Git remote, so nothing was stored. Remove the remote first.')
        # Each object and ref reaches the disk before the next step, so power loss can't leave a half-written document.
        for name, value in (('core.fsync', 'loose-object,pack,reference'), ('core.fsyncMethod', 'fsync')):
            subprocess.run(['git', '--git-dir', str(self.repo), 'config', name, value], capture_output=True, timeout=30)
        hook = self.repo / 'hooks/pre-push'
        hook.parent.mkdir(exist_ok=True)
        if not hook.is_file() or hook.read_text() != NEVER_PUSH:
            hook.write_text(NEVER_PUSH)
            hook.chmod(0o700)

    def prune(self):
        """Drop unreachable ciphertext. A killed or deleted store leaves only that behind."""
        subprocess.run(['git', '--git-dir', str(self.repo), 'gc', '--quiet', '--prune=now'], capture_output=True, timeout=CALL_TIMEOUT)

    # Sessions ------------------------------------------------------------

    def unlocked(self, session_id):
        with self.lock:
            session = self.session
            if not session or not session_id or not secrets.compare_digest(session['id'], session_id):
                return False
            if self.clock() > session['expires']:
                self.session = None
                return False
            session['expires'] = self.clock() + IDLE_LIMIT
            return True

    def key(self, session_id):
        with self.lock:
            if not self.unlocked(session_id):
                raise Locked('Unlock encrypted storage first.')
            return self.session['key']

    def open_session(self, key):
        self.failures = 0
        self.session = {'id': secrets.token_urlsafe(32), 'key': key, 'expires': self.clock() + IDLE_LIMIT}
        return self.session['id']

    def setup(self, passphrase):
        if not isinstance(passphrase, str) or not MIN_PASSPHRASE <= len(passphrase) <= MAX_PASSPHRASE:
            raise ValueError(f'Choose a passphrase of at least {MIN_PASSPHRASE} characters.')
        with self.lock:
            if self.initialized():
                raise ValueError('Encrypted storage is already set up.')
            self.home.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not self.repo.exists():
                subprocess.run(['git', 'init', '-q', '--bare', str(self.repo)], check=True, capture_output=True, timeout=30)
            os.chmod(self.repo, 0o700)
            self.ensure_private()
            self.call({'op': 'init', 'passphrase': passphrase})
            return self.open_session(self.call({'op': 'unlock', 'passphrase': passphrase})[0]['key'])

    def unlock(self, passphrase):
        if not isinstance(passphrase, str) or not 0 < len(passphrase) <= MAX_PASSPHRASE:
            raise ValueError('Enter your passphrase.')
        with self.lock:
            if self.clock() < self.blocked_until:
                raise ValueError('Too many wrong passphrases. Wait a minute and try again.')
            try:
                reply, _ = self.call({'op': 'unlock', 'passphrase': passphrase})
            except ValueError:
                self.failures += 1
                if self.failures >= ATTEMPTS:
                    self.failures, self.blocked_until = 0, self.clock() + BACKOFF
                raise
            return self.open_session(reply['key'])

    def close(self):
        with self.lock:
            self.session = None

    # Documents -----------------------------------------------------------

    def store(self, session_id, request_id, meta, files):
        """Encrypt one upload. `files` are (path, bytes), held in memory until git-cas has them."""
        identity = checked_id(request_id)
        with self.lock:
            key = self.key(session_id)
            self.ensure_private()
            described = [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for path, data in files]
            encoded = json.dumps({**meta, 'files': described}, ensure_ascii=False).encode()
            try:
                self.call({'op': 'store', 'key': key, 'id': identity, 'meta_bytes': len(encoded)}, encoded + b''.join(data for _, data in files))
            except (ValueError, subprocess.SubprocessError):
                self.prune()
                raise
        return {'id': identity, 'status': 'encrypted', 'integrity': 'intact', 'title': meta.get('title')}

    def encrypt_arrival(self, session_id, root, arrival, busy):
        """Move one waiting delivery into encrypted storage, including its receipt. The inbox copy is removed only after
        every stored file has been read back and matched. `busy` is why filing might be touching it, or None."""
        from .store import Store
        identity = checked_id(arrival)
        self.key(session_id)
        store = Store(Path(root))
        with store.locked():
            if busy:
                raise ValueError(busy)
            status = store._status(identity)
            if status.get('status') != 'awaiting_filing':
                raise ValueError('That isn’t a delivery waiting in the inbox.')
            if status.get('integrity') != 'intact':
                raise ValueError('That delivery has changed since it arrived, so it wasn’t moved. Check it on the Inbox page.')
            folder = store.inbox / identity
            names = [status['document'], *sorted(row['path'] for row in status['files'] if row['path'] != status['document']), 'receipt.json']
            files = [(name, (folder / name).read_bytes()) for name in names]
            provenance = status.get('provenance') or {}
            meta = {'title': status['title'], 'author': provenance.get('author'), 'uploaded_by': provenance.get('uploaded_by'),
                    'received_at': status.get('received_at'), 'source': provenance.get('project')}
            self.store(session_id, identity, meta, files)
            _, stored = self.read(session_id, identity)
            if stored != dict(files):
                raise ValueError('The encrypted copy didn’t match, so the inbox copy was kept.')
            shutil.rmtree(folder)
        return {'id': identity, 'status': 'encrypted', 'title': status['title']}

    def items(self, session_id):
        with self.lock:
            key = self.key(session_id)
            rows = self.call({'op': 'list', 'key': key})[0]['items'][:MAX_ITEMS]
        items = [{'id': row['id'], **json.loads(row['meta'])} for row in rows]
        return sorted(items, key=lambda item: item.get('received_at') or '', reverse=True)

    def read(self, session_id, request_id):
        """(metadata, {path: bytes}) for one document, checked against its recorded hashes."""
        identity = checked_id(request_id)
        with self.lock:
            key = self.key(session_id)
            rows = {row['id']: row for row in self.call({'op': 'list', 'key': key})[0]['items']}
            if identity not in rows:
                raise ValueError('That document doesn’t exist.')
            meta = json.loads(rows[identity]['meta'])
            _, data = self.call({'op': 'read', 'key': key, 'id': identity})
        files, offset = {}, 0
        for row in meta['files']:
            part = data[offset:offset + row['bytes']]
            offset += row['bytes']
            if hashlib.sha256(part).hexdigest() != row['sha256']:
                raise ValueError('A stored file doesn’t match its hash, so it wasn’t shown.')
            files[row['path']] = part
        return {'id': identity, **meta}, files

    def view(self, session_id, request_id):
        """A document's details and, when its main file is text of a sensible size, that text."""
        meta, files = self.read(session_id, request_id)
        main = files[meta['files'][0]['path']]
        text = None
        if len(main) <= MAX_PREVIEW:
            try:
                text = main.decode()
            except UnicodeDecodeError:
                pass
        return {**meta, 'text': text}

    def document(self, session_id, path):
        """A stored file as the reader opens it, addressed by `private/<id>` or `private/<id>/<index>`. Names stay out of the URL, and so out of browser history."""
        parts = path.split('/')
        if parts[0] != 'private' or len(parts) not in (2, 3) or (len(parts) == 3 and not (parts[2].isascii() and parts[2].isdigit() and len(parts[2]) < 5)):
            raise ValueError('That document doesn’t exist.')
        meta, files = self.read(session_id, parts[1])
        index = int(parts[2]) if len(parts) == 3 else 0
        if index >= len(meta['files']):
            raise ValueError('That document doesn’t exist.')
        row = meta['files'][index]
        data, text = files[row['path']], None
        if len(data) <= MAX_PREVIEW and b'\x00' not in data:
            try:
                text = data.decode()
            except UnicodeDecodeError:
                pass
        name = Path(row['path'])
        identity = parts[1]
        return {'path': path, 'sha256': row['sha256'], 'kind': name.suffix.lower(), 'text': text, 'title': meta['title'] if index == 0 else name.stem.replace('-', ' '),
                'metadata': {}, 'file_url': '/api/private/file?id=' + quote(identity, safe='') + '&path=' + quote(row['path'], safe=''),
                'item': None, 'preview': True, 'private': True, 'bookmark': None,
                'private_files': [{'path': f'private/{identity}' + (f'/{number}' if number else ''), 'name': other['path'], 'current': number == index}
                                  for number, other in enumerate(meta['files']) if other['path'] != 'receipt.json']}

    def delete(self, session_id, request_id):
        identity = checked_id(request_id)
        with self.lock:
            self.call({'op': 'delete', 'key': self.key(session_id), 'id': identity})
            self.prune()
        return {'deleted': identity}
