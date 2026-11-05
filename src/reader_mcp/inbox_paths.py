"""Where arrivals physically live. Everywhere else they keep their logical name, `inbox/<arrival>`.

Arrivals wait in the ignored `.reader/inbox/`, out of sight of Obsidian and Git. `READER_INBOX` names another vault-relative folder.
A vault's old `inbox/` folder still works as a drop box: anything left there, by a person or an older helper, is moved in the next time
arrivals are read. Moves are renames on one filesystem, and nothing is ever overwritten."""
import os
from pathlib import Path

DEFAULT = '.reader/inbox'
LEGACY = 'inbox'
PREFIX = 'inbox/'
KEEP = ('README.md', '.DS_Store')


def inbox_dir(root):
    return Path(root) / (os.environ.get('READER_INBOX') or DEFAULT)


def physical(root, logical):
    """The file or folder for `inbox/<...>`. Callers still check the logical path's shape."""
    return inbox_dir(root) / logical[len(PREFIX):]


def sweep(root):
    """Move everything from the old drop box in. Returns the names it couldn't move because that name is taken."""
    root = Path(root)
    target, legacy = inbox_dir(root), root / LEGACY
    if target == legacy or legacy.is_symlink() or not legacy.is_dir():
        return []
    if target.is_symlink():
        raise ValueError('The inbox must not be a symlink')
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    conflicts = []
    for entry in sorted(legacy.iterdir()):
        if entry.name in KEEP or entry.name.startswith('.delivery-') or entry.is_symlink():
            continue
        destination = target / entry.name
        if destination.exists() or destination.is_symlink():
            conflicts.append(entry.name)
            continue
        try:
            os.rename(entry, destination)
        except FileNotFoundError:
            pass  # Another reader of the inbox moved it first.
    return conflicts
