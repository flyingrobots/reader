"""Chats with the voices about one document: a shared vault store at `chats/<uuid>.json`.

The writer follows the annotation pattern (flock, atomic replace, idempotent request
IDs, size caps). Chat files are committed to the vault, one chat (and its LLM run logs) per commit, through
`git locks with … .git/` when git-locks is installed."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from uuid import UUID, uuid4

MAX_CHATS = 5000
MAX_MESSAGES = 2000
MAX_FILE = 8 * 1024**2
MAX_BODY = 64 * 1024
KINDS = ('message', 'chime_in', 'hand')
HAND_STATES = ('raised', 'accepted', 'declined', 'expired')
CHIME_INS = ('off', 'hands', 'free')
DEFAULT_CHIME_INS = 'hands'


def chime_ins(chat):
    value = (chat.get('settings') or {}).get('chime_ins')
    return value if value in CHIME_INS else DEFAULT_CHIME_INS


def now():
    return datetime.now(timezone.utc).isoformat()


def git_locks_tool():
    candidates = [shutil.which('git-locks'), str(Path.home() / '.local/bin/git-locks'),
                  '/opt/homebrew/bin/git-locks', '/usr/local/bin/git-locks']
    return next((p for p in candidates if p and os.path.isfile(p) and os.access(p, os.X_OK)), None)


class Chats:
    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        self.folder = self.root / 'chats'
        self.runtime = self.root / '.reader'

    @staticmethod
    def identity(value):
        return str(UUID(str(value)))

    @staticmethod
    def text(value, name, maximum, empty=False):
        if not isinstance(value, str) or (not empty and not value.strip()) or len(value) > maximum:
            raise ValueError(f'{name} must contain {"0" if empty else "1"}–{maximum} characters')
        return value

    @contextmanager
    def locked(self):
        self.runtime.mkdir(exist_ok=True)
        if self.folder.is_symlink():
            raise ValueError('Chat folder must not be a symlink')
        self.folder.mkdir(exist_ok=True)
        with (self.runtime / 'chats.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def file(self, chat_id):
        return self.folder / (self.identity(chat_id) + '.json')

    def read(self, chat_id):
        if self.folder.is_symlink():
            raise ValueError('Chat folder must not be a symlink')
        path = self.file(chat_id)
        if not path.exists():
            raise ValueError('Unknown chat')
        if path.is_symlink() or path.stat().st_size > MAX_FILE:
            raise ValueError('Unsafe or oversized chat file')
        chat = json.loads(path.read_text())
        if chat.get('schema_version') != 1 or chat.get('id') != self.identity(chat_id):
            raise ValueError('Invalid chat identity/schema')
        return chat

    def write(self, chat):
        data = (json.dumps(chat, ensure_ascii=False, indent=2) + '\n').encode()
        if len(data) > MAX_FILE:
            raise ValueError('Chat exceeds 8 MiB; start a new chat')
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.folder, prefix='.chat-', delete=False) as out:
                temporary = Path(out.name); out.write(data); out.flush(); os.fsync(out.fileno())
            os.replace(temporary, self.file(chat['id']))
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

    def inventory(self):
        if not self.folder.exists():
            return []
        if self.folder.is_symlink():
            raise ValueError('Chat folder must not be a symlink')
        files = sorted(p for p in self.folder.glob('*.json') if not p.name.startswith('.'))
        if len(files) > MAX_CHATS:
            raise ValueError('Chat inventory exceeds 5,000 chats')
        return files

    def list(self, path):
        chats = []
        for file in self.inventory():
            try:
                chat = self.read(file.stem)
            except ValueError:
                continue
            if chat['document_path'] != path:
                continue
            last = chat['messages'][-1] if chat['messages'] else None
            chats.append({k: chat.get(k) for k in ('id', 'title', 'document_path', 'document_sha256', 'started_by', 'created_at', 'revision')} | {
                'updated_at': last['created_at'] if last else chat['created_at'], 'messages': len(chat['messages']),
                'last': {'author': last['author'], 'body': last['body'][:200]} if last else None})
        return sorted(chats, key=lambda c: c['updated_at'], reverse=True)

    def create(self, path, sha256, title, started_by, request_id=None, reuse=False):
        """Create a chat; with `reuse`, return the document's newest chat instead when one exists.

        Reuse is checked under the store lock, so two tabs that each start a document's first
        chat end up in the same one."""
        chat_id = self.identity(request_id) if request_id else str(uuid4())
        title = self.text(title, 'Title', 500)
        started_by = self.text(started_by, 'Participant', 100).strip()
        with self.locked():
            if reuse and not self.file(chat_id).exists():
                existing = self.list(path)
                if existing:
                    return self.read(existing[0]['id'])
            if self.file(chat_id).exists():
                previous = self.read(chat_id)
                if (previous['document_path'], previous['started_by']) == (path, started_by):
                    return previous
                raise ValueError('Chat request ID already exists with different input')
            if len(self.inventory()) >= MAX_CHATS:
                raise ValueError('Chat inventory exceeds 5,000 chats')
            chat = dict(schema_version=1, id=chat_id, document_path=path, document_sha256=sha256, title=title,
                        started_by=started_by, created_at=now(), revision=1, messages=[])
            self.write(chat)
            return chat

    def append(self, chat_id, message):
        """Append one message; a repeated message ID with identical content is a no-op."""
        message = dict(message)
        message['id'] = self.identity(message.get('id') or uuid4())
        self.text(message.get('author'), 'Author', 100)
        self.text(message.get('body', ''), 'Message', MAX_BODY, empty=message.get('turn') is not None)
        message.setdefault('created_at', now())
        if message.get('kind', 'message') not in KINDS:
            raise ValueError('Message kind must be message, chime_in or hand')
        if message.get('kind') == 'hand' and message.get('state') not in HAND_STATES:
            raise ValueError('A raised hand needs a state')
        if message.get('reply_to') is not None:
            message['reply_to'] = self.identity(message['reply_to'])
        with self.locked():
            chat = self.read(chat_id)
            for existing in chat['messages']:
                if existing['id'] == message['id']:
                    if (existing['author'], existing['body'], existing.get('reply_to')) == (message['author'], message['body'], message.get('reply_to')):
                        return chat, False
                    raise ValueError('Message request ID already exists with different input')
            if message.get('reply_to') and not any(m['id'] == message['reply_to'] for m in chat['messages']):
                raise ValueError('Reply parent is not in this chat')
            if len(chat['messages']) >= MAX_MESSAGES:
                raise ValueError('Chat exceeds 2,000 messages; start a new chat')
            chat['messages'].append(message)
            chat['revision'] += 1
            self.write(chat)
            return chat, True

    def amend(self, chat_id, message_id, change):
        """Update one message in place under the lock: `change(message)` returns True when it changed it."""
        with self.locked():
            chat = self.read(chat_id)
            message = next((m for m in chat['messages'] if m['id'] == message_id), None)
            if message is None:
                raise ValueError('Unknown message in this chat')
            if change(message):
                chat['revision'] += 1
                self.write(chat)
            return chat, message

    def amend_all(self, chat_id, change):
        """Apply `change(message)` to every message; write once when any returned True."""
        with self.locked():
            chat = self.read(chat_id)
            changed = [m for m in chat['messages'] if change(m)]
            if changed:
                chat['revision'] += 1
                self.write(chat)
            return chat, changed

    def configure(self, chat_id, chime_ins):
        if chime_ins not in CHIME_INS:
            raise ValueError('chime_ins must be off, hands or free')
        with self.locked():
            chat = self.read(chat_id)
            if (chat.get('settings') or {}).get('chime_ins') == chime_ins:
                return chat, False
            chat['settings'] = dict(chat.get('settings') or {}, chime_ins=chime_ins)
            chat['revision'] += 1
            self.write(chat)
            return chat, True

    # Commits --------------------------------------------------------------

    def commit(self, chat_id, subject, voice=None, git_locks=None, holder='reader-chat', logs=()):
        """Commit only this chat's file and the given LLM run directories (`logs/llm/…`).
        Returns {'commit': hash|None, 'status': ...}."""
        from .llm_logs import RELATIVE, safe_dir
        relative = 'chats/' + self.identity(chat_id) + '.json'
        logs = [log for log in logs if log]
        for log in logs:
            safe_dir(self.root, log)
        trailers = ''.join('\nReader-Log: ' + '/'.join(RELATIVE.fullmatch(log).group(1, 2)) for log in logs)
        git = shutil.which('git')
        if not git:
            return {'commit': None, 'status': 'no-git'}
        inside = subprocess.run([git, 'rev-parse', '--show-toplevel'], cwd=self.root, capture_output=True, text=True, timeout=10)
        if inside.returncode or Path(inside.stdout.strip()).resolve() != self.root:
            return {'commit': None, 'status': 'not-a-repository'}
        message = subject + '\n\nReader-Chat: ' + self.identity(chat_id) + ('\nReader-Voice: ' + voice if voice else '') + trailers + '\n'
        runtime = self.runtime / 'voice-runner'
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile('w', dir=runtime, prefix='.commit-', suffix='.txt', delete=False) as out:
            out.write(message); note = Path(out.name)
        try:
            # LLM run directories are added with -A -f: their compressed files replace the streamed partials,
            # and they are archived even if an ignore rule would hide them.
            script = ('note="$1"; chat="$2"; shift 2; if [ -e "$chat" ]; then git add -- "$chat" || exit 1; fi; '
                      'if [ "$#" -gt 0 ]; then git add -A -f -- "$@" || exit 1; fi; '
                      'if git diff --cached --quiet -- "$chat" "$@"; then echo nothing-to-commit; else git commit -q -F "$note" -- "$chat" "$@"; fi')
            command = ['sh', '-c', script, 'reader-chat-commit', str(note), relative, *logs]
            tool = git_locks if git_locks is not None else git_locks_tool()
            if tool:
                command = [tool, 'with', '--job', 'reader-chat-' + uuid4().hex, '--holder', holder, '--ttl', '300',
                           '--wait', '120', '--note', 'Reader chat commit', '.git/', '--'] + command
            # Cooperating Reader processes also serialize on one flock (the only lock without git-locks).
            with (self.runtime / 'chat-commit.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, timeout=180)
        finally:
            note.unlink(missing_ok=True)
        if result.returncode:
            return {'commit': None, 'status': 'failed', 'error': (result.stderr or result.stdout)[-600:].strip()}
        if 'nothing-to-commit' in result.stdout:
            return {'commit': None, 'status': 'unchanged'}
        head = subprocess.run([git, 'log', '-1', '--format=%H', '--', relative, *logs], cwd=self.root, capture_output=True, text=True, timeout=10)
        return {'commit': head.stdout.strip() or None, 'status': 'committed', 'locked_by': 'git-locks' if tool else 'flock'}
