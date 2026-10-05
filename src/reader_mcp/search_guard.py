"""Bound the local index worker and all of its generated output."""
import fcntl
import json
import os
from pathlib import Path
import resource
import shutil
from .resources import has_capacity, minimum_free_bytes
import signal
import subprocess
import sys
import time

GIB = 1024 ** 3


def usage(path):
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file() and not p.is_symlink()) if path.exists() else 0


def run_index(root, semantic):
    state = root / '.reader'
    runtime = state / 'search-runtime'
    runtime.mkdir(parents=True, exist_ok=True)
    with (state / 'search-run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _run(root, state, runtime, semantic)


def _run(root, state, runtime, semantic):
    env = os.environ.copy()
    for key, leaf in {'TMPDIR': 'tmp', 'HF_HOME': 'hf', 'XDG_CACHE_HOME': 'cache',
                      'PYTHONPYCACHEPREFIX': 'pycache'}.items():
        folder = runtime / leaf
        folder.mkdir(exist_ok=True)
        env[key] = str(folder)
    env.update({'READER_INDEX_WORKER': '1', 'OMP_NUM_THREADS': '2', 'TOKENIZERS_PARALLELISM': 'false',
                'HF_HUB_DISABLE_TELEMETRY': '1', 'HF_HUB_DISABLE_XET': '1'})
    log = runtime / 'stderr.log'
    output = runtime / 'result.json'
    contract = {'worker': 'local Python index process group; no Docker',
        'lock': str(state / 'search-run.lock'), 'outputs': [str(state)],
        'data_limit_bytes': 4 * GIB, 'log_limit_bytes': 16 * 1024 ** 2,
        'build_limit_bytes': 20 * GIB, 'memory_limit_bytes': 4 * GIB,
        'minimum_free_bytes': minimum_free_bytes(root), 'timeout_seconds': 1800,
        'cpu_threads': 2, 'cpu_time_limit_seconds': 3600, 'guard': 'one-second polling, fail closed; per-file RLIMIT_FSIZE 512 MiB',
        'initial_data_bytes': usage(state), 'initial_build_bytes': usage(root / '.venv'),
        'initial_free_bytes': shutil.disk_usage(root).free}
    if contract['initial_data_bytes'] >= 4 * GIB or contract['initial_build_bytes'] >= 20 * GIB or not has_capacity(root):
        raise ValueError('Index resource preflight refused; inspect .reader usage and host free space')
    (runtime / 'launch.json').write_text(json.dumps(contract, indent=2))
    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (512 * 1024 ** 2, 512 * 1024 ** 2))
        resource.setrlimit(resource.RLIMIT_CPU, (3600, 3600))
    cmd = [sys.executable, '-m', 'reader_mcp.cli', '--root', str(root), 'index']
    if not semantic:
        cmd.append('--no-semantic')
    started = time.monotonic()
    last_progress = started
    with output.open('wb') as out, log.open('wb') as err:
        worker = subprocess.Popen(cmd, env=env, stdout=out, stderr=err,
                                  start_new_session=True, preexec_fn=limits)
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
                if time.monotonic() - started > 1800:
                    raise ValueError('Index stopped after 30-minute timeout')
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
    if worker.returncode:
        raise ValueError(f'Index worker failed (exit {worker.returncode}); see {runtime / "launch.json"}: '
                         + log.read_text(errors='replace')[-4000:])
    return json.loads(output.read_text())
