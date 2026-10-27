#!/usr/bin/env python3
"""Mechanically inventory the Python Reader surface for the TypeScript port (D1).

Writes docs/port/surface.md from the source tree: HTTP routes (from web.py's router), the
JSON actions each POST route dispatches, MCP tools, CLI subcommands and script entry points,
vault files (static path literals plus an empirical scan of a freshly built demo vault: formats,
JSON shapes, SQLite schemas), locking and atomic-write sites, subprocesses and network
endpoints, environment variables, Python dependencies, a per-module size table and the test
coverage per module and per route (existing pytest/browser suites and tests/contract/).

    python scripts/port_inventory.py            # rewrite docs/port/surface.md
    python scripts/port_inventory.py --check    # exit 1 if surface.md is stale
    python scripts/port_inventory.py --no-demo  # skip the empirical demo-vault scan

Re-run it after main moves and diff the result: a new route, flag, env var or vault file shows
up as a changed line. Only the source tree and a disposable demo vault are read; never a real
vault. Purpose notes for env vars and dependencies are the only hand-written facts, and an
undocumented new one is reported as "undocumented" so it cannot slip by.
"""
import argparse
import ast
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / 'src' / 'reader_mcp'
OUT = REPO / 'docs' / 'port' / 'surface.md'
CONTRACT = REPO / 'tests' / 'contract'

# Hand-written purposes (the only non-derived facts). Unknown names render as "undocumented".
ENV_PURPOSE = {
    'READER_ROOT': 'Vault path for the CLI and scripts (`--root` wins).',
    'READER_TEST_CLOCK': 'Tests only: pins calendar time to an ISO instant (clock.py).',
    'READER_INDEX_WORKER': 'Set by search_guard for the bounded index child process.',
    'READER_INDEX_DEADLINE': 'Deadline (epoch seconds) the index worker must finish by.',
    'READER_CODEX': 'Codex CLI used by the inbox runner (web Inbox page).',
    'READER_WORKSTATION_LOCK_STORE': 'git-locks store for shared host resources during inbox runs.',
    'READER_DEBUG': 'Keeps extra diagnostics (stderr tails) in runner/maintenance errors.',
    'READER_LMS': 'LM Studio `lms` CLI path.',
    'READER_LMSTUDIO_URL': 'Default OpenAI-compatible base URL for local models.',
    'READER_LLM_API_KEY': 'API key for the configured local-model provider (else the git-ignored key file).',
    'READER_COLORFUL': 'Colorful Language (prose colouring) binary.',
    'READER_CLI_CANDIDATES': 'Folders searched for agent CLIs (claude/codex/agy) beyond PATH.',
    'READER_GIT_LOCKS': 'git-locks executable for companions/voice commits.',
    'READER_GIT_LOCKS_STORE': 'git-locks store for companion installs.',
    'READER_GIT_LOCKS_CANDIDATES': 'Folders searched for git-locks.',
    'READER_LAUNCHCTL': 'launchctl used to probe/start the AI-TTS agent.',
    'READER_WEB_ALLOWED_HOSTS': 'Override web-config allowed_hosts (tailnet names).',
    'READER_WEB_ALLOWED_ORIGINS': 'Override web-config allowed_origins.',
    'READER_WEB_ALLOWED_LOGINS': 'Override web-config allowed_logins (Tailscale logins).',
    'READER_WEB_FRONT_SECRET': 'Turn on the trusted front: requests must prove this secret (32+ characters).',
    'READER_WEB_FRONT_TOKEN': 'With the front secret, the write token the front hands out (32+ characters).',
    'READER_WEB_TRUSTED_PROXY': 'Override web-config trusted_proxy (`tailscale` or empty).',
    'READER_SERVICE_LAUNCHCTL': 'reader_service.py: launchctl path (tests use fakes).',
    'READER_SERVICE_TAILSCALE': 'reader_service.py: tailscale path.',
    'READER_SERVICE_GIT': 'reader_service.py: git path.',
    'READER_SERVICE_GIT_LOCKS': 'reader_service.py: git-locks path.',
    'READER_SERVICE_BUSY_POLL': 'reader_service.py: poll interval while waiting for a busy server.',
    'READER_SERVICE_BUSY_WAIT': 'reader_service.py: how long an update waits for a busy server.',
    'READER_SERVICE_HEALTH_TIMEOUT': 'reader_service.py: health-probe timeout after a restart.',
    'READER_SERVICE_SMOKE_TIMEOUT': 'reader_service.py: smoke-test timeout before an update lands.',
    'READER_VERIFY_QUERY': 'verify_search_installation.py: query to try.',
    'READER_VERIFY_FUZZY_QUERY': 'verify_search_installation.py: fuzzy query to try.',
    'AI_TTS_HOME': 'AI-TTS install folder (speech companion).',
    'AI_TTS_SOCKET': 'AI-TTS daemon Unix socket.',
    'CODEX_HOME': 'Where install scripts register the MCP server/skills for Codex.',
    'CARGO_HOME': 'install_wide_md.py: cargo install root.',
    'CARGO_BUILD_JOBS': 'Companion builds: bounded cargo parallelism.',
    'CARGO_INCREMENTAL': 'Companion builds: no incremental cache.',
    'CARGO_TARGET_DIR': 'Companion builds: an owned, disposable target folder.',
    'CARGO_TERM_COLOR': 'Companion builds: plain logs.',
    'GIT_LOCKS_STORE': 'Passed through to git-locks for shared-resource locks.',
    'HOME': 'Resolves ~ for CLI folders, companions and service state.',
    'PATH': 'Executable lookup; narrowed for child processes.',
    'PYTHONPATH': 'Propagated to the inbox runner child.',
    'HF_HUB_OFFLINE': 'Set by the demo so fastembed never downloads unless asked.',
    'HF_HOME': 'Set by search_guard to the index worker\'s own runtime folder.',
    'XDG_CACHE_HOME': 'Set for bounded child processes to an owned runtime folder.',
    'PYTHONPYCACHEPREFIX': 'Set for the index worker so bytecode lands in its runtime folder.',
    'OMP_NUM_THREADS': 'Index worker thread cap (ONNX runtime).',
    'TOKENIZERS_PARALLELISM': 'Disables tokenizer thread pools in the index worker.',
    'GIT_CONFIG_GLOBAL': 'Isolates git from the user\'s global config for vault commits/demo builds.',
    'GIT_CONFIG_NOSYSTEM': 'Isolates git from the system config.',
    'GIT_TERMINAL_PROMPT': 'Never lets git prompt for credentials.',
    'GIT_AUTHOR_NAME': 'Commit attribution for voice/vault commits.',
    'GIT_AUTHOR_EMAIL': 'Commit attribution for voice/vault commits.',
    'GIT_COMMITTER_NAME': 'Commit attribution for voice/vault commits.',
    'GIT_COMMITTER_EMAIL': 'Commit attribution for voice/vault commits.',
    'GIT_AUTHOR_DATE': 'Pinned commit dates (demo history).',
    'GIT_COMMITTER_DATE': 'Pinned commit dates (demo history).',
    'GIT_OPTIONAL_LOCKS': 'Read-only git calls never take index locks.',
    'NO_COLOR': 'Plain output from child tools.',
    'TERM': 'Plain output from child tools.',
    'CI': 'Non-interactive child tools.',
    'HF_HUB_DISABLE_TELEMETRY': 'Set by search_guard: no Hugging Face telemetry from the index worker.',
    'HF_HUB_DISABLE_XET': 'Set by search_guard: plain HTTP downloads for the embedding model.',
    'TMPDIR': 'Set for children to an owned, bounded temp folder.',
}
DEP_PURPOSE = {
    'fastembed': 'ONNX text embeddings (BAAI/bge-small-en-v1.5) for semantic search, related works, shapes; optional at runtime.',
    'numpy': 'Imported directly but not declared (it arrives through fastembed). Vector maths over embeddings: float16 pack/unpack of stored vectors, cosine similarity, SVD/PCA for document shapes, mean vectors for related/magazine diversity.',
    'rapidfuzz': 'Fuzzy title/path matching (search fuzzy mode, link resolution suggestions).',
    'pypdf': 'PDF text extraction per page (search index, read, speech, PDF reading).',
    'pillow': 'Art still images: decode/validate/re-encode data-URL PNG/JPEG/WebP.',
    'PIL': 'Same as pillow (import name).',
    'fonttools': 'Declared, but no module imports it (theme fonts are served as downloaded woff2 files).',
    'mcp': 'FastMCP stdio server (reader serve) and the install verifiers\' MCP client.',
    'pydantic': 'Validated models: ingest Submission, catalog metadata, frontmatter.',
    'pyyaml': 'YAML frontmatter parsing/writing.',
    'yaml': 'Same as pyyaml (import name).',
    'pytest': 'Dev only: the Python test suite.',
}
STDLIB = set(sys.stdlib_module_names)
PROGRAMS = ('git', 'git-locks', 'launchctl', 'tailscale', 'lms', 'codex', 'claude', 'agy', 'ollama', 'llama-server', 'wide-md',
            'colorful', 'ai-tts', 'cargo', 'npm', 'node', 'ps', 'ssh', 'say', 'afplay', 'open', 'uv', 'python3')
