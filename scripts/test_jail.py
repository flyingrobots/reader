#!/usr/bin/env python3
"""Run a test command inside an enforced sandbox that cannot reach a live Reader.

    python3 scripts/test_jail.py -- .venv/bin/python -m pytest -q
    python3 scripts/test_jail.py -- python3 scripts/run_browser_suites.py
    python3 scripts/test_jail.py -- npm run test:contract
    python3 scripts/test_jail.py --print-profile

On macOS the command runs under `sandbox-exec` with a profile written for this run, and every process it starts
inherits the sandbox. The profile fails closed:

- writes only under this checkout, a fresh per-run directory under /tmp (which becomes HOME, TMPDIR and READER_HOME),
  /dev and the per-user system temporary folders;
- no reads of the live Reader (its vault, its service checkout, its state and logs), agent-CLI configuration, SSH
  keys or the shared git-locks store;
- no network except loopback, and not the live Reader port, local model servers or the speech socket;
- the real agent CLIs (claude, codex, agy, lms, ollama, gemini) and git-locks cannot be started.

The live Reader's locations come from its service record (`~/Library/Application Support/Reader/service.json`) and
from READER_ROOT. Add more with --protect PATH or --deny-port N. On Linux the runner only accepts an existing container
(READER_TEST_JAIL=container with /.dockerenv or /run/.containerenv) and then runs the command as is.

The per-run directory is removed afterwards unless --keep is given; the run stops if it grows past 4 GiB. See
docs/testing.md.
"""
import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REAL_HOME = Path(os.environ.get('READER_TEST_JAIL_REAL_HOME') or Path.home())
SERVICE = REAL_HOME / 'Library/Application Support/Reader/service.json'
# Real agent CLIs, and git-locks: its workstation store is shared with every agent on the machine.
HOST_PROGRAMS = ('claude', 'codex', 'agy', 'lms', 'ollama', 'gemini', 'git-locks')
# Local model servers (LM Studio, Ollama) and the default live Reader port.
PORTS = (8766, 1234, 11434)
DATA_LIMIT = 4 * 1024**3


class JailError(Exception):
    pass


def service_record():
    """The installed service's record, or None when no service is installed. A record that exists but cannot be
    read is an error: the live vault would then be unknown."""
    if not SERVICE.exists():
        return None
    try:
        record = json.loads(SERVICE.read_text())
    except (OSError, ValueError) as exc:
        raise JailError(f'Cannot read the Reader service record {SERVICE}: {exc}') from exc
    if not isinstance(record, dict):
        raise JailError(f'Unexpected Reader service record {SERVICE}')
    return record


def protected_paths(root=ROOT, extra=()):
    """Everything a test must not read: the live Reader and the host's credentials and coordination state."""
    home = REAL_HOME
    paths = [home / 'Library/Application Support/Reader', home / 'Library/Logs/Reader',
             home / 'Library/Application Support/ai-tts', home / '.ssh', home / '.codex', home / '.claude',
             home / '.claude.json', home / '.gemini', home / '.config/gh', home / '.agy']
    record = service_record()
    if record:
        for key in ('vault', 'live'):
            if record.get(key):
                paths.append(Path(record[key]))
        for value in (record.get('env') or {}).values():
            if isinstance(value, str) and value.startswith('/') and 'git-locks' in value:
                paths.append(Path(value))
    for name in ('READER_ROOT', 'GIT_LOCKS_STORE'):
        if os.environ.get(name):
            paths.append(Path(os.environ[name]).expanduser())
    paths += [Path(p).expanduser() for p in extra]
    found = []
    for path in paths:
        for candidate in {path, path.resolve()}:
            if candidate not in found:
                found.append(candidate)
    root = Path(root).resolve()
    for path in found:
        if root == path or root.is_relative_to(path) or path.is_relative_to(root):
            raise JailError(f'This checkout and the protected path {path} overlap; run tests from a separate worktree')
    return found


def denied_ports(extra=()):
    record = service_record() or {}
    ports = list(PORTS) + [p for p in [record.get('port')] if isinstance(p, int)] + [int(p) for p in extra]
    return sorted(set(ports))


