"""Extract a bounded PDF excerpt from snapshot-bound bytes in a disposable child."""

import hashlib
import io
import json
import os
import resource
import sys

MAX_INPUT_BYTES = 32 * 1024**2
MAX_PAGES = 16
MAX_MEMORY_BYTES = 512 * 1024**2
MAX_CPU_SECONDS = 2
MAX_METADATA_BYTES = 512


def utf8_prefix(text: str, limit: int) -> str:
    """Return at most limit UTF-8 bytes without splitting a code point."""
    # Bound encoding allocation even when a parser returns a much larger string.
    return text[:limit].encode('utf-8', 'replace')[:limit].decode('utf-8', 'ignore')


def lower_limit(kind: int, ceiling: int) -> None:
    """Keep any tighter inherited guard; never raise a soft or hard limit."""
    soft, hard = resource.getrlimit(kind)
    finite = [value for value in (soft, hard, ceiling) if value != resource.RLIM_INFINITY]
    value = min(finite)
    resource.setrlimit(kind, (value, value))


def extract(fd: int, expected_sha256: str, payload_bytes: int) -> dict[str, object]:
    """Read only the admitted descriptor; metadata is evidence, never authority."""
    lower_limit(resource.RLIMIT_CPU, MAX_CPU_SECONDS)
    lower_limit(resource.RLIMIT_CORE, 0)
    if sys.platform.startswith('linux'):
        lower_limit(resource.RLIMIT_AS, MAX_MEMORY_BYTES)
    # Import the parser only after installing the child's execution guards.
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    with os.fdopen(fd, 'rb') as source:
        data = source.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        return {'error': 'input_limit'}
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        return {'error': 'changed'}
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            return {'error': 'encrypted'}
        metadata = reader.metadata
        title = utf8_prefix(str(metadata.title or ''), min(MAX_METADATA_BYTES, payload_bytes)) if metadata else ''
        remaining = payload_bytes - len(title.encode())
        author = utf8_prefix(str(metadata.author or ''), min(MAX_METADATA_BYTES, remaining)) if metadata else ''
        remaining -= len(author.encode())
        pieces: list[str] = []
        pages = 0
        for number in range(MAX_PAGES):
            if remaining <= 0 or number >= len(reader.pages):
                break
            page = reader.pages[number]
            excerpt = utf8_prefix(page.extract_text() or '', remaining)
            pieces.append(excerpt)
            remaining -= len(excerpt.encode())
            pages += 1
            if remaining and excerpt:
                pieces.append('\n')
                remaining -= 1
        text = ''.join(pieces)
        if not text.strip():
            return {'error': 'no_text'}
        return {'excerpt': text, 'title': title, 'author': author, 'pages': pages}
    except (PyPdfError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError):
        return {'error': 'malformed'}


def main() -> None:
    fd, expected, budget = sys.argv[1:]
    limit = int(budget)
    if not 0 < limit <= 16000 or len(expected) != 64:
        raise ValueError('Invalid PDF extraction request')
    result = extract(int(fd), expected, limit)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
