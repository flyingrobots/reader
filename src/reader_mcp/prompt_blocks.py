"""`reader:prompt` v1 blocks: an article's repair prompt that can become a coding job (RW-44).

An author writes two HTML comments around one ordinary `text` fence:

    <!-- reader:prompt {"v":1,"id":"bound-parser-depth","title":"…","repo":"owner/name","issue":277} -->

    ```text
    The self-contained task…
    ```

    <!-- /reader:prompt -->

Plain Markdown readers keep a copyable code block; the comments carry the metadata. The structure is
read from Markdown tokens, never from rendered HTML: this module tokenizes with markdown-it-py using the
block rules of the browser's markdown-it (the `default` preset with HTML, plus Reader's display-math
rule), and `web_ui/prompt-blocks.mjs` applies the same rules to the browser's tokens. A wrapper is:

- a top-level HTML block at column 0 whose single line is `<!-- reader:prompt {JSON} -->`,
- then exactly one top-level fence opened at column 0 with the info string `text`,
- then a top-level `<!-- /reader:prompt -->` line, with only blank lines between the three.

Anything else stays ordinary Markdown: malformed or oversized metadata, unknown versions or fields,
unsafe identifiers, a missing close marker, a wrapper inside another (an unclosed opener counts as
open until its close), duplicate IDs, or markers inside code, lists, quotes and other HTML. Metadata is
a flat JSON object read by a strict parser: strings, integers and null only, no duplicate keys.
Rejections are reported with a reason; the source is never changed."""
import hashlib
import json
import re

from markdown_it import MarkdownIt

VERSION = 1
MAX_METADATA = 2048          # UTF-8 bytes of the JSON text
MAX_PROMPT = 32 * 1024       # UTF-8 bytes of the fence content
MAX_TITLE = 160              # code points
MAX_ISSUE = 2**31 - 1
FIELDS = ('v', 'id', 'title', 'repo', 'issue')
OPEN = '<!-- reader:prompt'
CLOSE = '<!-- /reader:prompt'
ID = re.compile(r'[a-z0-9-]{1,64}')
OWNER = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?')
REPO_NAME = re.compile(r'[A-Za-z0-9._-]{1,100}')
CONTROL = re.compile(r'[\x00-\x1f\x7f-\x9f]')
SURROGATE = re.compile(r'[\ud800-\udfff]')
# Blank characters, spelled out so Python and JavaScript agree on what an empty title or prompt is.
BLANK = re.compile('[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*')
# One flat JSON token at a time: a string, an integer (not followed by a fraction or exponent), null or punctuation.
TOKEN = re.compile(r'[ \t\n\r]*(?:("(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")'
                   r'|(-?(?:0|[1-9][0-9]{0,15}))(?![0-9.eE])|(null)|([{}:,]))')
TRAILING = re.compile(r'[ \t\n\r]*')


def repository_name(value):
    """True for a GitHub `owner/repository` name Reader can register."""
    if not isinstance(value, str) or value.count('/') != 1:
        return False
    owner, name = value.split('/')
    return bool(OWNER.fullmatch(owner) and REPO_NAME.fullmatch(name) and name not in ('.', '..')
                and not name.lower().endswith('.git'))


def flat_json(text):
    """A flat JSON object of strings, integers and nulls, or None. Duplicate keys, nesting, booleans,
    fractions and exponents are refused (the browser parser in prompt-blocks.mjs agrees)."""
    pos, tokens = 0, []
    while pos < len(text):
        match = TOKEN.match(text, pos)
        if not match:
            if TRAILING.fullmatch(text, pos):
                break
            return None
        pos = match.end()
        string, number, null, punct = match.groups()
        tokens.append(('s', json.loads(string)) if string is not None else ('n', int(number)) if number is not None
                      else ('z', None) if null else ('p', punct))
        if len(tokens) > 64:
            return None
    if len(tokens) < 2 or tokens[0] != ('p', '{') or tokens[-1] != ('p', '}'):
        return None
    body, result = tokens[1:-1], {}
    if not body:
        return result
    for index in range(0, len(body), 4):
        pair = body[index:index + 4]
        if len(pair) < 3 or pair[0][0] != 's' or pair[1] != ('p', ':') or pair[2][0] == 'p':
            return None
        if len(pair) == 4 and (pair[3] != ('p', ',') or index + 4 >= len(body)):
            return None
        if pair[0][1] in result:
            return None
        result[pair[0][1]] = pair[2][1]
    return result


