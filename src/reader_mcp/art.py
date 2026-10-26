"""Bespoke article art (RW-43): commissioned, validated, stored and committed per edition.

A commission is a background job. The chosen producer, a voice from `voices.json` (its CLI and
subscription) or the configured local model, reads the article and writes an *art brief*, then turns
the brief into a *scene description* in Reader's declarative scene language (`art_scene.py`). A
scene the validator refuses goes back once, with the errors, for repair. Nothing a model writes is
ever executed: the browser draws validated scenes with Reader's own interpreter.

Prompts are versioned files in `art_prompts/`. Every model call is archived under
`logs/llm/art/…` (kept forever). Voice CLIs run in an empty workspace under `.reader/art/work/`
with the article inline, never in the vault, and with the same process-group, CPU, memory, output,
disk and timeout guards as chat turns (`voice_runner.supervise`).

Accepted art is a new, never-overwritten version beside its edition:

    art/<path under library/>/<source sha256>/<generation>/scene.json
                                                           brief.md         (the Artist's note)
                                                           provenance.json
                                                           still.png|.webp  (optional, captured by the first browser to draw it)
    art/<path under library/>/favorite.json                (the version the reader picked)

and committed to the vault with `Reader-Art:` and `Reader-Log:` trailers. Job history is kept in
`.reader/art/jobs.json`; jobs owned by another live Reader process are shown but never adopted."""
from collections import deque
from contextlib import nullcontext
from datetime import datetime, timezone
import base64
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import traceback
import uuid

from . import art_scene, llm_logs
from . import voices as voice_tools
from .metadata import FrontmatterError, decode_frontmatter
from .resources import has_capacity, minimum_free_bytes

PROMPTS = Path(__file__).with_name('art_prompts')
PROMPT_VERSIONS = {'brief': 'brief.v1', 'scene': 'scene.v1', 'repair': 'repair.v1', 'dsl': 'dsl.v1'}
DIRECTION_VERSION = 'direction.v1'  # the reader's direction for one commission (#147), appended to the brief and scene prompts
MAX_DIRECTION = 2000           # characters of a reader's direction
PROMPT_LIMIT = 512 * 1024      # bytes of one stage's archived prompt that /api/art/prompt returns (#146)
PROMPT_STAGES = ('brief', 'scene', 'repair')
# The quoted blocks a prompt fences with its nonce: the article (brief stage) and the brief (scene stage).
FENCE = re.compile(r'<<<READER-(ARTICLE|BRIEF|DIRECTION) ([0-9a-f]{8,64})>>>\n(.*?)\n<<<END READER-\1 \2>>>', re.S)
ART_ROOT = 'art'
# `Reader-Art: library/<path>@<edition>/<generation>[ (favorite|still)]`; group 1 is the path under library/.
ART_TRAILER = re.compile(r'^Reader-Art: library/([^@\n]+)@[0-9a-f]{12}/', re.M)
TEXT_KINDS = ('.md', '.markdown', '.txt')
MAX_SOURCE = 4 * 1024**2
MAX_ARTICLE = 60_000           # characters of the article sent to the producer
STAGE_TIMEOUT = 600            # seconds per model call (and at most the voice's own timeout)
LOCAL_OUTPUT = 12_000          # tokens of a local-model answer
LOCAL_REASONING = 6_000
MAX_QUEUE = 20
KEEP_JOBS = 60
MAX_VERSIONS = 200
MAX_STILL = 2 * 1024**2
STILL_SIZE = (2048, 1536)
RETRY_AFTER = 24 * 3600        # an automatic commission does not retry a failed edition sooner
MAX_COMMISSION = 6
GENERATION = re.compile(r'\d{8}T\d{6}Z-[0-9a-f]{4}')
SHA = re.compile(r'[0-9a-f]{64}')
ACTIVE = ('queued', 'waiting', 'running')
ART_RULES = ('This is a Reader art commission, not a chat turn. Do not run turn-boundary upkeep, intake or spoken summaries, '
             'do not launch other agents, do not run tools, and do not read or change any file: everything you need is in '
             'this message. Answer only in the form the message asks for.')


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def short(error, limit=600):
    text = str(error) or type(error).__name__
    return text if len(text) <= limit else text[:limit] + '…'


def template(name):
    return (PROMPTS / ((DIRECTION_VERSION if name == 'direction' else PROMPT_VERSIONS[name]) + '.md')).read_text()


def render(name, **values):
    text = template(name)
    for key, value in values.items():
        text = text.replace('{{' + key + '}}', str(value))
    return text