def denied_programs():
    """Real agent CLIs and git-locks found on PATH or in the usual install folders, by their resolved paths."""
    directories = [p for p in os.environ.get('PATH', '').split(':') if p and 'mise/shims' not in p]
    directories += [str(REAL_HOME / '.local/bin'), str(REAL_HOME / '.lmstudio/bin'), '/opt/homebrew/bin', '/usr/local/bin']
    found = []
    for name in HOST_PROGRAMS:
        path = shutil.which(name, path=':'.join(directories))
        if path:
            for candidate in (path, os.path.realpath(path)):
                if candidate not in found:
                    found.append(candidate)
    return found


def speech_socket():
    configured = os.environ.get('AI_TTS_SOCKET')
    return configured or str(REAL_HOME / 'Library/Application Support/ai-tts/ai-tts.sock')


def quote(value):
    return json.dumps(str(value))


def profile(root, run, protected, ports, programs, socket):
    """The sandbox-exec profile. Later deny rules narrow earlier exceptions, so the order matters."""
    writable = [Path(root).resolve(), run.resolve(), Path('/dev'), Path('/private/var/folders')]
    lines = ['(version 1)', '(allow default)',
             '(deny file-write* (require-not (require-any ' + ' '.join(f'(subpath {quote(p)})' for p in writable) + ')))',
             # The guard's probe: inside the writable run directory, but never writable in the sandbox.
             f'(deny file-write* (subpath {quote(run / "probe")}))']
    for path in protected:
        lines.append(f'(deny file-read* file-write* (subpath {quote(path)}))')
    lines.append('(deny network-outbound (require-all (require-not (remote ip "localhost:*")) (require-not (remote unix-socket))))')
    for port in ports:
        lines.append(f'(deny network-outbound (remote ip "localhost:{port}"))')
    lines.append(f'(deny network-outbound (remote unix-socket (path-literal {quote(socket)})))')
    for program in programs:
        lines.append(f'(deny process-exec (literal {quote(program)}))')
    return '\n'.join(lines) + '\n'


def toolchain_path(root=ROOT):
    """Resolve mise shims to real binaries first: with HOME moved, a shim cannot find its configuration."""
    directories = []
    mise = shutil.which('mise')
    for tool in ('node', 'npm', 'python3'):
        found = None
        if mise:
            result = subprocess.run([mise, 'which', tool], capture_output=True, text=True, cwd=root)
            found = result.stdout.strip() if result.returncode == 0 else None
        found = found or shutil.which(tool)
        if found:
            directory = str(Path(os.path.realpath(found)).parent)
            if directory not in directories:
                directories.append(directory)
    return ':'.join(directories + [os.environ.get('PATH', '')])


def environment(root, run, protected, ports, programs):
    home = run / 'home'
    env = dict(os.environ)
    env.update(HOME=str(home), TMPDIR=str(run / 'tmp'), READER_HOME=str(run / 'reader-home'),
               XDG_CONFIG_HOME=str(home / '.config'), XDG_CACHE_HOME=str(home / '.cache'), XDG_DATA_HOME=str(home / '.local/share'),
               npm_config_cache=str(home / '.npm'), PATH=toolchain_path(root),
               READER_TEST_SOCKET_ROOT=str(run / 'tmp'),
               READER_TEST_JAIL='sandbox-exec', READER_TEST_JAIL_PROBE=str(run / 'probe'),
               READER_TEST_JAIL_REAL_HOME=str(REAL_HOME),
               READER_TEST_JAIL_PROTECTED=json.dumps([str(p) for p in protected]),
               # Inside the sandbox a protected path cannot even be checked for existence, so record it here.
               READER_TEST_JAIL_PROTECTED_EXISTING=json.dumps([str(p) for p in protected if os.path.lexists(p)]),
               READER_TEST_JAIL_PORTS=json.dumps(ports), READER_TEST_JAIL_PROGRAMS=json.dumps(programs),
               READER_TEST_JAIL_SOCKET=speech_socket())
    env.pop('READER_ROOT', None)
    browsers = REAL_HOME / 'Library/Caches/ms-playwright'
    if 'PLAYWRIGHT_BROWSERS_PATH' not in env and browsers.is_dir():
        env['PLAYWRIGHT_BROWSERS_PATH'] = str(browsers)
    return env


def size(path):
    total = 0
    for directory, _, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(directory, name)).st_size
            except OSError:
                pass
    return total


