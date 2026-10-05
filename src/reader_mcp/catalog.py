"""Versioned frontmatter and a rebuildable, exact SQLite metadata mirror."""
from contextlib import contextmanager
from datetime import date
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
from .resources import has_capacity, minimum_free_bytes
import sqlite3
import tempfile
from uuid import uuid4

import yaml

VERSION = 1
MAX_FILES = 10000
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_METADATA_BYTES = 512 * 1024
MAX_GENERATED_BYTES = 32 * 1024 * 1024
from .metadata import (CatalogEnvelope as Metadata,
                       frontmatter, validate_record)

# Every schema field has its own SQL column. JSON columns preserve compound types;
# frontmatter_json also preserves all custom top-level properties without flattening.
COLUMNS = {
    'schema_version': 'INTEGER CHECK(schema_version = 1)',
    'document_id': 'TEXT PRIMARY KEY',
    'document_path': 'TEXT NOT NULL UNIQUE',
    'title': 'TEXT NOT NULL',
    'type': 'TEXT NOT NULL',
    'added': 'TEXT',
    'metadata_created': 'TEXT NOT NULL',
    'author': 'TEXT CHECK(author IS NULL OR json_valid(author))',
    'source': 'TEXT',
    'created': 'TEXT',
    'updated': 'TEXT',
    'kind': 'TEXT',
    'tags': "TEXT NOT NULL CHECK(json_valid(tags) AND json_type(tags) = 'array')",
    'frontmatter_schema_version': 'INTEGER CHECK(frontmatter_schema_version = 1)',
    'document_revision': 'INTEGER CHECK(document_revision >= 1)',
}
DDL = 'CREATE TABLE documents (' + ', '.join(f'"{k}" {v}' for k, v in COLUMNS.items()) + ''',
    frontmatter_json TEXT NOT NULL CHECK(json_valid(frontmatter_json)),
    metadata_path TEXT NOT NULL UNIQUE,
    source_sha256 TEXT NOT NULL,
    metadata_sha256 TEXT NOT NULL
)'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def validated(data):
    # Old catalog aliases are explicit compatibility records, never invented revisions.
    if 'schema_version' not in data and 'frontmatter_schema_version' not in data:
        raise ValueError('Missing frontmatter_schema_version; use catalog migrate for legacy records')
    result = validate_record(data, 'envelope', allow_legacy=True)
    canonical(result)
    return result


def emit(metadata, body):
    return ('---\n' + yaml.safe_dump(metadata, sort_keys=False, allow_unicode=True) + '---\n').encode() + body


class Catalog:
    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        for name in ('library', '.reader', 'catalog', 'catalog/metadata'):
            p = self.root / name
            if p.is_symlink():
                raise ValueError(f'Symlink not allowed: {name}')
        if not (self.root / 'library').is_dir():
            raise ValueError('Missing library directory')
        self.state = self.root / '.reader'
        self.db = self.state / 'catalog.sqlite3'
        if self.db.is_symlink():
            raise ValueError('Catalog database must not be a symlink')

    @contextmanager
    def locked(self):
        self.state.mkdir(exist_ok=True)
        lock = self.state / 'catalog.lock'
        if lock.is_symlink():
            raise ValueError('Catalog lock must not be a symlink')
        with lock.open('a') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            yield

    def inventory(self):
        files, size = {}, 0
        for p in sorted((self.root / 'library').rglob('*')):
            if p.is_symlink():
                raise ValueError(f'Library symlink requires explicit disposition: {p}')
            if p.is_dir():
                continue
            if not p.is_file():
                raise ValueError(f'Unsupported library entry: {p}')
            size += p.stat().st_size
            if size > MAX_SOURCE_BYTES or len(files) >= MAX_FILES:
                raise ValueError('Catalog inventory exceeds 10,000 files or 256 MiB; no publication')
            files[p.relative_to(self.root).as_posix()] = p.read_bytes()
        return files

    def sidecars(self):
        records = {}
        total = 0
        parent = self.root / 'catalog/metadata'
        if not parent.exists():
            return records
        for p in sorted(parent.rglob('*')):
            if p.is_symlink():
                raise ValueError(f'Metadata symlink: {p}')
            if not p.is_file():
                continue
            if p.suffix != '.md':
                raise ValueError(f'Unexpected metadata file: {p}')
            data = p.read_bytes()
            total += len(data)
            if total > MAX_GENERATED_BYTES or len(records) >= MAX_FILES:
                raise ValueError('Metadata inventory exceeds 32 MiB or 10,000 records')
            if len(data) > MAX_METADATA_BYTES:
                raise ValueError(f'Metadata file too large: {p}')
            meta = validated(frontmatter(data)[0])
            target = meta['document_path']
            if f'![[{target}]]' not in frontmatter(data)[1].decode('utf-8'):
                raise ValueError(f'Missing Obsidian source embed: {p}')
            if target in records:
                raise ValueError(f'Duplicate metadata owners: {target}')
            records[target] = (p.relative_to(self.root).as_posix(), data, meta)
        return records

    def protected(self, files):
        """Conservatively protect every manifest-hashed byte sequence, irrespective of path."""
        hashes = set()
        for path, data in files.items():
            if Path(path).name in ('preservation.json', 'receipt.json', 'SHA256SUMS'):
                hashes.update(re.findall(rb'\b[a-f0-9]{64}\b', data))
        return {p for p, data in files.items() if digest(data).encode() in hashes
                or 'originals' in PurePosixPath(p).parts or 'snapshot' in PurePosixPath(p).parts}

    def prepare(self, migrate=False):
        files = self.inventory()
        sidecars = self.sidecars()
        protected = self.protected(files)
        rows, writes, ids = [], {}, set()
        stale = set(sidecars) - set(files)
        if stale:
            raise ValueError(f'Orphan metadata records: {sorted(stale)}; reconcile moves/deletions explicitly')
        for path, source in files.items():
            markdown = Path(path).suffix.lower() == '.md'
            try:
                original, body = frontmatter(source) if markdown else ({}, source)
            except ValueError:
                if path not in protected:
                    raise
                # Receipt-protected source headers are evidence, not catalog owners.
                # Keep their bytes and give an independent sidecar the diagnostics.
                from .metadata import parse_metadata
                result = parse_metadata(source)
                original = {'original_metadata_status': result.status,
                            'original_metadata_diagnostics': result.diagnostics}
                body = source
            if path in sidecars:
                owner, data, meta = sidecars[path]
                if original.get('document_id') == meta['document_id']:
                    raise ValueError(f'Direct metadata and sidecar both claim {path}')
            elif path not in protected and 'document_id' in original and ('schema_version' in original or 'frontmatter_schema_version' in original):
                meta = validated(original)
                owner, data = path, source
            elif not migrate:
                raise ValueError(f'Missing versioned frontmatter: {path}')
            else:
                # Only librarian-managed Markdown gets edited directly. Everything else
                # receives a wrapper, even if an unrecognized source has no manifest.
                direct = markdown and path not in protected and (
                    'added' in original or Path(path).name in ('index.md', 'reading-record.md')
                    or path.startswith(('library/reactions/', 'library/connections/', 'library/reflections/')))
                metadata = dict(original)
                tags = metadata.get('tags', [])
                if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
                    if 'original_frontmatter' in metadata:
                        raise ValueError(f'Original metadata preservation field already occupied: {path}')
                    metadata['original_frontmatter'] = dict(original)
                    values = tags if isinstance(tags, list) else [tags]
                    if any(type(t) not in (str, int, float, bool) for t in values):
                        raise ValueError(f'Tags require manual normalization: {path}')
                    metadata['tags'] = [str(t) for t in values]
                title = original.get('title')
                if not isinstance(title, str) or not title.strip():
                    heading = re.search(rb'^#\s+(.+?)\r?$', body, re.M) if markdown else None
                    title = heading[1].decode('utf-8') if heading else Path(path).name
                if 'schema_version' in metadata:
                    metadata.setdefault('original_frontmatter', dict(original))
                    metadata.pop('schema_version')
                if not direct and 'frontmatter_schema_version' in original:
                    metadata.setdefault('original_frontmatter', dict(original))
                metadata.update(frontmatter_schema_version=VERSION,
                                document_revision=original.get('document_revision', 1) if direct else 1,
                                document_id=str(uuid4()), document_path=path,
                                title=title, type=original.get('type') or ('document' if markdown else 'attachment'),
                                added=original.get('added'), metadata_created=date.today().isoformat())
                try:
                    meta = validated(metadata)
                except ValueError as exc:
                    raise ValueError(f'{path}: {exc}') from exc
                if direct:
                    owner, data = path, emit(meta, body)
                else:
                    owner = 'catalog/metadata/' + path.removeprefix('library/') + '.md'
                    # Vault-relative embeds avoid ambiguous basename resolution.
                    if any(c in path for c in '[]|#'):
                        raise ValueError(f'Path needs explicit Obsidian embed encoding: {path}')
                    from urllib.parse import quote
                    link = quote(os.path.relpath(self.root / path, (self.root / owner).parent))
                    wrapper = ('\n# ' + title + '\n\nReader metadata for the unchanged original. '
                               'The embed depends on Obsidian support for this file format.\n\n'
                               f'![[{path}]]\n\n[Open the original]({link})\n').encode()
                    data = emit(meta, wrapper)
                if len(data) > MAX_METADATA_BYTES and owner != path:
                    raise ValueError(f'Metadata too large: {owner}')
                # Validate the exact emitted header before any migration writes.
                frontmatter(data)
                writes[owner] = data
            if meta['document_path'] != path:
                raise ValueError(f'Metadata path mismatch: {path}; update document_path after moving')
            if meta['document_id'] in ids:
                raise ValueError(f'Duplicate document_id: {meta["document_id"]}')
            ids.add(meta['document_id'])
            source_data = writes.get(path, source)
            values = [canonical(meta.get(k, [] if k == 'tags' else None)) if k in ('author', 'tags') and meta.get(k, [] if k == 'tags' else None) is not None else meta.get(k)
                      for k in COLUMNS]
            rows.append(tuple(values + [canonical(meta), owner, digest(source_data), digest(data)]))
        if sum(len(v) for v in writes.values()) > MAX_GENERATED_BYTES:
            raise ValueError('Planned catalog output exceeds 32 MiB')
        return files, writes, rows

    def atomic_write(self, relative, data, expected=None):
        p = self.root / relative
        # Reject any existing symlink parent before mkdir/replace.
        for parent in (p, *p.parents):
            if parent == self.root:
                break
            if parent.is_symlink():
                raise ValueError(f'Symlink output: {parent}')
        if (p.exists() and (expected is None or p.read_bytes() != expected)) or (expected is not None and not p.exists()):
            raise ValueError(f'Concurrent edit or output conflict: {relative}')
        p.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.reader-', dir=p.parent)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, p)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def publish(self, rows):
        self.state.mkdir(exist_ok=True)
        with sqlite3.connect(self.db) as db:
            if db.execute('PRAGMA page_size').fetchone()[0] != 4096:
                raise ValueError('Unexpected catalog page size; rebuild the disposable database')
            db.execute('PRAGMA max_page_count=32768')  # 128 MiB at the standard page size.
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1, 2):
                raise ValueError(f'Unsupported catalog SQL schema {version}')
            if version == 0 and db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchone():
                raise ValueError('Refusing to replace an unversioned nonempty catalog database')
            db.execute('BEGIN IMMEDIATE')
            db.execute('DROP TABLE IF EXISTS documents')
            db.execute(DDL)
            db.executemany('INSERT INTO documents VALUES (' + ','.join('?' for _ in rows[0]) + ')', rows) if rows else None
            db.execute('PRAGMA user_version=2')
            db.commit()

    def navigation(self, rows):
        from urllib.parse import quote
        lines = ['# Document metadata placeholders', '',
                 'These notes carry versioned metadata and embed preserved originals. '
                 'Each note owns the catalog row for its source; it is not an additional source work.', '',
                 '[Library](../library/index.md) · [Metadata contract](../docs/metadata.md)', '']
        for row in rows:
            path, owner = row[2], row[-3]
            if owner != path:
                label = path.replace('[', '\\[').replace(']', '\\]')
                lines.append(f'- [{label}]({quote(owner.removeprefix("catalog/"))})')
        data = ('\n'.join(lines) + '\n').encode()
        p = self.root / 'catalog/index.md'
        old = p.read_bytes() if p.exists() else None
        if old != data:
            self.atomic_write('catalog/index.md', data, old)

    def run(self, action):
        with self.locked():
            files, writes, rows = self.prepare(migrate=action in ('plan', 'migrate'))
            report = {'schema_version': VERSION, 'documents': len(rows), 'direct': sum(r[-3] == r[2] for r in rows),
                      'placeholders': sum(r[-3] != r[2] for r in rows), 'planned_writes': len(writes),
                      'legacy_metadata': sum(json.loads(r[-4]).get('frontmatter_schema_version') is None for r in rows),
                      'catalog_sql_version': 2,
                      'database': str(self.db)}
            if action == 'plan':
                return report
            if action in ('migrate', 'sync'):
                used = sum(p.stat().st_size for p in self.state.rglob('*') if p.is_file())
                growth = sum(len(v) for v in writes.values()) + sum(len(files[p]) for p in writes if p in files)
                if used + growth + 256 * 1024 * 1024 > 4 * 1024**3 or not has_capacity(self.root):
                    raise ValueError('Metadata migration resource budget exceeded')
            if action == 'migrate':
                if self.inventory() != files:
                    raise ValueError('Library changed during planning; retry after the writer finishes')
                for path, data in writes.items():
                    old = files.get(path)
                    if old is not None:
                        backup = '.reader/catalog-migration-backup/' + digest(old)
                        if not (self.root / backup).exists():
                            self.atomic_write(backup, old)
                    self.atomic_write(path, data, old)
                # Re-read and validate the resulting authoritative files before SQL publication.
                current, _, rows = self.prepare()
                expected = {p: writes.get(p, data) for p, data in files.items()}
                if current != expected:
                    raise ValueError('Library changed during migration; SQL not published; rerun after review')
            elif action not in ('sync', 'check'):
                raise ValueError('Unknown catalog operation')
            if action == 'check':
                if not self.db.is_file():
                    raise ValueError('Catalog SQL mirror missing; run catalog sync')
                with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as db:
                    if db.execute('PRAGMA user_version').fetchone()[0] != 2:
                        raise ValueError('Catalog SQL schema version mismatch; run catalog sync')
                    stored = db.execute('SELECT * FROM documents ORDER BY document_path').fetchall()
                    names = [r[1] for r in db.execute('PRAGMA table_info(documents)')]
                    if names != list(COLUMNS) + ['frontmatter_json', 'metadata_path', 'source_sha256', 'metadata_sha256']:
                        raise ValueError('Catalog SQL columns differ from metadata schema')
                if stored != sorted(rows, key=lambda r: r[2]):
                    raise ValueError('SQL mirror differs from current frontmatter/source bytes; run catalog sync')
            else:
                if self.inventory() != (current if action == 'migrate' else files):
                    raise ValueError('Library changed before SQL publication')
                if self.prepare()[2] != rows:
                    raise ValueError('Metadata changed before SQL publication')
                self.publish(rows)
                self.navigation(rows)
            report['status'] = 'valid' if action == 'check' else 'synchronized'
            return report
