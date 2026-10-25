"""Build the Reader demo vault: public-domain texts and clearly fictional notes, voices and projects.

`build(root)` writes a complete, git-initialized vault whose dates are relative to the build day, so
the magazine always shows "this week" and editions, receipts and history look lived in. It only ever
writes into an empty directory or one that carries the demo marker (see `prepare`). Sources live next
to this module in `content/`; see `content/NOTICE.md` for provenance and licenses.
"""
from datetime import datetime, time, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
from uuid import NAMESPACE_URL, UUID, uuid5

CONTENT = Path(__file__).resolve().parent / 'content'
MARKER = '.reader-demo-vault'
MARKER_KIND = 'reader-demo-vault'
DEMO_VERSION = 1
FICTIONAL = 'Fictional: invented for the Reader demo'
GUT = 'https://www.gutenberg.org/ebooks/'
PEOPLE = {'editors': ('The Editors', 'editors@reader-demo.invalid'), 'mira': ('Mira Okafor', 'mira@reader-demo.invalid'),
          'jonah': ('Jonah Reyes', 'jonah@reader-demo.invalid'), 'archivist': ('Archivist', 'archivist@reader-demo.invalid')}
VOICE_LABEL = 'scripted demo voice (no AI)'

# key: (library path, title, author, year, ebook, project, type, topics, added offset, extra)
PD = {
    'thoreau-reading': ('walden/thoreau/reading.md', 'Reading', 'Henry David Thoreau', 1854, 205, 'Walden', 'Book chapter', ['Reading'], -10, {}),
    'thoreau-solitude': ('walden/thoreau/solitude.md', 'Solitude', 'Henry David Thoreau', 1854, 205, 'Walden', 'Book chapter', ['Solitude', 'Nature'], -8, {}),
    'thoreau-where-i-lived': ('walden/thoreau/where-i-lived.md', 'Where I Lived, and What I Lived For', 'Henry David Thoreau', 1854, 205, 'Walden', 'Essay',
                              ['Simplicity', 'Nature'], 0,
                              {'standfirst': 'Thoreau explains why he went to the woods, in the chapter that gave the world “Simplify, simplify.”'}),
    'emerson-self-reliance': ('walden/emerson/self-reliance.md', 'Self-Reliance', 'Ralph Waldo Emerson', 1841, 2944, 'Walden', 'Essay', ['Independence'], -8, {}),
    'emerson-circles': ('walden/emerson/circles.md', 'Circles', 'Ralph Waldo Emerson', 1841, 2944, 'Walden', 'Essay', ['Nature'], -12, {}),
    'montaigne-of-idleness': ('essayists/montaigne/of-idleness.md', 'Of Idleness', 'Michel de Montaigne', 1580, 3600, 'Essayists', 'Essay', ['Writing', 'Mind'], -13,
                              {'translator': 'Charles Cotton'}),
    'montaigne-of-solitude': ('essayists/montaigne/of-solitude.md', 'Of Solitude', 'Michel de Montaigne', 1580, 3600, 'Essayists', 'Essay', ['Solitude'], -7,
                              {'translator': 'Charles Cotton'}),
    'montaigne-of-books': ('essayists/montaigne/of-books.md', 'Of Books', 'Michel de Montaigne', 1580, 3600, 'Essayists', 'Essay', ['Reading', 'Memory'], 0,
                           {'translator': 'Charles Cotton', 'standfirst': 'Montaigne on the books he loves, the ones he cannot finish, and the notes he '
                                                                          'writes at the back so he will remember what he thought.'}),
    'bacon-of-studies': ('essayists/bacon/of-studies.md', 'Of Studies', 'Francis Bacon', 1625, 575, 'Essayists', 'Essay', ['Reading'], 1, {}),
    'bacon-of-truth': ('essayists/bacon/of-truth.md', 'Of Truth', 'Francis Bacon', 1625, 575, 'Essayists', 'Essay', ['Truth'], -13, {}),
    'woolf-common-reader': ('essayists/woolf/the-common-reader.md', 'The Common Reader', 'Virginia Woolf', 1925, 64457, 'Essayists', 'Essay', ['Reading'], -7, {}),
    'woolf-montaigne': ('essayists/woolf/montaigne.md', 'Montaigne', 'Virginia Woolf', 1925, 64457, 'Essayists', 'Essay', ['Essays', 'Mind'], -9, {}),
    'woolf-modern-fiction': ('essayists/woolf/modern-fiction.md', 'Modern Fiction', 'Virginia Woolf', 1925, 64457, 'Essayists', 'Essay', ['Fiction', 'Mind'], 4,
                             {'standfirst': 'Woolf asks the novel to look at an ordinary mind on an ordinary day, and to stop arranging life like a row of gig lamps.'}),
    'woolf-modern-essay': ('essayists/woolf/the-modern-essay.md', 'The Modern Essay', 'Virginia Woolf', 1925, 64457, 'Essayists', 'Essay', ['Essays'], -12, {}),
    'darwin-struggle': ('natural-history/darwin/struggle-for-existence.md', 'Struggle for Existence', 'Charles Darwin', 1859, 1228, 'Natural History', 'Book chapter',
                        ['Evolution'], 1,
                        {'standfirst': 'Darwin’s third chapter: why every species produces more young than can survive, and why that pressure is the engine '
                                       'of natural selection.'}),
    'darwin-recapitulation': ('natural-history/darwin/recapitulation.md', 'Recapitulation and Conclusion', 'Charles Darwin', 1859, 1228, 'Natural History',
                              'Book chapter', ['Evolution'], -8, {}),
    'babbage-analytical-engine': ('analytical-engine/babbage-analytical-engine.md', 'Of the Analytical Engine', 'Charles Babbage', 1864, 57532, 'Analytical Engine',
                                  'Book chapter', ['Computing history'], -8, {}),
    'lovelace-note-g': ('analytical-engine/lovelace-note-g.md', 'Note G', 'Ada Lovelace', 1843, 75107, 'Analytical Engine', 'Essay',
                        ['Computing history', 'Mathematics'], 1,
                        {'standfirst': 'The last of Lovelace’s notes to Menabrea’s Sketch: a caution against overrating the Engine, then a program for the '
                                       'Bernoulli numbers.',
                         'note': 'Excerpt: paragraphs of Note G; the original tables and typeset formulas are omitted.'}),
}

