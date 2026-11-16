"""Deliver to a Reader vault on another machine over SSH.

Standard library only: the delivering machine needs Python 3 and OpenSSH, not
the Reader environment or a vault. The vault machine runs `remote-gate` as the
forced command of a dedicated, restricted SSH key, so that key can reach only
the Reader operations allowed by its scope.
"""

import argparse
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from uuid import UUID

MAX_FILE = 32 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_FILES = 64
MAX_HEADER = 48 * 1024 * 1024
PING_TIMEOUT = 30
GATE_REFUSAL = 'this key only accepts reader-remote commands'
DEFAULT_KEY = '~/.ssh/reader_ed25519'
SCOPES = {
    'deliver': {'ping', 'ingest', 'status'},
    'library': {'ping', 'ingest', 'status', 'search', 'read', 'annotate', 'serve'},
}
KEY_LINE = re.compile(r'^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp(?:256|384|521)|'
                      r'sk-ecdsa-sha2-nistp256@openssh\.com|ssh-rsa) ([A-Za-z0-9+/]+={0,3})(?: ([\x21-\x7e ]{0,200}))?$')
HELPER_SEARCH = ('if [ -x "$HOME/.reader/bin/reader" ]; then exec "$HOME/.reader/bin/reader" remote-authorize --scope %s; fi; '
                 'for h in "$HOME/.claude/skills/reader/scripts/reader.py" '
                 '"${CODEX_HOME:-$HOME/.codex}/skills/reader/scripts/reader.py"; do '
                 'if [ -f "$h" ]; then exec python3 "$h" remote-authorize --scope %s; fi; done; '
                 'echo "Reader helper not found on this host; pass --server-helper" >&2; exit 3')


# ---- delivering machine ------------------------------------------------------

def config_path() -> Path:
    return Path(os.environ.get('READER_REMOTE_CONFIG') or '~/.config/reader/remote.json').expanduser()


def load_config():
    if os.environ.get('READER_REMOTE', '').lower() in ('0', 'off', 'local'):
        return None
    path = config_path()
    if not path.is_file():
        return None
    try:
        config = json.loads(path.read_text())
    except ValueError:
        config = None
    if isinstance(config, dict) and isinstance(config.get('url'), str) and isinstance(config.get('token_file'), str):
        return config
    if not (isinstance(config, dict) and isinstance(config.get('host'), str)
            and isinstance(config.get('identity'), str)):
        raise ValueError(f'{path} is not a valid remote configuration; run reader.py remote-setup again '
                         'or set READER_REMOTE=local')
    return config


