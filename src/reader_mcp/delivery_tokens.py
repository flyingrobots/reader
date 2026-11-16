"""Named delivery tokens and per-sender upload quotas.

A token lets a machine or agent deliver to the inbox and read its own receipts, and nothing else: it can't read the library or start
filing, so holding one can't spend a model's usage. Only a hash is stored, and the secret is shown once. It adds to the access
rules rather than replacing them: the request must still reach Reader on this machine or from an approved Tailscale login."""
from datetime import datetime, timezone
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
from uuid import uuid4

FILE = '.reader/delivery-tokens.json'
MAX_TOKENS = 100
MAX_FILE_BYTES = 1024 ** 2
DAILY_UPLOADS = 200
DAILY_BYTES = 512 * 1024 ** 2
TOKEN = re.compile(r'rdt_([0-9a-f]{32})_([A-Za-z0-9_-]{32,64})')
NAME = re.compile(r'[^\x00-\x1f\x7f]{1,80}')


class QuotaExceeded(ValueError):
    pass


def digest(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


def today(now=None):
    return (now or datetime.now(timezone.utc)).strftime('%Y-%m-%d')


class DeliveryTokens:
    def __init__(self, root, now=None):
        self.root, self.now = Path(root), now or (lambda: datetime.now(timezone.utc))
        self.file = self.root / FILE

    def locked(self, change):
        """Read, change and atomically rewrite the store under a lock. It's private, so its mode is owner-only."""
        self.file.parent.mkdir(parents=True, exist_ok=True)
        if self.file.is_symlink():
            raise ValueError('The delivery token store must not be a symlink')
        with self.file.with_suffix('.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            data = self.read()
            result = change(data)
            temporary = self.file.with_name(self.file.name + '.next')
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, 'w') as out:
                json.dump(data, out, ensure_ascii=False, indent=1)
            os.replace(temporary, self.file)
            return result

    def read(self):
        if not self.file.is_file():
            return {'tokens': {}, 'usage': {}}
        if self.file.stat().st_size > MAX_FILE_BYTES:
            raise ValueError('The delivery token store is too large')
        data = json.loads(self.file.read_text())
        if not isinstance(data.get('tokens'), dict) or not isinstance(data.get('usage'), dict):
            raise ValueError('The delivery token store is damaged')
        return data

    def create(self, name):
        name = name.strip() if isinstance(name, str) else ''
        if not NAME.fullmatch(name):
            raise ValueError('Give the token a name of at most 80 characters')
        identity, secret = uuid4().hex, secrets.token_urlsafe(32)

        def change(data):
            if len(data['tokens']) >= MAX_TOKENS:
                raise ValueError(f'At most {MAX_TOKENS} delivery tokens can exist')
            if any(row['name'] == name for row in data['tokens'].values()):
                raise ValueError('A token with that name already exists')
            data['tokens'][identity] = {'name': name, 'hash': digest(secret), 'created_at': self.now().isoformat(timespec='seconds'), 'last_used_at': None}
        self.locked(change)
        return {'id': identity, 'name': name, 'token': f'rdt_{identity}_{secret}'}

    def revoke(self, identity):
        def change(data):
            if data['tokens'].pop(str(identity), None) is None:
                raise ValueError('That token doesn’t exist')
        self.locked(change)
        return {'revoked': identity}

    def verify(self, header):
        """The sender for an `Authorization: Bearer` value, or None. Unknown and revoked tokens look the same."""
        kind, _, value = (header or '').partition(' ')
        match = TOKEN.fullmatch(value.strip()) if kind.casefold() == 'bearer' else None
        if not match:
            return None
        row = self.read()['tokens'].get(match.group(1))
        if not row or not hmac.compare_digest(row['hash'], digest(match.group(2))):
            return None
        return {'via': 'token', 'token_id': match.group(1), 'name': row['name']}

    def list(self):
        data, day = self.read(), today(self.now())
        rows = []
        for identity, row in data['tokens'].items():
            usage = data['usage'].get('token:' + identity, {})
            used = usage if usage.get('day') == day else {}
            rows.append({'id': identity, 'name': row['name'], 'created_at': row['created_at'], 'last_used_at': row['last_used_at'],
                         'uploads_today': used.get('uploads', 0), 'bytes_today': used.get('bytes', 0)})
        return {'tokens': sorted(rows, key=lambda row: row['created_at']), 'daily_uploads': DAILY_UPLOADS, 'daily_bytes': DAILY_BYTES}

    @staticmethod
    def sender(identity):
        """The quota key for a request. Your own browser on this machine has no quota."""
        if not identity or identity.get('via') == 'local':
            return None
        if identity.get('via') == 'token':
            return 'token:' + identity['token_id']
        return 'login:' + str(identity.get('login'))

    def admit(self, identity, length):
        """Refuse before a body is read if this upload would pass the sender's daily limit. Counts it as admitted."""
        key = self.sender(identity)
        if key is None:
            return

        def change(data):
            day = today(self.now())
            usage = data['usage'].get(key)
            if not usage or usage.get('day') != day:
                usage = {'day': day, 'uploads': 0, 'bytes': 0}
            if usage['uploads'] >= DAILY_UPLOADS or usage['bytes'] + length > DAILY_BYTES:
                raise QuotaExceeded(f'This sender has reached today’s limit of {DAILY_UPLOADS} uploads or {DAILY_BYTES // 1024 ** 2} MB.')
            usage.update(uploads=usage['uploads'] + 1, bytes=usage['bytes'] + length)
            data['usage'] = {k: v for k, v in data['usage'].items() if v.get('day') == day}
            data['usage'][key] = usage
            if identity.get('via') == 'token' and identity['token_id'] in data['tokens']:
                data['tokens'][identity['token_id']]['last_used_at'] = self.now().isoformat(timespec='seconds')
        self.locked(change)
