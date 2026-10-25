"""Versioned curator dispositions, independent of filing and read receipts."""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile
from uuid import UUID

from .annotations import now, sha
from .catalog import Catalog, canonical
from .store import relative_path

MAX_RECORD = 8 * 1024**2
MAX_TOTAL = 32 * 1024**2
STATUSES = ('unscanned', 'scanned', 'studied')
AUXILIARY = {'receipt.json', 'reading-record.md', 'intake-record.md',
             'intake-inspection.md', 'intake-inspection.json', 'preservation.json',
             'reading-copy-outcomes.json', 'reading-copy-results.json', 'SHA256SUMS'}
READABLE = {'.md', '.markdown', '.txt', '.pdf', '.html', '.docx', '.epub'}


def participant_name(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 100:
        raise ValueError('Participant must contain 1–100 characters')
    return value.strip()


def timestamp(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        raise ValueError('Expected an ISO timestamp with an explicit timezone') from None
    if result.tzinfo is None:
        raise ValueError('Expected an ISO timestamp with an explicit timezone')
    return result.astimezone(timezone.utc)


class Curation:
    def __init__(self, root):
        self.catalog = Catalog(root)
        self.root = self.catalog.root
        self.folder = self.root / 'curation'
        self.runtime = self.root / '.reader'

    def _record(self, participant):
        if self.folder.is_symlink():
            raise ValueError('Curation folder must not be a symlink')
        entries = list(self.folder.iterdir()) if self.folder.exists() else []
        if any(p.is_symlink() or not p.is_file() for p in entries):
            raise ValueError('Curation records must be regular files without symlinks')
        files = [p for p in entries if p.suffix == '.json']
        if len(files) > 100 or sum(p.stat().st_size for p in entries) > MAX_TOTAL:
            raise ValueError('Curation records exceed participant/storage limits')
        path = self.folder / (sha(participant.encode()) + '.json')
        if not path.exists():
            return path, dict(schema_version=1, participant=participant, items={})
        if path.is_symlink() or path.stat().st_size > MAX_RECORD:
            raise ValueError('Unsafe or oversized curation record')
        try:
            record = json.loads(path.read_text())
        except (ValueError, RecursionError):
            raise ValueError('Invalid curation JSON') from None
        if (not isinstance(record, dict) or record.get('schema_version') != 1
                or record.get('participant') != participant
                or not isinstance(record.get('items'), dict)
                or len(record['items']) > 10000):
            raise ValueError('Invalid curation record identity/schema')
        for key, item in record['items'].items():
            if (not isinstance(key, str) or not key.startswith(('receipt:', 'catalog:'))
                    or not isinstance(item, dict) or item.get('status') not in STATUSES
                    or not re.fullmatch('[a-f0-9]{64}', str(item.get('version', '')))
                    or not isinstance(item.get('coverage'), list) or len(item['coverage']) > 1000
                    or set(item) != {'version', 'status', 'coverage', 'note', 'at'}
                    or not isinstance(item['note'], str) or len(item['note']) > 4000):
                raise ValueError('Invalid curation disposition')
            timestamp(item['at'])
            if item['status'] != 'unscanned' and not item['coverage']:
                raise ValueError('Invalid curation disposition: missing coverage')
            for c in item['coverage']:
                if (not isinstance(c, dict) or set(c) != {'path', 'sha256', 'scope', 'full'}
                        or not isinstance(c['path'], str) or not c['path'].startswith('library/')
                        or not re.fullmatch('[a-f0-9]{64}', str(c['sha256']))
                        or type(c['full']) is not bool or not isinstance(c['scope'], str)
                        or not c['scope'].strip() or len(c['scope']) > 2000):
                    raise ValueError('Invalid stored curation coverage')
        return path, record

    @contextmanager
    def locked(self):
        self.runtime.mkdir(exist_ok=True)
        lock = self.runtime / 'curation.lock'
        if lock.is_symlink():
            raise ValueError('Curation lock must not be a symlink')
        with lock.open('a') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            yield

    @staticmethod
    def auxiliary(path, metadata):
        return (Path(path).name in AUXILIARY
                or metadata.get('kind') in ('reading-copy', 'reading-record', 'intake-inspection')
                or bool(metadata.get('reading_source')))

    def inventory(self):
        # Read authoritative files, not a possibly stale SQL projection.
        files, _, rows = self.catalog.prepare()
        metadata = {r[2]: json.loads(r[-4]) for r in rows}
        hashes = {r[2]: r[-2] for r in rows}
        metadata_hashes = {r[2]: r[-1] for r in rows}
        editions_by_source = {}
        for p, m in metadata.items():
            source = m.get('reading_source')
            if isinstance(source, str) and source in hashes:
                editions_by_source.setdefault(source, []).append(
                    dict(path=p, sha256=hashes[p], reading_source=source,
                         reading_source_sha256=m.get('reading_source_sha256'),
                         current_source=m.get('reading_source_sha256') == hashes[source]))
        covered, units, receipt_ids = set(), [], set()

        def make(key, kind, title, primary, paths, catalog_path=None, received=None,
                 integrity='intact', extra_context=()):
            members = [dict(path=p, sha256=hashes[p]) for p in sorted(set(paths))]
            contexts = list(extra_context) + ([catalog_path] if catalog_path else [])
            context = [dict(path=p, sha256=hashes[p]) for p in sorted(set(contexts))]
            source_paths = {m['path'] for m in members}
            editions = [e for source in source_paths for e in editions_by_source.get(source, [])]
            editions.sort(key=lambda e: e['path'])
            meta_versions = {p: metadata_hashes[p] for p in sorted(set(paths) | set(contexts)
                              | {e['path'] for e in editions})}
            token = sha(canonical(dict(key=key, sources=members, context=context,
                                       reading_copies=editions, metadata=meta_versions)).encode())
            meta = metadata.get(catalog_path or primary, {})
            if received is not None:
                received = timestamp(received).isoformat()
            units.append(dict(key=key, version=token, kind=kind, title=title,
                              path=primary, catalog_path=catalog_path,
                              received_at=received, cataloged_on=meta.get('metadata_created'),
                              source_count=len(members), integrity=integrity,
                              sources=members, context=context, reading_copies=editions))
            covered.update(paths)
            if catalog_path:
                covered.add(catalog_path)

        receipts = sorted((p for p in files if Path(p).name == 'receipt.json'),
                          key=lambda p: (len(Path(p).parts), p))
        for path in receipts:
            if path in covered:
                continue  # A declared nested receipt is an outer delivery's source artifact.
            if files[path].size > 128 * 1024:
                raise ValueError('Oversized receipt requires source reconciliation')
            data = self.catalog.source(path, files[path])
            try:
                receipt = json.loads(data)
            except (ValueError, UnicodeError, RecursionError):
                raise ValueError('Invalid receipt JSON requires source reconciliation') from None
            if not isinstance(receipt, dict) or receipt.get('reader_receipt') != 1:
                continue
            identity = str(UUID(receipt['id']))
            if identity in receipt_ids:
                raise ValueError('Duplicate delivery receipt IDs require reconciliation')
            receipt_ids.add(identity)
            entries = receipt.get('files')
            if not isinstance(entries, list) or not 1 <= len(entries) <= 64:
                raise ValueError('Invalid delivery payload inventory')
            parent = Path(path).parent
            members, damaged = [], False
            for entry in entries:
                if (not isinstance(entry, dict) or not isinstance(entry.get('path'), str)
                        or type(entry.get('bytes')) is not int or not 0 <= entry['bytes'] <= 32 * 1024**2
                        or not re.fullmatch('[a-f0-9]{64}', str(entry.get('sha256', '')))):
                    raise ValueError('Invalid delivery payload descriptor')
                member = (parent / relative_path(entry['path'])).as_posix()
                if member not in files or member in members:
                    raise ValueError('Missing or duplicate receipted payload')
                members.append(member)
                damaged |= (hashes[member] != entry['sha256'] or files[member].size != entry['bytes'])
            primary = (parent / relative_path(receipt['document'])).as_posix()
            if primary not in members:
                raise ValueError('Delivery primary document is outside its payload inventory')
            wrapper = (parent / 'index.md').as_posix()
            make('receipt:' + identity, 'delivery', receipt['title'], primary, members,
                 wrapper if wrapper in files else None, receipt.get('received_at'),
                 'needs_attention' if damaged else 'intact', [path])
            covered.add(path)

        # A deeper catalog wrapper groups direct-drop books/research packets.
        wrappers = sorted((p for p in files if Path(p).name == 'index.md'
                           and len(Path(p).parts) > 3 and p not in covered),
                          key=lambda p: (len(Path(p).parts), p))
        for wrapper in wrappers:
            if wrapper in covered:
                continue
            parent = Path(wrapper).parent
            members = [p for p in files if p not in covered and p != wrapper
                       and Path(p).is_relative_to(parent)
                       and not self.auxiliary(p, metadata[p])]
            if members:
                make('catalog:' + metadata[wrapper]['document_id'], 'collection-work',
                     metadata[wrapper]['title'], wrapper, members, wrapper)
            else:
                make('catalog:' + metadata[wrapper]['document_id'], 'standalone',
                     metadata[wrapper]['title'], wrapper, [wrapper])

        ungrouped = []
        for path in sorted(files):
            meta = metadata[path]
            if path in covered or self.auxiliary(path, meta) or Path(path).name == 'index.md':
                continue
            if Path(path).suffix.lower() not in READABLE and meta.get('type') == 'attachment':
                ungrouped.append(path)
                continue
            make('catalog:' + meta['document_id'], 'standalone', meta['title'], path, [path])

        # A concurrent filing/edit must not publish a supposedly complete snapshot.
        if self.catalog.inventory() != files or self.catalog.prepare()[2] != rows:
            raise ValueError('Library/catalog changed during curation discovery; retry after filing')
        units.sort(key=lambda u: (u['received_at'] or u['cataloged_on'] or '', u['key']), reverse=True)
        return units, ungrouped

    def pending(self, participant, key=None, offset=0, limit=25, since=None, expected_snapshot=None):
        participant = participant_name(participant)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid curation page')
        cutoff = timestamp(since) if since is not None else None
        _, record = self._record(participant)
        units, ungrouped = self.inventory()
        pending = []
        for unit in units:
            previous = record['items'].get(unit['key'])
            current = previous is not None and previous['version'] == unit['version']
            if current:
                members = {m['path']: m['sha256'] for m in unit['sources'] + unit['context'] + unit['reading_copies']}
                if any(c['path'] not in members or c['sha256'] != members[c['path']]
                       for c in previous['coverage']):
                    raise ValueError('Stored coverage does not match its current work version')
            unit['status'] = previous['status'] if current else ('changed' if previous else 'unscanned')
            unit['review'] = previous
            if key is not None:
                if unit['key'] == key:
                    return dict(participant=participant, item=unit)
                continue
            if current and previous['status'] != 'unscanned':
                continue
            if cutoff:
                if unit['received_at'] and timestamp(unit['received_at']) < cutoff:
                    continue
                # A catalog date is not an instant or a filing timestamp. Include
                # the boundary day conservatively instead of inventing precision.
                if not unit['received_at']:
                    day = unit['cataloged_on']
                    if day and day < (cutoff - timedelta(days=1)).date().isoformat():
                        continue
                    unit['time_filter_uncertain'] = True
            pending.append({k: v for k, v in unit.items() if k not in ('sources', 'context', 'reading_copies')})
        if key is not None:
            raise ValueError('Curation work not found')
        snapshot = sha(canonical(dict(participant=participant, since=cutoff.isoformat() if cutoff else None,
                                      items=[(u['key'], u['version'], u['status']) for u in pending])).encode())
        if expected_snapshot is not None and expected_snapshot != snapshot:
            raise ValueError('Curation queue changed; restart paging from offset zero')
        return dict(participant=participant, pending=pending[offset:offset + limit], total=len(pending),
                    snapshot_version=snapshot,
                    next_offset=offset + limit if offset + limit < len(pending) else None,
                    ungrouped_attachment_count=len(ungrouped), ungrouped_attachments=ungrouped[:100])

    def mark(self, participant, key, expected_version, status, coverage, note=''):
        participant = participant_name(participant)
        if status not in STATUSES or not isinstance(note, str) or len(note) > 4000:
            raise ValueError('Invalid curation status/note')
        if not isinstance(coverage, list) or len(coverage) > 1000:
            raise ValueError('Expected at most 1,000 coverage records')
        if status != 'unscanned' and not coverage:
            raise ValueError('Scanned/studied dispositions require explicit source coverage')
        with self.locked():
            path, record = self._record(participant)
            unit = self.pending(participant, key=key)['item']
            if unit['version'] != expected_version:
                raise ValueError('Curation source version changed; inspect the new content before recording')
            members = {m['path']: m['sha256'] for m in unit['sources'] + unit['context'] + unit['reading_copies']}
            normalized, seen = [], set()
            for item in coverage:
                if not isinstance(item, dict) or set(item) != {'path', 'sha256', 'scope', 'full'}:
                    raise ValueError('Coverage needs path, sha256, scope and full fields')
                source = item['path']
                if not isinstance(source, str) or source not in members or source in seen:
                    raise ValueError('Coverage must name a distinct current work member')
                if item['sha256'] != members[source]:
                    raise ValueError('Coverage source hash changed; reread before recording')
                if (type(item['full']) is not bool or not isinstance(item['scope'], str)
                        or not item['scope'].strip() or len(item['scope']) > 2000):
                    raise ValueError('Coverage needs a bounded scope and boolean full flag')
                seen.add(source)
                normalized.append(dict(item))
            study_sources = {m['path'] for m in unit['sources']} | {
                e['path'] for e in unit['reading_copies'] if e['current_source']}
            if status == 'studied' and not any(c['full'] and c['path'] in study_sources for c in normalized):
                raise ValueError('Studied requires full reading of a source member or current reading copy, not only its catalog')
            normalized.sort(key=lambda c: c['path'])
            disposition = dict(version=expected_version, status=status, coverage=normalized, note=note)
            old = record['items'].get(key)
            if old and {k: old[k] for k in disposition} == disposition:
                return dict(participant=participant, key=key, review=old)
            disposition['at'] = now()
            record['items'][key] = disposition
            data = (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode()
            if len(data) > MAX_RECORD or len(record['items']) > 10000:
                raise ValueError('Curation record exceeds limits')
            existing = list(self.folder.glob('*.json'))
            if len(existing) + (not path.exists()) > 100:
                raise ValueError('At most 100 curator participants are supported')
            # Include abandoned stages and the old record: admission must fit
            # the new temporary bytes before atomic replacement frees anything.
            entries = list(self.folder.iterdir()) if self.folder.exists() else []
            if sum(p.stat().st_size for p in entries) + len(data) > MAX_TOTAL:
                raise ValueError('Aggregate curation publication/staging exceeds 32 MiB')
            self.folder.mkdir(exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.folder, prefix='.curation-', delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            return dict(participant=participant, key=key, review=disposition)
