#!/usr/bin/env python3
"""Locate the installed Reader checkout without machine-specific paths.

With a remote configuration (see remote.py), commands run against a Reader
vault on another machine over SSH instead.
"""

import importlib.util
import os
from pathlib import Path
import runpy
import subprocess
import sys


def load_remote():
    spec = importlib.util.spec_from_file_location('reader_remote', Path(__file__).resolve().with_name('remote.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def local():
    code, root = runpy.run_path(str(Path(__file__).resolve().parents[3] / 'scripts/reader_paths.py'))['paths']()
    python = code / ".venv" / "bin" / "python"
    if not python.is_file():
        sys.exit("Reader environment missing: run uv sync --locked in the Reader checkout.")
    return root, [str(python), "-m", "reader_mcp.cli", "--root", str(root)]


def main():
    args = sys.argv[1:]
    command = args[0] if args else None
    if command in ("remote-setup", "remote-gate", "remote-authorize"):
        remote = load_remote()
        try:
            if command == "remote-setup":
                raise SystemExit(remote.setup(args[1:]))
            if command == "remote-authorize":
                # The installed (unresolved) path keeps working if the checkout is reinstalled elsewhere.
                raise SystemExit(remote.authorize(args[1:], Path(os.path.abspath(__file__))))
            scope = args[2] if args[1:2] == ["--scope"] and len(args) == 3 else None
            if scope is None:
                sys.exit("Usage: reader.py remote-gate --scope SCOPE (run as an SSH forced command)")
            root, cli = local()
            raise SystemExit(remote.gate(scope, cli, root / ".reader"))
        except (ValueError, OSError, subprocess.CalledProcessError) as exc:
            sys.exit(f"Reader: {exc}")
    config = load_remote().load_config()
    if config:
        try:
            raise SystemExit(load_remote().client(args, config))
        except (ValueError, OSError) as exc:
            sys.exit(f"Reader: {exc}")
    _, cli = local()
    raise SystemExit(subprocess.call([*cli, *args]))


if __name__ == "__main__":
    main()
