"""Host paths as a browser may see them (#105).

The web API answers every allowed client, a tailnet browser included, so it never names the vault's
folder or the home folder. `shown` rewrites both inside text that has to carry paths (a transcript's
prompt and metadata, a companion's location or setup command): the vault becomes `<vault>` and the
home folder `~`. Locations elsewhere (`/opt/homebrew/bin`, `/usr/bin`) name no person and stay.
`resolve` turns such a display path back into a real one for a request from this Mac.
"""
import os
from pathlib import Path

VAULT = '<vault>'


def prefixes(root, home):
    """(text, replacement) pairs, longest first, so a vault inside the home folder becomes `<vault>`."""
    pairs = {}
    for value, mark in ((home, '~'), (root, VAULT)):
        if not value:
            continue
        for form in {str(value), os.path.realpath(value), str(Path(value).absolute())}:
            if form and form != os.sep:
                pairs[form.rstrip(os.sep)] = mark
    return sorted(pairs.items(), key=lambda pair: -len(pair[0]))


def shown(value, root, home=None):
    """`value` with the vault and home folders replaced, recursively through lists and dicts."""
    home = str(Path.home()) if home is None else home
    pairs = prefixes(root, home)

    def text(item):
        # Every occurrence, whole component or not: a prefix alone already names the folder.
        for prefix, mark in pairs:
            item = item.replace(prefix, mark)
        return item

    def walk(item):
        if isinstance(item, str):
            return text(item)
        if isinstance(item, dict):
            return {k: walk(v) for k, v in item.items()}
        if isinstance(item, (list, tuple)):
            return [walk(v) for v in item]
        return item
    return walk(value)


def resolve(value, root, home=None):
    """A path typed or shown in the browser, with `<vault>/` and `~/` expanded."""
    home = str(Path.home()) if home is None else home
    if value == VAULT or value.startswith(VAULT + '/'):
        return str(Path(root)) + value[len(VAULT):]
    if value == '~' or value.startswith('~/'):
        return home + value[1:]
    return value