def metadata(text):
    """(fields, None) for valid v1 metadata, else (partial fields or None, reason)."""
    if len(text.encode('utf-8', 'surrogatepass')) > MAX_METADATA:
        return None, 'metadata-size'
    if any(seq in text for seq in ('<!--', '-->', '--!>')):
        return None, 'metadata-unsafe'
    data = flat_json(text)
    if data is None:
        return None, 'metadata-json'
    version = data.get('v')
    if type(version) is not int:
        return data, 'metadata-fields'
    if version != VERSION:
        return data, 'version'
    if set(data) != set(FIELDS):
        return data, 'metadata-fields'
    if not isinstance(data['id'], str) or not ID.fullmatch(data['id']):
        return data, 'id'
    title = data['title']
    if (not isinstance(title, str) or BLANK.fullmatch(title) or len(title) > MAX_TITLE or CONTROL.search(title)
            or SURROGATE.search(title)):
        return data, 'title'
    if not repository_name(data['repo']):
        return data, 'repo'
    issue = data['issue']
    if issue is not None and (type(issue) is not int or not 1 <= issue <= MAX_ISSUE):
        return data, 'issue'
    return data, None


def _escaped(text, pos):
    count = 0
    while pos - 1 - count >= 0 and text[pos - 1 - count] == '\\':
        count += 1
    return count % 2 == 1


def _math_block(state, start, end, silent):
    """Reader's display-math block rule (web_ui/math.mjs), so `$$ … $$` hides markers here as it does there."""
    begin, maximum = state.bMarks[start] + state.tShift[start], state.eMarks[start]
    if state.sCount[start] - state.blkIndent >= 4:
        return False
    line = state.src[begin:maximum]
    opener = '$$' if line.startswith('$$') else '\\[' if line.startswith('\\[') else None
    if not opener:
        return False
    closer = '$$' if opener == '$$' else '\\]'
    rest, content, last = line[2:], None, start
    trimmed = rest.rstrip()
    if len(trimmed) >= 2 and trimmed.endswith(closer) and not _escaped(trimmed, len(trimmed) - 2):
        content = trimmed[:-2]
    else:
        lines = [rest]
        for following in range(start + 1, end):
            text = state.src[state.bMarks[following] + state.tShift[following]:state.eMarks[following]]
            stripped = text.rstrip()
            if state.sCount[following] < state.blkIndent and stripped:
                return False
            if stripped.endswith(closer) and not _escaped(stripped, len(stripped) - 2):
                lines.append(stripped[:-2])
                content, last = '\n'.join(lines), following
                break
            lines.append(text)
    if content is None or not content.strip():
        return False
    if silent:
        return True
    state.line = last + 1
    token = state.push('math_block', 'math', 0)
    token.block, token.content, token.markup, token.map = True, content.strip(), opener, [start, state.line]
    return True


def markdown():
    md = MarkdownIt('js-default', {'html': True})
    md.block.ruler.before('fence', 'math_block', _math_block, {'alt': ['paragraph', 'reference', 'blockquote', 'list']})
    return md


_MD = markdown()


def _shape(token):
    """'open' or 'close' for an HTML block shaped like a marker (by its first line), else None."""
    if token.type != 'html_block':
        return None
    first = token.content.lstrip(' \t').split('\n', 1)[0]
    if first.startswith(CLOSE):
        return 'close'
    if first.startswith(OPEN) and (len(first) == len(OPEN) or first[len(OPEN)] in ' \t'):
        return 'open'
    return None


