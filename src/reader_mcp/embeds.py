"""Obsidian-style embeds (`![[target#fragment|alias]]`): parsing, fragment extraction and the embed tree.

The browser renders every embed live with markdown-it, so annotations inside an embed anchor
to the embedded file. This module only decides *what* each embed shows: the resolved file, the
code-point range of the fragment inside that file, and a status when nothing can be shown.
`tree()` resolves a document's embeds, and theirs, in one bounded pass for `/api/embeds`.

Conformance follows Obsidian where it is documented, and tests/fixtures/transclusion/corpus.json
is shared by the Python and JavaScript tests:

- `![[name]]` resolves like a wikilink (links.Resolver): a path relative to the source, a
  `library/...` path, or a unique basename; a name without a known extension is a note.
- `#Heading` is the section from that heading to the next heading of the same or a higher
  level; `#A#B` is heading B inside section A. Headings match by text (case and spacing
  ignored) or by slug. Headings inside code never match and never end a section.
- `#^id` is the block (paragraph, list item with its children, quote/callout, or the block
  before a line holding only `^id`) whose last line ends with `^id`.
- `|alias` is the caption; on images `|300` or `|300x200` is a size.
- Code (fenced, indented, inline) and a backslash-escaped `\\![[` never embed.
"""
from collections import OrderedDict
import re
import threading

from .links import ATX, FRONT, HTML_HEADING, LIST_ITEM, LinkError, UNDERLINE, blank_code, inline, setext, slug, title_of

MARKDOWN = ('.md', '.markdown')
IMAGES = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp')
AUDIO = ('.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm')
VIDEO = ('.mp4', '.mov', '.mkv', '.ogv')
KNOWN = MARKDOWN + IMAGES + AUDIO + VIDEO + ('.pdf', '.txt', '.json', '.csv', '.html', '.canvas')

MAX_DEPTH = 4             # levels of embedding below the open document
MAX_TARGETS = 64          # top-level targets per request
MAX_ANCESTORS = MAX_DEPTH
MAX_NODES = 256           # nodes per response, nested ones included
MAX_EMBED_CHARS = 512_000  # a larger Markdown file is shown as a link, not embedded
MAX_RESPONSE_CHARS = 8_000_000  # document text per response; the rest is deferred
MAX_RAW = 2000

EMBED = re.compile(r'!\[\[([^\[\]\n]+)\]\]')
COMMENT = re.compile(r'<!--[\s\S]*?-->')
SIZE = re.compile(r'^\s*(\d{1,5})(?:\s*x\s*(\d{1,5}))?\s*$')
BLOCK_ID = re.compile(r'^[A-Za-z0-9-]{1,64}$')


def kind_of(path):
    """'markdown', 'image', 'pdf', 'audio', 'video' or 'other', from the target's extension.

    A name whose extension is not a known file type is a note (Obsidian: `![[v1.2 notes]]`)."""
    name = path.rpartition('/')[2].lower()
    ext = '.' + name.rpartition('.')[2] if '.' in name else ''
    if ext not in KNOWN or ext in MARKDOWN:
        return 'markdown'
    if ext in IMAGES:
        return 'image'
    if ext == '.pdf':
        return 'pdf'
    if ext in AUDIO:
        return 'audio'
    if ext in VIDEO:
        return 'video'
    return 'other'


def parse(raw):
    """The parts of an embed's inner text: target path, fragment, alias, width and height.

    The first `|` separates the target from the alias (`\\|` is a table-escaped bar). On an
    image, an alias of digits (`300`, `300x200`) is a size."""
    raw = raw[:MAX_RAW]
    head, bar, alias = raw.replace('\\|', '|').partition('|')
    target, _, fragment = head.partition('#')
    target, fragment, alias = target.strip(), fragment.strip(), alias.strip()
    kind = kind_of(target) if target else 'markdown'
    width = height = None
    if kind == 'image' and bar:
        size = SIZE.match(alias)
        if size:
            width, height, alias = int(size[1]), int(size[2]) if size[2] else None, ''
    page = None
    if kind == 'pdf':
        match = re.fullmatch(r'page=(\d{1,5})', fragment)
        page = int(match[1]) if match else None
    return {'raw': raw, 'target': target, 'fragment': fragment, 'alias': alias, 'kind': kind,
            'width': width, 'height': height, 'page': page}


def scan(text, start=0, end=None):
    """Inner texts of the embeds in text[start:end], in order: never in code or after a backslash."""
    blanked = COMMENT.sub(lambda m: re.sub(r'[^\n]', ' ', m[0]), blank_code(text))
    end = len(text) if end is None else end
    found = []
    for match in EMBED.finditer(blanked, start, end):
        slashes = len(blanked[:match.start()]) - len(blanked[:match.start()].rstrip('\\'))
        if slashes % 2 == 0:
            found.append(match[1])
    return found


