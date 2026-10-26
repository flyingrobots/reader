"""A bounded, read-only inventory of the permanent LLM archive (`logs/llm/`), for Reader Admin's LLM logs.

Pages walk the dated folders newest first and read each run's `meta.json` (at most 64 KiB) without
decompressing anything. Artifact reads go through `llm_logs.read` with its bounds. Nothing here prunes,
rewrites or recompresses: retention is forever, and a page is a view, not a cleanup tool."""
import json
from pathlib import Path

from . import llm_logs
from .display import shown

MAX_META = 64 * 1024
PAGE = 50


def _dirs(path):
    try:
        return sorted((p for p in path.iterdir() if p.is_dir() and not p.is_symlink()), key=lambda p: p.name, reverse=True)
    except OSError:
        return []


def _meta(folder):
    file = folder / llm_logs.META
    try:
        if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_META:
            return None
        data = json.loads(file.read_text())
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def row(root, relative, meta):
    files = meta.get('files') if isinstance(meta.get('files'), dict) else {}
    partial = sorted(p.name[:-len('.partial')] for p in (Path(root) / relative).glob('*.partial'))
    return shown({'path': relative, 'kind': meta.get('kind'), 'run_id': meta.get('run_id'), 'status': meta.get('status'),
                  'outcome': meta.get('outcome'), 'started_at': meta.get('started_at'), 'ended_at': meta.get('ended_at'),
                  'runner': meta.get('runner'), 'agent': meta.get('agent') or meta.get('voice') or meta.get('cli'),
                  'title': (meta.get('source') or {}).get('title') if isinstance(meta.get('source'), dict) else meta.get('document_path'),
                  'bytes': sum(f.get('bytes') or 0 for f in files.values() if isinstance(f, dict)),
                  'artifacts': sorted(set(files) | set(partial)), 'sealed': not partial and meta.get('status') != 'running'}, root)


def page(root, kind=None, cursor=None, limit=PAGE):
    """{'runs': [...], 'next': cursor or None}. `cursor` is the last row's relative path."""
    root = Path(root).resolve()
    if kind is not None and kind not in llm_logs.KINDS:
        raise ValueError('Unknown LLM log kind')
    if cursor is not None and not llm_logs.RELATIVE.fullmatch(cursor):
        raise ValueError('Bad LLM log cursor')
    limit = max(1, min(PAGE, limit))
    base = root / llm_logs.ROOT
    if not base.is_dir() or base.is_symlink():
        return {'runs': [], 'next': None, 'kinds': list(llm_logs.KINDS), 'retention': 'forever'}
    found = []
    # Every kind's day folders, merged newest first; within a day, runs by folder mtime (newest first).
    days = []
    for kind_dir in _dirs(base):
        if kind_dir.name not in llm_logs.KINDS or (kind and kind_dir.name != kind):
            continue
        for year in _dirs(kind_dir):
            for month in _dirs(year):
                for day in _dirs(month):
                    days.append((f'{year.name}/{month.name}/{day.name}', kind_dir.name, day))
    days.sort(key=lambda d: (d[0], d[1]), reverse=True)
    passed = cursor is None
    for date, name, day in days:
        try:
            runs = sorted((p for p in day.iterdir() if p.is_dir() and not p.is_symlink()), key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)
        except OSError:
            continue
        for folder in runs:
            relative = f'{llm_logs.ROOT}/{name}/{date}/{folder.name}'
            if not passed:
                passed = relative == cursor
                continue
            if not llm_logs.RELATIVE.fullmatch(relative):
                continue
            meta = _meta(folder)
            found.append(row(root, relative, meta or {'kind': name, 'run_id': folder.name, 'status': 'unreadable'}))
            if len(found) > limit:
                return {'runs': found[:limit], 'next': found[limit - 1]['path'], 'kinds': list(llm_logs.KINDS), 'retention': 'forever'}
    return {'runs': found, 'next': None, 'kinds': list(llm_logs.KINDS), 'retention': 'forever'}


def detail(root, relative):
    folder = llm_logs.safe_dir(root, relative)
    meta = _meta(folder)
    if meta is None:
        raise ValueError('That LLM run has no readable meta.json')
    names = sorted({p.name.removesuffix('.partial').removesuffix('.gz') for p in folder.iterdir()
                    if not p.is_symlink() and p.is_file() and p.name not in (llm_logs.META, '.meta.next')})
    return {'run': row(root, relative, meta), 'meta': shown(meta, root), 'artifacts': [n for n in names if llm_logs.NAME.fullmatch(n)]}


def artifact(root, relative, name, limit=256 * 1024):
    limit = max(1024, min(1024**2, int(limit)))
    text, total, truncated = llm_logs.read(root, relative, name, limit)
    return {'path': relative, 'name': name, 'available': text is not None, 'text': shown(text, root) if text is not None else None,
            'bytes': total, 'truncated': truncated, 'limit': limit}
