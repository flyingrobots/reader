"""What you've decided about an arrival still waiting. Receipts stay exactly as delivered, so choices live beside them, in ignored `.reader/`.

Two choices: hold keeps an arrival out of every filing run, and cloud lets models other than the local one read it. With no choice, unlabelled arrivals use the saved inbox default. Explicit restrictions and unknown levels stay local. A file
we can't read stops the run, because it might be holding something."""
import fcntl
import json
import os
from pathlib import Path

from .inbox_paths import PREFIX, physical

FILE = '.reader/arrival-choices.json'
HOLD, CLOUD = 'hold', 'cloud'
NORMAL = 'normal'
MAX_BYTES = 1024 * 1024


def read(root):
    path = Path(root) / FILE
    if path.is_symlink():
        raise ValueError(f'{FILE} must not be a symlink')
    if not path.exists():
        return {}
    try:
        with path.open('rb') as handle:
            value = json.loads(handle.read(MAX_BYTES).decode())
    except (OSError, ValueError) as exc:
        raise ValueError(f'{FILE} is unreadable, so nothing will be filed until it is repaired or removed: {exc}') from exc
    if not isinstance(value, dict) or any(choice not in (HOLD, CLOUD) for choice in value.values()):
        raise ValueError(f'{FILE} is invalid, so nothing will be filed until it is repaired or removed')
    return value


def waiting(root, name):
    if not isinstance(name, str) or not name or '/' in name or '\\' in name or name.startswith('.'):
        return False
    path = physical(root, PREFIX + name)
    return not path.is_symlink() and path.exists()


def choose(root, name, choice):
    """Record a choice for a waiting arrival; None clears it. Arrivals that have left are dropped on the way."""
    if choice not in (HOLD, CLOUD, None):
        raise ValueError('Expected the choice hold, cloud or null')
    if not waiting(root, name):
        raise ValueError('That arrival is not waiting in the inbox')
    path = Path(root) / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        choices = {key: value for key, value in read(root).items() if waiting(root, key)}
        if choice is None:
            choices.pop(name, None)
        else:
            choices[name] = choice
        temporary = path.with_name(path.name + '.next')
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as out:
            json.dump(choices, out, indent=1)
        os.replace(temporary, path)
    return {'arrival': name, 'choice': choice}


def held(root):
    return {name for name, choice in read(root).items() if choice == HOLD}


def name_of(source):
    return source.split('/')[1]


def local_only(root, name, provenance):
    """Whether only the local model may read this arrival. Unlabelled arrivals use the saved default; explicit restrictions remain local."""
    if read(root).get(name) == CLOUD:
        return False
    level = provenance.get('privacy') if isinstance(provenance, dict) else None
    # Test fixtures and operators who want the old behavior can set this. It only ever applies to an arrival with no level.
    if level is None:
        from .uploads import settings
        level = os.environ.get('READER_UNMARKED_PRIVACY') or settings(root)['default_privacy']
    return level != NORMAL
