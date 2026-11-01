"""Source-bound repairs for local Markdown URLs. Only the explicit CLI/intake path reads Git or copies assets.

The web reader consumes these plain JSON records; opening a document never probes
the host filesystem or turns arbitrary file URLs into a file-serving endpoint.
"""
from collections import Counter
from functools import cached_property
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote, unquote, urlsplit

from markdown_it import MarkdownIt

MAX_DOCUMENT = 4 * 1024**2
MAX_RECORD = 512 * 1024
MAX_LINKS = 2048
MAX_ASSET = 32 * 1024**2
MAX_ASSETS = 64 * 1024**2
IMAGES = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp'}
DIRECTORY = 'link-repairs'
SHA = re.compile(r'^[0-9a-f]{7,40}$')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_file(root, relative, *, exists=True, limit=MAX_DOCUMENT):
    if not isinstance(relative, str) or not relative.startswith('library/') or any(
            p in ('', '.', '..') or p.startswith('.') for p in relative.split('/')) or '\\' in relative:
        raise ValueError('Expected a library-relative source path')
    path = root / relative
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise ValueError('Source or destination crosses a symlink')
    if exists and (not path.is_file() or path.stat().st_size > limit):
        raise ValueError('Source is missing, not regular, or exceeds its byte limit')
    return path


def references(text):
    """Use the real Markdown parser: reference links work and code examples remain literal."""
    parser = MarkdownIt('commonmark')
    validate = parser.validateLink
    parser.validateLink = lambda url: url.lower().startswith('file:') or validate(url)
    result = []
    def walk(tokens):
        for i, token in enumerate(tokens):
            if token.type == 'image':
                target, label, kind = token.attrGet('src'), token.content, 'image'
            elif token.type == 'link_open':
                target, kind = token.attrGet('href'), 'link'
                pieces = []
                for following in tokens[i + 1:]:
                    if following.type == 'link_close':
                        break
                    pieces.append(following.content)
                label = ''.join(pieces)
            else:
                target = None
            if target and target.lower().startswith('file:'):
                result.append({'source_url': target, 'label': label, 'kind': kind})
                if len(result) > MAX_LINKS:
                    raise ValueError('Document exceeds 2,048 local links')
            if token.children and token.type != 'image':
                walk(token.children)
    # Match the reader's bodyOf: header text is metadata, even with invalid YAML.
    text = re.sub(r'\A\ufeff?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)', '', text, count=1)
    walk(parser.parse(text))
    return list({(r['source_url'], r['label'], r['kind']): r for r in result}.values())


def github(remote):
    match = re.fullmatch(r'(?:git@github\.com:|https://github\.com/|ssh://git@github\.com/)([\w.-]+/[\w.-]+?)(?:\.git)?/?', remote)
    return 'https://github.com/' + match[1] if match else None


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True, timeout=10,
                            env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_OPTIONAL_LOCKS': '0'})
    if result.returncode:
        raise ValueError('Git could not resolve this reference')
    return result.stdout.strip()


