"""Automatic reading positions, independent of document and discussion receipts."""
import json
import math
import os
from pathlib import Path
import tempfile

from .annotations import Annotations, now, sha


class Bookmarks:
    def __init__(self, root):
        self.annotations = Annotations(root)
        self.folder = self.annotations.root / 'bookmarks'

    def participant(self, value):
        return self.annotations.body(value, 'Participant', 100).strip()

    def read(self, participant):
        participant = self.participant(participant)
        if self.folder.is_symlink():
            raise ValueError('Bookmarks folder must not be a symlink')
        path = self.folder / (sha(participant.encode()) + '.json')
        if not path.exists():
            return {'schema_version': 1, 'participant': participant, 'items': {}}
        if path.is_symlink() or path.stat().st_size > 4 * 1024**2:
            raise ValueError('Unsafe or oversized bookmarks')
        data = json.loads(path.read_text())
        if data.get('schema_version') != 1 or data.get('participant') != participant or not isinstance(data.get('items'), dict):
            raise ValueError('Invalid bookmark identity/schema')
        return data

    def get(self, participant, path):
        return self.read(participant)['items'].get(path)

    def save(self, participant, path, source_sha256, progress, source_offset=None, block_fraction=0, layout='scroll', spread_count=None, pdf_page=None):
        participant = self.participant(participant)
        if not isinstance(path, str) or not path.startswith('library/') or any(p in ('', '.', '..') or p.startswith('.') for p in path.split('/')) or '\\' in path:
            raise ValueError('Expected a normalized library-relative document path')
        if not isinstance(source_sha256, str) or len(source_sha256) != 64 or any(c not in '0123456789abcdef' for c in source_sha256):
            raise ValueError('Expected a source SHA-256')
        for value in (progress, block_fraction):
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError('Reading positions must be finite fractions from 0 to 1')
        if source_offset is not None and (type(source_offset) is not int or not 0 <= source_offset <= 4 * 1024**2):
            raise ValueError('Invalid source offset')
        if layout not in ('scroll', 'spread') or spread_count is not None and (type(spread_count) is not int or not 1 <= spread_count <= 100000):
            raise ValueError('Invalid reading layout')
        if pdf_page is not None and (type(pdf_page) is not int or not 1 <= pdf_page <= 5000):
            raise ValueError('Invalid PDF page')
        item = {'source_sha256': source_sha256, 'progress': progress, 'source_offset': source_offset,
                'block_fraction': block_fraction, 'layout': layout, 'spread_count': spread_count, 'pdf_page': pdf_page, 'updated_at': now()}
        with self.annotations.locked():
            record = self.read(participant)
            if len(record['items']) >= 10000 and path not in record['items']:
                raise ValueError('At most 10,000 reading positions per participant')
            self.folder.mkdir(exist_ok=True)
            if len(list(self.folder.glob('*.json'))) >= 100 and not (self.folder / (sha(participant.encode()) + '.json')).exists():
                raise ValueError('At most 100 bookmark participants')
            record['items'][path] = item
            data = (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode()
            if len(data) > 4 * 1024**2:
                raise ValueError('Bookmarks exceed 4 MiB')
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.folder, prefix='.position-', delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.folder / (sha(participant.encode()) + '.json'))
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
        return item
