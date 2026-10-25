"""Server helpers for the magazine homepage: standfirsts and weekly issue signals.

Selection itself runs in the browser (web_ui/magazine.mjs) over the work
inventory. The server adds what the browser cannot read cheaply: the opening
prose of a source, the newsletter picks for a week, and which candidates are
near-identical by search-index embeddings. Nothing is written."""
from datetime import date
import posixpath
import re
import sqlite3
import threading

import numpy as np

from .metadata import FrontmatterError, decode_frontmatter
from .related import DIVERSE

STANDFIRST_WORDS = 60
STANDFIRST_READ = 64 * 1024     # bytes read from a source to find its opening prose
STANDFIRST_CACHE = 2000         # cached standfirsts, keyed by path and source digest
MIN_PROSE_WORDS = 8             # shorter paragraphs are labels or datelines, not prose
NEWSLETTER_FOLDER = 'library/newsletters'
MAX_NEWSLETTERS = 200
MAX_NEWSLETTER_BYTES = 512 * 1024
MAX_CANDIDATES = 400            # works compared pairwise for near-identical text
TEXT_KINDS = ('.md', '.markdown', '.txt')

FENCE = re.compile(r'^\s{0,3}(`{3,}|~{3,})')
SKIP_LINE = re.compile(r'^\s{0,3}(#|>|\||<!--|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|[-*+]\s|\d+[.)]\s|!\[|<)')
LINK = re.compile(r'\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)')


def plain(text):
    """Inline Markdown to plain text: links, wikilinks, emphasis, code and tags."""
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)
    text = re.sub(r'\[\[([^\]|]+)\|([^\]]+)\]\]', r'\2', text)
    text = re.sub(r'\[\[([^\]]+)\]\]', r'\1', text)
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'\[([^\]]*)\]\[[^\]]*\]', r'\1', text)
    text = re.sub(r'<[^>]{1,200}>', '', text)
    text = re.sub(r'`([^`]*)`', r'\1', text)
    text = re.sub(r'(\*\*|__)(.+?)\1', r'\2', text)
    text = re.sub(r'(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])', r'\2', text)
    return re.sub(r'\s+', ' ', text).strip()


SENTENCE_END = re.compile(r'[.!?…]["”’)\]]*(?=\s|$)')


def sentences(text):
    """Prose, not a dateline: whole sentences, few ' · ' separators, at least eight words.

    A paragraph that ends by introducing a list keeps only its complete sentences."""
    if text.count(' · ') >= 2:
        return None
    ends = list(SENTENCE_END.finditer(text))
    if not ends:
        return None
    if text.rstrip().endswith(':'):
        text = text[:ends[-1].end()]
    return text if len(text.split()) >= MIN_PROSE_WORDS else None


def opening(body):
    """The first prose paragraph after the H1, skipping code, Mermaid, tables, quotes and lists."""
    fence, paragraph = None, []

    def prose():
        return sentences(plain(' '.join(paragraph)))

    for line in body.splitlines():
        marker = FENCE.match(line)
        if fence:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
                fence = None
            continue
        if marker or not line.strip() or SKIP_LINE.match(line):
            if paragraph and (found := prose()):
                return found
            paragraph = []
            if marker:
                fence = marker.group(1)
            continue
        paragraph.append(line.strip())
    return prose() if paragraph else None


def clip(text, limit=STANDFIRST_WORDS):
    words = text.split()
    if len(words) <= limit:
        return text
    return ' '.join(words[:limit]).rstrip(',;:—–-') + '…'


def standfirst_of(data):
    """A standfirst from source bytes: frontmatter `standfirst`, else the opening prose."""
    try:
        raw, body, _ = decode_frontmatter(data)
    except FrontmatterError:
        raw, body = None, data
    if isinstance(raw, dict) and isinstance(raw.get('standfirst'), str) and raw['standfirst'].strip():
        return clip(plain(raw['standfirst'])), 'frontmatter'
    text = body.decode('utf-8', errors='ignore')
    found = opening(text)
    return (clip(found), 'opening') if found else (None, None)


