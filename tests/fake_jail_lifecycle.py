"""Synthetic, pipe-coordinated processes for the test-jail lifecycle contract."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys


def main() -> None:
    mode = sys.argv[1]
    if mode == 'sleeper':
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        print(json.dumps({'pid': os.getpid(), 'group': os.getpgrp()}), flush=True)
        signal.pause()
        raise SystemExit(99)
    if mode == 'command':
        descendant = subprocess.Popen([sys.executable, __file__, 'sleeper'], stdout=subprocess.PIPE, text=True)
        assert descendant.stdout is not None
        ready = json.loads(descendant.stdout.readline())
        descendant.stdout.close()
        print(json.dumps({'pid': os.getpid(), 'group': os.getpgrp(), 'descendant': ready['pid']}), flush=True)
        sys.stdin.read(1)
        if sys.argv[3:] != ['orphan']:
            descendant.kill()
            descendant.wait(timeout=3)
        raise SystemExit(int(sys.argv[2]))
    spec = importlib.util.spec_from_file_location('test_jail', sys.argv[2])
    assert spec is not None and spec.loader is not None
    jail = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(jail)
    run = Path(sys.argv[3])
    # The test itself already runs in the enforced sandbox/container. These seams
    # isolate lifecycle behavior without attempting a forbidden nested sandbox.
    jail.prepare = lambda *args: (run, '', dict(os.environ))
    jail.command_for = lambda directory, command: command
    if mode == 'lost-waitid':
        def lost(*args):
            raise ChildProcessError('Synthetic lost child custody')
        jail.os.waitid = lost
        def record_unverified(group, signum):
            with (run / 'unverified-signals').open('a') as record:
                record.write(f'{group} {signum}\n')
        jail.os.killpg = record_unverified
    if mode == 'missing-leader':
        original_states = jail.process_states
        def omit_exited_leader():
            return {pid: state for pid, state in original_states().items() if not state[-1].startswith('Z')}
        jail.process_states = omit_exited_leader
    if mode == 'fallback':
        jail.os.waitid = None
    if mode == 'unreadable':
        def refuse():
            raise jail.JailError('Synthetic process-table visibility failure')
        jail.process_states = refuse
    timeout = float(sys.argv[4]) or None
    command = [sys.executable, __file__, 'command', sys.argv[5]]
    if mode == 'orphan':
        command.append('orphan')
    raise SystemExit(jail.run_jailed(command, timeout=timeout))


if __name__ == '__main__':
    main()