README = '''# Reader demo library

A small, disposable library for trying Reader. `reader demo` rebuilt it from scratch; run it again
to refresh the dates, or delete this folder when you are done. Nothing here is your data.

Every document is either in the public domain or invented for the demo:

- **Public domain:** excerpts from Thoreau, Emerson, Montaigne (tr. Charles Cotton), Bacon, Woolf,
  Darwin, Babbage and Lovelace, each with its Project Gutenberg eBook number and URL in its
  frontmatter, and Darwin's diagram from Wikimedia Commons.
- **Fictional:** the Lantern project, its people (Mira Okafor, Jonah Reyes), its numbers, the
  newsletter, and the voices Archivist, Architect, Plain Reader and Wren. Their documents say
  `rights: "Fictional: invented for the Reader demo"`.

NOTICE.md lists every source and license.

## Voices

The voices in chat are **scripted**: `bin/demo-voice` picks canned replies from
`bin/replies.json` and never calls a model. Wren is a manual voice: you paste Wren's replies by
hand. To talk to a real model, edit `voices.json` and point a voice at an installed agent CLI
(for example `claude` or `codex`); see "Voice registry" in Reader's docs/web.md.
'''

AGENTS = '''# Demo library instructions

This vault is a demo. Its voices are fictional and their replies are scripted.

## Multiple voices

- **Archivist (Curator):**
  - **Identity:** `Archivist`.
  - **Focus:** provenance, editions and what a margin owes the text.

- **Architect (Systems):**
  - **Identity:** `Architect`.
  - **Focus:** what can be retried by a machine and what must come back to a person.

- **Plain Reader (Reader's advocate):**
  - **Identity:** `Plain Reader`.
  - **Focus:** opinion first, coverage stated, one claim checked.

- **Wren (Guest reader):**
  - **Identity:** `Wren`. Replies are pasted by hand.

### Invariants between voices

1. Read freely, write only in your own namespace.
'''


def rid(*parts):
    return str(uuid5(NAMESPACE_URL, 'reader-demo/' + '/'.join(parts)))


def marker_info(root):
    """The parsed marker of a demo vault, or None when `root` does not carry one."""
    file = Path(root) / MARKER
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 4096:
        return None
    try:
        data = json.loads(file.read_text())
    except (ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) and data.get('kind') == MARKER_KIND else None


def check(root):
    """Return the absolute demo path if a build may write there, else raise ValueError. Writes nothing.

    Allowed: a path that does not exist yet, an empty directory, or a directory carrying a valid demo
    marker. A symlink, a file, or a non-empty directory without the marker is refused."""
    root = Path(root).expanduser()
    if not root.is_absolute():
        root = Path.cwd() / root
    if root.is_symlink():
        raise ValueError(f'{root} is a symlink; choose a real directory for the demo')
    if root.exists():
        if not root.is_dir():
            raise ValueError(f'{root} exists and is not a directory')
        if not marker_info(root) and any(root.iterdir()):
            raise ValueError(f'{root} is not empty and is not a Reader demo vault (no {MARKER}); refusing to touch it')
    return root


def prepare(root):
    """Make `root` ready for a fresh build (see `check`), or refuse without touching it.

    A refresh removes everything except the marker and downloaded embedding models (`.reader/models`)."""
    root = check(root)
    if root.exists():
        for child in list(root.iterdir()):
            if child.name == MARKER:
                continue
            if child.name == '.reader' and child.is_dir() and not child.is_symlink():
                for inner in list(child.iterdir()):
                    if inner.name != 'models':
                        remove(inner)
                continue
            remove(child)
    root.mkdir(parents=True, exist_ok=True)
    return root


