"""Supervise one deterministic, model-assisted intake batch per vault."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import resource
import shutil
from . import arrival_choices
from .inbox_paths import PREFIX, inbox_dir, sweep
from .resources import has_capacity, minimum_free_bytes
import signal
import subprocess
import sys
import time
import threading

MAX_INBOX_FILES = 10000
from uuid import uuid4
from .junk import os_junk


def inventory(root, *, strict=True):
    """Preserve hidden attachments; refuse unsafe arrivals instead of silently skipping them."""
    paths = []
    sweep(root)
    base = inbox_dir(root)
    if base.is_symlink():
        raise ValueError('Inbox must not be a symlink')
    for directory, folders, files in os.walk(base, followlinks=False):
        for name in folders + files:
            if strict and not os_junk(name) and ((Path(directory) / name).is_symlink() or name == '.git'):
                raise ValueError('Inbox symlinks or Git metadata require explicit disposition: ' + PREFIX + (Path(directory) / name).relative_to(base).as_posix())
        folders[:] = [n for n in folders if not os_junk(n) and n != '.git' and not (Path(directory) / n).is_symlink()]
        for name in sorted(files):
            p = Path(directory) / name
            if os_junk(name) or p.is_symlink() or p == base / 'README.md':
                continue
            if not p.is_file():
                if strict:
                    raise ValueError('Inbox contains a non-regular file')
                continue
            paths.append(PREFIX + p.relative_to(base).as_posix())
            if len(paths)>MAX_INBOX_FILES:raise ValueError('Inbox inventory exceeds its supported 10,000-file capacity')
    return sorted(paths)


def write_state(runtime, state):
    state['updated_at'] = datetime.now(timezone.utc).isoformat()
    temp = runtime / 'state.next.json'
    temp.write_text(json.dumps(state, indent=2)+'\n')
    temp.replace(runtime / 'state.json')


def sandbox_writable_paths(root, workstation_lock_store=None):
    """Resolve exact Git metadata and lock stores; never grant their parent directories."""
    metadata = root / '.git'
    paths = [metadata] if not metadata.exists() or metadata.is_dir() else []
    git = shutil.which('git')
    if git:
        for option in ['--git-common-dir', '--absolute-git-dir']:
            result = subprocess.run([git, 'rev-parse', '--path-format=absolute', option],
                                    cwd=root, capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                paths.append(Path(result.stdout.strip()))
            elif result.returncode != 128:
                raise ValueError('Cannot resolve shared Git metadata: ' + result.stderr[-1000:])
    from .companions import find_git_locks
    tool = find_git_locks(root=root)
    if tool:
        # The store the librarian's git-locks calls will use, in this server's environment.
        result = subprocess.run([tool, 'store'], cwd=root, capture_output=True, text=True,
                                timeout=10, check=True)
        if len(result.stdout) > 4096:
            raise ValueError('Git-locks store response exceeds 4 KiB')
        value = json.loads(result.stdout).get('store')
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise ValueError('Git-locks did not return an absolute store path')
        store = Path(value).resolve(strict=True)
        if not store.is_dir():
            raise ValueError('Git-locks store must be a directory')
        paths.append(store)
    if workstation_lock_store:
        store = Path(workstation_lock_store).expanduser()
        if not store.is_absolute():
            raise ValueError('Workstation git-locks store must be an absolute path')
        store = store.resolve(strict=True)
        if not store.is_dir() or not (store / 'HEAD').is_file() or not (store / 'objects').is_dir():
            raise ValueError('Workstation git-locks store must be an existing Git directory')
        paths.append(store)
    return list(dict.fromkeys(str(path.resolve()) for path in paths))


def chat_turn_running(root):
    """Web chat voices write in the vault too; their run lock is held for a whole turn."""
    lock = root / '.reader/voice-runner/run.lock'
    if not lock.is_file():
        return False
    with lock.open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(handle, fcntl.LOCK_UN)
    return False


class WorkerProcesses:
    """Track descendants even when a child starts another process group."""
    def __init__(self, process):
        self.process = process
        self.pids = {process.pid}
        self.groups = {process.pid}
        self.stopped = False

    def measure(self):
        output = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,rss='], text=True, timeout=5)
        rows = [tuple(map(int, line.split())) for line in output.splitlines() if len(line.split()) == 4]
        found = {pid for pid, parent, group, rss in rows if pid in self.pids or group in self.groups}
        while True:
            expanded = found | {pid for pid, parent, group, rss in rows if parent in found}
            if expanded == found:
                break
            found = expanded
        self.pids = found
        self.groups.update(group for pid, parent, group, rss in rows if pid in found and group in found)
        return sum(rss * 1024 for pid, parent, group, rss in rows if pid in found)

    def stop(self):
        if self.stopped:
            return
        try:
            self.measure()
        except (OSError, ValueError, subprocess.SubprocessError):
            pass  # A failed measurement still kills every previously observed owned process.
        for group in self.groups:
            self.signal_group(group, signal.SIGTERM)
        try:
            self.process.wait(timeout=35)  # Filing cleanup allows 30 seconds to release its own lease.
        except subprocess.TimeoutExpired:
            pass
        for group in self.groups:
            self.signal_group(group, signal.SIGKILL)
        self.process.wait()
        self.stopped = True

    @staticmethod
    def signal_group(group, sig):
        try:
            os.killpg(group, sig)
        except ProcessLookupError:
            pass
        except PermissionError:
            # macOS can report EPERM for a group that disappeared between TERM
            # and KILL. Only accept that error after proving no members remain;
            # an unreadable process table or a live group must still fail closed.
            groups = subprocess.check_output(['ps', '-axo', 'pgid='], text=True, timeout=5)
            if group in {int(value) for value in groups.split()}:
                raise


def run(root, codex, run_id=None, timeout=1800, workstation_lock_store=None, sandbox_mode='read-only', only=None):
    root = root.resolve(strict=True)
    runtime = root / '.reader/inbox-runner'
    from .intake_journal import local_path, MAX_PLAN
    from .portable_links import atomic
    local_path(root, '.reader/inbox-runner')
    if not 0 < timeout <= 1800:
        raise ValueError('Intake progress deadline must be at most 30 minutes')
    runtime.mkdir(parents=True, exist_ok=True)
    for name in ('run.lock', 'state.json', 'state.next.json', 'cancel', 'pending.json', 'queue.json', 'selection.json', 'result.json',
                 'last-message.md', 'events.jsonl', 'stderr.log', 'tmp', 'editorial', 'prepared', 'progress.json', 'model-chain.json'):
        local_path(root, '.reader/inbox-runner/' + name)
    with (runtime / 'run.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 2
        state = dict(run_id=run_id or str(uuid4()), status='starting', supervisor_pid=os.getpid(),
                     started_at=datetime.now(timezone.utc).isoformat(), message='Preparing inbox inventory')
        (runtime / 'cancel').unlink(missing_ok=True)
        # Serialize admission with turn-boundary intake claims. The running state
        # then excludes new claims while the long-lived run lock owns this job.
        with (root / '.reader/upkeep.lock').open('a') as coordination:
            fcntl.flock(coordination,fcntl.LOCK_EX)
            claims=root / '.reader/upkeep-claims.json'
            if claims.exists() and json.loads(claims.read_text()):
                state.update(status='failed',message='Upkeep intake workers hold arrivals; finish their batches before starting the inbox runner.')
                write_state(runtime,state)
                return 2
            if chat_turn_running(root):
                state.update(status='failed',message='A voice chat turn is running in this vault; start the inbox run when it finishes.')
                write_state(runtime,state)
                return 2
            write_state(runtime,state)
        worker = tree = None
        try:
            if sandbox_mode not in ('read-only', 'workspace-write', 'danger-full-access'):
                raise ValueError('Unsupported inbox sandbox mode')
            recovering = (runtime / 'pending.json').exists() or (runtime / 'queue.json').exists()
            paths = inventory(root, strict=not recovering)
            if only and not recovering:
                # A run for chosen arrivals, so an upload's filing never sweeps up what else is waiting.
                paths = [p for p in paths if p.split('/')[1] in only]
            on_hold = arrival_choices.held(root)
            kept = [p for p in paths if p.split('/')[1] not in on_hold] if not recovering else paths
            nothing = 'Nothing to file: everything waiting is on hold.' if paths and not kept else 'The inbox is empty.'
            paths = kept
            arrivals = sorted({p.split('/')[1] for p in paths})
            state['arrivals'] = arrivals[:20]
            state['arrival_count'] = len(arrivals)
            state['file_count'] = len(paths)
            state['inventory'] = 'selection.json'
            if not paths and not recovering:
                state.update(status='empty',message=nothing); return 0
            for name in ('last-message.md','events.jsonl','stderr.log'):
                (runtime / name).write_bytes(b'')
            atomic(runtime / 'selection.json', {'run_id': state['run_id'], 'arrivals': ['inbox/' + name for name in arrivals], 'files': paths}, limit=MAX_PLAN)
            (runtime / 'result.json').unlink(missing_ok=True)
            (runtime / 'progress.json').unlink(missing_ok=True)
            (runtime / 'model-chain.json').unlink(missing_ok=True)
            temp = runtime / 'tmp'; temp.mkdir(exist_ok=True)
            def data_size():
                total = 0
                waiting = inbox_dir(root)  # Arrivals are the input, with their own limits, not this run's generated data.
                for base, dirs, files in os.walk(root / '.reader'):
                    dirs[:] = [d for d in dirs if not (Path(base)/d).is_symlink() and Path(base)/d != waiting]
                    for name in files:
                        p=Path(base)/name
                        try:
                            if not p.is_symlink(): total += p.stat().st_size
                        except FileNotFoundError: pass
                return total
            def check_limits():
                if not has_capacity(root) or data_size() > 4*1024**3:
                    raise ValueError('Reader free-space or 4 GiB data budget reached')
                if sum((runtime/n).stat().st_size for n in ('events.jsonl','stderr.log','last-message.md')) > 16*1024**2:
                    raise ValueError('Inbox run exceeded its 16 MiB output budget')
            check_limits()
            args = [sys.executable, '-m', 'reader_mcp.intake', '--root', str(root), '--codex', codex,
                    '--run-id', state['run_id']]
            state['command'] = args
            state['sandbox_mode'] = 'read-only'
            state['workflow'] = 'deterministic-intake-v1'
            cpu_limits = tuple(3600 if value == resource.RLIM_INFINITY else min(value, 3600)
                               for value in resource.getrlimit(resource.RLIMIT_CPU))
            state['limits'] = dict(timeout_seconds=timeout,timeout_scope='verified-progress',data_bytes=4*1024**3,output_bytes=16*1024**2,
                                   minimum_free_bytes=minimum_free_bytes(root),cpu_seconds=cpu_limits[0])
            state['temporary_path'] = str(temp)
            state['output_path'] = str(runtime)
            write_state(runtime,state)
            def limits():
                resource.setrlimit(resource.RLIMIT_CPU,cpu_limits)
            with (runtime/'events.jsonl').open('wb') as out, (runtime/'stderr.log').open('wb') as err:
                worker=subprocess.Popen(args,cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=dict(os.environ,TMPDIR=str(temp),PYTHONPATH=os.pathsep.join([str(Path(__file__).resolve().parents[1]), os.environ.get("PYTHONPATH", "")])),
                                        start_new_session=True,preexec_fn=limits)
                tree = WorkerProcesses(worker)
                output_failed = threading.Event()
                def copy_output(pipe, target):
                    written = 0
                    try:
                        while chunk := pipe.read1(65536):  # Whatever is available, so events reach the transcript live.
                            if written + len(chunk) > 8*1024**2:
                                output_failed.set()
                                os.killpg(worker.pid,signal.SIGTERM); break
                            target.write(chunk); target.flush(); written += len(chunk)
                    except (OSError, ValueError):
                        output_failed.set()
                        try: os.killpg(worker.pid,signal.SIGTERM)
                        except ProcessLookupError: pass
                readers = [threading.Thread(target=copy_output,args=(worker.stdout,out),daemon=True),
                           threading.Thread(target=copy_output,args=(worker.stderr,err),daemon=True)]
                for reader in readers: reader.start()
                state.update(status='running',process_group=worker.pid,message='Preparing sources and requesting bounded editorial decisions')
                write_state(runtime,state)
                deadline=time.monotonic()+timeout
                last_progress = None
                while worker.poll() is None:
                    check_limits()
                    rss = tree.measure()
                    if rss > 4*1024**3:
                        raise ValueError('Inbox run exceeded its 4 GiB process-group memory limit')
                    if (runtime/'cancel').exists():
                        state.update(status='stopped',message='Stopped by user. Inspect partial changes before retrying.');return 1
                    checkpoint = runtime / 'progress.json'
                    if checkpoint.exists():
                        if checkpoint.is_symlink() or checkpoint.stat().st_size > 4096:
                            raise ValueError('Unsafe intake progress checkpoint')
                        current = json.loads(checkpoint.read_text())
                        if current.get('phase') not in ('snapshot', 'editorial', 'decision', 'filing', 'committed') or not isinstance(current.get('token'), str):
                            raise ValueError('Invalid intake progress checkpoint')
                        if current['token'] != last_progress:
                            last_progress = current['token']
                            deadline = time.monotonic() + timeout
                            state['phase'] = current['phase']
                    if time.monotonic()>deadline:
                        raise ValueError('Inbox step exceeded its progress time limit; inspect partial changes')
                    write_state(runtime,state)
                    time.sleep(1)
                tree.stop()
                for reader in readers: reader.join(timeout=2)
                if any(reader.is_alive() for reader in readers):raise ValueError('Runner output did not close; inspect the owned process group')
                if output_failed.is_set():
                    raise ValueError('Intake output exceeded its stream budget or could not be recorded')
                state['exit_code']=worker.returncode
                remaining = inventory(root, strict=False)
                state['remaining'] = remaining[:20]
                state['remaining_count'] = len({p.split('/')[1] for p in remaining})
                if worker.returncode:
                    state.update(status='failed',message=f'Intake exited with status {worker.returncode}; its checkpoint is retained. Open run details.')
                else:
                    result_file = runtime / 'result.json'
                    if result_file.is_symlink() or not result_file.is_file() or result_file.stat().st_size > MAX_PLAN:
                        raise ValueError('Intake exited without a bounded verified result')
                    result = json.loads(result_file.read_text())
                    if result.get('status') != 'verified' or result.get('run_id') != state['run_id'] or not isinstance(result.get('filed'), list):
                        raise ValueError('Intake result does not verify this run')
                    if result['filed'] and not result.get('commit'):
                        raise ValueError('Filed intake has no verified commit')
                    summary = {k: result.get(k) for k in ('status', 'batch_id', 'commit')}
                    summary.update({k + '_count': len(result.get(k, [])) for k in ('filed', 'deferred', 'warnings')})
                    state.update(status='finished', result=summary, message='Intake verified and committed.' if result['filed'] else 'Intake decisions verified; arrivals deferred.')
                return worker.returncode
        except Exception as exc:
            state.update(status='failed',message=str(exc));return 1
        finally:
            if tree:
                tree.stop()
            state['finished_at']=datetime.now(timezone.utc).isoformat()
            write_state(runtime,state)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',required=True,type=Path)
    parser.add_argument('--codex',default='codex')
    parser.add_argument('--run-id')
    parser.add_argument('--only', action='append', help='File only this arrival; repeatable')
    parser.add_argument('--workstation-lock-store', help='Existing Git lock store for shared host resources')
    parser.add_argument('--sandbox-mode', choices=['read-only', 'workspace-write', 'danger-full-access'], default='read-only',
                        help='Legacy permission arguments are accepted; editorial calls always use read-only')
    args=parser.parse_args()
    raise SystemExit(run(args.root,args.codex,args.run_id,workstation_lock_store=args.workstation_lock_store,only=set(args.only or ()) or None,sandbox_mode=args.sandbox_mode))


if __name__=='__main__':
    main()