NETWORK_CALLS = ('urlopen', 'HTTPConnection', 'HTTPSConnection', 'create_connection', 'AF_UNIX', 'urllib.request.Request')


def rel(path):
    return path.relative_to(REPO).as_posix()


def short(path):
    return '/'.join(rel(path).split('/')[-2:]) if path.parent.name == 'demo' else path.name


def parse(path):
    return ast.parse(path.read_text(), filename=str(path))


def text(node, limit=90):
    out = ast.unparse(node)
    return out if len(out) <= limit else out[:limit - 1] + '…'


def md(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def modules():
    files = sorted(SRC.glob('*.py')) + sorted((SRC / 'demo').glob('*.py'))
    return [f for f in files if f.name != '__init__.py' or f.parent.name == 'demo']


# ----------------------------------------------------------------------------- HTTP routes

def str_const(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def route_tests(test):
    """Route conditions in an if-test: ('==', path) or ('prefix', path), plus any extra condition text."""
    found = []
    for node in ast.walk(test):
        if isinstance(node, ast.Compare) and ast.unparse(node.left) == 'parsed.path' and isinstance(node.ops[0], ast.Eq):
            if (value := str_const(node.comparators[0])):
                found.append(('==', value))
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'startswith'
                and ast.unparse(node.func.value) == 'parsed.path' and node.args and str_const(node.args[0])):
            found.append(('prefix', node.args[0].value))
    return found


def collect_fields(body):
    params, fields, calls, statuses, limits = [], [], [], [], []
    for stmt in body:
        for node in ast.walk(stmt):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                owner = ast.unparse(node.func.value)
                if node.func.attr == 'get' and owner in ('args', 'lists') and node.args and str_const(node.args[0]):
                    params.append(node.args[0].value + ('[]' if owner == 'lists' else ''))
                if node.func.attr in ('get', 'pop') and owner == 'request' and node.args and str_const(node.args[0]):
                    fields.append(node.args[0].value)
                if owner.startswith('library') or owner == 'self':
                    if owner.startswith('library'):
                        calls.append(f'{owner}.{node.func.attr}')
                    if owner == 'self' and node.func.attr == 'json' and len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                        statuses.append(node.args[1].value)
                    if owner == 'self' and node.func.attr == 'send_file':
                        calls.append('send_file' + ('(raw)' if any(k.arg == 'raw' for k in node.keywords) else ''))
            if isinstance(node, ast.Subscript) and ast.unparse(node.value) in ('args', 'request') and str_const(node.slice):
                (params if ast.unparse(node.value) == 'args' else fields).append(node.slice.value)
            if isinstance(node, ast.Set):
                values = [str_const(e) for e in node.elts]
                if all(values):
                    fields.extend(values)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'number' and node.args and str_const(node.args[0]):
                params.append(node.args[0].value)
            if isinstance(node, ast.Name) and node.id == 'FACETS':
                params.extend(['project[]', 'author[]', 'type[]', '(other filter keys)'])
            if isinstance(node, ast.Call) and ast.unparse(node.func) == 'health':
                calls.append('service.health')
    uniq = lambda xs: list(dict.fromkeys(xs))
    return uniq(params), uniq(fields), uniq(c for c in calls if c != 'library.engagement.participant'), uniq(statuses), limits


def walk_chain(node, method, routes):
    """Follow an if/elif chain; each branch with a route test becomes a route."""
    while isinstance(node, ast.If):
        tests = route_tests(node.test)
        if tests:
            extra = ast.unparse(node.test)
            for kind, path in tests:
                params, fields, calls, statuses, _ = collect_fields(node.body)
                cond = '' if extra in (f"parsed.path == '{path}'", f"parsed.path.startswith('{path}')") else extra
                variant = re.findall(r"'(\w+)' in args", cond)
                routes.append({'method': method, 'path': path + ('*' if kind == 'prefix' else '') + ('?' + '&'.join(variant) if variant else ''), 'kind': kind, 'line': node.lineno,
                               'params': params, 'fields': fields, 'calls': calls, 'statuses': statuses, 'condition': cond})
        node = node.orelse[0] if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If) else None


def find_func(tree, cls, name):
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == cls:
            for item in node.body:
                if isinstance(item, ast.FunctionDef) and item.name == name:
                    return item
    raise LookupError(f'{cls}.{name} not found')


def constants(tree):
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, SyntaxError, TypeError):
                if isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'frozenset' and node.value.args:
                    value = ast.literal_eval(node.value.args[0])
                else:
                    continue
            if isinstance(node.targets[0], ast.Tuple):
                for t, v in zip(node.targets[0].elts, value):
                    out[t.id] = v
            elif isinstance(node.targets[0], ast.Name):
                out[node.targets[0].id] = value
    return out


def http_routes():
    tree = parse(SRC / 'web.py')
    handle = find_func(tree, 'WebHandler', 'handle_request')
    routes = []
    for stmt in ast.walk(handle):
        if isinstance(stmt, ast.If) and ast.unparse(stmt.test) == 'write':
            for inner in stmt.body:
                if isinstance(inner, ast.If) and route_tests(inner.test):
                    walk_chain(inner, 'POST', routes)
            break
    try_body = next(n for n in handle.body if isinstance(n, ast.Try) and any(isinstance(b, ast.Assign) and ast.unparse(b.targets[0]) == 'parsed' for b in n.body))
    for inner in try_body.body:
        if isinstance(inner, ast.If) and route_tests(inner.test) and ast.unparse(inner.test) != 'write':
            walk_chain(inner, 'GET', routes)
    stream = find_func(tree, 'WebHandler', 'stream_chat')
    params, fields, calls, statuses, _ = collect_fields(stream.body)
    statuses = sorted({n.args[1].value for n in ast.walk(stream) if isinstance(n, ast.Call) and ast.unparse(n.func) == 'self.json'
                       and len(n.args) > 1 and isinstance(n.args[1], ast.Constant)})
    routes.insert(0, {'method': 'GET', 'path': '/api/chat/stream', 'kind': '==', 'line': stream.lineno, 'params': ['id'], 'fields': [],
                      'calls': ['conversations.chats.read', 'conversations.runner.wait'], 'statuses': statuses, 'condition': '', 'sse': True})
    errors = []
    for handler in try_body.handlers:
        names = ast.unparse(handler.type) if handler.type else 'Exception'
        codes = [n.args[1].value for n in ast.walk(handler) if isinstance(n, ast.Call) and ast.unparse(n.func) == 'self.json' and len(n.args) > 1]
        errors.append((names, codes[0] if codes else 'none (connection dropped)'))
    consts = constants(tree)
    limits = []
    for node in ast.walk(handle):
        if isinstance(node, ast.Assign) and ast.unparse(node.targets[0]) == 'limit':
            limits.append(ast.unparse(node.value))
    return routes, errors, consts, limits


