"""Write-ahead records for an explicitly selected intake batch, never a general transaction API."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

from .portable_links import atomic, digest

MAX_PLAN = 8 * 1024**2
MAX_OUTPUT = 128 * 1024**2


def local_path(root, relative):
    if not isinstance(relative, str) or '\\' in relative or any(ord(c) < 32 for c in relative):
        raise ValueError('Invalid intake path')
    parts = relative.split('/')
    if any(p in ('', '.', '..', '.git') for p in parts):
        raise ValueError('Invalid intake path')
    path = root / relative
    for p in (path, *path.parents):
        if p == root:
            break
        if p.is_symlink():
            raise ValueError('Intake path crosses a symlink')
    return path


def file_hash(path):
    if not path.exists():
        return None
    if not path.is_file():
        raise ValueError('Expected a regular intake output')
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(runtime, plan):
    atomic(runtime / 'pending.json', plan, limit=MAX_PLAN)


def load(runtime):
    file = runtime / 'pending.json'
    if file.is_symlink() or file.stat().st_size > MAX_PLAN:
        raise ValueError('Unsafe or oversized intake journal')
    value = json.loads(file.read_text())
    if not isinstance(value, dict) or value.get('schema_version') != 1:
        raise ValueError('Unsupported intake journal')
    return value


class Journal:
    def __init__(self, root, runtime, plan):
        self.root, self.runtime, self.plan = root, runtime, plan
        self.writes = plan.setdefault('writes', {})
        self.entries = [e for e in plan['entries'] if e['decision']['disposition'] == 'file']
        self.payloads = {e['destination'] + '/originals/' + f['path'] for e in self.entries for f in e['files']}
        self.blobs = runtime / 'prepared'
        if self.blobs.is_symlink():
            raise ValueError('Unsafe prepared-output directory')
        self.blobs.mkdir(exist_ok=True)

    def allowed(self, path):
        if path in self.payloads:
            raise ValueError('Intake cannot rewrite preserved payload bytes')
        destinations = [e['destination'] + '/' for e in self.entries]
        sidecars = ['catalog/metadata/' + d.removeprefix('library/') for d in destinations]
        collections = {'library/' + e['decision']['collection'] + '/index.md' for e in self.entries}
        if not (path in {'library/index.md', 'catalog/index.md', 'README.md',
                         'activity/intake/' + self.plan['batch_id'] + '.json'} | collections
                or path.startswith(tuple(destinations + sidecars))
                or path.startswith(('indexes/', 'link-repairs/'))):
            raise ValueError('Write is outside this intake batch: ' + path)
        return local_path(self.root, path)

    def verify(self):
        for relative, record in self.writes.items():
            path = self.allowed(relative)
            if not isinstance(record, dict) or not isinstance(record.get('after'), str) or len(record['after']) != 64:
                raise ValueError('Invalid prepared write')
            if file_hash(path) not in (record.get('before'), record['after']):
                raise ValueError('Intake output changed outside this batch: ' + relative)
            blob = local_path(self.blobs, record['after'])
            if file_hash(blob) != record['after']:
                raise ValueError('Prepared output is missing or changed: ' + relative)

    def publish(self, relative, record):
        path = self.allowed(relative)
        current = file_hash(path)
        if current == record['after']:
            return
        if current != record['before']:
            raise ValueError('Intake output changed outside this batch: ' + relative)
        data = (self.blobs / record['after']).read_bytes()
        if digest(data) != record['after']:
            raise ValueError('Prepared output no longer matches the journal')
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
            temporary = Path(out.name)
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        try:
            if file_hash(path) != record['before']:
                raise ValueError('Intake output changed before publication: ' + relative)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)

    def replay(self):
        self.verify()
        for relative, record in self.writes.items():
            self.publish(relative, record)

    def write(self, relative, data):
        path = self.allowed(relative)
        before = file_hash(path)
        after = digest(data)
        prior = self.writes.get(relative)
        if prior and before != prior['after']:
            raise ValueError('Intake output changed outside this batch: ' + relative)
        if before == after:
            return
        if sum(p.stat().st_size for p in self.blobs.iterdir()) + len(data) > MAX_OUTPUT:
            raise ValueError('Prepared intake outputs exceed 128 MiB')
        blob = local_path(self.blobs, after)
        if not blob.exists():
            with blob.open('xb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        elif file_hash(blob) != after:
            raise ValueError('Prepared output hash collision or corruption')
        record = {'before': before, 'after': after}
        self.writes[relative] = record
        save(self.runtime, self.plan)
        self.publish(relative, record)