def atomic(path, value, *, limit=MAX_RECORD):
    if path.is_symlink() or any(p.is_symlink() for p in path.parents):
        raise ValueError('Repair output crosses a symlink')
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    if len(data) > limit:
        raise ValueError('JSON record exceeds its byte limit')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class PortableLinks:
    def __init__(self, root, git_root=None, *, writer=None, image_roots=()):
        self.root = Path(root).resolve(strict=True)
        self._git_root = git_root
        self._image_roots = image_roots
        self.repo_cache = {}
        self.catalog = None
        self.git_cache = {}
        self.asset_bytes = 0
        self.assets = set()
        self.record_bytes = 0
        self.writer = writer

    @cached_property
    def git_root(self):
        return Path(self._git_root).expanduser().resolve() if self._git_root else Path.home() / 'git'

    @cached_property
    def image_roots(self):
        return (self.root, self.git_root, *(Path(p).expanduser().resolve() for p in self._image_roots))

    def command(self, root, *args):
        key = (str(root), *args)
        if key not in self.git_cache:
            try:
                self.git_cache[key] = git(root, *args)
            except (ValueError, OSError, subprocess.TimeoutExpired):
                self.git_cache[key] = None
        value = self.git_cache[key]
        if value is None:
            raise ValueError('Git target or revision is unavailable')
        return value

    def repo(self, path):
        key = str(path)
        if key not in self.repo_cache:
            try:
                root = Path(self.command(path, 'rev-parse', '--show-toplevel'))
                remote = self.command(root, 'remote', 'get-url', 'origin')
                url = github(remote)
                self.repo_cache[key] = (root, url) if url else None
            except ValueError:
                self.repo_cache[key] = None
        return self.repo_cache[key]

    def repositories(self):
        if self.catalog is None:
            found = []
            if self.git_root.is_dir():
                for path in sorted(self.git_root.iterdir())[:1000]:
                    if path.is_dir() and not path.is_symlink() and (path / '.git').exists():
                        info = self.repo(path)
                        if info:
                            found.append(info)
            self.catalog = found
        return self.catalog

    def context(self, source, text):
        provenance = {}
        for parent in source.parents:
            if parent == self.root or not parent.is_relative_to(self.root / 'library'):
                break
            receipt = parent / 'receipt.json'
            if receipt.is_file() and not receipt.is_symlink() and receipt.stat().st_size <= MAX_RECORD:
                try:
                    value = json.loads(receipt.read_text())
                    candidate = value.get('provenance', {}) if isinstance(value, dict) else {}
                    provenance = candidate if isinstance(candidate, dict) else {}
                except (ValueError, UnicodeError):
                    pass
                break
        evidence = str(provenance.get('source', '')) + '\n' + text[:16000]
        urls = {url for m in re.findall(r'https://github\.com/([\w.-]+/[\w.-]+)', evidence)
                if (url := github('https://github.com/' + m))}
        commit = provenance.get('commit')
        if not isinstance(commit, str) or not SHA.fullmatch(commit):
            # Only explicit candidate/head declarations, never the first arbitrary hash in prose.
            matches = re.findall(r'(?im)^.{0,60}(?:exact candidate head|candidate head|reviewed head|pinned commit).{0,30}?\b([a-f0-9]{40})\b', text[:16000])
            commit = matches[0] if len(set(matches)) == 1 else None
        return urls, commit

    def resolve(self, source, ref, context, apply):
        parsed = urlsplit(ref['source_url'])
        if parsed.scheme.lower() != 'file' or parsed.netloc not in ('', 'localhost') or parsed.query:
            raise ValueError('Unsupported local URL authority or query')
        raw = unquote(parsed.path)
        if not raw.startswith('/') or any(ord(c) < 32 for c in raw) or '\\' in raw:
            raise ValueError('Invalid absolute local path')
        target = Path(raw)
        if '..' in target.parts or ref['kind'] == 'image' and any(p.startswith('.') for p in target.parts[1:]):
            raise ValueError('Hidden or traversing local target is not imported')
        if target.is_relative_to(self.root / 'library') and target.is_file() and not target.is_symlink():
            relative = target.relative_to(self.root).as_posix()
            safe_file(self.root, relative, limit=MAX_ASSET)
            return {'target': quote(relative, safe='/') + ('#' + parsed.fragment if parsed.fragment else ''), 'method': 'vault'}
        if ref['kind'] == 'image':
            if not any(target.is_relative_to(base) for base in self.image_roots):
                raise ValueError('Local image is outside the configured image roots')
            if target.suffix.lower() not in IMAGES or not target.is_file() or any(p.is_symlink() for p in (target, *target.parents)):
                raise ValueError('Local image is missing or unsupported')
            before = target.stat()
            if before.st_size > MAX_ASSET:
                raise ValueError('Local image exceeds 32 MiB')
            data = target.read_bytes()
            after = target.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError('Local image changed during preparation')
            if len(data) > MAX_ASSET:
                raise ValueError('Local image grew beyond 32 MiB')
            sha = digest(data)
            name = 'assets/local-' + sha[:24] + target.suffix.lower()
            dest = source.parent / name
            safe_file(self.root, dest.relative_to(self.root).as_posix(), exists=False)
            if dest not in self.assets:
                if self.asset_bytes + len(data) > MAX_ASSETS:
                    raise ValueError('Batch exceeds 64 MiB of image assets')
                self.asset_bytes += len(data)
                self.assets.add(dest)
            if dest.exists():
                if not dest.is_file() or dest.stat().st_size != len(data) or digest(dest.read_bytes()) != sha:
                    raise ValueError('Asset destination conflicts')
            elif apply:
                if self.writer:
                    self.writer(dest.relative_to(self.root).as_posix(), data)
                else:
                    dest.parent.mkdir(exist_ok=True)
                    temporary = None
                    try:
                        with tempfile.NamedTemporaryFile(dir=dest.parent, prefix='.tmp-', delete=False) as stream:
                            temporary = Path(stream.name)
                            stream.write(data)
                            stream.flush()
                            os.fsync(stream.fileno())
                        os.link(temporary, dest)  # Publish complete bytes without replacing another writer's asset.
                    finally:
                        if temporary is not None:
                            temporary.unlink(missing_ok=True)
            return {'target': quote(dest.relative_to(self.root).as_posix(), safe='/') + ('#' + parsed.fragment if parsed.fragment else ''),
                    'method': 'copied-image', 'asset_sha256': sha}
        if not target.is_relative_to(self.git_root):
            raise ValueError('Target is outside the configured Git root and library')
        tail = target.relative_to(self.git_root)
        if not tail.parts:
            raise ValueError('Git root is not a repository')
        checkout = self.git_root / tail.parts[0]
        info = self.repo(checkout) if checkout.is_dir() else None
        urls, source_commit = context
        if info:
            candidates = [info]
            rel = target.relative_to(info[0]).as_posix()
        else:
            # Deleted worktrees require source-stated GitHub evidence, corroborated by a retained remote/tree.
            candidates = [r for r in self.repositories() if r[1] in urls]
            rel = Path(*tail.parts[1:]).as_posix() if len(tail.parts) > 1 else '.'
        if not candidates:
            raise ValueError('No live GitHub remote or source-supported retained repository')
        results = []
        for root, url in candidates:
            try:
                label = ref['label'].strip('` ')
                if rel in ('.', '.git') and (SHA.fullmatch(label) or rel == '.git' and SHA.fullmatch(parsed.fragment)):
                    revision = label if SHA.fullmatch(label) else parsed.fragment
                    commit = self.command(root, 'rev-parse', '--verify', revision + '^{commit}')
                    results.append({'target': url + '/commit/' + commit, 'method': 'git-commit', 'commit': commit})
                elif rel == '.':
                    results.append({'target': url + ('#' + parsed.fragment if parsed.fragment else ''), 'method': 'git-remote'})
                elif rel == '.git' or rel.startswith('.git/'):
                    continue
                else:
                    commit = self.command(root, 'rev-parse', '--verify', (source_commit or 'HEAD') + '^{commit}')
                    kind = self.command(root, 'cat-file', '-t', commit + ':' + rel)
                    if kind not in ('blob', 'tree'):
                        continue
                    fragment = parsed.fragment
                    target_url = url + ('/blob/' if kind == 'blob' else '/tree/') + commit + '/' + quote(rel, safe='/')
                    results.append({'target': target_url + ('#' + quote(fragment, safe='-') if fragment else ''),
                                    'method': 'git-tree', 'commit': commit, 'revision_basis': 'source' if source_commit else 'checkout-head',
                                    'object': self.command(root, 'rev-parse', commit + ':' + rel)})
            except ValueError:
                continue
        unique = {r['target']: r for r in results}
        if len(unique) != 1:
            raise ValueError('Target is absent at the selected revision or repository evidence is ambiguous')
        return next(iter(unique.values()))

    def record_path(self, path):
        return self.root / DIRECTORY / (digest(path.encode()) + '.json')

    def prepare(self, path, *, apply=False):
        source = safe_file(self.root, path)
        data = source.read_bytes()
        text = data.decode('utf-8')
        if 'file:' not in text.lower():
            return {'path': path, 'status': 'unchanged', 'targets': []}
        refs = references(text)
        if not refs:
            return {'path': path, 'status': 'unchanged', 'targets': []}
        context = self.context(source, text)
        targets = []
        for ref in refs:
            try:
                result = self.resolve(source, ref, context, apply)
                targets.append({**ref, **result, 'status': 'resolved'})
            except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
                targets.append({**ref, 'status': 'unresolved', 'reason': str(exc)})
        record = {'schema_version': 1, 'path': path, 'source_sha256': digest(data), 'targets': targets}
        size = len(json.dumps(record, ensure_ascii=False, indent=2).encode()) + 1
        self.record_bytes += size
        if size > MAX_RECORD or self.record_bytes > 64 * 1024**2:
            raise ValueError('Link records exceed 512 KiB per document or 64 MiB per batch')
        if source.read_bytes() != data:
            raise ValueError('Source changed during link repair')
        target = self.record_path(path)
        old = self.stored(path, digest(data))
        if apply and old != record:
            if self.writer:
                self.writer(target.relative_to(self.root).as_posix(), (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode())
            else:
                atomic(target, record)
        return {**record, 'status': 'prepared' if apply else 'planned',
                'record': target.relative_to(self.root).as_posix(),
                'counts': dict(Counter(t['status'] for t in targets))}

    def stored(self, path, sha):
        file = self.record_path(path)
        if file.is_symlink() or file.parent.is_symlink() or not file.is_file() or file.stat().st_size > MAX_RECORD:
            return None
        try:
            value = json.loads(file.read_text())
            if not isinstance(value, dict) or value.get('schema_version') != 1 or value.get('path') != path or value.get('source_sha256') != sha:
                return None
            if not isinstance(value.get('targets'), list) or len(value['targets']) > MAX_LINKS:
                return None
            for item in value['targets']:
                if not isinstance(item, dict) or any(not isinstance(item.get(k), str) for k in ('source_url', 'label', 'kind', 'status')):
                    return None
                if item['kind'] not in ('link', 'image') or item['status'] not in ('resolved', 'unresolved') or not item['source_url'].lower().startswith('file:'):
                    return None
                target = item.get('target')
                if item['status'] == 'resolved' and not safe_target(target):
                    return None
                if item['status'] == 'unresolved' and (target is not None or not isinstance(item.get('reason'), str)):
                    return None
            return value
        except (ValueError, KeyError, TypeError, OSError, RecursionError):
            return None


def safe_target(target):
    if not isinstance(target, str) or any(ord(c) < 32 for c in target) or '\\' in target:
        return False
    parsed = urlsplit(target)
    if parsed.scheme == 'https' and parsed.netloc == 'github.com':
        return bool(re.match(r'^/[\w.-]+/[\w.-]+(?:/|$)', parsed.path))
    if parsed.scheme or parsed.netloc or parsed.query or not target.startswith('library/'):
        return False
    decoded = unquote(parsed.path)
    return all(p and not p.startswith('.') for p in decoded.split('/')) and '\\' not in decoded and not any(ord(c) < 32 for c in decoded)


def public_record(record):
    """The web API needs match identities, never host file URLs or Git metadata."""
    targets = []
    alternatives = {}
    for item in record.get('targets', []):
        alternatives.setdefault((item['source_url'], item['kind']), set()).add(
            (item['status'], item.get('target'), item.get('reason')))
    for item in record.get('targets', []):
        key = digest(json.dumps([item['source_url'], item['label'], item['kind']], ensure_ascii=False, separators=(',', ':')).encode())
        value = {'key': key, 'status': item['status']}
        # Parser extensions can decorate labels differently. URL/kind is a safe
        # fallback only when every label has the same disposition and target.
        # Exact label keys still distinguish commit labels sharing a repository URL.
        if len(alternatives[(item['source_url'], item['kind'])]) == 1:
            value['fallback_key'] = digest(json.dumps([item['source_url'], item['kind']], ensure_ascii=False, separators=(',', ':')).encode())
        if item['status'] == 'resolved':
            value['target'] = item['target']
        else:
            # Native filesystem exception text may include a host path. The
            # canonical private record keeps the diagnostic; the browser does not.
            reason = item.get('reason', 'Local target is unavailable')
            value['reason'] = reason if '/' not in reason and '\\' not in reason else 'Local target could not be prepared; see the repair record'
        targets.append(value)
    return {'targets': targets}
