#!/usr/bin/env python3
"""Run the browser suites (tests/web_*.cjs) in parallel and report the result.

    python3 scripts/run_browser_suites.py                 # every suite, half the cores at a time
    python3 scripts/run_browser_suites.py -j 8            # eight at a time
    python3 scripts/run_browser_suites.py dock threads    # suites whose names contain "dock" or "threads"

Each suite starts its own fixture (a synthetic vault on a free port) and its own browser, so suites are independent and
can run side by side. Suites start slowest first, from the durations of earlier runs, so a long suite does not
straggle at the end. A suite runs in its own process group and is killed with its fixture and browser when it
overruns. Logs, durations and the summary go to .reader/web-dev/suites/; the exit status is 1 if any suite failed.

Run the web build first when web/ changed (`npm run build` in web/). Set READER_PYTHON to the interpreter whose
reader_mcp is this checkout (default .venv/bin/python) and READER_CHROME to override the browser.
"""
import argparse
import json
import os
import signal
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.reader/web-dev/suites'
TIMES = OUT / 'durations.json'


def suites(patterns):
    # Shared helpers (web_wait.cjs, web_clock.cjs) export functions and never launch a browser.
    found = sorted(path.stem for path in (ROOT / 'tests').glob('web_*.cjs')
                   if 'chromium' in (text := path.read_text()) or 'module.exports' not in text)
    return [name for name in found if not patterns or any(pattern in name for pattern in patterns)]


def run(name, timeout, env):
    log = OUT / f'{name}.log'
    started = time.monotonic()
    with log.open('wb') as stream:
        process = subprocess.Popen(['node', f'tests/{name}.cjs'], cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            code = None
        finally:
            # The suite's fixture and browser are in its process group: none of them outlives it.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
    return name, code, time.monotonic() - started, log


def tail(log, lines=12):
    text = log.read_text(errors='replace').splitlines()
    return '\n'.join('    ' + line[:200] for line in text[-lines:])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    parser.add_argument('patterns', nargs='*', help='Run only suites whose names contain one of these')
    parser.add_argument('-j', '--jobs', type=int, default=max(1, (os.cpu_count() or 2) // 2), help='Suites at a time (default: half the cores)')
    parser.add_argument('--timeout', type=float, default=600, help='Seconds before a suite is killed (default 600)')
    args = parser.parse_args(argv)
    names = suites(args.patterns)
    if not names:
        sys.exit('No browser suites match ' + ' '.join(args.patterns))
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        known = json.loads(TIMES.read_text())
    except (OSError, ValueError):
        known = {}
    # Slowest first; a suite never timed goes early too, since it might be slow.
    names.sort(key=lambda name: -known.get(name, 60))
    env = os.environ | {'READER_PYTHON': os.environ.get('READER_PYTHON', str(ROOT / '.venv/bin/python'))}
    print(f'{len(names)} suites, {args.jobs} at a time', flush=True)
    started, failed, durations = time.monotonic(), [], {}
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for future in as_completed([pool.submit(run, name, args.timeout, env) for name in names]):
            name, code, seconds, log = future.result()
            durations[name] = round(seconds, 1)
            verdict = 'ok' if code == 0 else 'TIMEOUT' if code is None else f'FAIL ({code})'
            print(f'{verdict:>9} {seconds:6.1f}s  {name}', flush=True)
            if code != 0:
                failed.append((name, verdict, log))
    TIMES.write_text(json.dumps(known | durations, indent=1, sort_keys=True) + '\n')
    total = time.monotonic() - started
    print(f'\n{len(names) - len(failed)}/{len(names)} passed in {total:.0f}s (suite time {sum(durations.values()):.0f}s)')
    for name, verdict, log in failed:
        print(f'\n{verdict} {name}  ({log.relative_to(ROOT)})\n{tail(log)}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
