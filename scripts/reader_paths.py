"""Resolve the software checkout separately from the user's private vault."""
import json
import os
from pathlib import Path


def paths(code=None):
    code = Path(code or Path(__file__).resolve().parents[1]).resolve()
    config = code / '.reader/config.json'
    value = os.environ.get('READER_ROOT')
    if not value and config.is_file():
        value = json.loads(config.read_text()).get('vault')
    if not value:
        raise ValueError('No private vault configured. Run scripts/install.py --vault PATH or set READER_ROOT.')
    vault = Path(value).expanduser().resolve(strict=True)
    if vault == code or not (vault / 'library').is_dir() or not (vault / 'inbox').is_dir():
        raise ValueError('Expected a separate Reader vault with library/ and inbox/ directories')
    return code, vault


if __name__ == '__main__':
    code, vault = paths()
    print(json.dumps({'code': str(code), 'vault': str(vault)}))