def pool(route, consts):
    path = route['path'].split('?')[0].rstrip('*')
    if route.get('sse'):
        return 'streams (4, refuse 429)'
    if route['method'] == 'POST':
        return 'expensive (8, refuse 429)'
    if path in consts['UNGATED'] or path.startswith(tuple(consts['STATIC_PREFIXES'])):
        return 'ungated'
    if path in consts['EXPENSIVE_GETS'] or path.startswith(tuple(consts['EXPENSIVE_GET_PREFIXES'])):
        return 'expensive (8, refuse 429)'
    return f"reads ({consts['READ_LIMIT']}, wait {consts['READ_WAIT']} s then 429)"


def web_attributes():
    """WebLibrary attribute -> (class, module) from its __init__ assignments."""
    tree = parse(SRC / 'web.py')
    imports = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module and node.level == 1:
            for alias in node.names:
                imports[alias.asname or alias.name] = node.module
    init = find_func(tree, 'WebLibrary', '__init__')
    attrs = {}
    for node in ast.walk(init):
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Attribute) and ast.unparse(node.targets[0].value) == 'self':
            value = node.value
            if isinstance(value, ast.BoolOp):
                value = value.values[-1]
            if isinstance(value, ast.IfExp):
                value = value.body
            if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id in imports:
                attrs[node.targets[0].attr] = (value.func.id, imports[value.func.id])
    return attrs


def dispatch_actions():
    """Actions accepted by each module's dispatch(): dict keys, == / in comparisons on action/operation."""
    out = {}
    for file in modules():
        tree = parse(file)
        for cls in (n for n in tree.body if isinstance(n, ast.ClassDef)):
            for fn in cls.body:
                if isinstance(fn, ast.FunctionDef) and fn.name == 'dispatch':
                    actions = {}
                    for node in ast.walk(fn):
                        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Dict) and isinstance(node.targets[0], ast.Name) \
                                and node.targets[0].id in ('allowed', 'handlers', 'fields'):
                            for k, v in zip(node.value.keys, node.value.values):
                                if str_const(k):
                                    try:
                                        extra = sorted(ast.literal_eval(v)) if not isinstance(v, ast.Attribute) else []
                                    except ValueError:
                                        extra = [text(v, 40)]
                                    actions[k.value] = [e for e in extra if e != 'action']
                        if isinstance(node, ast.Compare) and isinstance(node.left, (ast.Name, ast.Call, ast.Subscript)):
                            left = ast.unparse(node.left)
                            if any(w in left for w in ('action', 'operation')):
                                for comp in node.comparators:
                                    for c in ([comp] if not isinstance(comp, ast.Tuple) else comp.elts):
                                        if str_const(c):
                                            actions.setdefault(c.value, [])
                    out[cls.name] = (rel(file), actions)
    return out


# ----------------------------------------------------------------------------- MCP and CLI

def mcp_tools():
    tree = parse(SRC / 'server.py')
    tools = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and any('tool' in ast.unparse(d) for d in node.decorator_list):
            hints = []
            for d in node.decorator_list:
                for kw in getattr(d, 'keywords', []):
                    if kw.arg == 'annotations':
                        hints = [f'{k.arg}={ast.unparse(k.value)}' for k in kw.value.keywords]
            args = node.args
            defaults = [None] * (len(args.args) - len(args.defaults)) + list(args.defaults)
            params = [a.arg + (': ' + ast.unparse(a.annotation) if a.annotation else '') + (' = ' + ast.unparse(d) if d is not None else '')
                      for a, d in zip(args.args, defaults)]
            doc = (ast.get_docstring(node) or '').split('\n')[0]
            tools.append((node.name, params, hints, doc))
    other = [ast.unparse(d) for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) for d in n.decorator_list if 'tool' not in ast.unparse(d)]
    return tools, other


def argparse_tree(file, fn_name=None, seed=None):
    """[(command path, option strings, details)] from argparse calls, in source order."""
    tree = parse(file)
    scopes = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and (fn_name is None or n.name == fn_name)]
    rows = []
    for scope in scopes:
        names = dict(seed or {})
        calls = sorted((n for n in ast.walk(scope) if isinstance(n, (ast.Assign, ast.Expr, ast.NamedExpr))), key=lambda n: n.lineno)
        for node in calls:
            value = node.value
            target = node.targets[0].id if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) else None
            if not isinstance(value, ast.Call):
                continue
            func = ast.unparse(value.func)
            owner = func.rsplit('.', 1)[0] if '.' in func else None
            if func.endswith('ArgumentParser'):
                names[target] = ()
            elif func.endswith('.add_subparsers') and owner in names:
                names[target] = names[owner]
            elif func.endswith('.add_parser') and owner in names and value.args and str_const(value.args[0]):
                names[target] = names[owner] + (value.args[0].value,)
                help_ = next((str_const(k.value) for k in value.keywords if k.arg == 'help'), '') or ''
                rows.append((names[target], None, help_))
            elif func.endswith('.add_argument') and owner in names:
                flags = [ast.unparse(a).strip("'\"") for a in value.args]
                details = []
                for kw in value.keywords:
                    if kw.arg in ('default', 'choices', 'action', 'type', 'required', 'nargs', 'metavar'):
                        details.append(f'{kw.arg}={text(kw.value, 60)}')
                rows.append((names[owner], ', '.join(flags), '; '.join(details)))
            elif isinstance(value.func, ast.Name) and value.args and ast.unparse(value.args[0]) in names and target is None:
                rows.append((names[ast.unparse(value.args[0])], f'(delegated to {value.func.id}())', ''))
    return rows


def entry_points():
    rows = []
    for file in sorted(list((REPO / 'scripts').glob('*.py')) + modules()):
        source = file.read_text()
        if "__name__" in source and re.search(r"if __name__ ?== ?['\"]__main__['\"]", source):
            doc = (ast.get_docstring(parse(file)) or '').strip().split('\n')[0]
            rows.append((rel(file), doc))
    return rows


def consumers():
    """CLI/HTTP invocations from the plugin, skills and installers (other surface clients in this repo)."""
    found = Counter()
    for base in ('plugins/reader/src', 'skills', 'scripts'):
        for file in (REPO / base).rglob('*'):
            if file.suffix not in ('.ts', '.py', '.mjs', '.js', '.md') or 'node_modules' in file.parts or not file.is_file() or file.name == 'port_inventory.py':
                continue
            source = file.read_text(errors='replace')
            for m in re.finditer(r"['\"](annotate|ingest|search|read|status|reading-copy|browse|curation|queue|index|serve|web|catalog|validate-metadata)['\"]", source):
                if re.search(r"reader(_mcp\.cli)?['\"]?\s*[,\]]|\.venv/bin/reader|\*cli|reader_mcp\.cli|--root", source):
                    found[(rel(file), m.group(1))] += 1
            for m in re.finditer(r"reader_mcp\.([a-z_]+)", source):
                found[(rel(file), 'module ' + m.group(1))] += 1
    return sorted(found)


