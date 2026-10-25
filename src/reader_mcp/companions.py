"""Optional companion tools: discovery, status, guided setup and pinned installs.

Reader works without every companion. Each is a separate project found on this Mac:
AI-TTS (read aloud), Colorful Language (prose colors), wide-md (reading copies) and
git-locks (cross-process coordination). This module finds them, reports what each
adds and what state it is in, and, where an automated install is safe, builds a
pinned revision into a Reader-owned tooling folder (`<vault>/.reader/tooling`).

Installs run as maintenance jobs with explicit argv (never a shell string), a
timeout, a bounded log, no sudo and only the pinned public sources named here.
AI-TTS and git-locks are guided installs: Reader shows their documented commands
and never installs a system service on its own. Paths a reader sets by hand live in
`<vault>/.reader/companions.json`."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid

CODE = Path(__file__).resolve().parents[2]
SETTINGS = '.reader/companions.json'
MAX_SETTINGS = 64 * 1024
TOOLING = '.reader/tooling'
LOG_LIMIT = 1024 ** 2          # bytes of one install log
LOG_TAIL = 16 * 1024           # bytes the log endpoint returns
MIN_FREE = 5 * 1024 ** 3       # free disk an install needs before it starts
GIT_LOCKS_DIRS = ('~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin')
HEAVY_KEY = 'host/heavy-work'

COLORFUL_REPO = 'https://github.com/flyingrobots/colorful-language'
# The 0.4.0 release on main (it has no tag). The v0.3.0 tag's artifacts carry a schema hash
# Reader's admission refuses, so the pin is the first release whose output Reader admits.
COLORFUL_TAG = '0.4.0'
COLORFUL_COMMIT = '61d0aa8b20837decdb26c92f71b967c7b14578d7'
AI_TTS_REPO = 'https://github.com/flyingrobots/AI-TTS'
AI_TTS_LABEL = 'com.flyingrobots.ai-tts'
WIDE_MD_REPO = 'https://github.com/flyingrobots/wide-md'
GIT_LOCKS_REPO = 'https://github.com/git-stunts/locks'
GIT_LOCKS_TAG = 'v0.7.0'
RUST = 'https://rustup.rs'
VOICE_CLIS = (('claude', 'Claude Code', 'https://docs.anthropic.com/en/docs/claude-code'),
              ('codex', 'Codex CLI', 'https://github.com/openai/codex'),
              ('agy', 'Antigravity CLI', None))

INFO = {
    'ai-tts': {'title': 'AI-TTS', 'repo': AI_TTS_REPO, 'feature': 'Read aloud', 'keys': 'Space s',
               'enables': 'Read aloud: Send to AI-TTS speaks the article, from your place or a selection, through a local speech daemon that queues speech and honours pauses.'},
    'colorful': {'title': 'Colorful Language', 'repo': COLORFUL_REPO, 'feature': 'Prose colors', 'keys': 'Space c',
                 'enables': 'Prose colors: paints function words, nouns, verbs, quotes and numbers in their own colors, like syntax highlighting for prose.'},
    'wide-md': {'title': 'wide-md', 'repo': WIDE_MD_REPO, 'feature': 'Reading copies', 'keys': None,
                'enables': 'Reading copies: removes artificial line wrapping from filed Markdown (reader reading-copy).'},
    'git-locks': {'title': 'git-locks', 'repo': GIT_LOCKS_REPO, 'feature': 'Shared coordination', 'keys': None,
                  'enables': 'Coordination with other agents and tools on this Mac: vault commits take the repository .git/ lock and the local model takes host/gpu/. Without it Reader coordinates its own processes only.'},
}
GUIDES = {
    'ai-tts': {'commands': ['git clone https://github.com/flyingrobots/AI-TTS.git', 'cd AI-TTS', 'make', 'make install', 'make doctor'],
               'note': 'macOS 14 or newer with Python 3.12+, uv, Swift 5.10+ and codesign. make install adds the ai-tts CLI, the menu-bar app and two '
                       'per-user launch agents; Reader never runs it for you. Then press Check again.'},
    'colorful': {'commands': ['git clone https://github.com/flyingrobots/colorful-language.git', 'cd colorful-language',
                              f'git checkout {COLORFUL_COMMIT[:12]}', 'cargo install --path crates/colorful-cli --locked'],
                 'note': 'Needs Rust (cargo). Or press Install to build the same pinned release into Reader’s tooling folder.'},
    'wide-md': {'commands': ['python3 scripts/install_wide_md.py'],
                'note': 'Run from the Reader code checkout. It builds a pinned wide-md into the vault’s .reader/tooling folder; needs Rust (cargo).'},
    'git-locks': {'commands': ['brew install bash git', 'git clone https://github.com/git-stunts/locks.git', 'cd locks',
                               f'git checkout {GIT_LOCKS_TAG}', 'make install', 'export PATH="$HOME/.local/bin:$PATH"', 'git locks version'],
                  'note': 'Needs Bash 4+ and Git 2.31+ (macOS ships Bash 3.2, hence Homebrew Bash). make install copies one script to ~/.local/bin.'},
}


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def short(text, limit=600):
    text = str(text or '').strip()
    return text if len(text) <= limit else text[:limit] + '…'


def executable_file(path):
    return bool(path) and os.path.isfile(path) and os.access(path, os.X_OK)


# Settings --------------------------------------------------------------------

def load_settings(root):
    """Paths set in Behind the scenes; a missing or unsafe file means none."""
    if root is None:
        return {}
    file = Path(root) / SETTINGS
    try:
        if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_SETTINGS:
            return {}
        data = json.loads(file.read_text())
    except (OSError, ValueError):
        return {}
    paths = data.get('paths') if isinstance(data, dict) else None
    return {k: v for k, v in (paths or {}).items() if isinstance(k, str) and isinstance(v, str) and os.path.isabs(v)}


def save_setting(root, key, value):
    state = Path(root) / '.reader'
    state.mkdir(exist_ok=True)
    if state.is_symlink():
        raise ValueError('.reader must not be a symlink')
    with (state / 'companions.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        paths = load_settings(root)
        if value:
            paths[key] = value
        else:
            paths.pop(key, None)
        with tempfile.NamedTemporaryFile('w', dir=state, prefix='.companions-', delete=False) as out:
            json.dump({'schema_version': 1, 'paths': paths}, out, indent=2)
            out.write('\n')
        os.replace(out.name, state / 'companions.json')
    return paths


# git-locks -------------------------------------------------------------------

def git_locks_candidates(environ=None, root=None):
    """READER_GIT_LOCKS (a path, or `none`), the path set in Settings, PATH, then the usual
    install folders. READER_GIT_LOCKS_CANDIDATES (os.pathsep-separated folders, may be empty)
    replaces those folders, so tests can hide an installed git-locks."""
    environ = os.environ if environ is None else environ
    explicit = (environ.get('READER_GIT_LOCKS') or '').strip()
    if explicit:
        return [] if explicit.lower() in ('none', 'off') else [str(Path(explicit).expanduser())]
    configured = load_settings(root).get('git-locks')
    found = shutil.which('git-locks', path=environ.get('PATH') or os.defpath)
    folders = environ.get('READER_GIT_LOCKS_CANDIDATES')
    folders = [f for f in folders.split(os.pathsep) if f] if folders is not None else list(GIT_LOCKS_DIRS)
    home = environ.get('HOME') or str(Path.home())
    expand = lambda f: f.replace('~', home, 1) if f.startswith('~') else f
    return [p for p in [configured, found] if p] + [str(Path(expand(f)) / 'git-locks') for f in folders]


def find_git_locks(environ=None, root=None):
    return next((p for p in git_locks_candidates(environ, root) if executable_file(p)), None)


def valid_store(path):
    store = Path(path)
    return store.is_dir() and (store / 'HEAD').is_file() and (store / 'objects').is_dir()


def workstation_store(environ=None, root=None):
    """(path, origin) of the shared git-locks store for host resources, or (None, None).
    There is no built-in default: a store is chosen by environment or Settings. A chosen
    store is returned even when it is invalid, so callers fail closed."""
    environ = os.environ if environ is None else environ
    for origin, value in (('READER_GIT_LOCKS_STORE', environ.get('READER_GIT_LOCKS_STORE')),
                          ('settings', load_settings(root).get('git-locks-store')),
                          ('GIT_LOCKS_STORE', environ.get('GIT_LOCKS_STORE'))):
        if value and value.strip():
            return str(Path(value.strip()).expanduser()), origin
    return None, None


def repo_env(environ=None):
    """The environment for a repository `.git/` key: the repo's default store, never a host store
    that GIT_LOCKS_STORE names for host resources."""
    environ = os.environ if environ is None else environ
    return {k: v for k, v in environ.items() if k != 'GIT_LOCKS_STORE'}


def coordination(environ=None, root=None):
    """How host resources (the GPU, heavy builds) are coordinated right now."""
    tool = find_git_locks(environ, root)
    store, origin = workstation_store(environ, root)
    if tool and store and valid_store(store):
        return {'mode': 'git-locks', 'executable': tool, 'store': store, 'store_origin': origin,
                'label': 'Workstation (git-locks)', 'message': f'Shared with other tools through git-locks ({store}).'}
    if tool and store:
        return {'mode': 'error', 'executable': tool, 'store': store, 'store_origin': origin, 'label': 'Store unavailable',
                'message': f'The configured git-locks store {store} is not a Git directory; host locks fail closed until it is fixed.'}
    reason = 'git-locks is not installed' if not tool else 'no git-locks workstation store is configured'
    return {'mode': 'local', 'executable': tool, 'store': None, 'store_origin': None, 'label': 'This Reader only',
            'message': f'{reason[0].upper() + reason[1:] if not reason.startswith("git-locks") else reason}, so Reader coordinates only its own processes (a lock file in .reader/).'}


# Status ----------------------------------------------------------------------

VERSION = re.compile(r'(\d+)\.(\d+)\.(\d+)')


def version_of(text):
    match = VERSION.search(text or '')
    return tuple(int(p) for p in match.groups()) if match else None


class Companions:
    def __init__(self, root, prose=None, speech=None, maintenance=None, local_model=None, environ=None, code=CODE,
                 launchctl=None, python=sys.executable):
        self.root = Path(root)
        self.prose, self.speech, self.maintenance, self.local_model = prose, speech, maintenance, local_model
        self.environ = os.environ if environ is None else environ
        self.code = Path(code)
        self.launchctl = launchctl or self.environ.get('READER_LAUNCHCTL') or '/bin/launchctl'
        self.python = python
        self.tooling = self.root / TOOLING
        self.lock = threading.Lock()
        self.probes = {}

    # Discovery helpers -------------------------------------------------------

    @property
    def home(self):
        return Path(self.environ.get('HOME') or Path.home())

    def which(self, name, extra=()):
        found = shutil.which(name, path=self.environ.get('PATH') or os.defpath)
        return found or next((str(p) for p in extra if executable_file(str(p))), None)

    def cargo(self):
        return self.which('cargo', [self.home / '.cargo/bin/cargo'])  # rustup's default; Homebrew's is on PATH

    def git(self):
        return self.which('git', ['/usr/bin/git'])

    def probe(self, path, argv=('--version',)):
        """`<path> --version` output, cached per file identity."""
        try:
            info = os.stat(path)
        except OSError:
            return None
        key = (path, tuple(argv), info.st_ino, info.st_mtime_ns, info.st_size)
        with self.lock:
            if key in self.probes:
                return self.probes[key]
        try:
            done = subprocess.run([path, *argv], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5,
                                  env=dict(self.environ), check=False)
            output = (done.stdout or done.stderr)[:2000] if done.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            output = None
        with self.lock:
            self.probes[key] = output
        return output

    def running_job(self, name):
        if not self.maintenance:
            return None
        running = self.maintenance.status()['running']
        return running if running and running['kind'] in JOB_KINDS and JOB_KINDS[running['kind']][0] == name else None

    def entry(self, name, state, label, **facts):
        info = INFO[name]
        return {'name': name, 'title': info['title'], 'repo': info['repo'], 'feature': info['feature'], 'keys': info['keys'],
                'enables': info['enables'], 'state': state, 'label': label, 'version': None, 'path': None, 'message': None,
                'actions': [], 'install': None, 'guide': GUIDES.get(name), 'facts': [], 'job': self.running_job(name)} | facts

    # Each companion ----------------------------------------------------------

    def colorful(self):
        status = self.prose.status() if self.prose else {'available': False, 'message': 'Prose colors are not set up.'}
        receipt = self.receipt('colorful')
        managed = bool(status.get('path') and receipt and Path(status['path']) == Path(receipt.get('executable', '')))
        cargo = self.cargo()
        install = {'available': bool(cargo and self.git()), 'pinned': f'{COLORFUL_TAG} ({COLORFUL_COMMIT[:12]})',
                   'reason': None if cargo and self.git() else ('Rust is not installed: Install builds Colorful with cargo. Get Rust from '
                                                                 f'{RUST}, then press Check again.' if not cargo else 'Git is not installed.'),
                   'changes': [f'Clones {COLORFUL_REPO} at {COLORFUL_TAG} into {TOOLING}/colorful-language in this vault',
                               f'Runs cargo build --locked --release -p colorful-cli (output in {TOOLING}/colorful-target)',
                               f'Copies the colorful binary to {TOOLING}/bin and records its path in .reader/companions.json'],
                   'help': RUST if not cargo else None}
        actions = ['check', 'set-path']
        if status['available']:
            version = version_of(status.get('version'))
            update = managed and receipt.get('revision') != COLORFUL_COMMIT
            if update and install['available']:
                actions.insert(0, 'update')
            return self.entry('colorful', 'installed', 'Installed', version=status['version'], path=status['path'],
                              origin=status.get('origin'), managed=managed, install=install, actions=actions,
                              facts=[['Origin', 'Built by Reader' if managed else status.get('origin')]] if status.get('origin') else [])
        message = status.get('message') or 'Colorful Language is not installed.'
        too_old = 'too old' in message
        if install['available']:
            actions.insert(0, 'update' if too_old and managed else 'install')
        return self.entry('colorful', 'too-old' if too_old else 'missing', 'Too old' if too_old else 'Not found',
                          message=message.split(' Install it from Behind')[0], install=install, actions=actions)

    def wide_md(self):
        from .reading import REVISION
        tool, receipt_file = self.tooling / 'bin/wide-md', self.tooling / 'installed.json'
        script = self.code / 'scripts/install_wide_md.py'
        cargo, git = self.cargo(), self.git()
        install = {'available': bool(cargo and git and script.is_file()), 'pinned': REVISION[:12],
                   'reason': None if cargo and git and script.is_file() else ('This installation has no scripts/install_wide_md.py.' if not script.is_file()
                                                                              else f'Rust is not installed: Install builds wide-md with cargo. Get Rust from {RUST}.' if not cargo
                                                                              else 'Git is not installed.'),
                   'changes': [f'Runs scripts/install_wide_md.py: clones {WIDE_MD_REPO} at {REVISION[:12]} into {TOOLING}/wide-md-source',
                               f'Builds it with cargo into {TOOLING}/target and copies wide-md to {TOOLING}/bin',
                               'The script needs 50 GiB of free disk and stops at its own time, memory and output limits'],
                   'help': RUST if not cargo else None}
        actions = ['check']
        if not tool.is_file():
            if install['available']:
                actions.insert(0, 'install')
            return self.entry('wide-md', 'missing', 'Not found', message='wide-md is not installed in this vault’s tooling folder.',
                              install=install, actions=actions)
        try:
            receipt = json.loads(receipt_file.read_text()) if receipt_file.is_file() and receipt_file.stat().st_size < MAX_SETTINGS else {}
        except (OSError, ValueError):
            receipt = {}
        key = ('wide-md', tool.stat().st_mtime_ns, tool.stat().st_size)
        with self.lock:
            digest = self.probes.get(key)
        if digest is None:
            digest = hashlib.sha256(tool.read_bytes()).hexdigest() if tool.stat().st_size <= 256 * 1024 ** 2 else ''
            with self.lock:
                self.probes[key] = digest
        if receipt.get('revision') != REVISION or receipt.get('executable_sha256') != digest:
            if install['available']:
                actions.insert(0, 'update')
            return self.entry('wide-md', 'too-old', 'Needs reinstall', path=str(tool), install=install, actions=actions,
                              message='The installed wide-md does not match the pinned revision Reader expects; reinstall it.')
        return self.entry('wide-md', 'installed', 'Installed', version=REVISION[:12], path=str(tool), install=install, actions=actions)

    def ai_tts(self):
        from .speech import SpeechUnavailable, default_socket
        socket_path = self.speech.socket_path if self.speech and self.speech.socket_path else default_socket()
        cli = self.which('ai-tts', [self.home / '.local/bin/ai-tts'])
        plist = self.home / 'Library/LaunchAgents' / f'{AI_TTS_LABEL}.plist'
        facts = [['Socket', str(socket_path)]]
        try:
            status = self.speech.status() if self.speech else None
        except (SpeechUnavailable, ValueError, OSError) as exc:
            status, problem = None, str(exc)
        else:
            problem = None
        if status is not None:
            return self.entry('ai-tts', 'installed', 'Running', path=cli, facts=facts + [['Playback', 'Held' if status['held'] else (status.get('playback_state') or 'Idle')]],
                              actions=['check'])
        if cli or plist.is_file():
            start = {'available': plist.is_file(), 'label': AI_TTS_LABEL, 'plist': str(plist),
                     'commands': self.start_commands(plist),
                     'changes': ['Asks launchd to start your AI-TTS daemon agent (com.flyingrobots.ai-tts) for this user',
                                 'Changes no files and never uses sudo; AI-TTS’s own launch agent then keeps it running']}
            return self.entry('ai-tts', 'not-running', 'Daemon not running', path=cli,
                              message=(problem or 'AI-TTS is installed but its daemon is not answering.') +
                              ('' if plist.is_file() else ' No AI-TTS launch agent was found; run make install in its checkout, or start `ai-tts daemon` in a terminal.'),
                              facts=facts, start=start, actions=(['start'] if plist.is_file() else []) + ['check', 'guide'])
        return self.entry('ai-tts', 'missing', 'Not found', message='AI-TTS is not installed, and no daemon answers on its socket.',
                          facts=facts, actions=['guide', 'check'])

    def start_commands(self, plist):
        uid = os.getuid()
        return [f'launchctl bootstrap gui/{uid} {plist}', f'launchctl kickstart gui/{uid}/{AI_TTS_LABEL}']

    def git_locks(self):
        tool = find_git_locks(self.environ, self.root)
        mode = coordination(self.environ, self.root)
        facts = [['Coordination', mode['label']]] + ([['Store', mode['store']]] if mode.get('store') else [])
        if not tool:
            return self.entry('git-locks', 'missing', 'Not found', message=mode['message'], facts=facts,
                              coordination=mode, actions=['guide', 'check', 'set-path'])
        output = self.probe(tool, ('version',))
        version = version_of(output)
        return self.entry('git-locks', 'installed' if mode['mode'] != 'error' else 'error',
                          'Installed' if mode['mode'] != 'error' else 'Store unavailable',
                          version='.'.join(map(str, version)) if version else None, path=tool,
                          message=mode['message'], facts=facts, coordination=mode, actions=['check', 'set-path'])

    def voices(self):
        from .voices import Registry, resolve_cli
        try:
            registry = Registry(self.root).load()
        except (ValueError, OSError):
            registry = {'voices': []}
        uses = {}
        for voice in registry['voices']:
            if voice.get('cli'):
                uses.setdefault(os.path.basename(voice['cli']), []).append(voice['name'])
        rows = []
        for cli, title, link in VOICE_CLIS:
            path = resolve_cli(cli)
            rows.append({'name': cli, 'title': title, 'link': link, 'path': path, 'state': 'installed' if path else 'missing',
                         'voices': uses.get(cli, [])})
        return rows

    def local(self):
        if not self.local_model:
            return None
        provider = self.local_model.settings().get('provider') or {}
        return {'preset': provider.get('preset'), 'base_url': provider.get('base_url'), 'gpu': self.local_model.gpu_mode()}

    def status(self, name=None):
        probes = {'ai-tts': self.ai_tts, 'colorful': self.colorful, 'wide-md': self.wide_md, 'git-locks': self.git_locks}
        if name is not None and name not in probes:
            raise ValueError('Unknown companion')
        items = []
        for key, probe in probes.items():
            if name and key != name:
                continue
            try:
                items.append(probe())
            except Exception as exc:  # A broken probe reports itself; the page still renders.
                items.append(self.entry(key, 'error', 'Error', message=short(exc), actions=['check']))
        result = {'companions': items, 'checked_at': stamp()}
        if not name:
            result['cli'] = self.voices()
            try:
                result['local_model'] = self.local()
            except Exception:
                result['local_model'] = None
        return result

    # Actions -----------------------------------------------------------------

    def dispatch(self, request, identity=None):
        action, name = request.get('action'), request.get('name')
        allowed = {'check': {'name'}, 'install': {'name'}, 'update': {'name'}, 'start': {'name'}, 'set-path': {'name', 'path'}}
        if action not in allowed or set(request) - {'action'} - allowed[action]:
            raise ValueError('Expected {"action": "check" | "install" | "update" | "start" | "set-path", "name": ...}')
        if name not in INFO:
            raise ValueError('Unknown companion')
        if identity is not None and identity.get('via') not in ('local', 'tailscale'):
            raise PermissionError('Companion installs need a local or allowed tailnet request')
        if action == 'check':
            with self.lock:
                self.probes.clear()
            if self.prose:
                self.prose.forget()
            return self.status(name)
        if action == 'set-path':
            # A path names an executable the server will run, so only a browser on this Mac may set one.
            if identity is not None and identity.get('via') != 'local':
                raise PermissionError('Set paths from a browser on this Mac (127.0.0.1); tailnet requests may install but not choose executables')
            return self.set_path(name, request.get('path'))
        kind = next((k for k, (n, a) in JOB_KINDS.items() if n == name and a == action), None)
        if not kind:
            raise ValueError(f'{INFO[name]["title"]} has no automated {action}; follow its setup guide')
        entry = self.status(name)['companions'][0]
        if action == 'start':
            if not (entry.get('start') or {}).get('available'):
                raise ValueError('AI-TTS has no launch agent to start; follow its setup guide')
        elif action not in entry['actions']:
            raise ValueError((entry.get('install') or {}).get('reason') or f'{INFO[name]["title"]} cannot be {action}d right now')
        return self.maintenance.start(kind)

    def set_path(self, name, value):
        if not isinstance(value, str) or len(value) > 1024 or '\x00' in value:
            raise ValueError('Expected a path')
        value = value.strip()
        key = {'colorful': 'colorful', 'git-locks': 'git-locks'}.get(name)
        if name == 'git-locks' and value.endswith('.git'):
            key = 'git-locks-store'
        if not key:
            raise ValueError(f'{INFO[name]["title"]} has no path setting')
        if value:
            path = Path(value).expanduser()
            if not path.is_absolute():
                raise ValueError('Use an absolute path')
            if key == 'git-locks-store':
                if not valid_store(path):
                    raise ValueError(f'{path} is not a git-locks store (a Git directory)')
            else:
                if not executable_file(str(path)):
                    raise ValueError(f'{path} is not an executable file')
                output = self.probe(str(path), ('--version',) if key == 'colorful' else ('version',))
                found = version_of(output)
                if key == 'colorful':
                    from .prose import MIN_VERSION
                    if not found:
                        raise ValueError(f'{path} did not report a Colorful version')
                    if found < MIN_VERSION:
                        raise ValueError(f'Colorful {".".join(map(str, found))} is too old; Reader needs 0.3.0 or newer')
                elif output is None:
                    raise ValueError(f'{path} did not answer `version` like git-locks')
            value = str(path)
        save_setting(self.root, key, value)
        with self.lock:
            self.probes.clear()
        if self.prose:
            self.prose.forget()
        return self.status(name)

    # Install jobs ------------------------------------------------------------

    def runners(self):
        return {'install-colorful': lambda: self.install_colorful(), 'update-colorful': lambda: self.install_colorful(),
                'install-wide-md': self.install_wide_md, 'update-wide-md': self.install_wide_md, 'start-ai-tts': self.start_ai_tts}

    def receipt(self, name):
        file = self.tooling / f'{name}.json'
        try:
            if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_SETTINGS:
                return None
            return json.loads(file.read_text())
        except (OSError, ValueError):
            return None

    def log_path(self, name):
        return self.tooling / 'logs' / f'{name}.log'

    def log(self, name):
        file = self.log_path(name)
        if file.is_symlink() or not file.is_file():
            return {'name': name, 'log': '', 'truncated': False}
        size = file.stat().st_size
        with file.open('rb') as stream:
            stream.seek(max(0, size - LOG_TAIL))
            data = stream.read(LOG_TAIL)
        return {'name': name, 'log': data.decode('utf-8', 'replace'), 'truncated': size > LOG_TAIL}

    def progress(self, text):
        if self.maintenance:
            self.maintenance.progress(short(text, 300))

    def prepare(self, name):
        for folder in (self.root / '.reader', self.tooling, self.tooling / 'logs', self.tooling / 'bin'):
            if folder.is_symlink():
                raise ValueError(f'{folder.relative_to(self.root)} must not be a symlink')
            folder.mkdir(exist_ok=True)
        if shutil.disk_usage(self.root).free < MIN_FREE:
            raise ValueError('Less than 5 GiB of disk is free; the install did not start')
        log = self.log_path(name)
        log.write_bytes(f'# Reader companion install: {name}, {stamp()}\n'.encode())
        return log

    @contextmanager
    def tooling_lock(self):
        with (self.tooling / 'setup.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise BlockingIOError('Another tooling install is running for this vault') from None
            yield

    def step(self, label, argv, log, *, cwd=None, env=None, timeout=300):
        """One explicit-argv step: output to the bounded log, last line as progress, the process group killed on timeout."""
        self.progress(label)
        with log.open('ab') as out:
            out.write(('\n$ ' + ' '.join(argv) + '\n').encode())
        process = subprocess.Popen(argv, cwd=cwd, env=env or dict(self.environ), stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        written = log.stat().st_size

        def drain():
            nonlocal written
            with log.open('ab') as out:
                for line in iter(process.stdout.readline, b''):
                    if written < LOG_LIMIT:
                        chunk = line[:LOG_LIMIT - written]
                        out.write(chunk)
                        out.flush()
                        written += len(chunk)
                    text = line.decode('utf-8', 'replace').strip()
                    if text:
                        self.progress(f'{label} · {text}')
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            raise TimeoutError(f'{label} took longer than {timeout // 60} min and was stopped') from None
        finally:
            reader.join(timeout=5)
        if code:
            tail = self.log(log.stem)['log'].strip().splitlines()
            raise RuntimeError(f'{label} failed (exit {code})' + (f': {tail[-1][:300]}' if tail else ''))

    def heavy(self, argv, note):
        """Wrap a Rust build in the workstation host/heavy-work lock when git-locks and a store exist."""
        mode = coordination(self.environ, self.root)
        if mode['mode'] == 'error':
            raise RuntimeError(mode['message'])
        if mode['mode'] != 'git-locks':
            return argv, dict(self.environ)
        env = dict(self.environ) | {'GIT_LOCKS_STORE': mode['store']}
        env.pop('GIT_LOCKS_NOW', None)
        return [mode['executable'], 'with', '--job', f'reader-install-{uuid.uuid4()}', '--holder', 'reader-companions',
                '--ttl', '2400', '--wait', '600', '--note', note, HEAVY_KEY, '--', *argv], env

    def install_colorful(self):
        from .prose import MIN_VERSION
        git, cargo = self.git(), self.cargo()
        if not cargo:
            raise ValueError(f'Rust is not installed; get it from {RUST}, then press Check again')
        if not git:
            raise ValueError('Git is not installed')
        log = self.prepare('colorful')
        with self.tooling_lock():
            source, target = self.tooling / 'colorful-language', self.tooling / 'colorful-target'
            if source.is_symlink():
                raise ValueError('The Colorful checkout must not be a symlink')
            if not source.exists():
                self.step('Cloning Colorful Language', [git, 'clone', '--quiet', '--no-checkout', COLORFUL_REPO, str(source)], log, timeout=600)
            else:
                origin = subprocess.run([git, '-C', str(source), 'remote', 'get-url', 'origin'], capture_output=True, text=True, timeout=10)
                if origin.stdout.strip().removesuffix('.git') != COLORFUL_REPO:
                    raise RuntimeError('The existing Colorful checkout is not the pinned public repository; remove it first')
                dirty = subprocess.run([git, '-C', str(source), 'status', '--porcelain'], capture_output=True, text=True, timeout=30)
                if dirty.returncode or dirty.stdout.strip():
                    raise RuntimeError('The Colorful checkout has local edits; preserve or remove them first')
                self.step('Fetching Colorful Language', [git, '-C', str(source), 'fetch', '--quiet', '--tags', 'origin'], log, timeout=600)
            self.step(f'Checking out {COLORFUL_TAG} ({COLORFUL_COMMIT[:12]})', [git, '-C', str(source), 'checkout', '--quiet', '--detach', COLORFUL_COMMIT], log, timeout=120)
            head = subprocess.run([git, '-C', str(source), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=10).stdout.strip()
            if head != COLORFUL_COMMIT:
                raise RuntimeError(f'Checkout is at {head[:12] or "nothing"}, not the pinned {COLORFUL_COMMIT[:12]}')
            env = dict(self.environ) | {'CARGO_TARGET_DIR': str(target), 'CARGO_INCREMENTAL': '0', 'CARGO_TERM_COLOR': 'never'}
            argv, lock_env = self.heavy([cargo, 'build', '--locked', '--release', '-p', 'colorful-cli', '--jobs', '2'], 'Reader: build Colorful Language')
            self.step('Building Colorful (a few minutes)', argv, log, cwd=str(source), env=lock_env | {k: env[k] for k in ('CARGO_TARGET_DIR', 'CARGO_INCREMENTAL', 'CARGO_TERM_COLOR')}, timeout=2100)
            built = target / 'release/colorful'
            if not executable_file(str(built)):
                raise RuntimeError('The build finished without a colorful binary')
            binary = self.tooling / 'bin/colorful'
            shutil.copy2(built, binary.with_suffix('.new'))
            os.replace(binary.with_suffix('.new'), binary)
            with self.lock:
                self.probes.clear()
            version = version_of(self.probe(str(binary)))
            if not version or version < MIN_VERSION:
                raise RuntimeError('The built colorful binary did not report version 0.3.0 or newer')
            receipt = {'revision': COLORFUL_COMMIT, 'tag': COLORFUL_TAG, 'repository': COLORFUL_REPO, 'executable': str(binary),
                       'version': '.'.join(map(str, version)), 'installed_at': stamp(),
                       'executable_sha256': hashlib.sha256(binary.read_bytes()).hexdigest()}
            (self.tooling / 'colorful.json').write_text(json.dumps(receipt, indent=2) + '\n')
            save_setting(self.root, 'colorful', str(binary))
            if self.prose:
                self.prose.forget()
            self.progress('Installed')
            return {'name': 'colorful', 'version': receipt['version'], 'path': str(binary), 'revision': COLORFUL_COMMIT[:12],
                    'message': f'Colorful Language {receipt["version"]} is ready. Press Space c in a document.'}

    def install_wide_md(self):
        if not self.cargo():
            raise ValueError(f'Rust is not installed; get it from {RUST}, then press Check again')
        script = self.code / 'scripts/install_wide_md.py'
        if not script.is_file():
            raise ValueError('This installation has no scripts/install_wide_md.py')
        log = self.prepare('wide-md')
        # The script takes the tooling setup.lock itself and enforces its own disk, memory and time limits.
        cargo_dir = str(Path(self.cargo()).parent)
        env = dict(self.environ) | {'READER_ROOT': str(self.root), 'PATH': cargo_dir + os.pathsep + (self.environ.get('PATH') or os.defpath)}
        argv, lock_env = self.heavy([self.python, str(script)], 'Reader: build wide-md')
        self.step('Building wide-md (a few minutes)', argv, log, cwd=str(self.code), env=lock_env | {k: env[k] for k in ('READER_ROOT', 'PATH')}, timeout=900)
        with self.lock:
            self.probes.clear()
        entry = self.wide_md()
        if entry['state'] != 'installed':
            raise RuntimeError(entry['message'] or 'wide-md did not install')
        self.progress('Installed')
        return {'name': 'wide-md', 'version': entry['version'], 'path': entry['path'], 'message': 'wide-md is ready for reader reading-copy.'}

    def start_ai_tts(self):
        plist = self.home / 'Library/LaunchAgents' / f'{AI_TTS_LABEL}.plist'
        if not plist.is_file() or plist.is_symlink():
            raise ValueError('No AI-TTS launch agent is installed; follow its setup guide')
        log = self.prepare('ai-tts')
        domain = f'gui/{os.getuid()}'
        loaded = subprocess.run([self.launchctl, 'print', f'{domain}/{AI_TTS_LABEL}'], stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=10).returncode == 0
        if loaded:
            self.step('Starting the AI-TTS daemon', [self.launchctl, 'kickstart', f'{domain}/{AI_TTS_LABEL}'], log, timeout=30)
        else:
            self.step('Loading the AI-TTS launch agent', [self.launchctl, 'bootstrap', domain, str(plist)], log, timeout=30)
        from .speech import SpeechUnavailable
        deadline = time.monotonic() + 20
        while True:
            try:
                self.speech.status()
                break
            except (SpeechUnavailable, ValueError, OSError):
                if time.monotonic() > deadline:
                    raise RuntimeError('launchd started AI-TTS, but its daemon did not answer within 20 s; see its log (make doctor)') from None
                self.progress('Waiting for the AI-TTS daemon')
                time.sleep(0.5)
        self.progress('Running')
        return {'name': 'ai-tts', 'message': 'AI-TTS is running. Press Space s in a document.'}


# kind -> (companion, action). Labels live in maintenance.JOBS.
JOB_KINDS = {'install-colorful': ('colorful', 'install'), 'update-colorful': ('colorful', 'update'),
             'install-wide-md': ('wide-md', 'install'), 'update-wide-md': ('wide-md', 'update'),
             'start-ai-tts': ('ai-tts', 'start')}
