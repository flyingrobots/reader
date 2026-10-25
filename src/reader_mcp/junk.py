"""Operating-system metadata files that no Reader inventory treats as content.

Finder, Explorer and AppleDouble copies drop these into any folder they touch.
Every inventory (catalog, search, browse, maintenance, metadata validation and
the inbox) skips them so a browsed vault stays publishable.
"""

OS_JUNK_NAMES = frozenset({'.ds_store', 'thumbs.db', 'ehthumbs.db', 'desktop.ini'})


def os_junk(name):
    """True for an OS metadata file name: .DS_Store, Thumbs.db, desktop.ini or an AppleDouble ._* file."""
    return name.lower() in OS_JUNK_NAMES or name.startswith('._')
