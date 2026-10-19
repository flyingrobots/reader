"""Deliver to a Reader vault on another machine over SSH.

Standard library only: the delivering machine needs Python 3 and OpenSSH, not
the Reader environment or a vault. The vault machine runs `remote-gate` as the
forced command of a dedicated, restricted SSH key, so that key can reach only
the Reader operations allowed by its scope.
"""

import argparse
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
from uuid import UUID

MAX_FILE = 32 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_FILES = 64
MAX_HEADER = 48 * 1024 * 1024
DEFAULT_KEY = '~/.ssh/reader_ed25519'
SCOPES = {
    'deliver': {'ping', 'ingest', 'status'},
    'library': {'ping', 'ingest', 'status', 'search', 'read', 'annotate', 'curation', 'serve'},
}
KEY_LINE = re.compile(r'^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp(?:256|384|521)|'
                      r'sk-ecdsa-sha2-nistp256@openssh\.com|ssh-rsa) ([A-Za-z0-9+/]+={0,3})(?: ([\x21-\x7e ]{0,200}))?$')
HELPER_SEARCH = ('for h in "$HOME/.claude/skills/reader/scripts/reader.py" '
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
    return json.loads(path.read_text()) if path.is_file() else None


def ssh_command(config: dict, remote_args, batch=True) -> list:
    command = [os.environ.get('READER_SSH', 'ssh')]
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
    submission = dict(submission)
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
    if len(payloads) > MAX_FILES or sum(map(len, payloads)) > MAX_TOTAL:
        raise ValueError('Delivery exceeds the 64-file or 64 MiB limit')
    for item, data in zip(files, payloads):
        item.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    header = {'remote_delivery': 1, 'submission': {**submission, 'attachments': attachments}, 'files': files}
    return json.dumps(header, ensure_ascii=False).encode() + b'\n' + b''.join(payloads)


def client(args, config) -> int:
    """Run a helper command on the vault machine."""
    if not args:
        raise ValueError('Missing command')
    op, rest, stdin = args[0], list(args[1:]), b''
    if op == 'ingest':
        if len(rest) != 1:
            raise ValueError('Usage: ingest REQUEST.json (or - for stdin)')
        raw = sys.stdin.buffer.read() if rest[0] == '-' else Path(rest[0]).read_bytes()
        stdin, rest = encode_delivery(json.loads(raw)), []
    elif op in ('annotate', 'curation') and rest and rest[-1] != '-' and (op == 'annotate' or rest[0] == 'mark'):
        stdin, rest[-1] = Path(rest[-1]).read_bytes(), '-'
    elif op == 'serve':
        raise ValueError('For MCP, configure your client to run: ' + shlex.join(ssh_command(config, ['reader-remote', 'serve'])))
    result = subprocess.run(ssh_command(config, ['reader-remote', op, *rest]), input=stdin)
    if result.returncode == 255:
        print('Reader: SSH connection failed; check the host or run reader.py remote-setup', file=sys.stderr)
    return result.returncode


def ping(config) -> bool:
    result = subprocess.run(ssh_command(config, ['reader-remote', 'ping']), capture_output=True, text=True)
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
    key = Path(args.key).expanduser()
    config = {'host': args.host, 'identity': str(key), 'scope': args.scope, **({'port': args.port} if args.port else {})}
    existing = load_config()
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
              if args.server_helper else HELPER_SEARCH % args.scope)
    print(f'Authorizing the key on {args.host}. SSH may ask for your password on that machine once.')
    login = [os.environ.get('READER_SSH', 'ssh')] + (['-p', str(args.port)] if args.port else []) + [args.host, remote]
    if subprocess.run(login, input=public).returncode != 0:
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
    header = json.loads(line)
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
        print('Reader: this key only accepts reader-remote commands', file=sys.stderr)
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
    if op == 'status' and len(rest) == 1:
        try:
            UUID(rest[0])
        except ValueError:
            print('Reader: status needs a receipt UUID', file=sys.stderr)
            return 2
    if op in ('annotate', 'curation') and rest[-1:] != ['-'] and rest[:1] != ['list']:
        print('Reader: remote annotate/curation mark requests are read from stdin', file=sys.stderr)
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


def authorize(argv, helper: Path, python=sys.executable, stdin=None) -> int:
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
    command = shlex.join([python, str(helper), 'remote-gate', '--scope', args.scope])
    if '"' in command or '\\' in command:
        print('Reader: helper path cannot be quoted safely in authorized_keys', file=sys.stderr)
        return 2
    entry = f'restrict,command="{command}" {kind} {blob}' + (f' {comment}' if comment else '')
    path = Path(os.environ.get('READER_AUTHORIZED_KEYS') or '~/.ssh/authorized_keys').expanduser()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
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
    print(json.dumps({'authorized': True, 'scope': args.scope, 'changed': changed}))
    return 0
