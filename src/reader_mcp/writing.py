"""Your own writing, saved from the scratch pad into `library/notebook/` and committed one file at a time.

A save writes `library/notebook/YYYY-MM-DD-<slug>.md` atomically and never replaces a file: an existing
path is refused (409) with a free suggestion. A revision of a saved piece writes `<name>.vN.md` beside it,
leaving the original bytes unchanged, and is refused when the base file changed since the draft opened.
Only that one file is committed, through `git locks with ... .git/` when it is installed (as chat commits
are), with `Reader-Writing` and `Reader-Participant` trailers. Collection navigation (`library/index.md`,
`writings/`, browse indexes) is librarian upkeep and is never touched here."""
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
from uuid import UUID, uuid4

from .chats import git_locks_tool

NOTEBOOK = 'library/notebook'
MAX_BODY = 64 * 1024  # UTF-8 bytes; requests are capped at 128 KiB.
MAX_TITLE = 200
SLUG = re.compile(r'^[a-z0-9-]{1,60}$')
VERSION = re.compile(r'^(?P<stem>.+?)(?:\.v(?P<n>[0-9]{1,4}))?\.md$')
FIELDS = {'action', 'body', 'title', 'slug', 'status', 'responds_to', 'request_id', 'base', 'shifted'}
GIT_ENV = {'LC_ALL': 'C', 'GIT_TERMINAL_PROMPT': '0', 'GIT_PAGER': 'cat'}


class WritingConflict(Exception):
    """The target exists, or the base changed; the client may retry with `suggestion`."""
    def __init__(self, message, **extra):
        super().__init__(message)
        self.extra = extra


def quoted(value):
    return json.dumps(value, ensure_ascii=False)  # A JSON string is a valid YAML double-quoted scalar.


