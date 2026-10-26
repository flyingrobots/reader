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
from uuid import UUID, uuid4, uuid5

from .chats import git_locks_tool
from .companions import repo_env
from .display import shown

NOTEBOOK = 'library/notebook'
MAX_BODY = 64 * 1024  # UTF-8 bytes; requests are capped at 128 KiB.
MAX_TITLE = 200
SLUG = re.compile(r'^[a-z0-9-]{1,60}$')
VERSION = re.compile(r'^(?P<stem>.+?)(?:\.v(?P<n>[0-9]{1,4}))?\.md$')
FIELDS = {'action', 'body', 'title', 'slug', 'status', 'responds_to', 'request_id', 'base', 'shifted', 'prompt_id', 'ask_reply'}
GIT_ENV = {'LC_ALL': 'C', 'GIT_TERMINAL_PROMPT': '0', 'GIT_PAGER': 'cat'}


class WritingConflict(Exception):
    """The target exists, or the base changed; the client may retry with `suggestion`."""
    def __init__(self, message, **extra):
        super().__init__(message)
        self.extra = extra


def quoted(value):
    return json.dumps(value, ensure_ascii=False)  # A JSON string is a valid YAML double-quoted scalar.


class Writing:
    def __init__(self, root, resolve, digest, git_locks=None, clock=None, prompts=None, conversations=None):
        self.root = Path(root).resolve(strict=True)
        self.resolve, self.digest = resolve, digest  # WebLibrary.path and .digest: validated, symlink-safe reads.
        self.git_locks = git_locks
        self.clock = clock or (lambda: datetime.now().astimezone())
        self.runtime = self.root / '.reader'
        self.guard = threading.Lock()
        self.prompts, self.conversations = prompts, conversations

    def dispatch(self, request, participant):
        if not isinstance(request, dict) or set(request) - FIELDS:
            raise ValueError('Unexpected writing request fields')
        if request.get('action') not in ('save', 'revise'):
            raise ValueError('Expected a save or revise writing request')
        if request['action'] == 'revise' and not request.get('base'):
            raise ValueError('A revision requires its base path and digest')
        if 'ask_reply' in request and type(request['ask_reply']) is not bool:
            raise ValueError('ask_reply must be a boolean')
        try:
            request_id = str(UUID(str(request.get('request_id'))))
        except ValueError:
            raise ValueError('request_id must be a UUID') from None
        fingerprint = hashlib.sha256(json.dumps([request, participant], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with self.guard:
            self.runtime.mkdir(exist_ok=True)
            if self.runtime.is_symlink():
                raise ValueError('Writing runtime must not cross symlinks')
            with (self.runtime / 'writing.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                journal = self.runtime / 'writing-requests'
                if journal.is_symlink():
                    raise ValueError('Writing request journal must not be a symlink')
                journal.mkdir(exist_ok=True)
                file = journal / (request_id + '.json')
                if file.is_symlink():
                    raise ValueError('Writing request must not be a symlink')
                if file.exists():
                    if file.stat().st_size > 128 * 1024:
                        raise ValueError('Writing request record exceeds its limit')
                    old = json.loads(file.read_text())
                    if old['fingerprint'] != fingerprint:
                        raise ValueError('Writing request ID already exists with different input')
                    if old.get('result'):
                        return shown(old['result'], self.root)
                    result = self.finish_save(old['plan'], recover=True)
                    self.record(file, {'fingerprint': fingerprint, 'result': result})
                    return shown(result, self.root)
                if sum(1 for _ in journal.iterdir()) >= 5000:
                    raise ValueError('Writing request journal exceeds 5,000 records')
                def planned(plan):
                    self.record(file, {'fingerprint': fingerprint, 'plan': plan})
                result = self.save(request, participant, planned)
                self.record(file, {'fingerprint': fingerprint, 'result': result})
            return shown(result, self.root)

    @staticmethod
    def record(file, value):
        data = (json.dumps(value, ensure_ascii=False) + '\n').encode()
        if len(data) > 128 * 1024:
            raise ValueError('Writing request record exceeds 128 KiB')
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=file.parent, prefix='.request-', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary, file)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

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

    def save(self, request, participant, planned=None):
        body, title, status, shifted = self.checked(request)
        prompt = None
        if request.get('prompt_id'):
            if self.prompts is None or not request.get('responds_to'):
                raise ValueError('A saved prompt and responds_to article are required')
            prompt = self.prompts.get(request['responds_to'], prompt_id=request['prompt_id'])
            if not prompt:
                raise ValueError('Unknown prompt for this article')
        chat_id = None
        if request.get('ask_reply'):
            if not prompt or self.conversations is None:
                raise ValueError('Choose a saved prompt before asking its voice for a reply')
            self.conversations.runner.own()
            self.prompts.tasks.choose(prompt['document_path'], prompt['author'])
            from .chats import MAX_BODY as CHAT_BODY
            if len(body + self.mention(prompt)) > CHAT_BODY:
                raise ValueError('The answer and voice mention exceed the chat message limit')
            chat_id = str(uuid5(UUID(request['request_id']), 'writing-reply'))
        responds = None
        if request.get('responds_to'):
            path = request['responds_to']
            self.resolve(path)
            responds = (path, self.digest(path))
            if prompt:
                responds = (path, prompt['document_sha256'])
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
        if prompt:
            import yaml
            header, contents = text[4:].split('\n---\n', 1)
            metadata = yaml.safe_load(header)
            metadata.update(frontmatter_schema_version=1, type='Response', writing_type='Response',
                created=self.clock().date().isoformat(), prompt_id=prompt['id'],
                prompt={'by': prompt['author'], 'text': prompt['question'],
                        'quote': (prompt['evidence'] or {}).get('quote'), 'evidence': prompt['evidence'],
                        'source_sha256': prompt['document_sha256']})
            if chat_id:
                metadata['chat'] = f'chats/{chat_id}.json'
            text = '---\n' + yaml.safe_dump(metadata, sort_keys=False, allow_unicode=True, default_flow_style=False) + '---\n' + contents
        digest = hashlib.sha256(text.encode()).hexdigest()
        plan = dict(path=relative, text=text, sha256=digest, title=title, participant=participant, revision=revision,
                    previous_version=previous, prompt=prompt, chat_id=chat_id, request_id=request['request_id'])
        if planned:
            planned(plan)
        return self.finish_save(plan)

    def finish_save(self, plan, recover=False):
        relative = plan['path']
        if not isinstance(relative, str) or not relative.startswith(NOTEBOOK + '/') or relative.count('/') != 2 or Path(relative).name in ('.', '..'):
            raise ValueError('Invalid saved writing request path')
        target = self.folder() / Path(relative).name
        data = plan['text'].encode()
        if hashlib.sha256(data).hexdigest() != plan['sha256']:
            raise ValueError('Writing request content digest does not match')
        if recover and target.exists() and not target.is_symlink():
            if target.read_bytes() != data:
                raise WritingConflict('The saved request destination changed; preserve it and inspect the request journal')
        else:
            self.write(target, plan['text'])
        prompt = plan['prompt']
        committed = self.commit(relative, plan['title'], plan['participant'], plan['revision'], prompt['author'] if prompt else None)
        result = {k: plan[k] for k in ('path', 'sha256', 'revision', 'previous_version')} | committed
        if plan['chat_id']:
            try:
                # The body is the exact saved response, excluding generated frontmatter.
                body = plan['text'].split('\n---\n', 1)[1][1:]
                self.reply(plan['chat_id'], prompt, body, plan['participant'], plan['request_id'])
                result['chat_id'] = plan['chat_id']
            except (ValueError, OSError, subprocess.SubprocessError) as exc:
                result['reply_error'] = 'The writing was saved, but the reply could not start: ' + str(exc)[:300]
        return result

    def mention(self, prompt):
        registry = self.conversations.registry.load()
        voice = next(v for v in registry['voices'] if v['name'] == prompt['author'])
        return '\n\n@' + voice['mention'][0]

    def reply(self, chat_id, prompt, body, participant, request_id):
        conversations = self.conversations
        chat = conversations.create(prompt['document_path'], participant, request_id=chat_id)['chat']
        prompt_message = str(uuid5(UUID(request_id), 'writing-question'))
        conversations.chats.append(chat['id'], dict(id=prompt_message, author=prompt['author'], body=prompt['question'],
            runtime={'prompt_id': prompt['id'], 'source_sha256': prompt['document_sha256'], 'origin': 'saved-writing-prompt'}))
        conversations.send(chat['id'], body + self.mention(prompt), participant,
            request_id=str(uuid5(UUID(request_id), 'writing-answer')), reply_to=prompt_message)

    def list(self, participant, responds_to=None):
        from .metadata import source_frontmatter
        notebook = self.root / NOTEBOOK
        if (self.root / 'library').is_symlink() or notebook.is_symlink():
            raise ValueError('Notebook must not be a symlink')
        rows = []
        for count, file in enumerate(notebook.glob('*.md'), 1):
            if count > 5000:
                raise ValueError('Notebook inventory exceeds 5,000 files')
            try:
                if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_BODY + 16 * 1024:
                    continue
                # Preserve old source fields; an unreadable piece must not disable
                # every article's reading log or the other notebook entries.
                metadata, _ = source_frontmatter(file.read_bytes())
            except (ValueError, OSError):
                continue
            if metadata.get('participant') != participant or responds_to and metadata.get('responds_to') != responds_to:
                continue
            rows.append({key: metadata.get(key) for key in ('title', 'date', 'responds_to', 'responds_to_sha256', 'prompt_id', 'participant', 'document_revision')}
                        | {'path': str(file.relative_to(self.root)),
                           'prompt': metadata.get('prompt') if isinstance(metadata.get('prompt'), dict) else None})
        if responds_to and self.prompts:
            from .learning import evidence, source
            try:
                text = source(self.prompts.documents, responds_to)['text']
            except ValueError:
                text = None
            for row in rows:
                anchor = (row.get('prompt') or {}).get('evidence')
                try:
                    row['evidence'] = evidence(text, anchor) if text is not None and anchor else None
                except ValueError:
                    row['evidence'] = None
        return sorted(rows, key=lambda row: (str(row['date']), row['path']), reverse=True)

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

    def commit(self, relative, title, participant, revision, prompt_voice=None):
        """Commit only this file. A failure (or a lock timeout) leaves it written but uncommitted, and says so."""
        git = shutil.which('git')
        if not git:
            return {'commit': None, 'status': 'no-git'}
        inside = subprocess.run([git, 'rev-parse', '--show-toplevel'], cwd=self.root, capture_output=True, text=True, timeout=10)
        if inside.returncode or Path(inside.stdout.strip()).resolve() != self.root:
            return {'commit': None, 'status': 'not-a-repository'}
        subject = ('Write ' if revision == 1 else f'Revise (v{revision}) ') + title
        message = subject + '\n\nReader-Writing: ' + relative + '\nReader-Participant: ' + participant + '\n'
        if prompt_voice:
            message += 'Reader-Prompt-Voice: ' + prompt_voice + '\n'
        self.runtime.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile('w', dir=self.runtime, prefix='.writing-commit-', suffix='.txt', delete=False) as out:
            out.write(message)
            note = Path(out.name)
        try:
            script = 'git add -- "$2" && { git diff --cached --quiet -- "$2" || git commit -q -F "$1" -- "$2"; }'
            command = ['sh', '-c', script, 'reader-writing-commit', str(note), relative]
            tool = self.git_locks if self.git_locks is not None else git_locks_tool(self.root)
            if tool:
                command = [tool, 'with', '--job', 'reader-writing-' + uuid4().hex, '--holder', 'reader-writing', '--ttl', '300',
                           '--wait', '120', '--note', 'Reader notebook commit', '.git/', '--'] + command
            # Chats, receipts and writing share the vault's .git/ lock; Reader processes also share this flock.
            with (self.runtime / 'chat-commit.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                result = subprocess.run(command, cwd=self.root, capture_output=True, text=True, timeout=180, env=repo_env())
        except subprocess.TimeoutExpired:
            return {'commit': None, 'status': 'failed', 'error': 'The commit timed out; the file is written but not committed.'}
        finally:
            note.unlink(missing_ok=True)
        if result.returncode:
            return {'commit': None, 'status': 'failed', 'error': ((result.stderr or result.stdout)[-600:].strip() or 'git commit failed') + ' The file is written but not committed.'}
        head = subprocess.run([git, 'log', '-1', '--format=%H', '--', relative], cwd=self.root, capture_output=True, text=True, timeout=10)
        return {'commit': head.stdout.strip() or None, 'status': 'committed', 'locked_by': 'git-locks' if tool else 'flock'}