# Fragments -----------------------------------------------------------------

def outline(text):
    """(start, level, text, slug) of every heading outside code, in order; offsets are code points."""
    blanked = blank_code(text)
    found = [(m.start(), len(m[1]), m[2] or '') for m in ATX.finditer(blanked)]
    for offset, title in setext(blanked):
        underline = next((u for u in re.finditer(r'^.*$', blanked[offset:], re.M) if UNDERLINE.match(u[0])), None)
        found.append((offset, 1 if underline and '=' in underline[0] else 2, title))
    found += [(m.start(), int(m[1]), m[2]) for m in HTML_HEADING.finditer(blanked)]
    found.sort()
    return [(offset, level, inline(title), slug(title)) for offset, level, title in found]


def _same(wanted, heading):
    text = ' '.join(heading[2].split()).casefold()
    return ' '.join(wanted.split()).casefold() == text or slug(wanted) == heading[3]


def _trim(text, start, end):
    while end > start and text[end - 1] in ' \t\r\n':
        end -= 1
    return start, end


def heading_range(text, fragment):
    """(start, end) of the section a heading fragment names (`A` or `A#B#C`), or None."""
    parts = [p for p in fragment.split('#') if p.strip()]
    if not parts:
        return None
    marks = outline(text)
    low, high, level = 0, len(marks), 0
    hit = None
    for part in parts:
        hit = next((i for i in range(low, high) if marks[i][1] > level and _same(part, marks[i])), None)
        if hit is None:
            return None
        level = marks[hit][1]
        low = hit + 1
        high = next((i for i in range(low, len(marks)) if marks[i][1] <= level), len(marks))
    end = marks[high][0] if high < len(marks) else len(text)
    return _trim(text, marks[hit][0], end)


def _lines(text):
    """(start, end) of every line, end excluding the newline."""
    spans, position = [], 0
    for line in text.split('\n'):
        spans.append((position, position + len(line)))
        position += len(line) + 1
    return spans


def block_range(text, block):
    """(start, end) of the block whose last line ends with ` ^block`, or None."""
    if not BLOCK_ID.match(block):
        return None
    blanked = blank_code(text)
    marker = re.compile(r'(?:^|[ \t])\^' + re.escape(block) + r'[ \t]*$', re.M)
    match = marker.search(blanked)
    if not match:
        return None
    lines = _lines(blanked)
    row = next(i for i, (a, b) in enumerate(lines) if a <= match.start() <= b)
    blank = lambda i: not blanked[lines[i][0]:lines[i][1]].strip()
    indent = lambda i: len(blanked[lines[i][0]:lines[i][1]]) - len(blanked[lines[i][0]:lines[i][1]].lstrip())
    line = lambda i: blanked[lines[i][0]:lines[i][1]]
    if not line(row)[:match.start() - lines[row][0]].strip() and line(row).strip().startswith('^'):
        # A line holding only ^id names the block before it (a table, a quote, a list).
        last = row - 1
        while last >= 0 and blank(last):
            last -= 1
        if last < 0:
            return None
        first = last
        while first > 0 and not blank(first - 1):
            first -= 1
        return _trim(text, lines[first][0], lines[last][1])
    if line(row).lstrip().startswith('>'):
        first, last = row, row
        while first > 0 and line(first - 1).lstrip().startswith('>'):
            first -= 1
        return _trim(text, lines[first][0], lines[last][1])
    # A list item: from its marker line, with any deeper lines that follow (its children).
    item = row
    while item >= 0 and not blank(item) and not LIST_ITEM.match(line(item)):
        item -= 1
    if item >= 0 and not blank(item) and LIST_ITEM.match(line(item)):
        last, depth = row, indent(item)
        while last + 1 < len(lines) and not blank(last + 1) and indent(last + 1) > depth:
            last += 1
        return _trim(text, lines[item][0], lines[last][1])
    first = row
    while first > 0 and not blank(first - 1) and not ATX.match(line(first - 1)):
        first -= 1
    return _trim(text, lines[first][0], lines[row][1])


def body_start(text):
    front = FRONT.match(text)
    return front.end() if front else 0


def fragment_range(text, fragment):
    """(start, end) code points of what an embed of `fragment` shows, or None if it names nothing.

    No fragment shows the whole file after its frontmatter."""
    if not fragment:
        return _trim(text, body_start(text), len(text))
    if fragment.startswith('^'):
        return block_range(text, fragment[1:])
    return heading_range(text, fragment)


# The tree ------------------------------------------------------------------