def prepare(extra_protect=(), extra_ports=(), root=ROOT):
    """Create the run directory for a checkout and return (run, profile text, environment). The service updater
    passes the temporary worktree it smoke-tests as `root`."""
    root = Path(root)
    # Outside any checkout: a temporary vault nested in a Git worktree would see that repository. The short path also
    # keeps Unix socket paths under their 104-byte limit.
    # /tmp resolved, because the sandbox matches resolved paths.
    run = Path(tempfile.mkdtemp(prefix=f'rtj-{time.strftime("%m%d%H%M%S")}-', dir=os.path.realpath('/tmp')))
    for name in ('home', 'tmp', 'reader-home', 'probe'):
        (run / name).mkdir(parents=True)
    protected, ports, programs = protected_paths(root, extra_protect), denied_ports(extra_ports), denied_programs()
    text = profile(root, run, protected, ports, programs, speech_socket())
    (run / 'profile.sb').write_text(text)
    return run, text, environment(root, run, protected, ports, programs)


def process_sandboxed():
    """Whether macOS has put this process in any sandbox, whatever its environment says."""
    import ctypes
    library = ctypes.CDLL('/usr/lib/libSystem.dylib')
    library.sandbox_check.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    library.sandbox_check.restype = ctypes.c_int
    return library.sandbox_check(os.getpid(), None, 0) == 1


def in_container():
    """True in a Linux container marked for tests (READER_TEST_JAIL=container), which is the isolation there."""
    marked = Path('/.dockerenv').exists() or Path('/run/.containerenv').exists()
    return sys.platform != 'darwin' and os.environ.get('READER_TEST_JAIL') == 'container' and marked


def already_sandboxed():
    """True inside a running test sandbox; macOS cannot nest sandboxes. Both must hold: the process is sandboxed, and
    the test sandbox's probe refuses a write. Some other, more permissive sandbox does not count."""
    probe = os.environ.get('READER_TEST_JAIL_PROBE')
    if sys.platform != 'darwin' or os.environ.get('READER_TEST_JAIL') != 'sandbox-exec' or not probe or not process_sandboxed():
        return False
    try:
        (Path(probe) / f'nested-{os.getpid()}').write_text('')
    except PermissionError:
        return True
    except OSError:
        return False
    (Path(probe) / f'nested-{os.getpid()}').unlink(missing_ok=True)
    return False


def command_for(run, command):
    return ['/usr/bin/sandbox-exec', '-f', str(run / 'profile.sb'), *command]


def run_jailed(command, *, keep=False, timeout=None, extra_protect=(), extra_ports=()):
    run, _, env = prepare(extra_protect, extra_ports)
    process = subprocess.Popen(command_for(run, command), cwd=os.getcwd(), env=env, start_new_session=True)
    deadline = time.monotonic() + timeout if timeout else None
    reason = None
    try:
        while process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            if process.poll() is None and size(run) > DATA_LIMIT:
                reason = f'the run directory passed {DATA_LIMIT // 1024**3} GiB'
            elif deadline and time.monotonic() > deadline:
                reason = f'the run passed its {timeout} s deadline'
            if reason:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
    except KeyboardInterrupt:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait()
        raise
    finally:
        used = size(run)
        if not keep:
            shutil.rmtree(run, ignore_errors=True)
    if reason:
        print(f'test_jail: stopped: {reason}', file=sys.stderr)
        return 125
    print(f'test_jail: run directory used {used / 1024**2:.1f} MiB' + (f', kept at {run}' if keep else ''), file=sys.stderr)
    return process.returncode


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--protect', action='append', default=[], metavar='PATH', help='another path no test may read')
    parser.add_argument('--deny-port', action='append', default=[], metavar='N', help='another loopback port no test may reach')
    parser.add_argument('--keep', action='store_true', help='keep the per-run directory for inspection')
    parser.add_argument('--timeout', type=float, help='stop the whole run after this many seconds')
    parser.add_argument('--print-profile', action='store_true', help='print the profile this run would use and exit')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    try:
        if sys.platform != 'darwin':
            if in_container():
                return subprocess.call(command) if command else 0
            raise JailError('Only macOS sandbox-exec is supported here; on Linux run inside a container with READER_TEST_JAIL=container')
        if args.print_profile:
            run, text, _ = prepare(args.protect, args.deny_port)
            shutil.rmtree(run, ignore_errors=True)
            print(text, end='')
            return 0
        if not command:
            parser.error('give the test command after --')
        return run_jailed(command, keep=args.keep, timeout=args.timeout, extra_protect=args.protect, extra_ports=args.deny_port)
    except JailError as exc:
        print(f'test_jail: refusing to run: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