# ----------------------------------------------------------------------------- vault files, locks, processes

PATHISH = re.compile(r"^(\.reader|\.git|library|catalog|indexes|inbox|annotations|engagement|bookmarks|chats|queues|history|curation|"
                     r"quizzes|quiz-reviews|prompts|art|logs|themes|voices\.json|README\.md|AGENTS\.md|favorite\.json|writing|notebook)"
                     r"(/|$)|\.(json|jsonl|sqlite3|lock|md|log|txt|png|plist)$")


def path_literals(tree):
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            for side in (node.left, node.right):
                if (value := str_const(side)) and len(value) < 80 and '\n' not in value and ' ' not in value:
                    found.add(value)
        if (value := str_const(node)) and PATHISH.search(value) and len(value) < 80 and ' ' not in value and '\n' not in value \
                and not value.startswith(('http', '.', '-')) or (value and value.startswith('.reader/') and ' ' not in value):
            found.add(value)
    return sorted(found)


LOCK_PATTERNS = {'flock': r'fcntl\.flock', 'os.replace': r'os\.replace|\.replace\((?=[^)]*(tmp|temp|part))',
                 'fsync': r'os\.fsync', 'mkstemp/NamedTemporaryFile': r'mkstemp|NamedTemporaryFile|TemporaryDirectory',
                 'O_EXCL/O_NOFOLLOW': r'O_EXCL|O_NOFOLLOW', 'symlink refusal': r'is_symlink\(\)', 'sqlite WAL': r'journal_mode\s*=?\s*WAL|WAL',
                 'threading.Lock': r'threading\.(R?Lock|Condition|BoundedSemaphore)', 'git-locks': r'git.locks|git_locks'}


def process_sites(tree, file):
    rows = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = ast.unparse(node.func)
            if func in ('subprocess.run', 'subprocess.Popen', 'subprocess.check_output', 'subprocess.call', 'subprocess.check_call') \
                    or func.startswith('os.exec') or func.startswith('os.spawn') or func.endswith('self.spawn'):
                argv = text(node.args[0], 70) if node.args else '?'
                timeout = next((ast.unparse(k.value) for k in node.keywords if k.arg == 'timeout'), '—')
                rows.append((rel(file), node.lineno, func.replace('subprocess.', ''), argv, timeout))
    return rows


def programs_named(source):
    hits = []
    for name in PROGRAMS:
        if re.search(r"['\"/]" + re.escape(name) + r"['\"]", source):
            hits.append(name)
    return hits


def network_sites(source):
    return sorted({n for n in NETWORK_CALLS if n in source} | set(re.findall(r"https?://[A-Za-z0-9.\-:]+(?:/[A-Za-z0-9._/\-]*)?", source)))


ENVISH = re.compile(r'^[A-Z][A-Z0-9]*_[A-Z0-9_]+$|^(HOME|PATH|TMPDIR|TERM|CI|LANG|NO_COLOR|PWD|USER|SHELL)$')


def env_vars(source):
    tree = ast.parse(source)
    found = set()
    for node in ast.walk(tree):
        # Keys of environment dicts handed to children: env.update({...}), dict(os.environ, KEY=...), env['KEY'] = ...
        if isinstance(node, ast.Call) and ast.unparse(node.func) in ('dict', 'env.update', 'environ.update') and \
                any('environ' in ast.unparse(a) or ast.unparse(a) == 'env' for a in node.args) or \
                (isinstance(node, ast.Call) and ast.unparse(node.func).endswith('.update') and 'env' in ast.unparse(node.func)):
            found |= {k.arg for k in node.keywords if k.arg and ENVISH.match(k.arg)}
            for a in node.args:
                if isinstance(a, ast.Dict):
                    found |= {k.value for k in a.keys if str_const(k) and ENVISH.match(k.value)}
        if isinstance(node, ast.Subscript) and isinstance(node.ctx, ast.Store) and 'env' in ast.unparse(node.value) and \
                str_const(node.slice) and ENVISH.match(node.slice.value):
            found.add(node.slice.value)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr) and 'environ' in ast.unparse(node.left) and isinstance(node.right, ast.Dict):
            found |= {k.value for k in node.right.keys if str_const(k) and ENVISH.match(k.value)}
        if isinstance(node, ast.For) and 'env[' in ast.unparse(node) and isinstance(node.iter, ast.Call) and \
                isinstance(node.iter.func, ast.Attribute) and isinstance(node.iter.func.value, ast.Dict):
            found |= {k.value for k in node.iter.func.value.keys if str_const(k) and ENVISH.match(k.value)}
    names = found | set(re.findall(r"environ(?:\.get)?\s*[\(\[]\s*['\"]([A-Z][A-Z0-9_]+)['\"]", source))
    names |= set(re.findall(r"['\"]((?:READER|AI_TTS|HF)_[A-Z0-9_]+)['\"]", source))
    names |= set(m for m in re.findall(r"\b(READER_[A-Z0-9_]+)\b", source) if not m.endswith('_'))
    for prefix, items in (('READER_WEB_', ('ALLOWED_HOSTS', 'ALLOWED_ORIGINS', 'ALLOWED_LOGINS')),):
        if "'" + prefix + "'" in source:
            names |= {prefix + i for i in items}
    return {n for n in names if not n.endswith('_')}


def demo_scan():
    """Build a disposable demo vault and describe every file kind in it (paths normalised)."""
    python = sys.executable
    with tempfile.TemporaryDirectory(prefix='reader-port-inventory-') as tmp:
        root = Path(tmp) / 'demo'
        env = dict(os.environ, PYTHONPATH=str(REPO / 'src'), HF_HUB_OFFLINE='1', HOME=tmp)
        # The demo pinned to 2026-10-21 12:00 UTC (as tests/contract does), so weekday-relative content never changes the scan.
        pinned = ('import sys; from datetime import date, datetime, timezone; from reader_mcp.demo import build as b; '
                  'r = b.build(sys.argv[1], today=date(2026, 10, 21), now=datetime(2026, 10, 21, 12, tzinfo=timezone.utc)); b.index(r, False)')
        done = subprocess.run([python, '-c', pinned, str(root)], env=env, cwd=tmp,
                              capture_output=True, text=True, timeout=300)
        if done.returncode:
            raise SystemExit('demo build failed: ' + done.stderr[-2000:])
        kinds = defaultdict(lambda: {'count': 0, 'shape': None, 'bytes': 0})
        tables = {}
        for file in sorted(root.rglob('*')):
            if not file.is_file() or '.git' in file.relative_to(root).parts[:1]:
                continue
            path = file.relative_to(root).as_posix()
            key = normalise(path)
            entry = kinds[key]
            entry['count'] += 1
            entry['bytes'] += file.stat().st_size
            if file.suffix == '.json' and entry['shape'] is None:
                try:
                    entry['shape'] = shape(json.loads(file.read_text()))
                except ValueError:
                    entry['shape'] = 'invalid JSON'
            elif file.suffix == '.jsonl' and entry['shape'] is None:
                lines = [l for l in file.read_text().splitlines() if l.strip()]
                entry['shape'] = 'lines of ' + (shape(json.loads(lines[0])) if lines else '(empty)')
            elif file.suffix == '.sqlite3':
                con = sqlite3.connect(f'file:{file}?mode=ro', uri=True)
                try:
                    tables[key] = [(t, s) for t, s in con.execute("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL "
                                                                    "AND name NOT LIKE '%_data' AND name NOT LIKE '%_idx' AND name NOT LIKE '%_docsize' "
                                                                    "AND name NOT LIKE '%_config' AND name NOT LIKE '%_content' ORDER BY type DESC, name")]
                    version = con.execute('PRAGMA user_version').fetchone()[0]
                    mode = con.execute('PRAGMA journal_mode').fetchone()[0]
                    entry['shape'] = f'SQLite (user_version {version}, journal {mode})'
                finally:
                    con.close()
            elif entry['shape'] is None:
                entry['shape'] = file.suffix.lstrip('.') or 'no extension'
        return dict(kinds), tables


UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
HEX = re.compile(r'\b[0-9a-f]{16,64}\b')
DATE = re.compile(r'\d{4}-\d{2}-\d{2}(T[0-9:.\-+Z]+)?|\d{4}/\d{2}(/\d{2})?|\d{8}T\d{6}')


def normalise(path):
    parts = path.split('/')
    out = []
    for i, part in enumerate(parts):
        p = UUID.sub('<uuid>', part)
        p = HEX.sub('<hash>', p)
        p = DATE.sub('<date>', p)
        if i < len(parts) - 1 and parts[0] in ('library', 'catalog') and i >= 1 and '<' not in p:
            p = '…'
        out.append(p)
    # Collapse library/catalog subtrees to one row per extension.
    if out[0] in ('library', 'catalog', 'indexes', 'art') and len(out) > 2:
        if out[0] == 'art':
            return 'art/<library path>/<sha256>/<generation>/' + out[-1]
        return f"{out[0]}/**/*{Path(path).suffix or '(no ext)'}"
    if out[0] in ('library', 'catalog') and len(out) == 2:
        return f"{out[0]}/*{Path(path).suffix or '(no ext)'}"
    return '/'.join(out)


def shape(value, depth=0):
    if isinstance(value, dict):
        if value and all(('/' in k or ':' in k) for k in value):
            return '{<path key>: ' + shape(next(iter(value.values())), depth + 1) + '}'
        if depth >= 1:
            return '{' + ', '.join(list(value)[:8]) + (', …' if len(value) > 8 else '') + '}'
        return '{' + ', '.join(f'{k}: {shape(v, depth + 1)}' for k, v in list(value.items())[:12]) + (', …' if len(value) > 12 else '') + '}'
    if isinstance(value, list):
        return '[' + (shape(value[0], depth + 1) if value else '') + ']'
    return type(value).__name__.replace('NoneType', 'null').replace('str', 'string').replace('int', 'number').replace('float', 'number')


# ----------------------------------------------------------------------------- tests and coverage

def test_coverage(names):
    """Per module: pytest files importing it and their test count; browser suites naming it is not possible statically."""
    tests = sorted((REPO / 'tests').glob('test_*.py'))
    imports = defaultdict(list)
    counts = {}
    for file in tests:
        source = file.read_text()
        counts[file.name] = len(re.findall(r'^\s*def test_', source, re.M))
        for name in names:
            if re.search(rf'reader_mcp(\.{name}\b| import [^\n]*\b{name}\b)|from \.\.?{name} ', source) or \
                    re.search(rf'from reader_mcp\.{name} import|reader_mcp\.{name}', source):
                imports[name].append(file.name)
    return imports, counts


def route_mentions(route_paths, files):
    hits = defaultdict(set)
    for file in files:
        source = file.read_text(errors='replace')
        for path in route_paths:
            bare = path.split('?')[0].rstrip('*')
            if re.search(re.escape(bare) + (r"(?![a-z\-/])" if not path.endswith('*') else ''), source):
                hits[path].add(file.name)
    return hits


def contract_routes():
    """Routes exercised in tests/contract/*.mjs: calls like get('/api/x'), post('/api/x'), raw('GET', '/x')."""
    covered = defaultdict(set)
    for file in sorted(CONTRACT.glob('*.test.mjs')) if CONTRACT.is_dir() else []:
        source = file.read_text()
        for method, path in re.findall(r"\b(get|post|stream)\(\s*[`'\"](/[^`'\"?$]*)", source):
            covered[('POST' if method == 'post' else 'GET', path)].add(file.name)
        for path in re.findall(r"\bshape\(\s*'[^']*',\s*[`'\"](/[^`'\"?$]*)", source):  # read.test.mjs: shape(name, path, ...)
            covered[('GET', path)].add(file.name)
        for path in re.findall(r"\b(?:ok|refused)\(\s*(?:'[^']*',\s*)?'(/api/[^'?]*)", source):  # write.test.mjs helpers post
            covered[('POST', path)].add(file.name)
        for verb, path in re.findall(r"\braw\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*[`'\"](/[^`'\"?$]*)", source):
            covered[(verb, path)].add(file.name)
        # An explicit tag for route variants a call cannot show: `// covers: GET /api/changes?a&b`
        for verb, path in re.findall(r"covers: (GET|POST) (\S+)", source):
            covered[(verb, path)].add(file.name)
    return covered


def contract_inventory():
    """What the contract suite claims beyond HTTP: CLI subcommands and MCP tools named in its tests."""
    cli, tools = set(), set()
    for file in sorted(CONTRACT.glob('*.mjs')) if CONTRACT.is_dir() else []:
        source = file.read_text()
        cli |= set(re.findall(r"\[\s*'([a-z-]+)'", source))  # argv arrays: ['ingest', '-'], ['--root', ..., 'web', ...]
        cli |= set(re.findall(r"'(web|serve)'", source))  # the harness starts `web` and `serve`
        tools |= set(re.findall(r"\b(reader_[a-z_]+)\b", source))
    return cli, tools


def area(path):
    path = path.rstrip('*')
    table = [('/api/chat', 'chat'), ('/api/art', 'art'), ('/api/search', 'search'), ('/api/speak', 'speech'),
             ('/api/inbox', 'inbox'), ('/api/companions', 'companions'), ('/api/local-model', 'local model'),
             ('/api/editions', 'versions'), ('/api/version', 'versions'), ('/api/changes', 'versions'),
             ('/api/annotations', 'annotations'), ('/api/discussion', 'annotations'), ('/api/seen', 'engagement'), ('/api/readers', 'engagement'),
             ('/api/queue', 'queue'), ('/api/history', 'queue'), ('/api/next', 'queue'),
             ('/api/themes', 'themes'), ('/api/fonts', 'themes'), ('/fonts/', 'themes'),
             ('/api/resolve', 'links'), ('/api/links', 'links'), ('/api/link-counts', 'links'), ('/api/preview', 'links'), ('/api/embeds', 'links'),
             ('/api/standfirst', 'magazine'), ('/api/issue', 'magazine'), ('/api/shape', 'shape'), ('/api/prose', 'prose'),
             ('/api/quiz', 'quizzes'), ('/api/prompt', 'prompts'), ('/api/writing', 'writing'),
             ('/api/service', 'service'), ('/api/health', 'service'), ('/api/maintenance', 'maintenance'),
             ('/api/library', 'library'), ('/api/document', 'library'), ('/api/file', 'library'), ('/api/bookmark', 'library'),
             ('/assets/', 'static'), ('/', 'static')]
    return next(a for prefix, a in table if path == prefix or (prefix != '/' and path.startswith(prefix)))


