"""Bound the local index worker and all of its generated output."""
from contextlib import closing
import fcntl
import json
import os
from pathlib import Path
import re
import resource
import shutil
from .resources import has_capacity, minimum_free_bytes
import signal
import sqlite3
import stat
import subprocess
import sys
import time

GIB = 1024 ** 3


def usage(path):
    try:
        path.stat()
    except FileNotFoundError:
        return 0
    total = 0
    for item in path.rglob('*'):
        try:
            if item.is_symlink():
                continue
            info = item.stat()
        except FileNotFoundError:
            # SQLite may remove a journal between discovery and measurement.
            continue
        if stat.S_ISREG(info.st_mode):
            total += info.st_size
    return total


NOISE = re.compile(r'^(Skipping broken line|Got invalid hex string|Reader indexing: |\s|Traceback |File "|warnings\.warn)')


def failure_line(log):
    """The last meaningful error in a worker log: the CLI's `Reader:` line, else the last non-noise line."""
    lines = [line.rstrip() for line in log.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.startswith('Reader: '):
            return line.removeprefix('Reader: ')[:1000]
    for line in reversed(lines):
        if not NOISE.match(line):
            return line[:1000]
    return 'Index worker failed without an error message'


def run_index(root, semantic):
    state = root / '.reader'
    runtime = state / 'search-runtime'
    runtime.mkdir(parents=True, exist_ok=True)
    with (state / 'search-run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _run(root, state, runtime, semantic)


def saved_passages(state):
    """Passages a stopped run left published, read without writing."""
    try:
        with closing(sqlite3.connect(f'{(state / "search.v2.sqlite3").as_uri()}?mode=ro', uri=True, timeout=5)) as con:
            return con.execute('SELECT count(*) FROM passages').fetchone()[0]
    except sqlite3.Error:
        return 0


def _run(root, state, runtime, semantic):
    from .search import MIB, settings
    limits = settings(root)  # Invalid settings refuse before any worker starts.
    timeout = limits['worker_timeout_minutes'] * 60
    threads = limits['worker_threads']
    # The largest single file the worker may write: either database, or a VACUUM copy of one.
    file_limit = (max(limits['max_database_mib'], limits['max_cache_mib']) + 64) * MIB
    env = os.environ.copy()
    for key, leaf in {'TMPDIR': 'tmp', 'HF_HOME': 'hf', 'XDG_CACHE_HOME': 'cache',
                      'PYTHONPYCACHEPREFIX': 'pycache'}.items():
        folder = runtime / leaf
        folder.mkdir(exist_ok=True)
        env[key] = str(folder)
    # The worker stops cleanly between files a little before the hard deadline, keeping its work.
    margin = min(120, timeout // 10)
    env.update({'READER_INDEX_WORKER': '1', 'OMP_NUM_THREADS': str(threads), 'TOKENIZERS_PARALLELISM': 'false',
                'READER_INDEX_DEADLINE': str(time.time() + timeout - margin),
                'HF_HUB_DISABLE_TELEMETRY': '1', 'HF_HUB_DISABLE_XET': '1'})
    log = runtime / 'stderr.log'
    output = runtime / 'result.json'
    contract = {'worker': 'local Python index process group; no Docker',
        'lock': str(state / 'search-run.lock'), 'outputs': [str(state)],
        'data_limit_bytes': 4 * GIB, 'log_limit_bytes': 16 * 1024 ** 2,
        'build_limit_bytes': 20 * GIB, 'memory_limit_bytes': 4 * GIB,
        'minimum_free_bytes': minimum_free_bytes(root), 'timeout_seconds': timeout,
        'cpu_threads': threads, 'cpu_time_limit_seconds': timeout * threads + 600,
        'file_size_limit_bytes': file_limit, 'budgets': {k: limits[k] for k in limits if k != 'content_types'},
        'guard': f'one-second polling, fail closed; per-file RLIMIT_FSIZE {file_limit // MIB} MiB',
        'initial_data_bytes': usage(state), 'initial_build_bytes': usage(root / '.venv'),
        'initial_free_bytes': shutil.disk_usage(root).free}
    if contract['initial_data_bytes'] >= 4 * GIB or contract['initial_build_bytes'] >= 20 * GIB or not has_capacity(root):
        raise ValueError('Index resource preflight refused; inspect .reader usage and host free space')
    (runtime / 'launch.json').write_text(json.dumps(contract, indent=2))
    def apply_limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))
        resource.setrlimit(resource.RLIMIT_CPU, (timeout * threads + 600, timeout * threads + 600))
    cmd = [sys.executable, '-m', 'reader_mcp.cli', '--root', str(root), 'index']
    if not semantic:
        cmd.append('--no-semantic')
    started = time.monotonic()
    last_progress = started
    stopped_at_deadline = False
    with output.open('wb') as out, log.open('wb') as err:
        worker = subprocess.Popen(cmd, env=env, stdout=out, stderr=err,
                                  start_new_session=True, preexec_fn=apply_limits)
        contract['process_group'] = worker.pid
        (runtime / 'launch.json').write_text(json.dumps(contract, indent=2))
        try:
            while True:
                # A failed measurement raises and the finally block kills the whole group.
                data_bytes = usage(state)
                processes = subprocess.check_output(['ps', '-axo', 'pgid=,rss='], text=True, timeout=5)
                rss = sum(int(line.split()[1]) * 1024 for line in processes.splitlines()
                          if len(line.split()) == 2 and int(line.split()[0]) == worker.pid)
                if data_bytes >= 4 * GIB or log.stat().st_size + output.stat().st_size >= 16 * 1024 ** 2:
                    raise ValueError('Index stopped at data/log budget; inspect .reader/search-runtime')
                if rss >= 4 * GIB or not has_capacity(root):
                    raise ValueError('Index stopped at memory/free-space guard')
                if time.monotonic() - started > timeout:
                    stopped_at_deadline = True
                    break
                if worker.poll() is not None:
                    break
                if time.monotonic() - last_progress >= 30:
                    print(f"Reader indexing: {int(time.monotonic() - started)}s elapsed, "
                          f"{data_bytes // 1024 ** 2} MiB local data, {rss // 1024 ** 2} MiB worker memory",
                          file=sys.stderr, flush=True)
                    last_progress = time.monotonic()
                time.sleep(1)
        finally:
            try:
                os.killpg(worker.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            worker.wait()
            contract.update({'final_data_bytes': usage(state), 'final_build_bytes': usage(root / '.venv'),
                'final_free_bytes': shutil.disk_usage(root).free, 'exit_code': worker.returncode,
                'elapsed_seconds': round(time.monotonic() - started, 2)})
            (runtime / 'launch.json').write_text(json.dumps(contract, indent=2))
    if stopped_at_deadline:
        raise ValueError(f'Stopped at the time limit; {saved_passages(state):,} passages saved. Run again to continue. '
                         '(indexes/settings.json search.worker_timeout_minutes)')
    if worker.returncode:
        raise ValueError(failure_line(log.read_text(errors='replace'))
                         + f' (index worker exit {worker.returncode}; details in {runtime / "stderr.log"})')
    return json.loads(output.read_text())
