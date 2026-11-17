"""Supervise PDF excerpt extraction without changing or trusting the source file."""

import json
import os
from pathlib import Path
import selectors
import stat
import subprocess
import sys
import time

from . import process_table
from .pdf_worker import MAX_INPUT_BYTES, MAX_MEMORY_BYTES, MAX_METADATA_BYTES, MAX_PAGES

MAX_OUTPUT_BYTES = 128 * 1024
MAX_WALL_SECONDS = 5
MAX_FILES = 8
MAX_TOTAL_SECONDS = 20
REASONS = {
    'input_limit': 'PDF exceeds the 32 MiB extraction input limit.',
    'changed': 'PDF bytes changed since the intake snapshot; take a fresh snapshot.',
    'encrypted': 'Encrypted PDF requires an unlocked source supplied by its owner.',
    'no_text': 'No readable PDF text layer was found within the page limit; OCR or human review is required.',
    'malformed': 'Malformed PDF could not be extracted; human review is required.',
}


class ExtractionRefused(ValueError):
    """The supervised child did not produce an admitted excerpt."""


def resident_bytes(pid: int) -> int:
    """Measure the owned child directly; missing telemetry refuses extraction."""
    if sys.platform == 'darwin':
        task = process_table.pid_info(pid, process_table.PROC_PIDTASKINFO, process_table.TaskInfo)
        if task is None:
            raise ExtractionRefused('PDF worker memory could not be measured.')
        return task.resident_size
    if sys.platform.startswith('linux'):
        # Linux also enforces the worker's address-space limit before parsing.
        fields = Path(f'/proc/{pid}/statm').read_text().split()
        return int(fields[1]) * os.sysconf('SC_PAGE_SIZE')
    raise ExtractionRefused('PDF extraction requires Linux or macOS memory supervision.')


def capture(command: list[str], *, descriptor: int, timeout_seconds: float) -> bytes:
    """Bound one trusted parser child; it stays in its caller's process group."""
    deadline = time.monotonic() + timeout_seconds
    output = bytearray()
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, pass_fds=(descriptor,))
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            while selector.get_map() or child.poll() is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ExtractionRefused('PDF extraction exceeded its wall-time limit.')
                if child.poll() is None:
                    try:
                        rss = resident_bytes(child.pid)
                    except (OSError, ValueError, IndexError) as error:
                        if child.poll() is None:
                            raise ExtractionRefused('PDF worker memory could not be measured.') from error
                    else:
                        if rss > MAX_MEMORY_BYTES:
                            raise ExtractionRefused('PDF extraction exceeded its sampled memory limit.')
                for key, _ in selector.select(min(remaining, 0.02)):
                    part = os.read(key.fd, min(8192, MAX_OUTPUT_BYTES + 1 - len(output)))
                    if not part:
                        selector.unregister(key.fileobj)
                    output.extend(part)
                    if len(output) > MAX_OUTPUT_BYTES:
                        raise ExtractionRefused('PDF extraction exceeded its output limit.')
            if child.wait(timeout=2):
                raise ExtractionRefused('PDF extraction failed or exceeded its CPU/memory limits.')
    finally:
        try:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=2)
        finally:
            child.stdout.close()
    return bytes(output)


def admitted_result(data: bytes, budget: int) -> dict[str, object]:
    """Check the child protocol before exposing any data to editorial context."""
    result = json.loads(data)
    if not isinstance(result, dict):
        raise ExtractionRefused('Invalid PDF worker response.')
    if set(result) == {'error'} and isinstance(result['error'], str) and result['error'] in REASONS:
        raise ExtractionRefused(REASONS[result['error']])
    if set(result) != {'excerpt', 'title', 'author', 'pages'}:
        raise ExtractionRefused('Invalid PDF worker response fields.')
    if any(not isinstance(result[key], str) for key in ('excerpt', 'title', 'author')):
        raise ExtractionRefused('Invalid PDF worker text.')
    if (sum(len(result[key].encode()) for key in ('excerpt', 'title', 'author')) > budget
            or any(len(result[key].encode()) > MAX_METADATA_BYTES for key in ('title', 'author'))
            or type(result['pages']) is not int or not 0 <= result['pages'] <= MAX_PAGES):
        raise ExtractionRefused('PDF worker response exceeds its text or page limits.')
    return result


def reading(path: Path, row: dict[str, object], *, budget: int, timeout_seconds: float) -> dict[str, object]:
    """Return a labelled excerpt or an explicit refusal; never write the PDF."""
    record: dict[str, object] = {'path': row['path'], 'format': 'pdf-extracted-text', 'excerpt': '', 'complete': False}
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_INPUT_BYTES:
                raise ExtractionRefused('PDF is not a regular file within the 32 MiB extraction input limit.')
            command = [sys.executable, '-B', '-m', 'reader_mcp.pdf_worker', str(source.fileno()),
                       str(row['sha256']), str(budget)]
            result = admitted_result(capture(command, descriptor=source.fileno(),
                                            timeout_seconds=timeout_seconds), budget)
        record.update(excerpt=result['excerpt'], source_metadata={'title': result['title'], 'author': result['author']},
                      metadata_scope='Untrusted embedded PDF metadata, not verified authorship or filing authority.',
                      extraction_scope=f"Text from the first {result['pages']} pages, at most {MAX_PAGES}; images, layout and later pages are not established as read.")
    except (OSError, ValueError) as error:
        record['reason'] = str(error) if isinstance(error, ExtractionRefused) else 'PDF extraction could not read or validate the source.'
    return record