# ----------------------------------------------------------------------------- render

def size_row(file):
    source = file.read_text()
    lines = source.splitlines()
    code = [l for l in lines if l.strip() and not l.strip().startswith('#')]
    tree = ast.parse(source)
    stmts = sum(1 for n in ast.walk(tree) if isinstance(n, ast.stmt))
    defs = sum(1 for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)))
    classes = sum(1 for n in ast.walk(tree) if isinstance(n, ast.ClassDef))
    avg = sum(len(l) for l in code) / max(1, len(code))
    return len(lines), len(code), len(source), avg, max((len(l) for l in lines), default=0), stmts / max(1, len(code)), defs, classes


def render(demo=True):
    routes, errors, consts, limits = http_routes()
    attrs = web_attributes()
    actions = dispatch_actions()
    tools, other_decorators = mcp_tools()
    out = []
    w = out.append
    w('# Python surface inventory for the TypeScript port')
    w('')
    w('Generated by `scripts/port_inventory.py` from the source tree; do not edit by hand. Re-run it after main moves and diff')
    w('the result (`--check` fails when this page is stale). Everything here is derived mechanically from the code, except the')
    w('purpose notes for environment variables and dependencies, which live in the script and show "undocumented" for a new name.')
    w('Response shapes are not derivable statically; the golden snapshots in `tests/contract/golden/` are their record.')
    w('')
    w('Contents: [HTTP routes](#http-routes) · [POST actions](#post-actions) · [request checks](#request-checks-every-route) ·')
    w('[MCP](#mcp-server) · [CLI](#cli) · [vault files](#vault-files) · [locking](#locking-and-atomic-writes) ·')
    w('[processes](#subprocesses-and-external-programs) · [network](#network-endpoints) · [environment](#environment-variables) ·')
    w('[dependencies](#python-dependencies) · [module sizes](#module-sizes-and-test-coverage) · [contract coverage](#contract-coverage)')
    w('')

    # Routes
    browser = sorted((REPO / 'tests').glob('web_*.cjs')) + sorted((REPO / 'tests').glob('*.test.mjs'))
    pytests = sorted((REPO / 'tests').glob('test_*.py'))
    paths = [r['path'] for r in routes]
    in_browser = route_mentions(paths, browser)
    in_pytest = route_mentions(paths, pytests)
    covered = contract_routes()
    w('## HTTP routes')
    w('')
    w(f'{len(routes)} method+path routes in `src/reader_mcp/web.py` (`WebHandler.handle_request` and `stream_chat`). `*` marks a prefix')
    w('route. **Pool** is the admission gate (`WebHandler.admission`). **Handler** is the WebLibrary attribute it calls, with the')
    w('owning class. **Existing tests** counts browser suites (`tests/web_*.cjs`, `tests/*.test.mjs`) and pytest files naming the path;')
    w('**Contract** names the `tests/contract/` files that call it.')
    w('')
    w('| Method | Path | Pool | Query params / body fields | Handler | Explicit status | Existing tests (browser / pytest) | Contract |')
    w('| - | - | - | - | - | - | - | - |')
    for r in routes:
        handler = []
        for call in r['calls']:
            parts = call.split('.')
            if len(parts) >= 2 and parts[0] == 'library' and parts[1] in attrs:
                handler.append(f'{".".join(parts[1:])} ({attrs[parts[1]][0]})')
            else:
                handler.append(call.removeprefix('library.'))
        fields = ', '.join(r['params'] if r['method'] == 'GET' else r['fields']) or '—'
        if r.get('sse'):
            fields += ' (SSE: hello, state, started, delta, posted, done, commit, ping)'
        if r['condition']:
            fields += f" — when `{md(r['condition'])}`"
        key = (r['method'], r['path'].rstrip('*'))
        contract = sorted(covered.get(key, set()) | (set().union(*[v for (m, p), v in covered.items() if m == r['method'] and p.startswith(r['path'][:-1])])
                                                     if r['path'].endswith('*') else set()))
        mentions = '(page shell)' if r['path'] == '/' else f"{len(in_browser.get(r['path'], ()))} / {len(in_pytest.get(r['path'], ()))}"
        w(f"| {r['method']} | `{r['path']}` | {pool(r, consts)} | {md(fields)} | {md(', '.join(dict.fromkeys(handler)) or '—')} | "
          f"{', '.join(map(str, r['statuses'])) or '—'} | {mentions} | "
          f"{', '.join(c.removesuffix('.test.mjs') for c in contract) or '**gap**'} |")
    w('')
    w('## POST actions')
    w('')
    w('JSON routes that dispatch on an `action` (or `operation`) field, from each class\'s `dispatch()`. Extra fields are the keys')
    w('the action accepts beyond `action`, where the code lists them.')
    w('')
    w('| Class (module) | Action: accepted fields |')
    w('| - | - |')
    for cls, (file, acts) in sorted(actions.items()):
        w(f"| {cls} (`{file}`) | {md('; '.join(f'`{a}`' + (': ' + ', '.join(f) if f else '') for a, f in acts.items()))} |")
    w('')
    w('## Request checks (every route)')
    w('')
    w('- **Bind:** `WebServer` refuses any address but `127.0.0.1`/`localhost`. Port default 8766 (`reader web --port`, 0 = any free).')
    w('- **Identity (`web_access.WebAccess.identify`), before admission:** a request without proxy headers must have Host')
    w('  `127.0.0.1:<port>` or `localhost:<port>` and, if it sends Origin, the same origin; any forwarding/Tailscale header makes it')
    w('  *proxied*, which needs `trusted_proxy: tailscale`, a configured host matching X-Forwarded-Host, an allowed')
    w('  Tailscale-User-Login, no Funnel header and an allowed Origin. Refusal: 403 JSON `{error}` under `/api/`, else a 403 HTML page.')
    w('  Config: `<vault>/.reader/web-config.json` (≤ 64 KiB, no symlink) with `READER_WEB_*` overrides, re-read on change.')
    w('- **Trusted front (off by default):** with `READER_WEB_FRONT_SECRET` set, `identify` instead requires that secret in')
    w('  `X-Reader-Front-Secret` (constant-time) and a JSON `X-Reader-Identity` (`via` local or tailscale), then re-checks the')
    w('  forwarded Host/Origin against it and the config; anything else is a 403. Unset, both headers are ignored.')
    w('  `READER_WEB_FRONT_TOKEN` then supplies the write token.')
    w('- **Writes (every POST):** header `X-Reader-Token` equal to the per-process token from `GET /api/library`, and')
    w('  `Content-Type: application/json`, else 403. Body must be a JSON object of 1 byte up to: ' + '; '.join(f'`{md(l)}`' for l in limits) + '.')
    w(f"- **Admission:** expensive pool {consts['EXPENSIVE_LIMIT']} slots (refuse 429 at once), read pool {consts['READ_LIMIT']} slots"
      f" (wait {consts['READ_WAIT']} s, then 429), SSE 4 streams (429), ungated: {', '.join(sorted(consts['UNGATED']))} and"
      f" {', '.join(consts['STATIC_PREFIXES'])}.")
    w('- **Response headers:** every JSON/file response sets `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`,')
    w('  `Referrer-Policy: no-referrer` and a CSP; raw vault files (`/api/file`, `/api/art/still`) get `sandbox` CSP, ranges')
    w('  (`Range: bytes=a-b`, 206/416) and `text/plain` unless the suffix is pdf/png/jpg/jpeg/webp/gif/svg.')
    w('- **Error mapping** (the `except` chain, in order):')
    w('')
    w('| Exception | Status |')
    w('| - | - |')
    for names, code in errors:
        w(f'| `{md(names)}` | {code} |')
    w('')
    w('Error bodies are `{"error": message}`; `shown()` rewrites absolute paths to `<vault>/…` or `~/…` (#105).')
    w('')

    # MCP
    w('## MCP server')
    w('')
    w(f'`reader serve [--inline-only]` runs FastMCP "Reader" over stdio (`src/reader_mcp/server.py`). {len(tools)} tools; no resources or')
    w('prompts are registered' + (f' (other decorators: {", ".join(other_decorators)})' if other_decorators else '') + '. `--inline-only` makes')
    w('`reader_ingest` refuse `document_path` and attachments. (`resources.py` is not MCP: it holds the free-space reserve rules.)')
    w('')
    w('| Tool | Parameters | Hints | Summary |')
    w('| - | - | - | - |')
    for name, params, hints, doc in tools:
        w(f"| `{name}` | {md(', '.join(params))} | {md(', '.join(hints))} | {md(doc)} |")
    w('')

    # CLI
    w('## CLI')
    w('')
    w('`reader` (`reader_mcp.cli:main`, also `python -m reader_mcp.cli`). Global `--root` (or `READER_ROOT`). Prints one JSON document')
    w('on stdout; errors print `Reader: <message>` on stderr and exit 1 (`browse --check` stale and `validate-metadata` invalid also exit 1).')
    w('')
    w('| Command | Option | Details |')
    w('| - | - | - |')
    for path, flag, details in argparse_tree(SRC / 'cli.py', 'main'):
        if flag and flag.startswith('(delegated'):
            for _, f2, d2 in argparse_tree(SRC / 'demo' / '__init__.py', 'add_arguments', {'parser': ()}):
                w(f"| {' '.join(path)} | `{md(f2)}` | {md(d2)} |")
            continue
        w(f"| {' '.join(path) or '(global)'} | {('`' + md(flag) + '`') if flag else '—'} | {md(details)} |")
    w('')
    w('### Script and module entry points')
    w('')
    w('| File | Purpose (docstring) |')
    w('| - | - |')
    for file, doc in entry_points():
        w(f'| `{file}` | {md(doc)} |')
    w('')
    for file, fn in (('scripts/reader_service.py', 'parser'), ('src/reader_mcp/inbox_runner.py', 'main'), ('scripts/install.py', None),
                     ('scripts/start_web.py', None), ('scripts/check_container.py', None)):
        rows = argparse_tree(REPO / file, fn)
        if not rows:
            continue
        w(f'`{file}` arguments:')
        w('')
        w('| Command | Option | Details |')
        w('| - | - | - |')
        for path, flag, details in rows:
            w(f"| {' '.join(path) or '(top)'} | {('`' + md(flag) + '`') if flag else '—'} | {md(details)} |")
        w('')
    w('### Other clients of the surface in this repository')
    w('')
    w('The Obsidian plugin, skills and scripts invoke these CLI subcommands and modules (a port must keep them working or move them):')
    w('')
    w('| File | Invokes |')
    w('| - | - |')
    for file, what in consumers():
        w(f'| `{file}` | {md(what)} |')
    w('')

    # Vault files
    mods = modules() + sorted(f for f in (REPO / 'scripts').glob('*.py') if f.name != 'port_inventory.py')
    w('## Vault files')
    w('')
    w('### Path literals per module (static)')
    w('')
    w('String literals joined with `/` or shaped like vault paths. A starting point for ownership; the empirical table below is exact.')
    w('')
    w('| Module | Literals |')
    w('| - | - |')
    for file in mods:
        lits = path_literals(parse(file))
        if lits:
            w(f"| `{rel(file)}` | {md(', '.join(f'`{l}`' for l in lits))} |")
    w('')
    if demo:
        kinds, tables = demo_scan()
        w('### Files in a freshly built demo vault (empirical)')
        w('')
        w('The demo vault (as `reader demo --no-serve` builds it, pinned to 2026-10-21) in a temporary folder, then every file except `.git/`, with UUIDs, hashes and dates')
        w('normalised and `library/`/`catalog/`/`indexes/` subtrees grouped by extension. JSON shows the first file\'s shape (keys to')
        w('two levels). Counts and sizes describe the demo only.')
        w('')
        w('| Path pattern | Files | Format / shape |')
        w('| - | - | - |')
        for key in sorted(kinds):
            w(f"| `{md(key)}` | {kinds[key]['count']} | {md(kinds[key]['shape'])} |")
        w('')
        w('### SQLite schemas (from the demo vault)')
        w('')
        for key, rows in sorted(tables.items()):
            w(f'`{key}`:')
            w('')
            w('```sql')
            for _, sql in rows:
                w(re.sub(r'\s+', ' ', sql).strip() + ';')
            w('```')
            w('')
    w('Static `CREATE` statements per module (some tables only appear once a feature runs):')
    w('')
    w('| Module | Tables / indexes |')
    w('| - | - |')
    for file in mods:
        found = sorted(set(re.findall(r'CREATE (?:VIRTUAL )?(?:TABLE|INDEX)(?: IF NOT EXISTS)? ([A-Za-z_.]+)', file.read_text())))
        if found:
            w(f"| `{rel(file)}` | {', '.join(found)} |")
    w('')

    # Locking
    w('## Locking and atomic writes')
    w('')
    w('Occurrences per module of each durability/concurrency mechanism (regex counts over source; read the sites before porting).')
    w('')
    w('| Module | ' + ' | '.join(LOCK_PATTERNS) + ' |')
    w('| - | ' + ' | '.join('-' for _ in LOCK_PATTERNS) + ' |')
    for file in mods:
        source = file.read_text()
        counts = [len(re.findall(p, source)) for p in LOCK_PATTERNS.values()]
        if any(counts):
            w(f"| `{rel(file)}` | " + ' | '.join(str(c) if c else '' for c in counts) + ' |')
    w('')
    lock_files = sorted({l for f in mods for l in re.findall(r"['\"]([A-Za-z0-9_./\-]*\.lock)['\"]", f.read_text())})
    w('Lock file names: ' + ', '.join(f'`{l}`' for l in lock_files) + '.')
    w('')

    # Processes
    w('## Subprocesses and external programs')
    w('')
    w('| Site | Call | argv (start) | Timeout |')
    w('| - | - | - | - |')
    for file in mods:
        for site in process_sites(parse(file), file):
            w(f'| `{site[0]}:{site[1]}` | {site[2]} | `{md(site[3])}` | `{md(site[4])}` |')
    w('')
    w('Programs named as string literals per module:')
    w('')
    w('| Module | Programs |')
    w('| - | - |')
    for file in mods:
        hits = programs_named(file.read_text())
        if hits:
            w(f"| `{rel(file)}` | {', '.join(hits)} |")
    w('')
    w('## Network endpoints')
    w('')
    w('| Module | Calls / URLs |')
    w('| - | - |')
    for file in mods:
        hits = network_sites(file.read_text())
        if hits:
            w(f"| `{rel(file)}` | {md(', '.join(f'`{h}`' for h in hits))} |")
    w('')

    # Env
    w('## Environment variables')
    w('')
    usage = defaultdict(list)
    for file in mods:
        for name in env_vars(file.read_text()):
            usage[name].append(short(file))
    w('| Variable | Read or set in | Purpose |')
    w('| - | - | - |')
    for name in sorted(usage):
        w(f"| `{name}` | {', '.join(sorted(set(usage[name])))} | {md(ENV_PURPOSE.get(name, 'undocumented'))} |")
    w('')
    w('Config files: `<vault>/voices.json` (voice registry), `<vault>/.reader/web-config.json` (proxy/tailnet access),')
    w('`<vault>/.reader/local-model/settings.json` and `api-key`, `<vault>/.reader/companions.json`-style companion settings (see')
    w('companions.py), `<vault>/indexes/settings.json` (browse), `<code>/.reader/config.json` (installer vault binding) and')
    w('`~/Library/Application Support/Reader/service.json` (service state).')
    w('')

    # Deps
    w('## Python dependencies')
    w('')
    pyproject = (REPO / 'pyproject.toml').read_text()
    declared = re.findall(r'^\s*"([A-Za-z0-9_\-]+)[<>=!~ ]', pyproject, re.M)
    users = defaultdict(set)
    for file in mods:
        for node in ast.walk(parse(file)):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name.split('.')[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module.split('.')[0]]
            for n in names:
                if n not in STDLIB and n != 'reader_mcp' and not (REPO / 'scripts' / (n + '.py')).exists():
                    users[n].add(short(file))
    w('| Dependency | Declared | Imported by | Used for |')
    w('| - | - | - | - |')
    for name in sorted(set(declared) | set(users), key=str.lower):
        imported = users.get(name) or users.get({'pillow': 'PIL', 'fonttools': 'fontTools', 'pyyaml': 'yaml'}.get(name, ''), set())
        w(f"| `{name}` | {'yes' if name in declared else 'no (transitive)'} | {', '.join(sorted(imported)) or '—'} | {md(DEP_PURPOSE.get(name, 'undocumented'))} |")
    w('')
    w('numpy appears only through vector maths on embeddings (see the table); with semantic search off it still runs for')
    w('`/api/shape` (term vectors) and is imported at startup by web.py, related.py, magazine.py, shape.py and search.py.')
    w('')

    # Sizes
    w('## Module sizes and test coverage')
    w('')
    names = [f.stem for f in modules()]
    imports, counts = test_coverage(names)
    w('Lines, non-blank non-comment lines, characters, mean and max line length, AST statements per code line (density),')
    w('functions and classes; then the pytest files importing the module and their total `test_` functions. Browser suites')
    w('exercise modules through HTTP, so see the route table for those.')
    w('')
    w('| Module | Lines | Code | Chars | Mean len | Max len | Stmts/line | Defs | Classes | Pytest files | Tests |')
    w('| - | - | - | - | - | - | - | - | - | - | - |')
    total = [0, 0, 0]
    for file in mods:
        lines, code, chars, avg, longest, density, defs, classes = size_row(file)
        total = [total[0] + lines, total[1] + code, total[2] + chars]
        files = imports.get(file.stem, []) if file.parent == SRC or file.parent.name == 'demo' else []
        w(f"| `{rel(file)}` | {lines} | {code} | {chars} | {avg:.0f} | {longest} | {density:.2f} | {defs} | {classes} | "
          f"{len(files)} | {sum(counts[f] for f in files)} |")
    w(f'| **total** | {total[0]} | {total[1]} | {total[2]} | | | | | | | |')
    w('')
    ui = sorted((SRC / 'web_ui').rglob('*'))
    ui_files = [f for f in ui if f.is_file() and f.suffix in ('.js', '.mjs', '.css', '.html') and 'controls' not in f.parts and 'vendor' not in f.parts]
    w(f"Language-neutral code that a port keeps as is: `src/reader_mcp/web_ui/` ({len(ui_files)} hand-written JS/CSS/HTML files,"
      f" {sum(len(f.read_text(errors='replace').splitlines()) for f in ui_files)} lines, excluding vendor/) plus the built `web_ui/controls/` bundle from `web/`.")
    w(f"Tests: {len(pytests)} pytest files, {sum(counts.values())} test functions; {len(list((REPO / 'tests').glob('web_*.cjs')))} browser suites;"
      f" {len(list((REPO / 'tests').glob('*.test.mjs')))} node unit files.")
    w('')

    # Contract coverage
    w('## Contract coverage')
    w('')
    by_area = defaultdict(lambda: [0, 0])
    gaps = []
    for r in routes:
        key = (r['method'], r['path'].rstrip('*'))
        hit = key in covered or (r['path'].endswith('*') and any(m == r['method'] and p.startswith(key[1]) for m, p in covered))
        a = by_area[(area(r['path']), r['method'])]
        a[1] += 1
        a[0] += hit
        if not hit:
            gaps.append(r)
    total_hit = sum(v[0] for v in by_area.values())
    w(f'**{total_hit} of {len(routes)} routes** have at least one test in `tests/contract/`.')
    w('')
    w('A route counts as covered when at least one contract test requests it. Where success needs a real companion or would act')
    w('on the host (speech, prose colouring, an inbox run, service actions, companion installs, local-model server control), the')
    w('suite checks validation and refusals only; `docs/port/plan.md` lists what each port step must add.')
    w('')
    w('| Area | GET covered | POST covered |')
    w('| - | - | - |')
    for name in sorted({k[0] for k in by_area}):
        g, p = by_area.get((name, 'GET'), [0, 0]), by_area.get((name, 'POST'), [0, 0])
        w(f"| {name} | {f'{g[0]}/{g[1]}' if g[1] else '—'} | {f'{p[0]}/{p[1]}' if p[1] else '—'} |")
    w('')
    cli_cov, tool_cov = contract_inventory()
    commands = sorted({p[0] for p, f, _ in argparse_tree(SRC / 'cli.py', 'main') if p})
    w(f"CLI subcommands with a contract test: {len(set(commands) & cli_cov)} of {len(commands)} "
      f"({', '.join(sorted(set(commands) & cli_cov)) or 'none'}). MCP tools named in contract tests: "
      f"{len({t[0] for t in tools} & tool_cov)} of {len(tools)}.")
    w('')
    sources = '\n'.join(f.read_text() for f in sorted(CONTRACT.glob('*.test.mjs'))) if CONTRACT.is_dir() else ''
    mentioned = set(re.findall(r"\b(?:action|operation): '([a-z-]+)'", sources))
    w('POST actions named anywhere in contract tests (a route can be covered while some of its actions are not):')
    w('')
    w('| Class | Covered | Not yet covered |')
    w('| - | - | - |')
    for cls, (_, acts) in sorted(actions.items()):
        names = list(acts)
        hit = [a for a in names if a in mentioned]
        w(f"| {cls} | {len(hit)}/{len(names)} | {', '.join(f'`{a}`' for a in names if a not in mentioned) or '—'} |")
    w('')
    if gaps:
        w('Routes without a contract test (gaps):')
        w('')
        for r in gaps:
            w(f"- `{r['method']} {r['path']}` ({area(r['path'])})")
        w('')
    return '\n'.join(out).rstrip() + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--check', action='store_true', help='Exit 1 if docs/port/surface.md differs from a fresh render')
    parser.add_argument('--no-demo', action='store_true', help='Skip the empirical demo-vault scan')
    parser.add_argument('--stdout', action='store_true', help='Print instead of writing the file')
    args = parser.parse_args()
    page = render(demo=not args.no_demo)
    if args.stdout:
        sys.stdout.write(page)
    elif args.check:
        current = OUT.read_text() if OUT.exists() else ''
        if current != page:
            print('docs/port/surface.md is stale; run scripts/port_inventory.py', file=sys.stderr)
            sys.exit(1)
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(page)
        print(f'wrote {rel(OUT)}')


if __name__ == '__main__':
    main()