class Writing:
    def __init__(self, root, resolve, digest, git_locks=None, clock=None):
        self.root = Path(root).resolve(strict=True)
        self.resolve, self.digest = resolve, digest  # WebLibrary.path and .digest: validated, symlink-safe reads.
        self.git_locks = git_locks
        self.clock = clock or (lambda: datetime.now().astimezone())
        self.runtime = self.root / '.reader'
        self.guard = threading.Lock()
        self.done = {}  # request_id -> result, the most recent 256

    def dispatch(self, request, participant):
        if not isinstance(request, dict) or set(request) - FIELDS:
            raise ValueError('Unexpected writing request fields')
        if request.get('action') != 'save':
            raise ValueError('Expected {"action": "save", ...}')
        try:
            request_id = str(UUID(str(request.get('request_id'))))
        except ValueError:
            raise ValueError('request_id must be a UUID') from None
        with self.guard:
            if request_id in self.done:
                return self.done[request_id]
            self.runtime.mkdir(exist_ok=True)
            with (self.runtime / 'writing.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                result = self.save(request, participant)
            self.done[request_id] = result
            while len(self.done) > 256:
                self.done.pop(next(iter(self.done)))
            return result

    def checked(self, request):
        body, title, status = request.get('body'), request.get('title'), request.get('status', 'draft')
        if not isinstance(body, str) or len(body.encode()) > MAX_BODY:
            raise ValueError(f'The body must be text of at most {MAX_BODY // 1024} KiB')
        if not isinstance(title, str) or not title.strip() or len(title) > MAX_TITLE or any(c in title for c in '\r\n\x00'):
            raise ValueError(f'The title must be one line of 1–{MAX_TITLE} characters')
        if status not in ('draft', 'published'):
            raise ValueError('status must be draft or published')
        shifted = request.get('shifted')
        if shifted is not None and (not isinstance(shifted, str) or len(shifted) > 2000):
            raise ValueError('The "what shifted" note must be at most 2,000 characters')
        return body, title.strip(), status, (shifted or '').strip()

    def folder(self):
        library = self.root / 'library'
        notebook = self.root / NOTEBOOK
        if library.is_symlink() or not library.is_dir() or notebook.is_symlink():
            raise ValueError('The notebook must be a real folder inside library/')
        notebook.mkdir(exist_ok=True)
        if notebook.is_symlink() or notebook.resolve() != library.resolve() / 'notebook':
            raise ValueError('The notebook must be a real folder inside library/')
        return notebook

    def save(self, request, participant):
        body, title, status, shifted = self.checked(request)
        responds = None
        if request.get('responds_to'):
            path = request['responds_to']
            self.resolve(path)
            responds = (path, self.digest(path))
        base, slug = request.get('base'), request.get('slug')
        if not base and (not isinstance(slug, str) or not SLUG.fullmatch(slug)):
            raise ValueError('The slug must be 1–60 lowercase letters, digits or hyphens')
        notebook = self.folder()
        if base:
            target, revision, previous = self.revision(base, notebook)
        else:
            day = self.clock().date().isoformat()
            target, revision, previous = notebook / f'{day}-{slug}.md', 1, None
            if target.exists() or target.is_symlink():
                n = 2
                while (notebook / f'{day}-{slug}-{n}.md').exists():
                    n += 1
                raise WritingConflict(f'{NOTEBOOK}/{target.name} already exists', suggestion=f'{slug}-{n}')
        relative = f'{NOTEBOOK}/{target.name}'
        text = self.document(body, title, status, participant, responds, revision, previous, shifted)
        self.write(target, text)
        digest = hashlib.sha256(text.encode()).hexdigest()
        committed = self.commit(relative, title, participant, revision)
        return {'path': relative, 'sha256': digest, 'revision': revision, 'previous_version': previous} | committed

    def revision(self, base, notebook):
        """The next `.vN.md` beside a saved piece, refused when the piece changed since the draft opened."""
        if not isinstance(base, dict) or set(base) != {'path', 'sha256'}:
            raise ValueError('base must be {"path", "sha256"}')
        path = base['path']
        if not isinstance(path, str) or not path.startswith(NOTEBOOK + '/') or path.count('/') != 2:
            raise ValueError('Only notebook pieces can be revised here')
        self.resolve(path)
        if self.digest(path) != base['sha256']:
            raise WritingConflict('The saved piece changed since this draft opened; reopen it before saving a revision')
        match = VERSION.fullmatch(path.rsplit('/', 1)[1])
        if not match:
            raise ValueError('Only Markdown notebook pieces can be revised')
        stem = match['stem']
        numbers = [int(m['n'] or 1) for f in notebook.iterdir() if (m := VERSION.fullmatch(f.name)) and m['stem'] == stem]
        revision = max(numbers + [1]) + 1
        return notebook / f'{stem}.v{revision}.md', revision, path

    def document(self, body, title, status, participant, responds, revision, previous, shifted):
        lines = ['---', f'title: {quoted(title)}', f'author: {quoted(self.author(participant))}', f'participant: {quoted(participant)}',
                 f'date: {self.clock().date().isoformat()}', 'kind: Notebook', f'status: {status}']
        if responds:
            lines += [f'responds_to: {quoted(responds[0])}', f'responds_to_sha256: {responds[1]}']
        lines.append(f'document_revision: {revision}')
        if previous:
            lines.append(f'previous_version: {quoted(previous)}')
        if shifted:
            lines.append(f'what_shifted: {quoted(shifted)}')
        lines += ['tags: [you/writing]', '---', '']
        return '\n'.join(lines) + '\n' + body.rstrip('\n') + '\n'

    def author(self, participant):
        """The user's name from the vault's Git config, else the participant name."""
        git = shutil.which('git')
        if git:
            try:
                name = subprocess.run([git, 'config', 'user.name'], cwd=self.root, capture_output=True, text=True, timeout=10, env=GIT_ENV | {'PATH': os.environ.get('PATH', os.defpath), 'HOME': os.environ.get('HOME', '')}).stdout.strip()
                if name:
                    return name
            except (OSError, subprocess.SubprocessError):
                pass
        return participant

    @staticmethod
    def write(target, text):
        """Temporary file, then a hard link that fails if the target appeared meanwhile: never an overwrite."""
        with tempfile.NamedTemporaryFile('w', dir=target.parent, prefix='.writing-', suffix='.tmp', delete=False, encoding='utf-8') as out:
            out.write(text)
            out.flush()
            os.fsync(out.fileno())
            temporary = Path(out.name)
        try:
            os.link(temporary, target)
        except FileExistsError:
            raise WritingConflict(f'{NOTEBOOK}/{target.name} already exists') from None
        finally:
            temporary.unlink(missing_ok=True)

    def commit(self, relative, title, participant, revision):
        """Commit only this file. A failure (or a lock timeout) leaves it written but uncommitted, and says so."""
        git = shutil.which('git')
        if not git:
            return {'commit': None, 'status': 'no-git'}
        inside = subprocess.run([git, 'rev-parse', '--show-toplevel'], cwd=self.root, capture_output=True, text=True, timeout=10)
        if inside.returncode or Path(inside.stdout.strip()).resolve() != self.root:
            return {'commit': None, 'status': 'not-a-repository'}
        subject = ('Write ' if revision == 1 else f'Revise (v{revision}) ') + title
        message = subject + '\n\nReader-Writing: ' + relative + '\nReader-Participant: ' + participant + '\n'
        self.runtime.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile('w', dir=self.runtime, prefix='.writing-commit-', suffix='.txt', delete=False) as out:
            out.write(message)
            note = Path(out.name)
        try:
            script = 'git add -- "$2" && git commit -q -F "$1" -- "$2"'
            command = ['sh', '-c', script, 'reader-writing-commit', str(note), relative]
            tool = self.git_locks if self.git_locks is not None else git_locks_tool()
            if tool:
                command = [tool, 'with', '--job', 'reader-writing-' + uuid4().hex, '--holder', 'reader-writing', '--ttl', '300',
                           '--wait', '120', '--note', 'Reader notebook commit', '.git/', '--'] + command
            # Chats, receipts and writing share the vault's .git/ lock; Reader processes also share this flock.
            with (self.runtime / 'chat-commit.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired:
            return {'commit': None, 'status': 'failed', 'error': 'The commit timed out; the file is written but not committed.'}
        finally:
            note.unlink(missing_ok=True)
        if result.returncode:
            return {'commit': None, 'status': 'failed', 'error': ((result.stderr or result.stdout)[-600:].strip() or 'git commit failed') + ' The file is written but not committed.'}
        head = subprocess.run([git, 'log', '-1', '--format=%H', '--', relative], cwd=self.root, capture_output=True, text=True, timeout=10)
        return {'commit': head.stdout.strip() or None, 'status': 'committed', 'locked_by': 'git-locks' if tool else 'flock'}
