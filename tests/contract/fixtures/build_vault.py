"""Reference fixture generator for the contract suite: the Reader demo vault, pinned in time.

Usage: build_vault.py DIR

Builds the public-domain demo vault (src/reader_mcp/demo) into DIR as if today were Wednesday
2026-10-21 at 12:00 UTC, then its keyword/fuzzy search and link indexes (no embedding model,
no network). The contract suite pins the server under test to the same instant with
READER_TEST_CLOCK, so "this week", relative dates and golden shapes never depend on when or
where the suite runs.

This is the suite's only Python touchpoint and it is a fixture generator, not the system
under test: READER_FIXTURE_CMD replaces it (any command that takes DIR as its last argument
and writes the same vault), so a port can build the fixture with its own `demo` once that is
ported. It never touches a configured vault.
"""
from datetime import date, datetime, timezone
import os
import sys

os.environ['HF_HUB_OFFLINE'] = '1'  # never download an embedding model

from reader_mcp.demo import build as demo  # noqa: E402

TODAY = date(2026, 10, 21)
NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)

if len(sys.argv) != 2:
    raise SystemExit('usage: build_vault.py DIR')
root = demo.build(sys.argv[1], today=TODAY, now=NOW)
demo.index(root, False)
print(root)