def remove(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink()


def yaml_value(key, value):
    if isinstance(value, list):
        return f'{key}:\n' + ''.join(f'  - {json.dumps(v, ensure_ascii=False)}\n' for v in value)
    return f'{key}: {json.dumps(value, ensure_ascii=False)}\n'


class Builder:
    def __init__(self, root, today=None, now=None):
        self.root = Path(root)
        self.now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
        self.today = today or datetime.now().date()  # the reader's local calendar day
        self.base = self.today - timedelta(days=5)  # "MON" in the sources: five days before today
        self.weekstart = self.today - timedelta(days=self.today.weekday())
        self.git_env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')} | {
            'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_TERMINAL_PROMPT': '0'}

    # dates ------------------------------------------------------------
    def day(self, offset):
        return (self.base + timedelta(days=offset)).isoformat()

    def when(self, offset, hour=9, minute=0):
        """A UTC instant `offset` days after the base day, never later than five minutes ago."""
        t = datetime.combine(self.base + timedelta(days=offset), time(hour, minute), timezone.utc)
        return min(t, self.now - timedelta(minutes=5))

    def fill(self, text):
        text = text.replace('@@WEEKSTART@@', self.weekstart.isoformat()).replace('@@WEEKEND@@', (self.weekstart + timedelta(days=6)).isoformat())
        text = re.sub(r'@@MON([+-]\d+)@@', lambda m: self.day(int(m.group(1))), text)
        # Reader frontmatter wants block lists.
        return re.sub(r'^(\w+): \[(.*)\]$', lambda m: m.group(1) + ':\n' + ''.join(f'  - {v.strip()}\n' for v in m.group(2).split(',')).rstrip('\n'),
                      text, flags=re.M)

    # git --------------------------------------------------------------
    def git(self, *args, at=None, who='editors'):
        name, email = PEOPLE[who]
        env = self.git_env | {'GIT_AUTHOR_NAME': name, 'GIT_AUTHOR_EMAIL': email, 'GIT_COMMITTER_NAME': name, 'GIT_COMMITTER_EMAIL': email}
        if at:
            env |= {'GIT_AUTHOR_DATE': at.isoformat(), 'GIT_COMMITTER_DATE': at.isoformat()}
        return subprocess.run(['git', '-C', str(self.root), *args], env=env, check=True, capture_output=True, text=True).stdout

    def commit(self, message, at, who='editors', paths=('-A',)):
        self.git('add', *paths)
        self.git('commit', '-q', '--no-verify', '-m', message, at=at, who=who)

    # documents ----------------------------------------------------------
    def put(self, rel, text):
        if rel.endswith('.md') and text.startswith('---\n') and 'document_id:' not in text.split('\n---\n')[0]:
            added = re.search(r"^added: '?([0-9-]{10})", text, re.M)
            extra = (f"document_id: {rid('doc', 'library/' + rel)}\ndocument_path: library/{rel}\n"
                     f"metadata_created: '{added.group(1) if added else self.day(0)}'\n")
            head, sep, body = text[4:].partition('\n---\n')
            text = '---\n' + head + '\n' + extra.rstrip('\n') + sep + body
        file = self.root / 'library' / rel
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)
        return 'library/' + rel

    def src(self, rel):
        """An invented document from content/library, dated and marked fictional."""
        text = self.fill((CONTENT / 'library' / rel).read_text())
        head = text.split('\n---\n')[0]
        extra = ''
        if 'frontmatter_schema_version' not in head:
            extra += 'frontmatter_schema_version: 1\ndocument_revision: 1\n'
        if 'rights:' not in head:
            extra += f'rights: {json.dumps(FICTIONAL)}\n'
        return text.replace('---\n', '---\n' + extra, 1)

    def pd_text(self, key):
        path, title, author, year, ebook, project, kind, topics, added, extra = PD[key]
        meta = {'frontmatter_schema_version': 1, 'document_revision': 1, 'title': title, 'author': author, 'published': str(year),
                'source': f'Project Gutenberg eBook #{ebook}', 'source_url': f'{GUT}{ebook}', 'rights': 'Public domain (Project Gutenberg)',
                'project': project, 'type': kind, 'topics': topics, 'added': self.day(added)}
        meta |= extra
        meta |= {'document_id': rid('doc', 'library/' + path), 'document_path': 'library/' + path, 'metadata_created': self.day(added)}
        head = '---\n' + ''.join(yaml_value(k, v) for k, v in meta.items()) + '---\n\n'
        return head + f'# {title}\n\n' + (CONTENT / 'texts' / (key + '.md')).read_text()

    def place(self, *keys):
        return [self.put(PD[k][0], self.pd_text(k)) for k in keys]

    def sidecar(self, rel, title, kind, author, project, added, note, rights):
        file = self.root / 'catalog/metadata' / (rel + '.md')
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(f"""---
frontmatter_schema_version: 1
document_revision: 1
title: {json.dumps(title)}
type: {kind}
author: {author}
project: {project}
rights: {json.dumps(rights)}
added: '{self.day(added)}'
document_path: library/{rel}
document_id: {rid('doc', rel)}
metadata_created: '{self.day(added)}'
---

# {title}

{note}

![[library/{rel}]]
""")

    # receipts and margins -------------------------------------------------
    def read(self, name, paths, at):
        paths = [paths] if isinstance(paths, str) else paths
        items = [self.engagement.document(p) for p in paths]
        self.engagement.seen(name, items)
        file = self.root / 'engagement' / (hashlib.sha256(name.encode()).hexdigest() + '.json')
        record = json.loads(file.read_text())
        for item in items:
            record['items'][item['key']]['at'] = at.isoformat()
        file.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')

    def mark(self, path, quote, owner, at, comment='', kind='highlight', replies=()):
        text = (self.root / path).read_text()
        start = text.index(quote)
        thread = self.annotations.create(path=path, start=start, end=start + len(quote), owner=owner, comment=comment, kind=kind,
                                         request_id=rid('thread', path, quote, owner))
        file = self.root / 'annotations' / (thread['id'] + '.json')
        data = json.loads(file.read_text())
        data['created_at'] = at.isoformat()
        for row in data['comments']:  # the opening comment gets a stable id, so a refresh is byte-identical
            row.update(created_at=at.isoformat(), id=rid('comment', thread['id']))
        file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        for i, (author, body, later) in enumerate(replies):
            self.annotations.reply(thread['id'], author, body, request_id=rid('reply', thread['id'], str(i)))
            data = json.loads(file.read_text())
            data['comments'][-1]['created_at'] = (at + timedelta(hours=later)).isoformat()
            file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        return thread['id']

    # the build ----------------------------------------------------------
    def scaffold(self):
        root = self.root
        self.git('init', '-q')
        self.git('symbolic-ref', 'HEAD', 'refs/heads/main')
        for key, value in (('user.name', 'Reader Demo'), ('user.email', 'demo@reader-demo.invalid'), ('commit.gpgsign', 'false'),
                           ('core.hooksPath', os.devnull)):
            self.git('config', key, value)
        for name in ('library', 'inbox', 'indexes', 'bin'):
            (root / name).mkdir(exist_ok=True)
        (root / MARKER).write_text(json.dumps({'kind': MARKER_KIND, 'version': DEMO_VERSION, 'built': self.today.isoformat(),
                                               'note': 'Created by `reader demo`. This folder is disposable: `reader demo` rebuilds it.'}, indent=2) + '\n')
        (root / '.gitignore').write_text('.reader/\n.DS_Store\n')
        (root / 'inbox/README.md').write_text('# Inbox\n\nDrop documents here, or deliver them with `reader ingest`. The librarian files them.\n')
        (root / 'indexes/settings.json').write_text(json.dumps({'navigation_author': 'Reader demo', 'author_aliases': {}, 'topics': [], 'projects': []}, indent=2) + '\n')
        (root / 'README.md').write_text(README)
        (root / 'AGENTS.md').write_text(AGENTS)
        shutil.copy(CONTENT / 'NOTICE.md', root / 'NOTICE.md')
        shutil.copy(CONTENT / 'voice/demo-voice.py', root / 'bin/demo-voice.py')
        shutil.copy(CONTENT / 'voice/replies.json', root / 'bin/replies.json')
        wrapper = root / 'bin/demo-voice'
        # A shell wrapper keeps the runtime label "demo-voice" and survives interpreter paths with spaces.
        wrapper.write_text('#!/bin/sh\n# Scripted Reader demo voice: canned replies, no model.\n'
                           f'exec {shlex.quote(sys.executable)} "$(dirname "$0")/demo-voice.py" "$@"\n')
        wrapper.chmod(0o755)
        exe = str(wrapper)
        persona = lambda label: {'agents_md_section': [label, 'Invariants between voices']}
        (root / 'voices.json').write_text(json.dumps({'schema_version': 1, 'timeout_seconds': 60, 'voices': [
            {'name': 'Archivist', 'mention': ['archivist'], 'cli': exe, 'stream': 'codex', 'model': VOICE_LABEL,
             'argv': ['--style', 'codex', '--name', 'Archivist', '--output-last-message', '{last_message}', '-'], 'persona': persona('Archivist (Curator)')},
            {'name': 'Architect', 'mention': ['architect'], 'cli': exe, 'stream': 'claude', 'model': VOICE_LABEL,
             'argv': ['--style', 'claude', '--name', 'Architect', '--prompt', '{prompt}'], 'persona': persona('Architect (Systems)')},
            {'name': 'Plain Reader', 'mention': ['plain', 'plainreader'], 'cli': exe, 'stream': 'claude', 'model': VOICE_LABEL,
             'argv': ['--style', 'claude', '--name', 'Plain Reader', '--persona', '{persona}'], 'persona': persona("Plain Reader (Reader's advocate)")},
            {'name': 'Wren', 'mention': ['wren'], 'cli': None, 'manual': True},
        ]}, indent=2) + '\n')

    def run(self):
        from ..annotations import Annotations
        from ..engagement import Engagement
        self.scaffold()
        self.engagement, self.annotations = Engagement(self.root), Annotations(self.root)
        self.timeline()
        self.activity()
        self.commit('Record reading receipts, margins, a chat and the reading queue', self.when(5, 8))
        self.arrivals()
        from ..browse import Browse
        from ..catalog import Catalog
        Browse(self.root).run(today=self.today)
        Catalog(self.root).run('sync')
        self.commit('Refresh browse indexes and the catalog', self.now - timedelta(minutes=4), paths=('indexes', 'README.md', 'catalog'))
        return self.root

    def timeline(self):
        put, src, place, commit, when, read, mark, day = self.put, self.src, self.place, self.commit, self.when, self.read, self.mark, self.day
        root = self.root
        # Week -2: the first shelf.
        place('montaigne-of-idleness', 'bacon-of-truth', 'emerson-circles', 'woolf-modern-essay')
        put('lantern/guides/keyboard-reading.md', src('lantern/guides/keyboard-reading.md'))
        commit('File the first shelf: Montaigne, Bacon, Emerson and Woolf', when(-13, 10))
        place('thoreau-reading')
        pdf = root / 'library/lantern/reports/lantern-0.9-field-report.pdf'
        pdf.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(CONTENT / 'assets/lantern-0.9-field-report.pdf', pdf)
        self.sidecar('lantern/reports/lantern-0.9-field-report.pdf', 'Lantern 0.9 in the field', 'Report', 'Mira Okafor', 'Lantern', -12,
                     'Catalog note for the six-week field report (PDF, 3 pages).', FICTIONAL)
        self.sidecar('lantern/logs/sync-dry-run.log', 'Sync dry run on the old laptop', 'Log', 'Jonah Reyes', 'Lantern', -12,
                     'Machine log from a dry-run catch-up.', FICTIONAL)
        stamp = day(2)
        log = put('lantern/logs/sync-dry-run.log', f'''{stamp}T08:14:02Z INFO  lantern.sync  device=old-laptop since={day(-39)} mode=dry-run
{stamp}T08:14:02Z INFO  lantern.sync  heads local=3 remote=5 common_ancestor=41ab9c2e
{stamp}T08:14:03Z INFO  lantern.sync  missing events: 3208 (highlight 2711, comment 402, resolve 61, position 34)
{stamp}T08:14:05Z INFO  lantern.anchor re-anchoring 2711 highlights against current editions
{stamp}T08:14:13Z WARN  lantern.anchor orphaned 31 anchors in library/essays/rewritten-introduction.md (quotes kept)
{stamp}T08:14:13Z INFO  lantern.anchor exact 2589 · relocated 91 · orphaned 31
{stamp}T08:14:14Z INFO  lantern.sync  dry run complete in 11.4s; nothing written
''')
        commit('Add Thoreau on reading, the Lantern 0.9 field report and a sync dry-run log', when(-12, 15), who='mira')
        read('You', ['library/lantern/guides/keyboard-reading.md'], when(-12, 20))
        read('You', ['library/walden/thoreau/reading.md'], when(-11, 21, 30))
        read('You', ['library/essayists/woolf/the-modern-essay.md'], when(-10, 22))
        read('Archivist', ['library/essayists/montaigne/of-idleness.md', 'library/essayists/bacon/of-truth.md', 'library/walden/emerson/circles.md',
                           'library/essayists/woolf/the-modern-essay.md', 'library/walden/thoreau/reading.md'], when(-12, 9))
        read('intake-runner', ['library/lantern/reports/lantern-0.9-field-report.pdf', log], when(-12, 15, 5))

        # Week -1.
        place('woolf-montaigne', 'woolf-common-reader', 'montaigne-of-solitude', 'thoreau-solitude', 'emerson-self-reliance',
              'babbage-analytical-engine', 'darwin-recapitulation')
        put('natural-history/darwin/the-only-figure.md', src('natural-history/the-only-figure.md'))
        shutil.copy(CONTENT / 'assets/darwin-diagram.png', root / 'library/natural-history/darwin/darwin-diagram.png')
        self.sidecar('natural-history/darwin/darwin-diagram.png', 'Darwin’s diagram of divergence (1859)', 'Image', 'Charles Darwin', 'Natural History', -8,
                     'The only figure in On the Origin of Species. Public domain, via Wikimedia Commons: '
                     'https://commons.wikimedia.org/wiki/File:Origin_of_Species_illustration_cropped.png', 'Public domain (Wikimedia Commons)')
        commit('File Woolf, Montaigne, Thoreau, Emerson, Babbage and Darwin', when(-8, 11))
        design = 'library/lantern/design/sync-design.md'
        v1a = src('lantern/design/sync-design.v1a.md')
        put('lantern/design/sync-design.md', v1a)
        commit('Lantern: sync design, first draft', when(-6, 14, 20), who='mira')
        read('You', design, when(-5, 21, 10))
        read('Archivist', design, when(-5, 10))
        read('Architect', design, when(-6, 16))
        mark(design, 'Retries continue until the relay answers.', 'Architect', when(-6, 16, 30), kind='warning',
             comment='No upper bound. A phone left in a drawer wakes every fifteen minutes forever; cap the attempts or the total time.',
             replies=[('You', 'Agreed. Capping in the next draft.', 20)])
        mark(design, 'A reading position is the only value that is allowed to be overwritten.', 'You', when(-5, 21, 20),
             comment='The one rule worth remembering from the whole proposal.')
        mark(design, 'Highlights and comments never conflict', 'Archivist', when(-5, 10, 30),
             comment='Provided each event keeps the edition it was written against. Otherwise "never conflict" becomes "never explainable".',
             replies=[('Architect', 'The `edition` field is in the data model; I will make it mandatory.', 5)])
        put('lantern/decisions/adr-007.md', src('lantern/decisions/adr-007.md'))
        commit('Lantern: ADR-007, content-addressed highlights', when(-5, 9, 40), who='jonah')
        put('reading-room/solitude-twice.md', src('reading-room/solitude-twice.md'))
        commit('Archivist: connection between two essays on solitude', when(-4, 18), who='archivist')
        read('You', ['library/lantern/decisions/adr-007.md'], when(-4, 20))
        read('You', ['library/essayists/woolf/the-common-reader.md', 'library/essayists/montaigne/of-solitude.md'], when(-3, 21, 45))
        read('You', ['library/natural-history/darwin/the-only-figure.md'], when(-2, 22, 15))
        read('You', ['library/reading-room/solitude-twice.md'], when(-3, 22, 5))
        read('Archivist', ['library/essayists/woolf/montaigne.md', 'library/essayists/woolf/the-common-reader.md', 'library/essayists/montaigne/of-solitude.md',
                           'library/walden/thoreau/solitude.md', 'library/walden/emerson/self-reliance.md', 'library/analytical-engine/babbage-analytical-engine.md',
                           'library/natural-history/darwin/recapitulation.md', 'library/natural-history/darwin/the-only-figure.md',
                           'library/lantern/decisions/adr-007.md', 'library/reading-room/solitude-twice.md'], when(-4, 9))
        read('Architect', ['library/lantern/decisions/adr-007.md', 'library/analytical-engine/babbage-analytical-engine.md'], when(-4, 14))
        read('Wren', ['library/walden/thoreau/solitude.md', 'library/reading-room/solitude-twice.md'], when(-3, 19))
        mark('library/essayists/woolf/the-common-reader.md', 'He reads for his own pleasure rather than to impart knowledge or correct the opinions of others.',
             'Archivist', when(-4, 9, 20), comment='The whole case for a personal library, in one sentence.',
             replies=[('You', 'And the next sentence is the case for margins: "some kind of whole."', 36)])
        mark('library/walden/thoreau/solitude.md', 'I have a great deal of company in my house; especially in the morning, when nobody calls.',
             'Wren', when(-3, 19, 10), comment='The best joke in Walden.')

        # Revised draft: the retry loop gets its cap, so the Architect's warning loses its passage.
        v1b = (v1a.replace('Retries continue until the relay answers.',
                           'After 96 attempts (about a day) the device stops retrying until the reader opens Lantern again.')
                  .replace('- Two devices that annotate the same passage while apart both keep their work.\n',
                           '- Two devices that annotate the same passage while apart both keep their work, and each keeps the edition it was written against.\n')
                  .replace('| Event file corrupted | Hash mismatch | Refetch by id from any peer |\n',
                           '| Event file corrupted | Hash mismatch | Refetch by id from any peer |\n| Device away for months | Relay no longer holds its events | '
                           'Full catch-up from a peer |\n')
                  .replace('- A hosted service. A relay may forward bytes, but it never needs to understand them.\n',
                           '- A hosted service. A relay may forward and briefly keep bytes, but it never needs to understand them.\n')
                  .replace('      attempt += 1;\n      await sleep(backoff(attempt));',
                           '      attempt += 1;\n      if (attempt > MAX_ATTEMPTS) return device.sleepUntilOpened();\n      await sleep(backoff(attempt));'))
        put('lantern/design/sync-design.md', v1b)
        commit('Lantern sync: cap retries, keep editions with events', when(-2, 17, 5), who='mira')
        read('Architect', design, when(-2, 18))
        read('Plain Reader', ['library/essayists/woolf/the-common-reader.md'], when(-3, 12))

        # This week.
        place('thoreau-where-i-lived', 'montaigne-of-books')
        self.journal = journal = f'library/lantern/journal/week-{self.base.isocalendar()[1]:02d}.md'
        journal_rel = journal[len('library/'):]
        journal_full = src('lantern/journal/week.md')
        put(journal_rel, journal_full.split('\n## Tuesday')[0] + '\n')
        commit('File Thoreau and Montaigne; start the Lantern journal', when(0, 9, 30))
        read('You', [journal], when(0, 22))
        place('darwin-struggle', 'lovelace-note-g', 'bacon-of-studies')
        note_g = 'library/analytical-engine/lovelace-note-g.md'
        copy_text = re.sub(r'^(document_id|document_path|metadata_created): .*\n', '', (root / note_g).read_text(), flags=re.M).replace(
            '---\n', '---\nkind: reading-copy\nreading_source: library/analytical-engine/lovelace-note-g.md\n', 1)
        put('analytical-engine/lovelace-note-g.reading.md', copy_text)
        put('analytical-engine/reading-note-g.md', src('analytical-engine/reading-note-g.md'))
        put(journal_rel, journal_full.split('\n## Wednesday')[0] + '\n')
        commit('File Note G with a reading copy, Darwin and Bacon; Plain Reader notes on Note G', when(1, 11))
        put('lantern/research/spaced-rereading.md', src('lantern/research/spaced-rereading.md'))
        put(journal_rel, journal_full)
        commit('Lantern: spaced re-reading model; journal for Wednesday', when(2, 16), who='mira')
        v2 = (v1b.replace('title: "Lantern sync: how highlights travel between devices"', 'title: "Lantern sync: how highlights travel between devices (v2)"')
                 .replace('document_revision: 1\n', 'document_revision: 2\nprevious_version: sync-design.md\n')
                 .replace("added: '" + day(-6) + "'", "added: '" + day(3) + "'")
                 .replace('## Summary\n\n', '## Summary\n\n*Revised after review: retries are capped, events keep their edition, and the relay keeps events '
                                            'for thirty days.*\n\n')
                 .replace('## Failure modes', '### Relay retention\n\nThe relay keeps encrypted events for thirty days by default, configurable with a '
                                              'seven-day floor. That covers every absence measured in the 0.9 field trial except one, and a device away longer '
                                              'falls back to a full catch-up from a peer.\n\n| Setting | Default | Floor |\n| --- | --- | --- |\n'
                                              '| `relay.retention_days` | 30 | 7 |\n| `sync.max_attempts` | 96 | 1 |\n\n## Failure modes')
                 .replace('- Should the relay keep events at all, or only forward them while both devices are online?\n', ''))
        put('lantern/design/sync-design.v2.md', v2)
        put('reading-room/on-keeping-the-margins.md', src('reading-room/on-keeping-the-margins.md'))
        commit('Lantern sync design v2; Archivist essay on keeping the margins', when(3, 10), who='mira')
        put('reading-room/the-engine-and-the-essay.md', src('reading-room/the-engine-and-the-essay.md'))
        put('reading-room/what-note-g-costs.md', src('reading-room/what-note-g-costs.md'))
        place('woolf-modern-fiction')
        commit('File Woolf’s Modern Fiction; an Architect perspective and a Plain Reader aside', when(4, 7, 45))
        put(f'newsletters/{self.weekstart.isoformat()}-weekly.md', src('newsletters/weekly.md'))
        commit('The Weekly: margins, engines and the ordinary mind', when(5, 7, 30))

        # Receipts and margins for this week.
        read('You', ['library/walden/thoreau/where-i-lived.md'], when(2, 21, 30))
        read('You', ['library/analytical-engine/reading-note-g.md'], when(3, 20, 40))
        read('Archivist', ['library/essayists/woolf/modern-fiction.md', 'library/walden/thoreau/where-i-lived.md', 'library/essayists/montaigne/of-books.md',
                           note_g, 'library/analytical-engine/reading-note-g.md', 'library/lantern/design/sync-design.v2.md',
                           'library/reading-room/the-engine-and-the-essay.md', journal, 'library/lantern/research/spaced-rereading.md'], when(4, 8, 15))
        read('Architect', [note_g, 'library/lantern/design/sync-design.v2.md', 'library/reading-room/on-keeping-the-margins.md', journal,
                           'library/lantern/research/spaced-rereading.md'], when(3, 13))
        read('Plain Reader', ['library/essayists/woolf/modern-fiction.md', note_g, 'library/analytical-engine/reading-note-g.md',
                              'library/reading-room/what-note-g-costs.md'], when(4, 12, 30))
        read('Wren', ['library/essayists/woolf/modern-fiction.md'], when(4, 21))
        read('link-checker', ['library/reading-room/on-keeping-the-margins.md', 'library/reading-room/the-engine-and-the-essay.md'], when(4, 15, 10))
        read('intake-runner', ['library/analytical-engine/lovelace-note-g.reading.md'], when(1, 11, 5))
        where = 'library/walden/thoreau/where-i-lived.md'
        mark(where, 'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what '
                    'it had to teach', 'You', when(2, 21, 40), comment='The sentence everyone quotes. Read on to the next one.',
             replies=[('Archivist', 'The next one is the argument: "I wanted to live deep and suck out all the marrow of life."', 14),
                      ('Plain Reader', 'Checked: both sentences are in this chapter, in the same paragraph.', 30)])
        mark(where, 'Simplify, simplify.', 'Archivist', when(4, 8, 30), comment='Two words, and he still repeats one.')
        mark(where, 'Time is but the stream I go a-fishing in.', 'Wren', when(4, 21, 20))
        books = 'library/essayists/montaigne/of-books.md'
        mark(books, 'I have adopted a custom of late, to note at the end of every book', 'Archivist', when(4, 8, 40),
             comment='The origin of the margin as a second memory. See the essay on keeping the margins.',
             replies=[('Architect', 'Also a cache with a write-once policy.', 6)])
        mark(note_g, 'It is desirable to guard against the possibility of exaggerated ideas that might arise as to the powers of the Analytical Engine.',
             'Plain Reader', when(4, 12, 40),
             comment='The note opens with a caution, not a boast. Worth remembering when the famous line is quoted alone.')
        mark(note_g, 'It can arbitrarily substitute any formula for any other; effacing the first from the columns on which it is represented, and making '
                     'the second appear in its stead.', 'Architect', when(3, 13, 20),
             comment='Replace, not merge: the Engine has no history. A sync engine has to do the opposite.')
        mark('library/analytical-engine/reading-note-g.md', 'In the published table, operation 4 divides', 'Archivist', when(4, 9), kind='warning',
             comment='Check this against a facsimile of the 1843 printing before repeating it. Our excerpt omits the table, so the operation number cannot '
                     'be verified from this library.')
        fiction = 'library/essayists/woolf/modern-fiction.md'
        mark(fiction, 'Examine for a moment an ordinary mind on an ordinary day.', 'Plain Reader', when(4, 12, 50),
             comment='If you read one paragraph, read this one.')
        mark(fiction, 'Life is not a series of gig lamps symmetrically arranged', 'Wren', when(4, 21, 10),
             replies=[('Archivist', 'Gig lamps: the paired lamps on a light carriage. The image is exactness without depth.', 11)])
        mark('library/lantern/research/spaced-rereading.md', 'A review at the edge of forgetting is worth more than one made the next morning.', 'Architect',
             when(3, 13, 40), comment='Then the scheduler should prefer passages the reader is about to lose, not the newest ones.')
        mark('library/lantern/design/sync-design.v2.md', 'The relay keeps encrypted events for thirty days by default', 'Archivist', when(4, 8, 20),
             comment='Thirty days covers the field trial. What happens to the edition hashes after that?')

    def activity(self):
        """Reading queue, history, bookmarks and one finished chat."""
        from ..bookmarks import Bookmarks
        from ..web import WebLibrary
        root, when = self.root, self.when
        where, books = 'library/walden/thoreau/where-i-lived.md', 'library/essayists/montaigne/of-books.md'
        library = WebLibrary(root)
        try:
            for path in ['library/lantern/research/spaced-rereading.md', 'library/natural-history/darwin/struggle-for-existence.md',
                         'library/essayists/woolf/montaigne.md']:
                library.queue.change('You', 'add', path, request_id=rid('queue', path))
            library.queue.change('You', 'add', 'library/reading-room/the-engine-and-the-essay.md', request_id=rid('queue', 'architect'),
                                 added_by='Architect', reason='Read this beside the sync design: it is the boundary argument in one page.')
            library.queue.change('You', 'add', books, request_id=rid('queue', 'archivist'), added_by='Archivist',
                                 reason='Montaigne’s margins, before the essay on keeping them.')
            opens = [('library/lantern/guides/keyboard-reading.md', when(-12, 20)), ('library/walden/thoreau/reading.md', when(-11, 21, 30)),
                     ('library/essayists/woolf/the-modern-essay.md', when(-10, 22)), ('library/lantern/decisions/adr-007.md', when(-4, 20)),
                     ('library/essayists/woolf/the-common-reader.md', when(-3, 21, 45)), ('library/essayists/montaigne/of-solitude.md', when(-3, 21, 50)),
                     ('library/reading-room/solitude-twice.md', when(-3, 22, 5)), ('library/natural-history/darwin/the-only-figure.md', when(-2, 22, 15)),
                     ('library/natural-history/darwin/recapitulation.md', when(-2, 22, 30)), (self.journal, when(0, 22)), (where, when(2, 21, 30)),
                     ('library/analytical-engine/reading-note-g.md', when(3, 20, 40)),
                     ('library/lantern/reports/lantern-0.9-field-report.pdf', when(4, 22, 10))]
            for path, _ in opens:
                library.queue.opened('You', path, hashlib.sha256((root / path).read_bytes()).hexdigest())
            history = next((root / 'history').glob('*.jsonl'))
            rows = [json.loads(line) for line in history.read_text().splitlines()]
            for row, (_, at) in zip(rows, opens):
                row['at'] = at.isoformat()
            history.write_text(''.join(json.dumps(r) + '\n' for r in rows))
            marks = Bookmarks(root)
            for path, progress in [('library/natural-history/darwin/recapitulation.md', 0.62), (where, 0.41), ('library/walden/thoreau/reading.md', 1.0),
                                   ('library/essayists/woolf/the-common-reader.md', 1.0), ('library/lantern/decisions/adr-007.md', 1.0),
                                   ('library/essayists/montaigne/of-solitude.md', 0.27), ('library/analytical-engine/reading-note-g.md', 0.88),
                                   ('library/essayists/woolf/the-modern-essay.md', 0.55)]:
                marks.save('You', path, hashlib.sha256((root / path).read_bytes()).hexdigest(), progress)
        finally:
            library.close()
        self.chat()

    def chat(self):
        """A short, finished chat about the sync design, so the chat panel has history before you type."""
        from ..chats import Chats
        path = 'library/lantern/design/sync-design.v2.md'
        data = (self.root / path).read_bytes()
        title = 'Lantern sync: how highlights travel between devices (v2)'
        replies = json.loads((CONTENT / 'voice/replies.json').read_text())
        architect = next(r['reply'] for r in replies['replies']['Architect'] if 'thirty' in '|'.join(r.get('match', [])))
        archivist = replies['chime']['Archivist'][0]['reply']
        chats = Chats(self.root)
        chat = chats.create(path, hashlib.sha256(data).hexdigest(), title, 'You', request_id=rid('chat', path))
        asked, answered, hand = rid('chat', 'asked'), rid('chat', 'answered'), rid('chat', 'hand')
        at = lambda minutes: (self.when(4, 20) + timedelta(minutes=minutes)).isoformat()
        runtime = lambda session: {'cli': 'demo-voice', 'version': 'demo-voice 1.0 (scripted replies)', 'model': VOICE_LABEL, 'session_id': session}
        turn = lambda id, seconds: {'id': id, 'state': 'done', 'seconds': seconds, 'changed_paths': [], 'changes_tracked': True, 'commits': [],
                                    'commit': None, 'exit_code': 0, 'timeout_seconds': 60}
        messages = [
            {'id': asked, 'author': 'You', 'body': '@architect is thirty-day relay retention the right default, or should it be configurable?',
             'mentions': ['Architect'], 'reply_to': None, 'runtime': None, 'routing': {'voices': ['Architect'], 'chosen_by': 'mention'}, 'created_at': at(0)},
            {'id': answered, 'author': 'Architect', 'body': architect, 'mentions': [], 'reply_to': asked, 'chosen_by': 'mention', 'root': asked,
             'runtime': runtime('demo-architect'), 'turn': turn(answered, 1.6), 'created_at': at(1)},
            {'id': hand, 'author': 'Archivist', 'kind': 'hand', 'state': 'accepted', 'reply_to': answered, 'root': asked, 'mentions': [],
             'body': 'Retention is also a provenance question: orphaned notes need the edition they were written against.',
             'reason': 'Retention is also a provenance question: orphaned notes need the edition they were written against.',
             'decided_at': at(2), 'decided_by': 'You', 'created_at': at(1)},
            {'id': rid('chat', 'chime'), 'author': 'Archivist', 'kind': 'chime_in', 'body': archivist, 'mentions': [], 'reply_to': answered, 'root': asked,
             'chosen_by': 'hand', 'hand_id': hand, 'reason': 'Retention is also a provenance question: orphaned notes need the edition they were written against.',
             'runtime': runtime('demo-archivist'), 'turn': turn(rid('chat', 'chime'), 0.4), 'created_at': at(3)},
        ]
        for message in messages:
            chats.append(chat['id'], message)
        file = chats.file(chat['id'])
        stored = json.loads(file.read_text())
        stored['created_at'] = at(0)
        file.write_text(json.dumps(stored, ensure_ascii=False, indent=2) + '\n')

    def arrivals(self):
        """Three uncommitted inbox arrivals for Behind the scenes."""
        from ..store import Store, Submission
        store = Store(self.root)
        staging = self.root / '.reader/demo-staging'
        staging.mkdir(parents=True, exist_ok=True)
        bench = staging / 'catch-up.csv'
        bench.write_text('offline_days,events_missing,network_s,reanchor_s\n0.1,14,0.2,0.1\n9,412,0.7,1.2\n41,3208,2.5,8.9\n')
        store.ingest(Submission(request_id=UUID(rid('inbox', 'bench')), title='Lantern 0.9.1 catch-up benchmark', filename='catch-up-benchmark.md',
                                markdown=f'''---
title: Lantern 0.9.1 catch-up benchmark
author: Jonah Reyes
project: Lantern
type: Report
rights: "{FICTIONAL}"
---

# Lantern 0.9.1 catch-up benchmark

Catch-up after time offline, split into transfer and re-anchoring. Raw rows are in [catch-up.csv](catch-up.csv).

| Offline | Events | Network | Re-anchoring |
| --- | --- | --- | --- |
| 2 hours | 14 | 0.2 s | 0.1 s |
| 9 days | 412 | 0.7 s | 1.2 s |
| 41 days | 3,208 | 2.5 s | 8.9 s |

Re-anchoring is three quarters of the longest catch-up. The next release should index quotes per edition.
''', attachments=[{'source_path': str(bench), 'path': 'catch-up.csv'}],
            provenance={'author': 'Jonah Reyes', 'project': 'Lantern', 'source': 'lantern-ci benchmark job (fictional)', 'report_date': self.today.isoformat()}))
        gardens = ('---\ntitle: "Of Gardens"\nauthor: "Francis Bacon"\npublished: "1625"\nsource: "Project Gutenberg eBook #575"\n'
                   f'source_url: "{GUT}575"\nrights: "Public domain (Project Gutenberg)"\nproject: "Essayists"\ntype: "Essay"\n---\n\n'
                   '# Of Gardens\n\n' + (CONTENT / 'texts/bacon-of-gardens.md').read_text())
        store.ingest(Submission(request_id=UUID(rid('inbox', 'gardens')), title='Of Gardens', filename='of-gardens.md', markdown=gardens,
                                provenance={'author': 'Francis Bacon', 'project': 'Essayists', 'source': 'Project Gutenberg eBook #575 (public domain)'}))
        shutil.rmtree(staging)
        (self.root / 'inbox/autumn-reading-list.md').write_text(
            '# Autumn reading list\n\n- Montaigne, *Of Experience*\n- Woolf, *On Not Knowing Greek*\n- Thoreau, *The Ponds*\n- Emerson, *Experience*\n')


def build(root, today=None, now=None):
    """Prepare `root` (see `prepare`) and build the demo vault into it. Returns the vault path."""
    root = prepare(root)
    return Builder(root, today=today, now=now).run()


def semantic_model_present(root):
    """True when the embedding model is already on disk in the vault, so indexing needs no download.

    Callers set HF_HUB_OFFLINE=1 before anything imports fastembed (see demo.run) so a later index
    run cannot reach the network either."""
    from ..search import Search
    models = Path(root) / '.reader/models'
    if not models.is_dir() or not any(models.iterdir()):
        return False
    try:
        Search(root).model(download=False)
        return True
    except Exception:  # noqa: BLE001 - any failure means "not usable offline"
        return False


def index(root, semantic):
    """Build the search and link indexes. Semantic search only when asked for."""
    from ..links import LinkGraph
    from ..search import Search
    result = Search(root).index(semantic=semantic)
    LinkGraph(root).refresh()
    return result
