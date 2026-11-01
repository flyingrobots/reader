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
    code, vault = runpy.run_path(str(Path(__file__).resolve().parents[3] / 'scripts/reader_paths.py'))['paths']()
    python = code / '.venv/bin/python'
    if not python.is_file():
        sys.exit('Reader environment missing; use the existing code-checkout installation procedure.')
    env = dict(os.environ, PYTHONPATH=str(code / 'src'))
    raise SystemExit(subprocess.call([str(python), '-m', 'reader_mcp.cli', '--root', str(vault), 'inbox', args.action], env=env))


if __name__ == '__main__':
    main()