class Magazine:
    def __init__(self, library):
        self.library = library
        self.lock = threading.Lock()
        self.cache = {}

    def standfirst(self, path):
        file = self.library.path(path)
        if file.suffix.lower() not in TEXT_KINDS:
            return {'path': path, 'standfirst': None, 'source': None}
        if file.stat().st_size > 4 * 1024**2:
            raise ValueError('Standfirsts are read from text sources of at most 4 MiB')
        key = (path, self.library.digest(path))
        with self.lock:
            result = self.cache.get(key)
        if result is None:
            with file.open('rb') as stream:
                data = stream.read(STANDFIRST_READ)
            text, source = standfirst_of(data)
            result = {'path': path, 'standfirst': text, 'source': source}
            with self.lock:
                if len(self.cache) >= STANDFIRST_CACHE:
                    self.cache.clear()
                self.cache[key] = result
        if result['source'] == 'frontmatter':
            return result
        # An authored standfirst wins; then a local-model output current for this exact digest, marked with its
        # model (looked up every time: outputs arrive while the source, and so this cache key, stays the same).
        local = getattr(self.library, 'local_model', None)
        try:
            found = local.standfirst(path, key[1]) if local else None
        except (sqlite3.Error, OSError, ValueError):
            found = None  # An unreadable output cache never hides the opening paragraph.
        if found:
            return {'path': path, 'standfirst': found['standfirst'], 'source': 'local-model', 'model': found['model']}
        return result

    def newsletters(self, start, end, primaries):
        """Newsletters whose declared week overlaps [start, end], and the works they link."""
        folder = self.library.root / NEWSLETTER_FOLDER
        if not folder.is_dir() or folder.is_symlink():
            return [], []
        files = sorted(folder.glob('*.md'))[:MAX_NEWSLETTERS]
        letters, picks = [], set()
        for file in files:
            relative = NEWSLETTER_FOLDER + '/' + file.name
            try:
                checked = self.library.path(relative)
                if checked.stat().st_size > MAX_NEWSLETTER_BYTES:
                    continue
                data = checked.read_bytes()
                raw, body, _ = decode_frontmatter(data)
            except (ValueError, OSError, FrontmatterError):
                continue
            if not isinstance(raw, dict):
                continue
            first, last = str(raw.get('newsletter_week_start') or ''), str(raw.get('newsletter_week_end') or '')
            if not (re.fullmatch(r'\d{4}-\d{2}-\d{2}', first) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', last)):
                continue
            if last < start or first > end:
                continue
            letters.append({'path': relative, 'title': str(raw.get('title') or file.stem), 'week_start': first, 'week_end': last})
            for target in LINK.findall(body.decode('utf-8', errors='ignore')):
                target = target.split('#', 1)[0]
                if not target or re.match(r'^[a-z][a-z0-9+.-]*:', target, re.I) or target.startswith('/'):
                    continue
                candidate = posixpath.normpath(posixpath.join(NEWSLETTER_FOLDER, target))
                if candidate in primaries:
                    picks.add(candidate)
        letters.sort(key=lambda letter: letter['path'], reverse=True)
        return letters, sorted(picks)

    def issue(self, start, end):
        """Signals for an issue window: newsletter picks and near-identical candidate pairs."""
        for value in (start, end):
            if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                raise ValueError('Expected start and end dates as YYYY-MM-DD')
            date.fromisoformat(value)
        if start > end or (date.fromisoformat(end) - date.fromisoformat(start)).days > 62:
            raise ValueError('An issue window spans at most 62 days')
        works, _ = self.library.works()
        primaries = {w['primary'] for w in works}
        letters, picks = self.newsletters(start, end, primaries)
        window = sorted({w['primary'] for w in works if start <= (w.get('date') or '') <= end})[:MAX_CANDIDATES]
        vectors = self.library.related.vectors(primaries)
        present = [p for p in window if p in vectors]
        near = []
        if len(present) > 1:
            matrix = np.stack([vectors[p] for p in present])
            similarity = matrix @ matrix.T
            for i, j in zip(*np.nonzero(np.triu(similarity >= DIVERSE, 1))):
                near.append([present[i], present[j]])
        return {'start': start, 'end': end, 'newsletters': letters, 'picks': picks, 'near': near,
                'compared': len(present), 'candidates': len(window),
                'scope': 'Newsletter links whose declared week overlaps the window; pairs at or above the Read next diversity threshold.'}
