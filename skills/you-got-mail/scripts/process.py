#!/usr/bin/env python3
"""Start or inspect the installed deterministic inbox workflow."""
import argparse
import os
from pathlib import Path
import runpy
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'status', 'stop'])
    args = parser.parse_args()
    # The installed service's live checkout when there is one, never whatever branch this skill's checkout is on.
    code, vault, python, env = runpy.run_path(str(Path(__file__).resolve().parents[3] / 'scripts/reader_paths.py'))['runtime']()
    if not python.is_file():
        sys.exit('Reader environment missing; use the existing code-checkout installation procedure.')
    raise SystemExit(subprocess.call([str(python), '-m', 'reader_mcp.cli', '--root', str(vault), 'inbox', args.action], env=env))


if __name__ == '__main__':
    main()
