"""The wall clock behind Reader's calendar answers: "today", read and comment timestamps.

Tests pin it with READER_TEST_CLOCK, an ISO-8601 instant with a UTC offset (such as 2026-10-21T12:00:00Z):
the clock then starts at that instant and advances in real time, so durations and ordering behave as usual
while the date never depends on when the test runs. Nothing outside tests sets it. Timeouts, deadlines and
durations keep using time.monotonic() or the real clock; only calendar time goes through now().
"""
from datetime import datetime, timedelta, timezone
import os
import threading
import time

ENV = 'READER_TEST_CLOCK'
_lock = threading.Lock()
_anchor = None  # (env value, pinned start, monotonic reading when first used)


def now():
    """The current instant, timezone-aware in UTC (or the pinned test clock's instant)."""
    pinned = os.environ.get(ENV)
    if not pinned:
        return datetime.now(timezone.utc)
    global _anchor
    with _lock:
        if _anchor is None or _anchor[0] != pinned:
            start = datetime.fromisoformat(pinned.replace('Z', '+00:00'))
            if start.tzinfo is None:
                raise ValueError(f'{ENV} needs a UTC offset, such as 2026-10-21T12:00:00Z')
            _anchor = (pinned, start.astimezone(timezone.utc), time.monotonic())
        _, start, began = _anchor
    return start + timedelta(seconds=time.monotonic() - began)