def ssh_command(config: dict, remote_args, batch=True) -> list:
    # -S none: never share a multiplexed connection, which may be authenticated with other credentials.
    command = [os.environ.get('READER_SSH', 'ssh'), '-S', 'none']
    if batch:
        command += ['-i', str(Path(config['identity']).expanduser()), '-o', 'IdentitiesOnly=yes',
                    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
    if config.get('port'):
        command += ['-p', str(config['port'])]
    return command + [config['host'], shlex.join(remote_args)]


def read_local(value: str) -> bytes:
    source = Path(value).expanduser()
    if not source.is_absolute():
        raise ValueError('Source paths must be absolute')
    fd = os.open(source, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('Source must be a regular file')
        data = stream.read(MAX_FILE + 1)
        after = os.fstat(stream.fileno())
    if len(data) > MAX_FILE:
        raise ValueError('File exceeds the 32 MiB delivery limit')
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError('Source changed while being read; retry after the writer finishes')
    return data


def encode_delivery(submission: dict) -> bytes:
    """Replace local source paths with the bytes they name, framed after one JSON header line."""
    if not isinstance(submission, dict):
        raise ValueError('The request must be a JSON object')
    listed = submission.get('attachments') or []
    if (not isinstance(listed, list)
            or not all(isinstance(a, dict) and isinstance(a.get('source_path'), str) for a in listed)
            or not isinstance(submission.get('document_path', ''), (str, type(None)))):
        raise ValueError('document_path must be a string and attachments a list of objects with a source_path')
    submission = dict(submission)
    if len(submission.get('attachments') or []) + (submission.get('document_path') is not None) > MAX_FILES:
        raise ValueError('Delivery exceeds the 64-file limit')
    payloads, files = [], []
    document = submission.pop('document_path', None)
    if document is not None:
        payloads.append(read_local(document))
        files.append({'role': 'document'})
    attachments = []
    for attachment in submission.pop('attachments', None) or []:
        attachment = dict(attachment)
        payloads.append(read_local(attachment.pop('source_path')))
        files.append({'role': 'attachment'})
        attachments.append(attachment)
        if sum(map(len, payloads)) > MAX_TOTAL:
            raise ValueError('Delivery exceeds the 64 MiB limit')
    if document is not None and sum(map(len, payloads)) > MAX_TOTAL:
        raise ValueError('Delivery exceeds the 64 MiB limit')
    for item, data in zip(files, payloads):
        item.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    header = {'remote_delivery': 1, 'submission': {**submission, 'attachments': attachments}, 'files': files}
    return json.dumps(header, ensure_ascii=False).encode() + b'\n' + b''.join(payloads)


def encode_upload(submission: dict) -> bytes:
    """The web upload route's framing: a JSON header line, then the document and each attachment."""
    if not isinstance(submission, dict) or (submission.get('document_path') is None) == (submission.get('markdown') is None):
        raise ValueError('The request needs exactly one of document_path or markdown')
    if submission.get('document_path') is not None:
        document = read_local(submission['document_path'])
    else:
        document = submission['markdown'].encode()
    listed = submission.get('attachments') or []
    if not isinstance(listed, list) or not all(isinstance(a, dict) for a in listed):
        raise ValueError('attachments must be a list of objects')
    if len(listed) + 1 > MAX_FILES:
        raise ValueError('Delivery exceeds the 64-file limit')
    payloads = [(submission.get('filename') or 'report.md', document), *((a['path'], read_local(a['source_path'])) for a in listed)]
    if sum(len(data) for _, data in payloads) > MAX_TOTAL:
        raise ValueError('Delivery exceeds the 64 MiB limit')
    provenance = {k: v for k, v in (submission.get('provenance') or {}).items() if k in ('project', 'source', 'author', 'report_date', 'commit')}
    header = {'upload': 1, 'request_id': submission.get('request_id'), 'title': submission.get('title'), 'privacy': submission.get('privacy', 'no-cloud'),
              'provenance': provenance, 'files': [{'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for path, data in payloads]}
    return json.dumps(header, ensure_ascii=False).encode() + b'\n' + b''.join(data for _, data in payloads)


def http_request(config, method, path, body=None):
    token = Path(config['token_file']).expanduser().read_text().strip()
    url = config['url'].rstrip('/')
    if not url.startswith('https://') and not re.match(r'http://(127\.0\.0\.1|localhost)(:\d+)?$', url):
        raise ValueError('A delivery token is only sent over https or to this machine')
    headers = {'Authorization': 'Bearer ' + token}
    if body is not None:
        headers['Content-Type'] = 'application/vnd.reader.delivery'
    request = urllib.request.Request(url + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            sys.stdout.write(response.read().decode() + '\n')
        return 0
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read()).get('error')
        except ValueError:
            message = None
        print(f'Reader: {message or exc.reason} (HTTP {exc.code})', file=sys.stderr)
    except urllib.error.URLError as exc:
        print(f'Reader: could not reach {url}: {exc.reason}', file=sys.stderr)
    return 1


def http_client(args, config) -> int:
    """Delivery with a token instead of an SSH key. Only ingest and status exist on this route."""
    if not args or args[0] not in ('ingest', 'status') or len(args) != 2:
        raise ValueError('With a delivery token, the helper runs: ingest REQUEST.json, or status RECEIPT_ID')
    if args[0] == 'status':
        return http_request(config, 'GET', '/api/inbox/deliveries?id=' + str(UUID(args[1])))
    raw = sys.stdin.buffer.read() if args[1] == '-' else Path(args[1]).read_bytes()
    return http_request(config, 'POST', '/api/inbox/deliveries', encode_upload(json.loads(raw)))


def http_setup(argv) -> int:
    parser = argparse.ArgumentParser(prog='reader.py remote-token-setup',
                                     description='Deliver to Reader over https with a delivery token, instead of an SSH key.')
    parser.add_argument('url', help='Reader on your tailnet, for example https://reader.example.ts.net')
    args = parser.parse_args(argv)
    if not args.url.startswith('https://'):
        raise ValueError('Use the https:// address Reader has on your tailnet')
    token = getpass.getpass('Delivery token: ').strip()
    if not token.startswith('rdt_'):
        raise ValueError('That doesn’t look like a delivery token')
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    token_file = path.with_name('delivery-token')
    for target, text in ((token_file, token + '\n'), (path, json.dumps({'url': args.url, 'token_file': str(token_file)}, indent=2) + '\n')):
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
    print(f'Ready: deliveries from this machine now go to Reader at {args.url}. Config: {path}')
    return 0


def client(args, config) -> int:
    """Run a helper command on the vault machine."""
    if not args:
        raise ValueError('Missing command')
    if 'url' in config:
        return http_client(args, config)
    op, rest, stdin = args[0], list(args[1:]), b''
    if op == 'ingest':
        if len(rest) != 1:
            raise ValueError('Usage: ingest REQUEST.json (or - for stdin)')
        raw = sys.stdin.buffer.read() if rest[0] == '-' else Path(rest[0]).read_bytes()
        stdin, rest = encode_delivery(json.loads(raw)), []
    elif op == 'annotate' and rest:
        stdin = sys.stdin.buffer.read() if rest[-1] == '-' else Path(rest[-1]).read_bytes()
        rest[-1] = '-'
    elif op == 'serve':
        raise ValueError('For MCP, configure your client to run: ' + shlex.join(ssh_command(config, ['reader-remote', 'serve'])))
    result = subprocess.run(ssh_command(config, ['reader-remote', op, *rest]), input=stdin)
    if result.returncode == 255:
        print('Reader: SSH connection failed; check the host or run reader.py remote-setup', file=sys.stderr)
    return result.returncode


def ping(config) -> bool:
    try:
        result = subprocess.run(ssh_command(config, ['reader-remote', 'ping']), capture_output=True, text=True,
                                stdin=subprocess.DEVNULL, timeout=PING_TIMEOUT)
    except subprocess.TimeoutExpired:
        return False
    return result.returncode == 0 and '"ok": true' in result.stdout


def setup(argv) -> int:
    parser = argparse.ArgumentParser(prog='reader.py remote-setup',
                                     description='Create and authorize a Reader-only SSH key for a vault on another machine.')
    parser.add_argument('host', help='SSH destination of the vault machine, for example user@vault-host')
    parser.add_argument('--port', type=int)
    parser.add_argument('--key', default=DEFAULT_KEY, help='Dedicated key path (default %(default)s)')
    parser.add_argument('--scope', choices=sorted(SCOPES), default='deliver',
                        help='deliver: inbox delivery and receipt status only; library: also search, read and annotate')
    parser.add_argument('--passphrase', action='store_true', help='Prompt for a key passphrase (then use ssh-agent)')
    parser.add_argument('--server-helper', help="Absolute path of reader.py on the vault machine, if not in a skills folder")
    parser.add_argument('--force', action='store_true', help='Authorize again even if the key already works')
    args = parser.parse_args(argv)
    key = Path(os.path.abspath(Path(args.key).expanduser()))
    config = {'host': args.host, 'identity': str(key), 'scope': args.scope, **({'port': args.port} if args.port else {})}
    try:
        existing = load_config()
    except ValueError:
        existing = None  # setup rewrites a damaged configuration
    if not args.force and existing and {k: existing.get(k) for k in config} == config and key.is_file() and ping(config):
        print(f'Reader remote delivery to {args.host} is already set up ({args.scope} scope).')
        return 0
    if not key.with_name(key.name + '.pub').is_file():
        if key.exists():
            raise ValueError(f'{key} exists without {key.name}.pub; choose another --key')
        key.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        keygen = ['ssh-keygen', '-t', 'ed25519', '-f', str(key), '-C', f'reader-remote@{platform.node() or "client"}']
        subprocess.run(keygen + ([] if args.passphrase else ['-N', '']), check=True)
        print(f'Created dedicated Reader key {key}')
    else:
        print(f'Reusing Reader key {key}')
    public = key.with_name(key.name + '.pub').read_bytes()
    remote = (shlex.join(['python3', args.server_helper, 'remote-authorize', '--scope', args.scope])
              if args.server_helper else HELPER_SEARCH % (args.scope, args.scope))
    print(f'Authorizing the key on {args.host}. SSH may ask for your password on that machine once.')
    login = [os.environ.get('READER_SSH', 'ssh'), '-S', 'none'] + (['-p', str(args.port)] if args.port else [])
    result = subprocess.run(login + [args.host, remote], input=public, stderr=subprocess.PIPE)
    sys.stderr.buffer.write(result.stderr)
    if result.returncode != 0 and GATE_REFUSAL.encode() in result.stderr:
        # ssh-agent offered the Reader key itself, which reaches the gate; log in with configured identities only.
        print('Retrying without ssh-agent keys, which included the Reader key.', file=sys.stderr)
        result = subprocess.run(login + ['-o', 'IdentitiesOnly=yes', args.host, remote], input=public)
    if result.returncode != 0:
        print('Reader: authorization failed; nothing was saved on this machine', file=sys.stderr)
        return 1
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(config, stream, indent=2)
        stream.write('\n')
    if not ping(config):
        hint = ' Add the key to ssh-agent with ssh-add first.' if args.passphrase else ''
        print(f'Reader: saved {path}, but the key login test failed.{hint}', file=sys.stderr)
        return 1
    print(f'Ready: deliveries from this machine now go to Reader on {args.host} ({args.scope} scope). Config: {path}')
    return 0


# ---- vault machine -----------------------------------------------------------

def read_exact(stream, size: int, digest) -> bytes:
    chunks, remaining = [], size
    while remaining:
        chunk = stream.read(min(remaining, 1024 * 1024))
        if not chunk:
            raise ValueError('Delivery stream ended early')
        digest.update(chunk)
        chunks.append(chunk)
        remaining -= len(chunk)
    return b''.join(chunks)


def stage_delivery(stream, staging: Path) -> dict:
    """Write framed payloads to private staging files and return a local submission."""
    line = stream.readline(MAX_HEADER + 1)
    if not line.endswith(b'\n') or len(line) > MAX_HEADER:
        raise ValueError('Missing or oversized delivery header')
    try:
        header = json.loads(line)
    except RecursionError:
        raise ValueError('Unrecognized delivery header') from None
    if not isinstance(header, dict):
        raise ValueError('Unrecognized delivery header')
    files, submission = header.get('files'), header.get('submission')
    if header.get('remote_delivery') != 1 or not isinstance(files, list) or not isinstance(submission, dict):
        raise ValueError('Unrecognized delivery header')
    if len(files) > MAX_FILES:
        raise ValueError('Delivery exceeds the 64-file limit')
    sizes = [item.get('bytes') if isinstance(item, dict) else None for item in files]
    if not all(type(n) is int and 0 <= n <= MAX_FILE for n in sizes) or sum(sizes) > MAX_TOTAL:
        raise ValueError('Delivery exceeds the 32 MiB per-file or 64 MiB total limit')
    roles = [item.get('role') for item in files]
    attachments = submission.get('attachments') or []
    if not isinstance(attachments, list) or not all(isinstance(a, dict) for a in attachments):
        raise ValueError('Delivery header does not match its submission')
    expected = (['document'] if submission.get('markdown') is None else []) + ['attachment'] * len(attachments)
    if roles != expected or 'document_path' in submission or any('source_path' in a for a in attachments):
        raise ValueError('Delivery header does not match its submission')
    sources = []
    for index, (item, size) in enumerate(zip(files, sizes)):
        digest = hashlib.sha256()
        data = read_exact(stream, size, digest)
        if digest.hexdigest() != item.get('sha256'):
            raise ValueError('Delivered bytes do not match their SHA-256')
        target = staging / f'payload-{index}'
        with open(target, 'xb') as out:
            out.write(data)
        sources.append(str(target))
    if stream.read(1):
        raise ValueError('Unexpected data after the delivery payloads')
    if roles[:1] == ['document']:
        submission['document_path'] = sources.pop(0)
    submission['attachments'] = [{**a, 'source_path': s} for a, s in zip(attachments, sources)]
    return submission


def gate(scope: str, cli: list, state: Path, environ=os.environ, stdin=None) -> int:
    """Forced-command entry point: run one allowed Reader operation."""
    stdin = stdin or sys.stdin.buffer
    try:
        argv = shlex.split(environ.get('SSH_ORIGINAL_COMMAND', ''))
    except ValueError:
        argv = []
    if len(argv) < 2 or argv[0] != 'reader-remote':
        print(f'Reader: {GATE_REFUSAL}', file=sys.stderr)
        return 2
    op, rest = argv[1], argv[2:]
    if op not in SCOPES.get(scope, ()):
        print(f'Reader: {op!r} is not allowed for the {scope!r} key scope', file=sys.stderr)
        return 2
    if any(arg == '--root' or arg.startswith('--root=') for arg in rest):
        print('Reader: the vault root is fixed by the vault machine', file=sys.stderr)
        return 2
    if op == 'ping':
        print(json.dumps({'ok': True, 'scope': scope}))
        return 0
    if op == 'status':
        try:
            if len(rest) != 1:
                raise ValueError
            UUID(rest[0])
        except ValueError:
            print('Reader: status needs exactly one receipt UUID', file=sys.stderr)
            return 2
    if op == 'serve':
        if rest:
            print('Reader: remote serve takes no arguments', file=sys.stderr)
            return 2
        # Remote MCP clients must not name files on this machine.
        rest = ['--inline-only']
    if op == 'annotate' and rest != ['-']:
        print('Reader: remote annotate requests are read from stdin', file=sys.stderr)
        return 2
    if op != 'ingest':
        return subprocess.call([*cli, op, *rest], stdin=stdin)
    if rest:
        print('Reader: remote ingest reads its delivery from stdin', file=sys.stderr)
        return 2
    root = state / 'remote-staging'
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    staging = Path(tempfile.mkdtemp(prefix='delivery-', dir=root))
    try:
        submission = stage_delivery(stdin, staging)
        return subprocess.run([*cli, 'ingest', '-'], input=json.dumps(submission, ensure_ascii=False).encode()).returncode
    except (ValueError, OSError) as exc:
        print(f'Reader: {exc}', file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(staging, ignore_errors=True)


LAUNCHER = '''#!/bin/sh
# Reader's stable entry point. Written by install.py and remote-authorize; rerun install.py if Reader moves.
helper={helper}
if [ ! -f "$helper" ]; then
  echo "Reader helper is missing at $helper. On this machine, rerun Reader's scripts/install.py." >&2
  exit 3
fi
PATH="$PATH:/usr/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
exec python3 "$helper" "$@"
'''
LAUNCHER_TARGET = re.compile(r'^helper=(.+)$', re.M)
MAX_AUTHORIZED_KEYS = 1024 * 1024


def launcher_path() -> Path:
    return Path(os.environ.get('READER_HOME') or '~/.reader').expanduser() / 'bin/reader'


def launcher_target(path=None):
    """The helper a launcher starts, or None if it is absent or not ours."""
    try:
        match = LAUNCHER_TARGET.search(Path(path or launcher_path()).read_text())
        argv = shlex.split(match.group(1)) if match else []
        return Path(argv[0]) if len(argv) == 1 else None
    except (OSError, ValueError):
        return None


def linked_worktree(path: Path) -> bool:
    """Whether a file lives in a linked Git worktree, which can be removed while keys still name it."""
    for parent in Path(path).resolve().parents:
        marker = parent / '.git'
        if marker.exists():
            return marker.is_file()
    return False


def write_launcher(helper: Path) -> Path:
    """Point the stable launcher at this helper's real file. It holds no interpreter path, which can go stale too."""
    real = Path(helper).resolve()
    if linked_worktree(real):
        raise ValueError(f'{real} is in a linked Git worktree, which can be removed while it is still in use; '
                         'run this from the main Reader checkout')
    link = launcher_path()
    link.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.reader-', dir=link.parent)
    with os.fdopen(fd, 'w') as stream:
        stream.write(LAUNCHER.format(helper=shlex.quote(str(real))))
    os.chmod(temporary, 0o755)
    os.replace(temporary, link)
    return link


def stable_helper(helper: Path) -> Path:
    """The launcher a key should name. A working launcher is kept, so a run from a worktree cannot repoint it."""
    current = launcher_target()
    if current and current.is_file():
        return launcher_path()
    return write_launcher(helper)


def delivery_keys(path=None) -> list:
    """Each Reader key in authorized_keys and whether its forced command can still start."""
    file = Path(path or os.environ.get('READER_AUTHORIZED_KEYS') or '~/.ssh/authorized_keys').expanduser()
    try:
        if file.stat().st_size > MAX_AUTHORIZED_KEYS:
            return []
        lines = file.read_text(errors='replace').splitlines()
    except OSError:
        return []
    keys = []
    for line in lines:
        match = re.match(r'^\S*command="([^"]*remote-gate[^"]*)"\s+\S+\s+\S+\s*(.*)$', line)
        if not match:
            continue
        try:
            argv = shlex.split(match.group(1))
            start = argv[:argv.index('remote-gate')]
        except ValueError:
            keys.append({'name': match.group(2), 'healthy': False})
            continue
        healthy = bool(start) and all(Path(item).expanduser().is_file() for item in start)
        if healthy and launcher_target(start[-1]):
            healthy = launcher_target(start[-1]).is_file()
        keys.append({'name': match.group(2), 'healthy': healthy})
    return keys


def authorize(argv, helper: Path, stdin=None) -> int:
    """Add or update the restricted authorized_keys entry for a Reader key read from stdin."""
    parser = argparse.ArgumentParser(prog='reader.py remote-authorize')
    parser.add_argument('--scope', choices=sorted(SCOPES), default='deliver')
    args = parser.parse_args(argv)
    lines = (stdin or sys.stdin).read().strip().splitlines()
    match = KEY_LINE.match(lines[0].strip()) if len(lines) == 1 else None
    if not match:
        print('Reader: expected exactly one OpenSSH public key line', file=sys.stderr)
        return 2
    kind, blob, comment = match.groups()
    try:
        launcher = stable_helper(helper)
    except (ValueError, OSError) as exc:
        print(f'Reader: {exc}', file=sys.stderr)
        return 2
    command = shlex.join([str(launcher), 'remote-gate', '--scope', args.scope])
    if '"' in command or '\\' in command:
        print('Reader: the launcher path cannot be quoted safely in authorized_keys', file=sys.stderr)
        return 2
    entry = f'restrict,command="{command}" {kind} {blob}' + (f' {comment}' if comment else '')
    path = Path(os.environ.get('READER_AUTHORIZED_KEYS') or '~/.ssh/authorized_keys').expanduser()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Hold a sidecar lock across read-modify-replace so concurrent setups cannot drop each other's keys.
    lock_fd = os.open(path.with_name(path.name + '.reader-lock'), os.O_WRONLY | os.O_CREAT, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        return update_authorized_keys(path, entry, blob, args.scope)
    finally:
        os.close(lock_fd)


def update_authorized_keys(path: Path, entry: str, blob: str, scope: str) -> int:
    existing = path.read_bytes().decode().splitlines(keepends=True) if path.exists() else []
    output, changed, found = [], False, False
    for line in existing:
        if blob in line.split():
            if 'remote-gate' not in line:
                print('Reader: this key is already authorized without Reader restrictions; '
                      'use a dedicated key (remote-setup --key)', file=sys.stderr)
                return 2
            found = True
            changed = changed or line.rstrip('\r\n') != entry
            line = entry + '\n'
        output.append(line)
    if not found:
        if output and not output[-1].endswith('\n'):
            output[-1] += '\n'
        output.append(entry + '\n')
        changed = True
    if changed:
        fd, temporary = tempfile.mkstemp(prefix='.authorized_keys-', dir=path.parent)
        with os.fdopen(fd, 'w') as stream:
            stream.write(''.join(output))
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    print(json.dumps({'authorized': True, 'scope': scope, 'changed': changed}))
    return 0