def _single_line(token):
    text = token.content[:-1] if token.content.endswith('\n') else token.content
    return None if '\n' in text else text


def body_of(text):
    """The Markdown body after YAML front matter, as the browser renders it (logic.mjs `bodyOf`)."""
    match = re.match(r'\ufeff?---\r?\n.*?\r?\n---(?:\r?\n|$)', text, re.S)
    return text[match.end():] if match else text


def parse(body):
    """{'blocks': [...], 'rejected': [...]} for a Markdown body (front matter already removed).

    Each block: id, title, repo, issue, prompt, prompt_sha256, line (0-based line of its open marker in
    the body) and end_line. Each rejection: line and reason (and id when one was readable)."""
    text = body.replace('\r\n', '\n').replace('\r', '\n').replace('\x00', '\ufffd')
    lines = text.split('\n')
    tokens = _MD.parse(text)
    top = [t for t in tokens if t.level == 0 and t.block and t.nesting in (0, 1)]
    candidates, rejected, depth = [], [], 0
    for index, token in enumerate(top):
        shape = _shape(token)
        if shape == 'close':
            depth = max(0, depth - 1)
            continue
        if shape != 'open':
            continue
        line = token.map[0]
        nested, depth = depth > 0, depth + 1
        fence, close = (top[index + 1:index + 3] + [None, None])[:2]
        if nested:
            rejected.append({'line': line, 'reason': 'nested'})
            continue
        if fence is None or fence.type != 'fence' or close is None or _shape(close) != 'close':
            rejected.append({'line': line, 'reason': 'structure'})
            continue
        candidates.append((line, token, fence, close))
    blocks, seen = [], {}
    for line, token, fence, close in candidates:
        opener, closer = _single_line(token), _single_line(close)
        reason, data = None, None
        if opener is None or not opener.startswith(OPEN + ' ') or not opener.rstrip(' \t').endswith(' -->'):
            reason = 'marker'
        elif closer is None or closer.rstrip(' \t') != CLOSE + ' -->':
            reason = 'marker'
        elif lines[fence.map[0]] != fence.markup + 'text' or fence.info != 'text':
            reason = 'fence'
        else:
            data, reason = metadata(opener.rstrip(' \t')[len(OPEN) + 1:-len(' -->')])
            if reason is None:
                size = len(fence.content.encode('utf-8', 'surrogatepass'))
                reason = 'prompt-size' if size > MAX_PROMPT else 'prompt-empty' if BLANK.fullmatch(fence.content) else None
        identity = data.get('id') if isinstance(data, dict) and isinstance(data.get('id'), str) and ID.fullmatch(data['id']) else None
        if identity:
            seen[identity] = seen.get(identity, 0) + 1
        row = {'line': line, 'end_line': close.map[1], 'id': identity, 'reason': reason, 'data': data, 'prompt': fence.content}
        blocks.append(row)
    valid = []
    for row in blocks:
        if row['id'] and seen[row['id']] > 1:
            row['reason'] = 'duplicate-id'
        if row['reason']:
            rejected.append({'line': row['line'], 'reason': row['reason'], **({'id': row['id']} if row['id'] else {})})
            continue
        data = row['data']
        valid.append({'id': data['id'], 'title': data['title'], 'repo': data['repo'], 'issue': data['issue'],
                      'prompt': row['prompt'], 'prompt_sha256': hashlib.sha256(row['prompt'].encode()).hexdigest(),
                      'line': row['line'], 'end_line': row['end_line']})
    rejected.sort(key=lambda row: row['line'])
    return {'blocks': valid, 'rejected': rejected}


def find(document_text, block_id):
    """The valid block `block_id` in a whole document (front matter included), or None."""
    return next((block for block in parse(body_of(document_text))['blocks'] if block['id'] == block_id), None)
