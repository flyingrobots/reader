"""Fake git, cargo, git-locks and launchctl for companion install tests. Nothing here clones or builds.

`install(folder)` writes the executables and returns their paths. Each records its argv
(and GIT_LOCKS_STORE) as a JSON line in $FAKE_TOOL_LOG. Behaviour switches:
  FAKE_GIT_FAIL=<subcommand>   that git subcommand exits 128
  FAKE_CARGO_FAIL=1            cargo build exits 101
  FAKE_CARGO_SLEEP=<seconds>   cargo build waits first (for progress, timeouts and concurrency)
  FAKE_CARGO_VERSION=<x.y.z>   the built colorful reports this version (default 0.4.0)
The built `colorful` runs tests/fake_colorful.py, so prose colors work after a fake install."""
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent

PRELUDE = '''#!{python}
import json, os, pathlib, subprocess, sys, time
argv = sys.argv[1:]
if os.environ.get('FAKE_TOOL_LOG'):
    with open(os.environ['FAKE_TOOL_LOG'], 'a') as log:
        log.write(json.dumps({{'tool': {name!r}, 'argv': argv, 'store': os.environ.get('GIT_LOCKS_STORE'), 'cwd': os.getcwd()}}) + '\\n')
'''

GIT = '''
fail = os.environ.get('FAKE_GIT_FAIL')
where = pathlib.Path(argv[1]) if argv[:1] == ['-C'] else pathlib.Path.cwd()
rest = argv[2:] if argv[:1] == ['-C'] else argv
if rest and rest[0] == fail:
    sys.stderr.write('fatal: synthetic ' + fail + ' failure\\n'); raise SystemExit(128)
if rest[:1] == ['clone']:
    dest = pathlib.Path(rest[-1]); (dest / '.git').mkdir(parents=True)
    (dest / '.git/origin').write_text(rest[-2]); print('Cloning into ' + dest.name + '...')
elif rest[:3] == ['remote', 'get-url', 'origin']:
    print((where / '.git/origin').read_text())
elif rest[:2] == ['status', '--porcelain']:
    dirty = where / '.git/dirty'
    print(dirty.read_text() if dirty.exists() else '', end='')
elif rest[:1] == ['fetch']:
    print('fetched')
elif rest[:1] == ['checkout']:
    (where / '.git/HEAD_REV').write_text(rest[-1])
elif rest[:2] == ['rev-parse', 'HEAD']:
    head = where / '.git/HEAD_REV'
    print(head.read_text() if head.exists() else '')
else:
    sys.stderr.write('fake git: unsupported ' + ' '.join(rest) + '\\n'); raise SystemExit(2)
'''

CARGO = '''
if argv[:1] == ['--version']:
    print('cargo 1.90.0 (fake)'); raise SystemExit(0)
assert argv[:1] == ['build'], argv
time.sleep(float(os.environ.get('FAKE_CARGO_SLEEP') or 0))
print('   Compiling colorful-cli v0.4.0 (fake)', flush=True)
if os.environ.get('FAKE_CARGO_FAIL'):
    print('error: synthetic build failure', flush=True); raise SystemExit(101)
target = pathlib.Path(os.environ['CARGO_TARGET_DIR']) / 'release'; target.mkdir(parents=True, exist_ok=True)
version = os.environ.get('FAKE_CARGO_VERSION') or '0.4.0'
binary = target / 'colorful'
binary.write_text('#!/bin/sh\\nif [ "$1" = "--version" ]; then echo "colorful ' + version + '"; exit 0; fi\\n'
                  'exec ' + {python!r} + ' ' + {fake_colorful!r} + ' "$@"\\n')
binary.chmod(0o755)
print('    Finished `release` profile (fake)', flush=True)
'''

GIT_LOCKS = '''
if argv[:1] == ['version']:
    print('git-locks 0.7.0'); raise SystemExit(0)
if argv[:1] == ['with']:
    command = argv[argv.index('--') + 1:]
    raise SystemExit(subprocess.run(command).returncode)
if argv[:1] == ['claim']:
    print(json.dumps({{'event': 'claimed', 'acquisition': 'acq-fake'}})); raise SystemExit(0)
if argv[:1] == ['release']:
    print(json.dumps({{'event': 'released'}})); raise SystemExit(0)
if argv[:1] == ['store']:
    print(json.dumps({{'store': os.environ.get('FAKE_REPO_STORE', '')}})); raise SystemExit(0)
raise SystemExit(2)
'''

LAUNCHCTL = '''
state = pathlib.Path(os.environ.get('FAKE_LAUNCHCTL_STATE', '/nonexistent'))
if argv[:1] == ['print']:
    raise SystemExit(0 if state.exists() else 113)
if argv[:1] in (['bootstrap'], ['kickstart']):
    state.write_text(argv[0]); raise SystemExit(0)
raise SystemExit(2)
'''


def install(folder, names=('git', 'cargo', 'git-locks', 'launchctl')):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    bodies = {'git': GIT, 'cargo': CARGO.format(python=sys.executable, fake_colorful=str(HERE / 'fake_colorful.py')),
              'git-locks': GIT_LOCKS.format(), 'launchctl': LAUNCHCTL}
    paths = {}
    for name in names:
        path = folder / name
        path.write_text(PRELUDE.format(python=sys.executable, name=name) + bodies[name])
        path.chmod(0o755)
        paths[name] = path
    return paths


def calls(log, tool=None):
    log = Path(log)
    rows = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    return [r for r in rows if tool is None or r['tool'] == tool]


def store(folder):
    """A minimal Git directory, which is all a git-locks store must look like to Reader."""
    folder = Path(folder)
    (folder / 'objects').mkdir(parents=True, exist_ok=True)
    (folder / 'HEAD').write_text('ref: refs/heads/main\n')
    return folder
