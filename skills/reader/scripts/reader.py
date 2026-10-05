#!/usr/bin/env python3
"""Locate the installed Reader checkout without machine-specific paths."""

from pathlib import Path
import runpy
import subprocess
import sys


def main():
    code, root = runpy.run_path(str(Path(__file__).resolve().parents[3] / 'scripts/reader_paths.py'))['paths']()
    python = code / ".venv" / "bin" / "python"
    if not python.is_file():
        sys.exit("Reader environment missing: run uv sync --locked in the Reader checkout.")
    raise SystemExit(subprocess.call([
        str(python), "-m", "reader_mcp.cli", "--root", str(root), *sys.argv[1:]
    ]))


if __name__ == "__main__":
    main()