class Texts:
    """A small LRU of decoded Markdown by (path, sha256): repeat embeds and reopened documents skip the read."""

    def __init__(self, size=64):
        self.size, self.items, self.lock = size, OrderedDict(), threading.Lock()

    def get(self, key, load):
        with self.lock:
            if key in self.items:
                self.items.move_to_end(key)
                return self.items[key]
        value = load()
        with self.lock:
            self.items[key] = value
            while len(self.items) > self.size:
                self.items.popitem(last=False)
        return value


def tree(library, source, targets, ancestors=(), depth=0, texts=None):
    """The embed tree for `targets` (inner texts, in order) written in `source`.

    `ancestors` are the `path#fragment` keys already open above `source` (the open document
    first), `depth` is the level of `source` itself. Each node carries a status:
    ok, missing, ambiguous, cycle, depth, too-large, unsupported, no-fragment, deferred or error.
    Markdown nodes reference `documents[path]` with a code-point range [start, end)."""
    if not isinstance(targets, list) or len(targets) > MAX_TARGETS or any(not isinstance(t, str) for t in targets):
        raise ValueError(f'Expected at most {MAX_TARGETS} embed targets')
    if not isinstance(ancestors, (list, tuple)) or len(ancestors) > MAX_ANCESTORS + 1:
        raise ValueError('Expected a short ancestor chain')
    if not isinstance(depth, int) or not 0 <= depth <= MAX_DEPTH:
        raise ValueError(f'Expected an embed depth of 0-{MAX_DEPTH}')
    library.link_source(source)  # A document, or a draft's folder (`library/notebook/`).
    texts = texts or Texts()
    documents, budget = {}, {'nodes': MAX_NODES, 'chars': MAX_RESPONSE_CHARS}
    resolver = []

    def shared():
        if not resolver:
            resolver.append(library.resolver())
        return resolver[0]

    def resolve(src, target):
        return library.resolve(src, target, shared)['path']

    def load(path):
        file = library.path(path)
        digest = library.digest(path)
        if file.stat().st_size > MAX_EMBED_CHARS * 4:
            return {'sha256': digest, 'text': None, 'bytes': file.stat().st_size}
        def read():
            data = file.read_bytes()
            text = data.decode('utf-8', 'replace')
            return {'sha256': digest, 'text': text if len(text) <= MAX_EMBED_CHARS else None, 'bytes': len(data),
                    'title': title_of(data, path)}
        return texts.get((path, digest), read)

    def node(src, raw, chain, level):
        part = parse(raw)
        item = {k: part[k] for k in ('raw', 'target', 'fragment', 'alias', 'kind', 'width', 'height', 'page')}
        item['children'] = []
        if budget['nodes'] <= 0:
            return item | {'status': 'deferred'}
        budget['nodes'] -= 1
        if not part['target'] and (not part['fragment'] or src.endswith('/')):  # A draft folder has no headings.
            return item | {'status': 'missing'}
        try:
            path = resolve(src, part['target']) if part['target'] else src  # ![[#Heading]]: this document
        except LinkError as exc:
            return item | {'status': 'ambiguous' if exc.reason == 'ambiguous' else 'missing'}
        except (ValueError, OSError):
            return item | {'status': 'missing'}
        item['path'] = path
        if part['kind'] != 'markdown':
            return item | {'status': 'ok' if part['kind'] in ('image', 'pdf') else 'unsupported'}
        if not path.endswith(MARKDOWN):
            return item | {'status': 'unsupported'}
        key = path + '#' + part['fragment']
        if key in chain:
            return item | {'status': 'cycle'}
        if level > MAX_DEPTH:
            return item | {'status': 'depth'}
        try:
            doc = load(path)
        except (ValueError, OSError):
            return item | {'status': 'error'}
        item['title'] = doc.get('title') or path.rpartition('/')[2]
        if doc['text'] is None:
            return item | {'status': 'too-large', 'bytes': doc['bytes']}
        span = fragment_range(doc['text'], part['fragment'])
        if span is None:
            return item | {'status': 'no-fragment'}
        if path not in documents:
            if budget['chars'] < len(doc['text']):
                budget['nodes'] += 1
                return item | {'status': 'deferred'}
            budget['chars'] -= len(doc['text'])
            documents[path] = {'text': doc['text'], 'sha256': doc['sha256'], 'title': item['title']}
        item |= {'status': 'ok', 'start': span[0], 'end': span[1]}
        inner = (*chain, key)
        for child in scan(doc['text'], *span)[:MAX_TARGETS]:
            item['children'].append(node(path, child, inner, level + 1))
        return item

    chain = tuple(a for a in ancestors if isinstance(a, str))
    nodes = [node(source, raw, chain, depth + 1) for raw in targets]
    return {'documents': documents, 'nodes': nodes,
            'limits': {'depth': MAX_DEPTH, 'nodes': MAX_NODES, 'embed_chars': MAX_EMBED_CHARS, 'response_chars': MAX_RESPONSE_CHARS}}
