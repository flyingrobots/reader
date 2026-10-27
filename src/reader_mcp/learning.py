"""Bounded source evidence shared by Reader's article learning tools.

An exact quote establishes a location, not the truth of a generated answer.
Model-supplied offsets are never an authority for a new anchor.
"""
from .annotations import Annotations, sha

MAX_SOURCE = 4 * 1024**2


def source(documents, path):
    if not isinstance(path, str) or not path.startswith('library/') or not path.lower().endswith(('.md', '.markdown', '.txt')):
        raise ValueError('Learning tools support library Markdown and plain text only')
    document = documents(path, True)
    text = document.get('text')
    if not isinstance(text, str) or len(text.encode('utf-8')) > MAX_SOURCE:
        raise ValueError('Learning tools require UTF-8 text of at most 4 MiB')
    if sha(text.encode('utf-8')) != document.get('sha256'):
        raise ValueError('Document changed while reading; reopen it')
    return document


def evidence(text, value):
    """Locate an untrusted quote using the same ambiguity rules as annotations."""
    if not isinstance(value, dict):
        raise ValueError('Evidence must contain a quote')
    quote = Annotations.body(value.get('quote'), 'Evidence quote', 600)
    prefix, suffix = value.get('prefix', ''), value.get('suffix', '')
    if not all(isinstance(s, str) and len(s) <= 64 for s in (prefix, suffix)):
        raise ValueError('Evidence context exceeds 64 characters')
    # The sentinel digest and offsets prevent the annotation fast path from accepting
    # unverified model coordinates, including an arbitrary occurrence of a repeated quote.
    anchor = dict(quote=quote, prefix=prefix, suffix=suffix, start=-1, end=-1, source_sha256='')
    location = Annotations.anchor({'anchor': anchor}, text.encode('utf-8'), text)
    if location['status'] not in ('exact', 'relocated'):
        raise ValueError('Evidence quote is ' + location['status'])
    start, end = location['start'], location['end']
    return dict(quote=quote, start=start, end=end, prefix=text[max(0, start - 64):start],
                suffix=text[end:end + 64], source_sha256=sha(text.encode('utf-8')))