def direction_of(value):
    """A reader's direction for a commission (#147): None, or plain text of at most MAX_DIRECTION characters."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError('A direction is text')
    text = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', value).replace('\r\n', '\n').strip()
    if len(text) > MAX_DIRECTION:
        raise ValueError(f'A direction is at most {MAX_DIRECTION:,} characters')
    return text or None


def parse_brief(text):
    """(title, brief) from a `TITLE: … BRIEF: …` answer; lenient about decoration, strict about substance."""
    text = (text or '').strip()
    text = re.sub(r'^```[a-z]*\n|\n```$', '', text).strip()
    title = None
    match = re.search(r'(?im)^\**\s*TITLE\s*:\**\s*(.+)$', text)
    if match:
        title = match.group(1).strip().strip('*"“” ').strip()
    body = re.split(r'(?im)^\**\s*BRIEF\s*:\**\s*', text, maxsplit=1)
    brief = body[1].strip() if len(body) == 2 else (text[match.end():].strip() if match else text)
    brief = re.sub(r'\n{3,}', '\n\n', brief)
    if not 40 <= len(brief) <= 4000:
        raise ValueError(f'The art brief was {len(brief)} characters; expected 40 to 4,000')
    return (title or 'Untitled')[:80], brief


def usage_of(line):
    """Usage and cost a CLI reported on one stdout line (Claude, Codex or agy), or None."""
    try:
        event = json.loads(line)
    except ValueError:
        return None
    if not isinstance(event, dict):
        return None
    found = None
    if event.get('type') == 'result':
        found = {'usd': event.get('total_cost_usd'), **(event.get('usage') or {})}
    elif event.get('type') == 'turn.completed':
        found = dict(event.get('usage') or {})
    elif event.get('event') == 'result' and isinstance(event.get('result'), dict):
        found = dict(event['result'].get('usage') or {})
    if not found:
        return None
    tokens = lambda *keys: sum(v for k in keys if isinstance(v := found.get(k), (int, float)) and not isinstance(v, bool))
    usd = found.get('usd')
    return {'input_tokens': tokens('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'prompt_tokens'),
            'output_tokens': tokens('output_tokens', 'completion_tokens', 'thinking_tokens'),
            'usd': usd if isinstance(usd, (int, float)) and not isinstance(usd, bool) else None}


def add_usage(total, part):
    if not part:
        return total
    total = dict(total or {'input_tokens': 0, 'output_tokens': 0, 'usd': None})
    total['input_tokens'] += part.get('input_tokens') or 0
    total['output_tokens'] += part.get('output_tokens') or 0
    if part.get('usd') is not None:
        total['usd'] = round((total['usd'] or 0) + part['usd'], 6)
    return total


class Cancelled(Exception):
    pass


OWNED = 'Another Reader server owns art for this vault'


class ArtOwned(Exception):
    """Another Reader server owns art commissions for this vault; the API answers 409."""


class ArtMissing(FileNotFoundError):
    """No such art version or still image; the API answers 404."""


class Studio:
    def __init__(self, root, library, *, git_locks=None, limits=True, capacity=None, commit=True, registry=None, stage_timeout=None):
        self.root = Path(root).resolve(strict=True)
        self.library = library
        self.runtime = self.root / '.reader' / 'art'
        self.jobs_file = self.runtime / 'jobs.json'
        self.registry = registry or voice_tools.Registry(self.root)
        self.git_locks = git_locks
        self.limits = limits
        self.capacity = capacity or has_capacity
        self.commit_enabled = commit
        self.stage_timeout = stage_timeout or STAGE_TIMEOUT
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)
        self.jobs = {}
        self.foreign = {}
        self.queue = deque()
        self.worker = None
        self.closed = False
        self.versions_cache = {}
        # Only the server that holds `.reader/art/supervisor.lock` adopts, runs or records art jobs (#138), as for chat
        # (#20, #72); job pids are for display. Another server on the vault shows the jobs read-only and refuses art
        # actions until the owner stops. The lock is taken at start only when there are jobs to recover, and otherwise
        # on the first art action, so a server that only reads writes nothing to the vault.
        from .voice_runner import Supervisor  # voice_runner imports this module
        self.supervisor = Supervisor(self.runtime, name='reader-art-supervisor')
        self.owner = self.jobs_file.is_file() and self.supervisor.acquire()
        if self.owner:
            self.recover()

    # Producers ----------------------------------------------------------------

    def producers(self):
        """Voices that can make art (any runnable voice) and the local model, with the default."""
        rows, error = [], None
        try:
            registry = self.registry.load()
        except (ValueError, OSError) as exc:
            registry, error = {'voices': []}, short(exc, 300)
        for voice in registry['voices']:
            if voice['manual']:
                continue
            rows.append({'id': 'voice:' + voice['name'], 'kind': 'voice', 'label': voice['name'], 'available': voice_tools.runnable(voice),
                         'cli': os.path.basename(voice['cli']) if voice.get('cli') else None, 'model': voice.get('model'),
                         'estimate_seconds': self.estimate('voice:' + voice['name'])})
        local = self.local_settings()
        if local:
            rows.append({'id': 'local', 'kind': 'local', 'label': 'Local model', 'available': bool(local['model']), 'cli': None,
                         'model': local['model'], 'provider': local['label'], 'estimate_seconds': self.estimate('local')})
        default = next((r['id'] for r in rows if r['available'] and r['kind'] == 'voice'), None) or next((r['id'] for r in rows if r['available']), None)
        return {'producers': rows, 'default': default, 'error': error}

    def local_settings(self):
        model = getattr(self.library, 'local_model', None)
        if model is None:
            return None
        try:
            provider = model.provider()
        except (ValueError, OSError):
            return None
        return {'model': provider.get('model') or '', 'label': provider.get('label'), 'preset': provider.get('preset')}

    def producer(self, value):
        listed = self.producers()
        value = value or listed['default']
        row = next((r for r in listed['producers'] if r['id'] == value), None)
        if not row:
            raise ValueError('No art producer named ' + str(value) + '. Choose one in Settings (Art made by).' if value else
                             'No voice or local model can make art. Add a voice to voices.json or set up a local model.')
        if not row['available']:
            raise ValueError(f'{row["label"]} cannot make art right now: ' + ('its CLI is not installed or it is disabled.' if row['kind'] == 'voice' else 'no local model is configured.'))
        return row

    def estimate(self, producer):
        times = sorted(j['seconds'] for j in [*self.jobs.values(), *self.foreign.values()]
                       if j.get('producer') == producer and j.get('state') == 'done' and isinstance(j.get('seconds'), (int, float)))
        return times[len(times) // 2] if times else None

    # Storage ------------------------------------------------------------------

    def folder(self, path, create=False):
        """`art/<path under library/>/`, refusing symlinks on the way."""
        self.library.path(path)
        relative = ART_ROOT + '/' + path[len('library/'):]
        target = self.root
        for part in relative.split('/'):
            target = target / part
            if target.is_symlink():
                raise ValueError('Art folders must not contain symlinks')
            if create and not target.exists():
                target.mkdir()
        return target, relative

    def versions(self, path):
        """Every stored version for a path, newest first: [{edition, generation, title, …}]."""
        folder, relative = self.folder(path)
        rows = []
        if not folder.is_dir():
            return rows
        for edition in sorted(folder.iterdir()):
            if not SHA.fullmatch(edition.name) or edition.is_symlink() or not edition.is_dir():
                continue
            for generation in sorted(edition.iterdir()):
                if len(rows) >= MAX_VERSIONS:
                    break
                if not GENERATION.fullmatch(generation.name) or generation.is_symlink() or not generation.is_dir():
                    continue
                try:
                    meta = json.loads((generation / 'provenance.json').read_text())
                except (OSError, ValueError):
                    continue
                still = next((n for n in ('still.png', 'still.webp') if (generation / n).is_file() and not (generation / n).is_symlink()), None)
                rows.append({'edition': edition.name, 'generation': generation.name, 'title': meta.get('title'), 'created_at': meta.get('created_at'),
                             'producer': (meta.get('producer') or {}).get('label'), 'model': (meta.get('producer') or {}).get('model'),
                             'still': still, 'folder': f'{relative}/{edition.name}/{generation.name}'})
        rows.sort(key=lambda r: r['generation'], reverse=True)
        return rows

    def favorite(self, path):
        folder, _ = self.folder(path)
        file = folder / 'favorite.json'
        if not file.is_file() or file.is_symlink() or file.stat().st_size > 4096:
            return None
        try:
            data = json.loads(file.read_text())
        except ValueError:
            return None
        return data if isinstance(data, dict) and SHA.fullmatch(str(data.get('edition'))) and GENERATION.fullmatch(str(data.get('generation'))) else None

    def generation_dir(self, path, edition, generation):
        if not SHA.fullmatch(str(edition)) or not GENERATION.fullmatch(str(generation)):
            raise ValueError('Expected an edition digest and a generation id')
        folder, relative = self.folder(path)
        target = folder / edition / generation
        if any(p.is_symlink() for p in (folder / edition, target)) or not (target / 'scene.json').is_file():
            raise ArtMissing('No such art version')
        return target, f'{relative}/{edition}/{generation}'

    def art(self, path, edition=None, generation=None):
        """The art to show for a path: the version asked for, else the reader's favorite, else the newest for this
        edition, else the newest of any."""
        sha = self.library.digest(path)
        versions = self.versions(path)
        favorite = self.favorite(path)
        chosen = None
        if edition or generation:
            chosen = next((v for v in versions if v['edition'] == edition and v['generation'] == generation), None)
            if not chosen:
                raise ArtMissing('No such art version')
        elif favorite:
            chosen = next((v for v in versions if v['edition'] == favorite['edition'] and v['generation'] == favorite['generation']), None)
        chosen = chosen or next((v for v in versions if v['edition'] == sha), None) or (versions[0] if versions else None)
        art = None
        if chosen:
            try:
                art = self.load(path, chosen['edition'], chosen['generation']) | {'current': chosen['edition'] == sha,
                                                                                  'favorite': bool(favorite and favorite['generation'] == chosen['generation'])}
            except (OSError, ValueError, art_scene.SceneError) as exc:
                art = {'error': short(exc, 300), 'edition': chosen['edition'], 'generation': chosen['generation']}
        with self.lock:
            job = next((self.view(j) for j in [*self.jobs.values(), *self.foreign.values()] if j['path'] == path and j['state'] in ACTIVE), None)
        return {'path': path, 'sha256': sha, 'art': art, 'versions': versions[:50], 'count': len(versions), 'favorite': favorite, 'job': job}

    def load(self, path, edition, generation):
        folder, relative = self.generation_dir(path, edition, generation)
        scene, counts = art_scene.parse((folder / 'scene.json').read_text())
        provenance = json.loads((folder / 'provenance.json').read_text())
        try:
            _, body, _ = decode_frontmatter((folder / 'brief.md').read_bytes())
            brief = body.decode('utf-8', 'replace').strip()
        except (OSError, FrontmatterError):
            brief = ''
        still = next((n for n in ('still.png', 'still.webp') if (folder / n).is_file() and not (folder / n).is_symlink()), None)
        return {'edition': edition, 'generation': generation, 'folder': relative, 'scene': scene, 'counts': counts, 'brief': brief,
                'title': provenance.get('title') or scene.get('title'), 'provenance': provenance, 'still': still}

    def prompts(self, path, edition=None, generation=None):
        """The prompts that made one version (#146), read back from its archived run log: each stage's prompt as sent,
        split into the instructions and the quoted article, brief or language reference, so a reader can see the
        instructions first. At most PROMPT_LIMIT bytes per stage; only a run log under logs/llm/art/ is followed."""
        if edition or generation:
            folder, _ = self.generation_dir(path, edition, generation)
        else:
            shown = self.art(path)['art']
            if not shown:
                raise ArtMissing('This piece has no art')
            folder, _ = self.generation_dir(path, shown['edition'], shown['generation'])
            edition, generation = shown['edition'], shown['generation']
        try:
            provenance = json.loads((folder / 'provenance.json').read_text())
        except (OSError, ValueError):
            provenance = {}
        provenance = provenance if isinstance(provenance, dict) else {}
        producer = provenance.get('producer') if isinstance(provenance.get('producer'), dict) else {}
        result = {'path': path, 'edition': edition, 'generation': generation, 'title': provenance.get('title'),
                  'created_at': provenance.get('created_at'), 'producer': {k: producer.get(k) for k in ('label', 'model', 'kind')},
                  'prompts': provenance.get('prompts'), 'direction': provenance.get('direction'), 'log': None, 'recorded': False, 'handcrafted': False, 'message': None, 'stages': []}
        log, note = provenance.get('log'), provenance.get('note')
        if not log:
            if isinstance(note, str) and note.strip():
                return result | {'handcrafted': True, 'message': note.strip()[:300]}
            return result | {'message': 'Prompt not recorded for this version.'}
        if not isinstance(log, str) or not llm_logs.RELATIVE.fullmatch(log) or not log.startswith(llm_logs.ROOT + '/art/'):
            return result | {'message': 'The run log for this version could not be read.'}
        stages = []
        try:
            for name in PROMPT_STAGES:
                text, total, truncated = llm_logs.read(self.root, log, f'{name}-prompt.txt', PROMPT_LIMIT)
                if text is None:
                    continue
                if truncated:
                    text = text.rstrip('\ufffd')  # a cut through a character
                stages.append({'name': name, 'bytes': total, 'truncated': truncated, 'parts': self.prompt_parts(text, result['prompts'])})
        except (OSError, ValueError):
            return result | {'message': 'The run log for this version could not be read.'}
        if not stages:
            return result | {'message': 'Prompt not recorded for this version.'}
        return result | {'log': log, 'recorded': True, 'stages': stages}

    @staticmethod
    def prompt_parts(text, versions):
        """[{kind, text, chars}] covering `text` exactly: instructions, and the quoted article or brief and the
        scene-language reference (the prompt version's own file) that a reader would collapse."""
        spans = [(m.start(3), m.end(3), m.group(1).lower()) for m in FENCE.finditer(text)]
        dsl = (versions or {}).get('dsl') if isinstance(versions, dict) else None
        if isinstance(dsl, str) and re.fullmatch(r'dsl\.v\d{1,3}', dsl) and (PROMPTS / (dsl + '.md')).is_file():
            reference = (PROMPTS / (dsl + '.md')).read_text()
            at = text.find(reference) if reference else -1
            if at >= 0 and not any(a <= at < b for a, b, _ in spans):
                spans.append((at, at + len(reference), 'reference'))
        parts, cursor = [], 0
        for start, end, kind in sorted(spans):
            if start < cursor:
                continue
            if start > cursor:
                parts.append({'kind': 'instructions', 'text': text[cursor:start]})
            parts.append({'kind': kind, 'text': text[start:end]})
            cursor = end
        if cursor < len(text) or not parts:
            parts.append({'kind': 'instructions', 'text': text[cursor:]})
        return [p | {'chars': len(p['text'])} for p in parts if p['text'] or len(parts) == 1]

    def still_file(self, path, edition, generation):
        folder, _ = self.generation_dir(path, edition, generation)
        for name in ('still.png', 'still.webp'):
            file = folder / name
            if file.is_file() and not file.is_symlink():
                return file
        raise ArtMissing('This version has no still image yet')

    def save(self, job, title, brief, scene, counts, meta):
        """Write one new version (never over an old one) and return its folder relative to the vault."""
        folder, relative = self.folder(job['path'], create=True)
        edition = folder / job['sha256']
        if edition.is_symlink():
            raise ValueError('Art folders must not contain symlinks')
        edition.mkdir(exist_ok=True)
        generation = meta.get('generation') or datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(2)
        staging = self.runtime / 'staging' / (generation + '-' + secrets.token_hex(4))
        staging.mkdir(parents=True)  # ordinary permissions: this folder becomes the committed version
        created = meta.get('created_at') or stamp()
        provenance = {'schema_version': 1, 'kind': 'reader-art', 'path': job['path'], 'source_sha256': job['sha256'], 'generation': generation,
                      'created_at': created, 'title': title, 'scene_version': art_scene.VERSION, 'prompts': meta['prompts'],
                      'producer': meta['producer'], 'seconds': meta['seconds'], 'stages': meta['stages'], 'usage': meta['usage'],
                      'repaired': meta['repaired'], 'counts': counts, 'log': job.get('log'), 'reader_version': llm_logs.reader_version(),
                      'requested': 'automatic' if job.get('auto') else 'explicit'} | ({'note': meta['note']} if meta.get('note') else {}) \
            | ({'direction': job['direction']} if job.get('direction') else {})
        made_by = meta['producer']['label'] + (f' ({meta["producer"]["model"]})' if meta['producer'].get('model') else '')
        header = {'title': title, 'kind': 'Art brief', 'author': meta['producer']['label'], 'art_for': job['path'], 'source_sha256': job['sha256'],
                  'made_with': made_by, 'prompt': PROMPT_VERSIONS['brief'], 'created': created}
        (staging / 'brief.md').write_text('---\n' + ''.join(f'{k}: {json.dumps(v, ensure_ascii=False)}\n' for k, v in header.items()) + '---\n\n' + brief.strip() + '\n')
        (staging / 'scene.json').write_text(json.dumps(scene | {'title': scene.get('title') or title}, ensure_ascii=False, indent=2) + '\n')
        (staging / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
        target = edition / generation
        if target.exists():
            shutil.rmtree(staging, ignore_errors=True)
            raise FileExistsError('That art version already exists')
        os.rename(staging, target)
        return f'{relative}/{job["sha256"]}/{generation}', generation

    def commit(self, paths, subject, trailers):
        """Commit exactly `paths` (vault-relative) with Reader trailers; serialized with chat commits."""
        if not self.commit_enabled:
            return {'commit': None, 'status': 'disabled'}
        return llm_logs.commit(self.root, paths, subject, trailers, git_locks=self.git_locks, holder='reader-art', note='Reader art commit')

    # Jobs ---------------------------------------------------------------------

    def view(self, job):
        row = {k: job.get(k) for k in ('id', 'path', 'title', 'sha256', 'producer', 'producer_label', 'model', 'state', 'stage', 'message', 'queued_at',
                                         'started_at', 'finished_at', 'seconds', 'usage', 'log', 'result', 'error', 'auto', 'commit', 'warning', 'direction')}
        if job.get('monotonic') and job['state'] in ('running', 'waiting'):
            row['elapsed'] = round(time.monotonic() - job['monotonic'], 1)
        if job['state'] == 'queued' and job['id'] in self.queue:
            row['ahead'] = list(self.queue).index(job['id']) + sum(1 for j in self.jobs.values() if j['state'] in ('running', 'waiting'))
        row['foreign'] = job['id'] in self.foreign
        return row

    def status(self):
        with self.lock:
            if not self.owner:  # The owner's jobs, read-only and fresh from jobs.json on every look.
                self.foreign = {j['id']: j for j in self.stored()}
            rows = sorted([*self.jobs.values(), *self.foreign.values()], key=lambda j: j.get('queued_at') or '', reverse=True)
            return ({'jobs': [self.view(j) for j in rows[:KEEP_JOBS]], 'active': sum(1 for j in rows if j.get('state') in ACTIVE),
                     'ownership': self.ownership()} | self.producers())

    def persist(self):
        if not self.owner:
            return  # Only the owner writes jobs.json.
        self.runtime.mkdir(parents=True, exist_ok=True)
        keep = sorted([*self.jobs.values()], key=lambda j: j.get('queued_at') or '', reverse=True)[:KEEP_JOBS]
        data = {'schema_version': 1, 'updated_at': stamp(), 'jobs': [{k: v for k, v in j.items() if k not in ('cancel', 'monotonic')} for j in keep]
                + list(self.foreign.values())}
        temporary = self.runtime / 'jobs.next.json'
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
        temporary.replace(self.jobs_file)

    def own(self):
        """Refuse an art action unless this server owns art for the vault; take ownership once the previous owner stopped."""
        with self.lock:
            if self.owner:
                return
            if self.closed or not self.supervisor.acquire():
                raise ArtOwned(OWNED + '; art is read-only here. Use the server that owns it, or stop that server first.')
            self.owner = True
            self.foreign.clear()
            self.recover()

    def ownership(self):
        """`writable`: this server owns art, or will on its first art action because no other server holds it."""
        writable = bool(self.owner) or not self.closed and not self.supervisor.held()
        return {'owner': bool(self.owner), 'writable': writable, 'message': None if writable else OWNED + '; art is read-only here.'}

    def stored(self):
        """The job rows in jobs.json, or [] when it is missing, a symlink, too large or unreadable."""
        if not self.jobs_file.is_file() or self.jobs_file.is_symlink() or self.jobs_file.stat().st_size > 4 * 1024**2:
            return []
        try:
            rows = json.loads(self.jobs_file.read_text()).get('jobs') or []
        except (ValueError, OSError, AttributeError):
            return []
        return [j for j in rows if isinstance(j, dict) and isinstance(j.get('id'), str)] if isinstance(rows, list) else []

    def running_elsewhere(self):
        """Whether another process holds `.reader/art/run.lock` (a Reader from before the supervisor lock, say)."""
        lock = self.runtime / 'run.lock'
        if not lock.is_file() or lock.is_symlink():
            return False
        with lock.open('a') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            fcntl.flock(handle, fcntl.LOCK_UN)
        return False

    def recover(self):
        """The owner adopts this vault's queued and interrupted jobs. Only it calls this, so no other Reader server is
        running them; a run another process still holds run.lock for is left alone."""
        busy = self.running_elsewhere()
        requeue = False
        for job in self.stored():
            if job['id'] in self.jobs:
                continue
            if busy and job.get('state') in ACTIVE:
                self.foreign[job['id']] = job
                continue
            if job.get('state') == 'running' or job.get('state') == 'waiting' and job.get('started_at'):
                job.update(state='failed', error='Reader stopped while this art was being made.', finished_at=job.get('finished_at') or stamp())
                if job.get('log'):
                    try:
                        llm_logs.seal(self.root, job['log'], 'interrupted', 'Reader stopped before this run finished.')
                    except (OSError, ValueError):
                        pass
            elif job.get('state') in ('queued', 'waiting'):
                job.update(state='queued', owner_pid=os.getpid(), message='Queued again after Reader restarted')
                self.queue.append(job['id'])
                requeue = True
            job['cancel'] = False
            self.jobs[job['id']] = job
        if requeue:
            self.start_worker()

    def start_worker(self):
        if self.worker is None or not self.worker.is_alive():
            self.worker = threading.Thread(target=self.work, name='reader-art', daemon=True)
            self.worker.start()

    def enqueue(self, path, producer, auto=False, title=None, direction=None):
        direction = direction_of(direction)
        self.own()
        row = self.producer(producer)
        file = self.library.path(path)
        if file.suffix.lower() not in TEXT_KINDS:
            raise ValueError('Art is made for Markdown and plain-text articles')
        sha = self.library.digest(path)
        with self.lock:
            existing = next((j for j in self.jobs.values() if j['path'] == path and j['state'] in ACTIVE), None)
            if existing:
                return existing
            if sum(1 for j in self.jobs.values() if j['state'] in ACTIVE) >= MAX_QUEUE:
                raise BlockingIOError(f'At most {MAX_QUEUE} art commissions may wait; let some finish first')
            job = {'id': 'art-' + uuid.uuid4().hex[:12], 'path': path, 'title': title or self.title_of(file, path), 'sha256': sha,
                   'producer': row['id'], 'producer_label': row['label'], 'model': row.get('model'), 'state': 'queued', 'stage': None,
                   'message': 'Waiting to start', 'queued_at': stamp(), 'auto': bool(auto), 'owner_pid': os.getpid(), 'cancel': False}
            if direction:
                job['direction'] = direction
            self.jobs[job['id']] = job
            self.queue.append(job['id'])
            self.persist()
            self.changed.notify_all()
        self.start_worker()
        return job

    def title_of(self, file, path):
        try:
            with file.open('rb') as stream:
                raw, _, _ = decode_frontmatter(stream.read(64 * 1024))
            if isinstance(raw, dict) and isinstance(raw.get('title'), str) and raw['title'].strip():
                return raw['title'].strip()[:300]
        except (OSError, FrontmatterError):
            pass
        return Path(path).stem.replace('-', ' ')

    def commission(self, paths, producer):
        """Automatic art for the issue's cover and features: only works without art for their current edition."""
        if not isinstance(paths, list) or len(paths) > MAX_COMMISSION or not all(isinstance(p, str) for p in paths):
            raise ValueError(f'Expected at most {MAX_COMMISSION} paths')
        self.own()
        queued, skipped = [], []
        for path in paths:
            try:
                sha = self.library.digest(path)
                if any(v['edition'] == sha for v in self.versions(path)):
                    skipped.append({'path': path, 'reason': 'has-art'}); continue
                with self.lock:
                    recent = [j for j in self.jobs.values() if j['path'] == path and j['sha256'] == sha]
                if any(j['state'] in ACTIVE for j in recent):
                    skipped.append({'path': path, 'reason': 'queued'}); continue
                if any(j['state'] in ('failed', 'timeout', 'cancelled') and time.time() - self.when(j) < RETRY_AFTER for j in recent):
                    skipped.append({'path': path, 'reason': 'failed-recently'}); continue
                queued.append(self.view(self.enqueue(path, producer, auto=True)))
            except (ValueError, OSError) as exc:
                skipped.append({'path': path, 'reason': 'refused', 'error': short(exc, 300)})
        return {'queued': queued, 'skipped': skipped}

    @staticmethod
    def when(job):
        try:
            return datetime.fromisoformat(job.get('finished_at') or job.get('queued_at')).timestamp()
        except (TypeError, ValueError):
            return 0

    def cancel(self, job_id):
        self.own()
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise ValueError('No such art job in this Reader process')
            if job['state'] not in ACTIVE:
                return self.view(job)
            job['cancel'] = True
            if job['id'] in self.queue:
                self.queue.remove(job['id'])
                job.update(state='cancelled', message='Cancelled before it started', finished_at=stamp())
            self.persist()
            self.changed.notify_all()
            return self.view(job)

    def update(self, job, **fields):
        with self.lock:
            job.update(fields)
            self.persist()
            self.changed.notify_all()

    def work(self):
        while True:
            with self.lock:
                while not self.queue and not self.closed:
                    self.changed.wait(5)
                if self.closed:
                    return
                job = self.jobs[self.queue.popleft()]
            try:
                self.run(job)
            except Cancelled:
                if not job['cancel'] and self.closed:  # Reader is stopping: the next start runs it again
                    self.update(job, state='queued', stage=None, message='Queued again: Reader stopped while it ran', started_at=None)
                else:
                    self.update(job, state='cancelled', message='Cancelled', error=None, finished_at=stamp(), seconds=self.elapsed(job))
            except Exception as exc:  # A failed commission never stops the worker.
                traceback.print_exc()
                self.update(job, state='failed', message='Failed', error=short(exc), finished_at=stamp(), seconds=self.elapsed(job))

    @staticmethod
    def elapsed(job):
        return round(time.monotonic() - job['monotonic'], 1) if job.get('monotonic') else None

    def admitted(self, job):
        """Hold `.reader/art/run.lock`: one commission at a time per vault, across Reader processes."""
        self.runtime.mkdir(parents=True, exist_ok=True)
        held = (self.runtime / 'run.lock').open('a')
        while True:
            try:
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return held
            except BlockingIOError:
                if job['message'] != 'Waiting for another Reader process’s art run':
                    self.update(job, state='waiting', message='Waiting for another Reader process’s art run')
                if job['cancel'] or self.closed:
                    held.close()
                    raise Cancelled()
                time.sleep(1)

    def article(self, path):
        file = self.library.path(path)
        if file.stat().st_size > MAX_SOURCE:
            raise ValueError('Art is made from text sources of at most 4 MiB')
        data = file.read_bytes()
        try:
            raw, body, _ = decode_frontmatter(data)
        except FrontmatterError:
            raw, body = None, data
        text = body.decode('utf-8', 'replace').strip()
        if len(text) < 200:
            raise ValueError('This piece is too short to make art from')
        cut = len(text) > MAX_ARTICLE
        if cut:
            text = text[:MAX_ARTICLE] + '\n\n[… the rest of the article is omitted to keep the request bounded …]'
        title = raw.get('title').strip() if isinstance(raw, dict) and isinstance(raw.get('title'), str) and raw['title'].strip() else self.title_of(file, path)
        return {'title': title[:300], 'text': text, 'sha256': hashlib.sha256(data).hexdigest(), 'truncated': cut}

    def run(self, job):
        if job['cancel']:
            raise Cancelled()
        job['monotonic'] = time.monotonic()
        self.update(job, state='waiting', message='Starting', started_at=stamp())
        if not self.capacity(self.root):
            reserve = minimum_free_bytes(self.root) / 1024**3
            raise RuntimeError(f'Reader refuses to start LLM runs while free disk space is below {reserve:g} GiB, so their logs are never dropped.')
        row = self.producer(job['producer'])
        held = self.admitted(job)
        log, workspace = None, None
        try:
            document = self.article(job['path'])
            job['sha256'] = document['sha256']  # art is made for the edition actually read
            log = llm_logs.RunLog(self.root, 'art', job['id'], {
                'runner': 'art', 'producer': row['id'], 'producer_kind': row['kind'], 'label': row['label'], 'model': row.get('model'),
                'document_path': job['path'], 'source_sha256': document['sha256'], 'prompts': PROMPT_VERSIONS | ({'direction': DIRECTION_VERSION} if job.get('direction') else {}), 'automatic': bool(job.get('auto')),
                'direction': job.get('direction')})
            llm_logs.forget_usage(self.root)
            self.update(job, state='running', log=log.relative, title=document['title'] or job['title'])
            (self.runtime / 'work').mkdir(parents=True, exist_ok=True)
            workspace = Path(tempfile.mkdtemp(prefix=job['id'] + '-', dir=self.runtime / 'work'))
            if shutil.which('git'):
                subprocess.run(['git', 'init', '-q'], cwd=workspace, capture_output=True, timeout=20)  # some CLIs only run inside a repository
            ask = self.voice_asker(row, workspace, log) if row['kind'] == 'voice' else self.local_asker(log)
            nonce = secrets.token_hex(8)
            stages, usage = [], None

            def stage(name, prompt, message):
                nonlocal usage
                self.update(job, stage=name, message=message)
                began = time.monotonic()
                answer, part, runtime = ask(job, name, prompt)
                usage = add_usage(usage, part)
                stages.append({'name': name, 'seconds': round(time.monotonic() - began, 1), 'usage': part})
                self.update(job, usage=usage)
                return answer, runtime

            # A reader's direction (#147) follows each prompt, fenced with the same nonce.
            steer = '\n\n' + render('direction', nonce=nonce, direction=job['direction']) if job.get('direction') else ''
            answer, runtime = stage('brief', render('brief', title=document['title'], path=job['path'], nonce=nonce, text=document['text']) + steer, 'Reading the article and writing the brief')
            art_title, brief = parse_brief(answer)
            dsl = template('dsl')
            answer, runtime = stage('scene', render('scene', art_title=art_title, brief=brief, nonce=nonce, dsl=dsl) + steer, 'Composing the scene')
            repaired = False
            try:
                scene, counts = art_scene.parse(art_scene.extract(answer))
            except art_scene.SceneError as exc:
                if job['cancel']:
                    raise Cancelled()
                raw = answer if len(answer) < art_scene.LIMITS['bytes'] else answer[:art_scene.LIMITS['bytes']]
                try:
                    raw = art_scene.extract(answer)
                except art_scene.SceneError:
                    pass
                log.write('scene-errors.txt', '\n'.join(exc.errors))
                answer, runtime = stage('repair', render('repair', errors='\n'.join('- ' + e for e in exc.errors), scene=raw, dsl=dsl), 'Fixing what the validator refused')
                try:
                    scene, counts = art_scene.parse(art_scene.extract(answer))
                except art_scene.SceneError as again:
                    log.write('repair-errors.txt', '\n'.join(again.errors))
                    raise ValueError('The scene still did not validate after one repair: ' + '; '.join(again.errors[:4])) from again
                repaired = True
            if job['cancel']:
                raise Cancelled()
            self.update(job, stage='saving', message='Saving and committing')
            producer = {'id': row['id'], 'kind': row['kind'], 'label': row['label'], 'model': runtime.get('model') or row.get('model'),
                        'cli': runtime.get('cli'), 'cli_version': runtime.get('version'), 'provider': row.get('provider')}
            meta = {'prompts': {k: (v if k != 'repair' or repaired else None) for k, v in PROMPT_VERSIONS.items()} | ({'direction': DIRECTION_VERSION} if job.get('direction') else {}), 'producer': producer,
                    'seconds': self.elapsed(job), 'stages': stages, 'usage': usage, 'repaired': repaired}
            folder, generation = self.save(job, art_title, brief, scene, counts, meta)
            log.finish('done', art=folder, usage=usage, model=producer['model'])
            relative_log, log = log.relative, None
            llm_logs.forget_usage(self.root)
            committed = self.commit([folder, relative_log], f'Add art for {document["title"][:72]}',
                                    [('Reader-Art', f'{job["path"]}@{job["sha256"][:12]}/{generation}'),
                                     ('Reader-Log', llm_logs.trailer(relative_log))])
            self.update(job, state='done', stage=None, message='Ready', finished_at=stamp(), seconds=self.elapsed(job), model=producer['model'],
                        result={'edition': job['sha256'], 'generation': generation, 'folder': folder, 'title': art_title},
                        commit=committed, warning=None if committed['status'] in ('committed', 'disabled') else 'Saved, but not committed: ' + committed.get('error', committed['status']))
        except Cancelled:
            if log is not None:
                log.finish('cancelled' if job['cancel'] else 'interrupted')
                log = None
            raise
        except Exception as exc:
            if log is not None:
                log.finish('failed', error=short(exc))
                log = None
            state = 'timeout' if isinstance(exc, TimeoutError) else 'failed'
            self.update(job, state=state, message='Timed out' if state == 'timeout' else 'Failed', error=short(exc), finished_at=stamp(), seconds=self.elapsed(job))
        finally:
            if workspace is not None:
                shutil.rmtree(workspace, ignore_errors=True)
            fcntl.flock(held, fcntl.LOCK_UN)
            held.close()

    # Producers: a voice CLI or the local model ---------------------------------

    def voice_asker(self, row, workspace, log):
        from .voice_runner import StreamParser, classify, supervise
        registry = self.registry.load()
        voice = next((v for v in registry['voices'] if 'voice:' + v['name'] == row['id']), None)
        if not voice or not voice_tools.runnable(voice):
            raise ValueError(f'{row["label"]} is not an enabled voice with an installed CLI')
        system = voice_tools.persona(self.root, voice) + '\n\n' + ART_RULES
        timeout = min(self.stage_timeout, voice['timeout_seconds'])
        version = None
        if voice.get('version_argv') and voice.get('executable'):
            try:
                found = subprocess.run([voice['executable'], *voice['version_argv']], capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL, start_new_session=True)
                lines = (found.stdout or found.stderr).strip().splitlines()
                version = lines[0][:100] if found.returncode == 0 and lines else None
            except (OSError, subprocess.TimeoutExpired):
                pass
        log.update(cli=os.path.basename(voice['cli']), cli_version=version, stream=voice['stream'], timeout_seconds=timeout)

        def ask(job, name, prompt):
            full = prompt if '{persona}' in voice['argv'] else system + '\n\n' + prompt
            last = log.dir / f'{name}-last-message.md'
            values = {'{vault}': str(workspace), '{persona}': system, '{prompt}': full, '{last_message}': str(last)}
            argv = [voice['executable']]
            for item in voice['argv']:
                if item == '{sandbox_add_dirs}':
                    continue  # art never needs more than its empty workspace
                for key, value in values.items():
                    if key in item:
                        item = value if item == key else item.replace(key, value)
                argv.append(item)
            log.write(f'{name}-prompt.txt', full)
            log.update(**{f'{name}_argv': llm_logs.redact_argv(argv, {system: '<persona>', full: f'<{name}-prompt.txt>'})})
            parser, usage, text = StreamParser(voice['stream']), [None], ['']

            def on_line(line):
                text[0] += parser.feed(line) or ''
                found = usage_of(line)
                if found:
                    usage[0] = found
            stdin = subprocess.DEVNULL if any('{prompt}' in a for a in voice['argv']) else (log.dir / f'{name}-prompt.txt.partial').open('rb')
            temp = workspace / 'tmp'
            temp.mkdir(exist_ok=True)
            try:
                state, code, error, tail = supervise(argv, workspace, stdin, dict(os.environ, TMPDIR=str(temp)), timeout,
                                                     lambda: job['cancel'] or self.closed, on_line, lambda pid: None,
                                                     (log.open(f'{name}-stdout.jsonl'), log.open(f'{name}-stderr.log')), max(3600, timeout + 60), self.limits)
            finally:
                if stdin is not subprocess.DEVNULL:
                    stdin.close()
            last_text = last.read_text(errors='replace') if last.is_file() and not last.is_symlink() else ''
            body = parser.final(text[0], last_text)
            state, failure, error, warning = classify(state, code, error, parser, body, voice['name'], voice, timeout)
            if state == 'cancelled':
                raise Cancelled()
            if state == 'timeout':
                raise TimeoutError(error)
            if state != 'done':
                raise RuntimeError(error + (f' {tail[-300:]}' if tail else ''))
            return body, usage[0], {'model': parser.model or voice.get('model'), 'cli': os.path.basename(voice['cli']), 'version': version}
        return ask

    def local_asker(self, log):
        model = self.library.local_model
        settings = self.local_settings() or {}
        name = settings.get('model')
        if not name:
            raise ValueError('No local model is configured (Behind the scenes, Local model)')
        client = model.client
        # The provider by preset and host only (as the local-model worker logs it); never the key.
        scrub = getattr(client, 'scrub', lambda text: text)
        log.update(provider=settings.get('label'), preset=settings.get('preset'), host=getattr(client, 'host', None),
                   loopback=getattr(client, 'loopback', None), api_key=bool(getattr(client, 'api_key', None)), model=name)

        def ask(job, stage, prompt):
            messages = [{'role': 'system', 'content': ART_RULES}, {'role': 'user', 'content': prompt}]
            log.write(f'{stage}-prompt.txt', prompt)
            guard = model.gpu_lock(f'Reader art: {stage}', lambda: job['cancel'] or self.closed) if client.loopback else nullcontext()
            from .local_model import Cancelled as LocalCancelled
            try:
                with guard:
                    result = client.chat(name, messages, cancelled=lambda: job['cancel'] or self.closed, timeout=self.stage_timeout,
                                         max_output=LOCAL_OUTPUT, reasoning=LOCAL_REASONING)
            except LocalCancelled as exc:
                raise Cancelled() from exc
            log.write(f'{stage}-response.txt', scrub(result['text']))
            if result.get('reasoning'):
                log.write(f'{stage}-reasoning.txt', scrub(result['reasoning']))
            usage = result.get('usage') if isinstance(result.get('usage'), dict) else {}
            return result['text'], {'input_tokens': usage.get('prompt_tokens') or 0, 'output_tokens': usage.get('completion_tokens') or result.get('tokens') or 0, 'usd': None}, {'model': name}
        return ask

    # Requests -----------------------------------------------------------------

    def favor(self, path, edition, generation, participant):
        self.own()
        folder, relative = self.generation_dir(path, edition, generation)
        root, base = self.folder(path)
        (root / 'favorite.json').write_text(json.dumps({'edition': edition, 'generation': generation, 'chosen_at': stamp(), 'chosen_by': participant}, indent=2) + '\n')
        committed = self.commit([base + '/favorite.json'], 'Choose the art for ' + self.title_of(self.library.path(path), path)[:60],
                                [('Reader-Art', f'{path}@{edition[:12]}/{generation} (favorite)')])
        return self.art(path) | {'commit': committed}

    def keep_still(self, path, edition, generation, image):
        """Keep the first still image a browser captured for a version (never replaced)."""
        self.own()
        folder, relative = self.generation_dir(path, edition, generation)
        if any((folder / n).exists() for n in ('still.png', 'still.webp')):
            return {'kept': False, 'reason': 'exists'}
        match = re.fullmatch(r'data:image/(png|webp);base64,([A-Za-z0-9+/=]+)', image or '')
        if not match:
            raise ValueError('Expected a PNG or WebP data URL')
        data = base64.b64decode(match.group(2), validate=True)
        if len(data) > MAX_STILL:
            raise ValueError('Still images are at most 2 MiB')
        from PIL import Image
        with Image.open(io.BytesIO(data)) as picture:
            picture.verify()
        with Image.open(io.BytesIO(data)) as picture:
            if picture.format not in ('PNG', 'WEBP') or picture.width > STILL_SIZE[0] or picture.height > STILL_SIZE[1]:
                raise ValueError('Expected a PNG or WebP of at most 2048 × 1536 pixels')
        name = 'still.png' if match.group(1) == 'png' else 'still.webp'
        temporary = folder / ('.' + name + '.next')
        temporary.write_bytes(data)
        os.link(temporary, folder / name)  # fails rather than replace one that appeared meanwhile
        temporary.unlink()
        committed = self.commit([relative + '/' + name], 'Add a still image for article art', [('Reader-Art', f'{path}@{edition[:12]}/{generation} (still)')])
        return {'kept': True, 'name': name, 'commit': committed}

    def dispatch(self, request, participant):
        action = request.get('action')
        allowed = {'generate': {'action', 'path', 'producer', 'direction'}, 'commission': {'action', 'paths', 'producer'}, 'cancel': {'action', 'job'},
                   'favorite': {'action', 'path', 'edition', 'generation'}, 'still': {'action', 'path', 'edition', 'generation', 'image'}}
        if action not in allowed or set(request) - allowed[action]:
            raise ValueError('Expected an art action: generate, commission, cancel, favorite or still')
        if action == 'generate':
            return {'job': self.view(self.enqueue(request.get('path', ''), request.get('producer'), direction=request.get('direction')))}
        if action == 'commission':
            return self.commission(request.get('paths'), request.get('producer'))
        if action == 'cancel':
            return {'job': self.cancel(request.get('job'))}
        if action == 'favorite':
            return self.favor(request.get('path', ''), request.get('edition'), request.get('generation'), participant)
        return self.keep_still(request.get('path', ''), request.get('edition'), request.get('generation'), request.get('image'))

    def close(self, timeout=5):
        with self.lock:
            self.closed = True  # running work stops (its cancelled() check sees this) and is queued again
            self.changed.notify_all()
        if self.worker and self.worker.is_alive():
            self.worker.join(timeout)
        # Released after the worker has requeued its job, so a successor finds jobs.json complete; a worker
        # still running past the timeout writes nothing more.
        with self.lock:
            self.owner = False
            self.supervisor.release()
