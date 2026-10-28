"""Disposable, synthetic browser fixture. No configured/private vault access."""
import json
import os
from pathlib import Path
import tempfile
import sys
from uuid import uuid4

from reader_mcp import clock
from reader_mcp.annotations import Annotations
from reader_mcp.web import WebLibrary, WebServer


FAKE_CODEX = """import json, pathlib, shutil, sys, time
args = sys.argv
prompt = sys.stdin.read()
# Replays a scripted `codex exec --json` sequence (tests/fixtures/codex-exec-scripted.jsonl) with short pauses,
# so the transcript fills live. .fake-slow stalls before the first event; .fake-pause holds after the failed tests;
# .fake-fail exits 1 with a Python traceback on stderr.
script = pathlib.Path(SCRIPT).read_text().splitlines()
print(json.dumps({'type': 'padding', 'data': 'x' * 70000}), flush=True)  # Over 64 KiB: the server drops the field.
if pathlib.Path('.fake-slow').exists():
    time.sleep(60)
if pathlib.Path('.fake-fail').exists():
    print(script[2], flush=True)
    sys.stderr.write('Traceback (most recent call last):\\n  File "intake.py", line 3, in <module>\\nRuntimeError: synthetic intake failure\\n')
    raise SystemExit(1)
def file_mail():
    filed = pathlib.Path('library/filed'); filed.mkdir(exist_ok=True)
    for entry in sorted(pathlib.Path('inbox').iterdir()):
        if entry.name != 'README.md' and not entry.name.startswith('.'):
            shutil.move(str(entry), str(filed / entry.name))
for line in script:
    event = json.loads(line)
    item = event.get('item') or {}
    if item.get('type') == 'file_change' and event['type'] == 'item.completed':
        file_mail()
    print(line, flush=True)
    time.sleep(0.12)
    if item.get('id') == 'item_8' and event['type'] == 'item.completed':
        deadline = time.time() + 30
        while pathlib.Path('.fake-pause').exists() and time.time() < deadline:
            usage = pathlib.Path('.fake-live-usage')
            if usage.exists():
                print(json.dumps({'type': 'turn.completed', 'usage': {'input_tokens': 0, 'cached_input_tokens': 0, 'output_tokens': 0}}), flush=True)
                usage.unlink()
            time.sleep(0.1)
file_mail()
pathlib.Path(args[args.index('--output-last-message') + 1]).write_text(
    '# Filed the synthetic mail\\n\\n- Moved every arrival to [the filed shelf](library/filed/loose-note.md).\\n- The fixture vault is not a Git repository, so no commit is verified.\\n\\n<script>window.reportScriptRan=true</script>\\n')
"""


def deliver(root, request_id, name, text, title, **provenance):
    import hashlib
    folder = root / 'inbox' / request_id
    folder.mkdir(parents=True)
    (folder / name).write_text(text)
    data = text.encode()
    (folder / 'receipt.json').write_text(json.dumps({'reader_receipt': 1, 'id': request_id, 'title': title, 'document': name,
        'received_at': '2026-10-24T20:19:46+00:00', 'provenance': provenance,
        'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}))


def inbox_fixture(root):
    """Synthetic arrivals and a fake Codex executable; never the real CLI."""
    import os
    (root / 'inbox/README.md').write_text('# Inbox guide\n')
    deliver(root, '11111111-1111-4111-8111-111111111111', 'RW-90.md', '# RW-90 heading\n\nA synthetic delivered spec.\n', 'Synthetic spec ninety',
            author='Claude', project='Reader', report_date='2026-10-24', source='Synthetic courier')
    deliver(root, '22222222-2222-4222-8222-222222222222', 'RW-91.md', '# RW-91\n\nAnother synthetic spec.\n', 'Synthetic spec ninety-one', author='Agy', project='Reader')
    (root / 'inbox/loose-note.md').write_text('# A loose dropped note\n\nNo receipt here.\n')
    fake = root / '.fixture/fake-codex'
    fake.parent.mkdir()
    script = Path(__file__).resolve().parent / 'fixtures/codex-exec-scripted.jsonl'
    fake.write_text('#!' + sys.executable + '\nSCRIPT = ' + json.dumps(str(script)) + '\n' + FAKE_CODEX)
    fake.chmod(0o755)
    return dict(os.environ, READER_CODEX=str(fake), PATH='/nonexistent')


class FakeService:
    """Stands in for scripts/reader_service.py: an update request lands one second later."""
    def __init__(self):
        import threading
        self.lock = threading.Lock()
        self.state = {'installed': True, 'web': {'loaded': True, 'pid': 4242}, 'updater': {'loaded': True}, 'paused': False,
                      'source': 'preview/integration', 'commit': '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c',
                      'commit_facts': {'date': '2026-10-23T09:00:00+00:00', 'subject': 'A synthetic change'},
                      'last_update': {'at': '2026-10-23T09:05:00+00:00', 'outcome': 'updated', 'to': '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c'},
                      'last_check_at': None, 'next_check_at': None, 'update_requested_at': None,
                      'tailscale': {'state': 'on', 'enabled': True, 'url': 'https://reader-host.example-tailnet.ts.net'}}

    def __call__(self, argv):
        import threading
        from datetime import datetime, timedelta, timezone
        stamp = lambda: datetime.now(timezone.utc).isoformat(timespec='seconds')
        with self.lock:
            if argv[0] == 'status':
                return json.loads(json.dumps(self.state))
            if argv[0] == 'request-update':
                self.state['update_requested_at'] = stamp()
                def land():
                    with self.lock:
                        new = '9a8b7c6d5e4f30211a2b3c4d5e6f708192a3b4c5'
                        self.state.update(commit=new, update_requested_at=None, last_check_at=stamp(),
                                          next_check_at=(datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(timespec='seconds'),
                                          commit_facts={'date': stamp(), 'subject': 'A newer synthetic change'},
                                          last_update={'at': stamp(), 'outcome': 'updated', 'from': self.state['commit'], 'to': new})
                threading.Timer(1.0, land).start()
                return {'requested': True}
            if argv[0] in ('pause', 'resume'):
                self.state['paused'] = argv[0] == 'pause'
                return {'paused': self.state['paused']}
            return {'restarting': True}


def main():
    import signal
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # Run cleanup when the browser test stops us.
    with tempfile.TemporaryDirectory(prefix='reader-web-fixture-') as directory:
        root = Path(directory)
        for name in ('library', 'inbox', 'indexes'):
            (root / name).mkdir()
        intro = 'An emoji 🐈 and **a precise passage** worth keeping.'
        paragraphs = ['## Chapter ' + str(i) + '\n\n' + ('A quiet library holds room for careful thought. Each passage carries a different observation. ' * 9) + '\n\n' + f'The distinct observation for chapter {i} waits here.\n' for i in range(1, 45)]
        source = '---\ntitle: A quiet thought\nauthor: Ada\n---\n\n# A quiet thought\n\n' + intro + '\n\n' + '\n'.join(paragraphs)
        (root / 'library/thought.md').write_text(source)
        (root / 'library/other.md').write_text('# Another thought\n\nA different thought.\n\n```javascript\nconst answer = "a fenced observation 🐈";\nconsole.log(answer);\n```\n\n<script>window.untrustedScriptRan=true</script>\n\n<img src="https://example.invalid/tracker.png" onerror="alert(1)">\n')
        works = [dict(id=name, title=title, primary='library/' + name, authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-23', primary_format='.md', primary_bytes=100) for name, title in [('thought.md','A quiet thought'), ('other.md','Another thought')]]
        if '--breadcrumbs' in sys.argv:
            for path in ['research/causal/notes/source.md', 'research/causal/notes/sibling.md', 'research/causal/notes-other/nearby.md', 'research/other/elsewhere.md']:
                file = root / 'library' / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(source)
                works.append(dict(id=path, title='Causal note '+file.stem, primary='library/'+path, authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-23', primary_format='.md', primary_bytes=len(source.encode())))
        if '--dashboard' in sys.argv:
            from datetime import date, timedelta
            for index in range(12):
                path=f'library/sample-{index}.md'
                (root/path).write_text(f'# Sample {index}\n\nA synthetic observation.\n')
                works.append(dict(id=path,title=f'Sample {index}',primary=path,authors=[['Ada','Bo','Cy'][index%3]],topics=[['Ideas','Systems','Reading'][index%3]],projects=[['Test','Study'][index%2]],types=[['Essay','Report','Book'][index%3]],date=(date(2026,10,23)-timedelta(days=index*7)).isoformat(),primary_format='.md',primary_bytes=(index+1)*9000))
        if '--maintenance' in sys.argv or '--queue' in sys.argv:
            for index, (title, day, read_project) in enumerate([('Notes on careful reading', '2026-10-20', 'Synthetic'), ('A newer observation', '2026-10-22', 'Synthetic'), ('Unrelated ledger', '2026-10-21', 'Elsewhere')]):
                path = f'library/related-{index}.md'
                (root / path).write_text(f'# {title}\n\nA small synthetic note.\n')
                works.append(dict(id=path, title=title, primary=path, authors=['Bo'], topics=['Ideas'] if read_project == 'Synthetic' else ['Ledgers'], projects=[read_project], date=day, primary_format='.md', primary_bytes=40))
        magazine_reads = []
        if '--magazine' in sys.argv:
            from datetime import timedelta
            # The issue is "this week's", so pin the clock (#131): the server starts at a fixed Wednesday noon UTC and the
            # suite starts the browser's Date at the same instant (the `now` below), so the week, and every
            # piece's place in it, never depends on when or in which time zone the suite runs.
            os.environ.setdefault(clock.ENV, '2026-10-21T12:00:00Z')
            today = clock.now().astimezone().date()  # the browser's local day for that instant
            monday = today - timedelta(days=today.weekday())
            body = 'The opening paragraph explains why this piece matters to a reader arriving this week, in plain prose. ' * 3
            pieces = [  # name, title, project, type, days before today, bytes
                ('cover.md', 'The distance between the map and the coast', 'Echo', 'Essay', 0, 9000),
                ('bijou.md', 'Pixel glyphs land in the toolkit', 'Bijou', 'Development journal', 0, 6000),
                ('edict.md', 'Collections of rules, revisited', 'Edict', 'Design proposal', 0, 25000),
                ('db8.md', 'How the debate rounds run', 'db8', 'Report', 0, 36000),
                ('echo-note.md', 'A short Echo note', 'Echo', 'Note', 0, 900),
                ('keep.md', 'A ledger that remembers the tide', 'Keep', 'Essay', 0, 7000),
                ('read-essay.md', 'An essay already read', 'Shiplog', 'Essay', 0, 8000),
                ('ticket.md', 'Task ticket that never appears', 'Ledger', 'Task', 0, 4000),
                ('older-a.md', 'Last week’s lead essay', 'Graft', 'Essay', 7, 12000),
                ('older-b.md', 'Last week’s field notes', 'git-warp', 'Development journal', 7, 5000),
                ('older-c.md', 'Last week’s report', 'Bijou', 'Report', 7, 9000),
                ('older-d.md', 'Last week’s note', 'Echo', 'Note', 7, 3000),
                ('archive.md', 'From two weeks ago', 'Edict', 'Essay', 14, 9000),
            ]
            (root / 'library/issue').mkdir()
            for name, title, project, kind, age, size in pieces:
                path = 'library/issue/' + name
                text = f'---\ntitle: "{title}"\nauthor: Ada\n---\n\n# {title}\n\n'
                if name == 'cover.md':
                    text += '> A quotation that is not the standfirst.\n\n```mermaid\ngraph TD; A-->B\n```\n\n| a | b |\n| - | - |\n\n'
                (root / path).write_text(text + f'{title} — ' + body + '\n\nA second paragraph.\n')
                day = max(monday, today - timedelta(days=age)) if age == 0 else today - timedelta(days=age)
                works.append(dict(id=path, title=title, primary=path, authors=['Ada'], topics=['Ideas'], projects=[project], types=[kind], date=day.isoformat(), primary_format='.md', primary_bytes=size))
            (root / 'library/newsletters').mkdir()
            letter = f'library/newsletters/{monday.isoformat()}-weekly.md'
            (root / letter).write_text(f"---\ntitle: 'The Weekly: a synthetic issue'\nnewsletter_week_start: '{monday.isoformat()}'\nnewsletter_week_end: '{(monday + timedelta(days=6)).isoformat()}'\n---\n\n# The Weekly\n\nThis week we read [the cover](../issue/cover.md) and [db8](../issue/db8.md#top).\n")
            works.append(dict(id=letter, title='The Weekly: a synthetic issue', primary=letter, authors=['Editor'], topics=['Ideas'], projects=['Reader'], types=['Note'], date=today.isoformat(), primary_format='.md', primary_bytes=300))
            magazine_reads = ['library/issue/read-essay.md']
        if '--outline' in sys.argv:
            outline_docs = {
                'library/embed-host.md': '# Host document\n\n## Host one\n\nA host paragraph.\n\n![[nested.md]]\n\n## Host two\n\nAnother host paragraph.\n\n### Host two detail\n\nMore.\n',
                'library/nested.md': '# Nested title\n\n## Nested heading\n\nAn embedded paragraph.\n',
                'library/short.md': '# Short note\n\n## Only section\n\nA few words.\n',
                'library/deep.md': '# Deep outline\n\n' + ''.join(f'## Part {i}\n\nText.\n\n### Part {i} detail\n\nText.\n\n#### Part {i} note a\n\nText.\n\n#### Part {i} note b\n\nText.\n\n' for i in range(1, 41)),
            }
            for path, text in outline_docs.items():
                (root / path).write_text(text)
                works.append(dict(id=path, title=text.split('\n')[0][2:], primary=path, authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-22', primary_format='.md', primary_bytes=len(text)))
        if '--links' in sys.argv:
            filler = '\n\n'.join(f'Paragraph {n} of the citing note keeps the linked heading below the fold.' for n in range(1, 40))
            (root / 'library/linked').mkdir()
            for index in range(13):
                path = f'library/linked/citer-{index:02}.md'
                extra = ' Also [again](../thought.md) and [[thought#Chapter 2|once more]].' if index == 0 else ''
                (root / path).write_text(f'# Citer {index:02}\n\n{filler}\n\n## Why it matters\n\nSee [the second chapter](../thought.md#chapter-2).{extra}\n\n{filler}\n')
                works.append(dict(id=path, title=f'Citer {index:02}', primary=path, authors=['Cy'], topics=['Links'], projects=['Citations'], date='2026-10-01', primary_format='.md', primary_bytes=4000))
            (root / 'library/linked/source.md').write_text('# Link sampler\n\nRead [a quiet thought](../thought.md#chapter-2), then [[other]], an [external page](https://example.com/page) and a [missing note](nowhere.md).\n')
            # Headings the link graph must slug exactly as the renderer does, and a link inside indented code.
            for name, body in [('heading-setext', 'Intro.\n\nFirst line\nsecond *line*\n===\n\nSee [the sampler](source.md).\n'),
                               ('heading-html', '# Html heading\n\nText.\n\n<h2 id="custom">Html <em>heading</em></h2>\n\nSee [the sampler](source.md).\n'),
                               ('heading-code', '# Code sample\n\n    [not a link](nowhere-in-code.md)\n\nSee [the sampler](source.md).\n')]:
                (root / f'library/linked/{name}.md').write_text(body)
            works.append(dict(id='library/linked/source.md', title='Link sampler', primary='library/linked/source.md', authors=['Cy'], topics=['Links'], projects=['Citations'], date='2026-10-02', primary_format='.md', primary_bytes=200))
        if '--modal' in sys.argv:
            # The modal keyboard suite: footnote markers, links, a table and a figure (tests/web_modal.cjs).
            notes = ('---\ntitle: Field notes\nauthor: Ada\n---\n\n# Field notes\n\n'
                     'The first claim needs a source.[^1] A second sentence follows here. A third sentence closes the paragraph.\n\n'
                     'See [a quiet thought](thought.md) and [the other note](other.md).\n\n'
                     '| Term | Meaning |\n| - | - |\n| stacks | shelves of books |\n\n'
                     + '\n\n'.join(f'Filler paragraph {n} keeps the notes below the fold.' for n in range(1, 30)) + '\n\n'
                     '## Later section\n\nThe term stacks appears again. Another mention of stacks.[^2]\n\n'
                     '<figure><figcaption>A figure caption</figcaption></figure>\n\n'
                     '[^1]: The source for the first claim.\n\n[^2]: A second note.\n')
            (root / 'library/notes.md').write_text(notes)
            works.append(dict(id='library/notes.md', title='Field notes', primary='library/notes.md', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-21', primary_format='.md', primary_bytes=len(notes)))
        if '--diagrams' in sys.argv:
            diagrams = ('# Diagrams\n\nA paragraph before the figures.\n\n'
                '```mermaid\nflowchart LR\n  Intake[Intake desk] --> Catalog{Catalog?}\n  Catalog -->|yes| Shelf[Library shelf]\n  Catalog -->|no| Inbox[Inbox]\n  click Shelf "https://example.invalid/shelf"\n```\n\n'
                'The paragraph after the flowchart carries a careful observation.\n\n'
                '```mermaid\nsequenceDiagram\n  Reader->>Server: open document\n  Server-->>Reader: source text\n```\n\n'
                '```mermaid\npie title Shelves\n  "Essays" : 42\n  "Reports" : 30\n  "Books" : 28\n```\n\n'
                '```mermaid\nflowchart LR\n  A -->\n```\n\n'
                'A closing paragraph after the invalid diagram.\n\n' + ''.join(f'Further reading continues on the next spread, paragraph {i}. ' * 6 + '\n\n' for i in range(1, 25)))
            (root / 'library/diagrams.md').write_text(diagrams)
            works.append(dict(id='diagrams.md', title='Diagrams', primary='library/diagrams.md', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-23', primary_format='.md', primary_bytes=len(diagrams.encode())))
        if '--code-blocks' in sys.argv:
            # Fenced code of several languages, a Mermaid source, a long line and a note anchored inside code.
            code = ('# Code blocks\n\nA paragraph before the code.\n\n'
                '```python\ndef greet(name):\n    """Say hello."""\n    return f"hello {name}"  # a careful comment\n\n\nprint(greet("reader"))\n```\n\n'
                'The paragraph between the code blocks.\n\n'
                '```text\n' + 'a very long line that keeps going ' * 12 + 'end\n```\n\n'
                '```mermaid\nflowchart LR\n  Desk[Intake desk] --> Shelf[Library shelf]\n```\n\n'
                '```bash\necho "the anchored shell phrase" | tr a-z A-Z\n```\n\n'
                '```\nplain fence without a language\n```\n\n'
                + ''.join(f'Further reading continues on the next spread, paragraph {i}. ' * 6 + '\n\n' for i in range(1, 30))
                + '```json\n{"late": true, "count": 3}\n```\n\nThe closing paragraph.\n')
            (root / 'library/code.md').write_text(code)
            works.append(dict(id='code.md', title='Code blocks', primary='library/code.md', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-23', primary_format='.md', primary_bytes=len(code.encode())))
            phrase = 'the anchored shell phrase'
            at = code.index(phrase)
            Annotations(root).create(path='library/code.md', start=at, end=at + len(phrase), owner='Ada', comment='A note inside code.', request_id=str(uuid4()))
        if '--math' in sys.argv:
            math = ('# Formulas\n\nEuler wrote $e^{i\\pi} + 1 = 0$ in one line, and \\(a^2 + b^2 = c^2\\) in another.\n\n'
                '$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n'
                'A careful remark sits between the formulas.\n\n'
                '$$\\sqrt{2} \\approx 1.414$$\n\n'
                'An unfinished formula $\\frac{1}{$ stays as written.\n\n'
                'Prices stay prices: it costs $20 and $30, or $1,500 in total.\n\n'
                'Code stays code: `$x^2$`.\n\n'
                '\\[\n\\undefinedmacro{x}\n\\]\n\n'
                'The closing paragraph.\n')
            (root / 'library/math.md').write_text(math)
            (root / 'library/prices.md').write_text('---\ntitle: Prices\nmath: false\n---\n\n# Prices\n\nA price list where $x_1$ and $y_2$ are product codes.\n')
            # A math-heavy document (1,500 formulas, tall display blocks) for typesetting after first paint.
            heavy = '# Many formulas\n\n' + '\n\n'.join(
                f'## Part {i}\n\nPart {i} relates $x_{{{i}}}^2 + y_{{{i}}}^2 = r^2$, $\\alpha_{{{i}}} \\leq \\beta$, '
                f'$\\sum_{{k=1}}^{{{i}}} k = \\frac{{{i}({i}+1)}}{{2}}$ and $\\sqrt{{{i}}}$ in one paragraph.\n\n'
                f'$$\n\\begin{{pmatrix}} {i} & 1 \\\\ 0 & \\frac{{1}}{{{i}}} \\end{{pmatrix}} = \\int_0^{{{i}}} \\frac{{\\sum_{{n=0}}^{{\\infty}} t^n}}{{\\prod_{{m=1}}^{{3}} (1+t^m)}}\\,dt\n$$\n\n'
                f'The distinct remark for part {i} rests here.'
                for i in range(1, 301)) + '\n'
            (root / 'library/math-heavy.md').write_text(heavy)
            remark = 'distinct remark for part 280'
            at = heavy.index(remark)
            Annotations(root).create(path='library/math-heavy.md', start=at, end=at + len(remark), owner='Ada', comment='A note beside late math.', request_id=str(uuid4()))
            works.append(dict(id='math-heavy.md', title='Many formulas', primary='library/math-heavy.md', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-23', primary_format='.md', primary_bytes=len(heavy.encode())))
            for name, title, text in (('math.md', 'Formulas', math), ('prices.md', 'Prices', '')):
                works.append(dict(id=name, title=title, primary='library/' + name, authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-23', primary_format='.md', primary_bytes=max(1, len(text.encode()))))
        if '--editions' in sys.argv:
            # A v1/v2/v3 essay chain, a reading copy of v2 and a catalog note for v2.
            body = lambda title, extra='': f'---\ntitle: {title}\nauthor: Ada\ncreated: 2026-10-{extra or "12"}\n' + '---\n\n# ' + title + '\n\n' + '\n\n'.join(f'Paragraph {i} of {title} keeps a careful thought about fences and gates.' for i in range(1, 30)) + '\n'
            essay = 'library/essays/tidal'
            (root / essay).mkdir(parents=True)
            (root / f'{essay}/tidal.md').write_text(body('The tidal archive'))
            (root / f'{essay}/tidal.v2.md').write_text(body('The tidal archive (v2)', '15').replace('author: Ada\n', 'author: Ada\nfrontmatter_schema_version: 1\ntype: note\ndocument_revision: 2\nprevious_version: library/essays/tidal/tidal.md\n'))
            (root / f'{essay}/tidal.v3.md').write_text(body('The tidal archive (v3)', '20').replace('author: Ada\n', 'author: Ada\nfrontmatter_schema_version: 1\ntype: note\ndocument_revision: 3\nprevious_version: tidal.v2.md\n'))
            (root / f'{essay}/tidal.v2.reading.md').write_text(body('The tidal archive (v2) — reading copy', '15').replace('author: Ada\n', f'author: Ada\nkind: reading-copy\nreading_source: {essay}/tidal.v2.md\n'))
            (root / 'catalog/metadata/essays/tidal').mkdir(parents=True)
            (root / 'catalog/metadata/essays/tidal/tidal.v2.md.md').write_text('---\ntitle: The tidal archive (v2)\ntype: note\n---\n')
            for name, title in [('tidal.md', 'The tidal archive'), ('tidal.v2.md', 'The tidal archive (v2)'), ('tidal.v3.md', 'The tidal archive (v3)')]:
                works.append(dict(id=name, title=title, primary=f'{essay}/{name}', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-20', primary_format='.md', primary_bytes=2000))
        if '--changes' in sys.argv:
            # A committed edition with receipts and a highlight, then a changed working copy.
            import subprocess
            from reader_mcp.engagement import Engagement
            env = {'PATH': os.environ.get('PATH', os.defpath), 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1', 'HOME': '/dev/null',
                   'GIT_AUTHOR_NAME': 'Fixture', 'GIT_AUTHOR_EMAIL': 'fixture@example.invalid', 'GIT_COMMITTER_NAME': 'Fixture', 'GIT_COMMITTER_EMAIL': 'fixture@example.invalid'}
            paragraph = lambda i: f'Gate {i} opens onto a long corridor of careful reading and patient thought about the library.'
            old = '# Gates of reading\n\n' + '\n\n'.join(paragraph(i) for i in range(1, 41)) + '\n'
            doc = root / 'library/changing.md'
            doc.write_text(old)
            retagged = root / 'library/retagged.md'
            retagged.write_text('---\ntitle: Retagged\ntags: [old]\n---\n\n# Retagged\n\nThe text of this note never changes.\n')
            for args in (['init', '-q', '-b', 'main'], ['add', 'library/changing.md', 'library/retagged.md'], ['commit', '-q', '-m', 'First edition']):
                subprocess.run(['git', '-C', str(root), *args], env=env, check=True, capture_output=True)
            for path in ('library/changing.md', 'library/retagged.md'):
                item = Engagement(root).document(path)
                for name in ('Browser tester', 'Agy'):
                    Engagement(root).seen(name, [{'key': item['key'], 'version': item['version']}])
            # Only frontmatter and line wrapping change: nobody's earlier edition reads differently.
            retagged.write_text('---\ntitle: Retagged\ntags: [new]\n---\n\n# Retagged\n\nThe text of this note\nnever changes.\n')
            kept = old.index(paragraph(30))
            Annotations(root).create(path='library/changing.md', start=kept, end=kept + len('Gate 30 opens'), owner='Browser tester', request_id=str(uuid4()))
            gone = old.index(paragraph(12))
            Annotations(root).create(path='library/changing.md', start=gone, end=gone + len(paragraph(12)), owner='Agy', kind='warning', comment='Check this gate.', request_id=str(uuid4()))
            new = old.replace(paragraph(3), 'Gate 3 opens onto a short corridor of careful reading and restless thought about the library.')
            new = new.replace(paragraph(12) + '\n\n', '').replace(paragraph(35), paragraph(35) + '\n\nA new gate, added after the receipt, closes the corridor.')
            doc.write_text(new)
            works.append(dict(id='changing.md', title='Gates of reading', primary='library/changing.md', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-24', primary_format='.md', primary_bytes=len(new)))
        if '--versions' in sys.argv:
            # The --editions family in git: v1 filed on Oct 12 and revised on Oct 15 with v2, v3 and the reading copy.
            import subprocess
            env = {'PATH': os.environ.get('PATH', os.defpath), 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1', 'HOME': '/dev/null',
                   'GIT_AUTHOR_NAME': 'Ada', 'GIT_AUTHOR_EMAIL': 'ada@example.invalid', 'GIT_COMMITTER_NAME': 'Ada', 'GIT_COMMITTER_EMAIL': 'ada@example.invalid'}
            run = lambda *args, when: subprocess.run(['git', '-C', str(root), *args], env=env | {'GIT_AUTHOR_DATE': when, 'GIT_COMMITTER_DATE': when}, check=True, capture_output=True)
            essay = root / 'library/essays/tidal'
            final = (essay / 'tidal.md').read_text()
            later = {name: (essay / name).read_text() for name in ('tidal.v2.md', 'tidal.v3.md', 'tidal.v2.reading.md')}
            for name in later:
                (essay / name).unlink()
            (essay / 'tidal.md').write_text(final.replace('Paragraph 3 of The tidal archive keeps a careful thought', 'Paragraph 3 of The tidal archive kept an early thought'))
            if not (root / '.git').exists():
                run('init', '-q', '-b', 'main', when='2026-10-12T09:00:00Z')
            run('add', 'library/essays/tidal/tidal.md', when='2026-10-12T09:00:00Z')
            run('commit', '-q', '-m', 'File The tidal archive', when='2026-10-12T09:00:00Z')
            (essay / 'tidal.md').write_text(final)
            for name, text in later.items():
                (essay / name).write_text(text)
            run('add', 'library/essays/tidal', when='2026-10-15T09:00:00Z')
            run('commit', '-q', '-m', 'Revise v1; add v2, v3 and a reading copy', when='2026-10-15T09:00:00Z')
        if any(flag.startswith('--prose') for flag in sys.argv):
            prose_source = ('---\ntitle: Colored prose\nauthor: Ada\n---\n\n# Colored prose\n\n'
                'The quiet library holds 12 rooms, and Ada said “each passage waits” for a careful reader. Run `npm test` here.\n\n'
                '- Each room in the library holds a different thought.\n- Here Ada waits with 3 lamps.\n\n'
                '> The precise passage is not quickly forgotten.\n\n'
                'A formula <span class="katex">the x and the y</span> stays plain.\n\n'
                '```python\nthe_library = "holds a quiet room"\n```\n\n'
                '```mermaid\ngraph LR\n  the --> library\n```\n\n'
                + '\n\n'.join(f'## Part {i}\n\n' + ('The quiet library holds room for a careful thought, and each passage carries a different observation. ' * 8) for i in range(1, 25)) + '\n')
            (root / 'library/prose.md').write_text(prose_source)
            # A public-domain passage (Emerson, "Self-Reliance", 1841) for the intensity screenshots.
            essay = ('---\ntitle: Self-Reliance\nauthor: Ralph Waldo Emerson\n---\n\n# Self-Reliance (1841)\n\n'
                'I read the other day some verses written by an eminent painter which were original and not conventional. '
                'The soul always hears an admonition in such lines, let the subject be what it may. The sentiment they instil '
                'is of more value than any thought they may contain. To believe your own thought, to believe that what is true '
                'for you in your private heart is true for all men, — that is genius. Speak your latent conviction, and it shall '
                'be the universal sense; for the inmost in due time becomes the outmost, — and our first thought is rendered back '
                'to us by the trumpets of the Last Judgment. Familiar as the voice of the mind is to each, the highest merit we '
                'ascribe to Moses, Plato, and Milton is, that they set at naught books and traditions, and spoke not what men but '
                'what they thought.\n\n'
                'There is a time in every man’s education when he arrives at the conviction that envy is ignorance; that imitation '
                'is suicide; that he must take himself for better, for worse, as his portion; that though the wide universe is full '
                'of good, no kernel of nourishing corn can come to him but through his toil bestowed on that plot of ground which is '
                'given to him to till. The power which resides in him is new in nature, and none but he knows what that is which he '
                'can do, nor does he know until he has tried.\n\n'
                '“Ah, so you shall be sure to be misunderstood.” — Is it so bad, then, to be misunderstood? Pythagoras was '
                'misunderstood, and Socrates, and Jesus, and Luther, and Copernicus, and Galileo, and Newton, and every pure and wise '
                'spirit that ever took flesh. To be great is to be misunderstood.\n\n'
                'A foolish consistency is the hobgoblin of little minds, adored by little statesmen and philosophers and divines. '
                'With consistency a great soul has simply nothing to do. Speak what you think now in hard words, and to-morrow speak '
                'what to-morrow thinks in hard words again, though it contradict every thing you said to-day.\n\n'
                'Emerson printed the essay in 1841, in the first series of his *Essays*, 12 pieces in all; a second series '
                'followed in 1844.\n')
            (root / 'library/essay.md').write_text(essay)
            works.append(dict(id='essay.md', title='Self-Reliance', primary='library/essay.md', authors=['Ralph Waldo Emerson'], topics=['Ideas'], projects=['Synthetic'], date='1841-01-01', primary_format='.md', primary_bytes=len(essay.encode())))
            works.append(dict(id='prose.md', title='Colored prose', primary='library/prose.md', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-24', primary_format='.md', primary_bytes=len(prose_source.encode())))
        if '--queue' in sys.argv:
            # A longer piece in another project, for reading time and the cross-project suggestion.
            path = 'library/field-notes.md'
            (root / path).write_text('# Field notes\n\n' + 'Observations from elsewhere, written slowly. ' * 400 + '\n')
            works.append(dict(id=path, title='Field notes', primary=path, authors=['Cy'], topics=['Ledgers'], projects=['Elsewhere'], date='2026-10-19', primary_format='.md', primary_bytes=(root / path).stat().st_size))
        if '--perf' in sys.argv:
            # A ~2 MB synthetic document: headings, emoji prose, lists, code fences and local images.
            import base64
            pixel = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')
            (root / 'library/figures').mkdir()
            sections = []
            for i in range(1, 401):
                prose = (f'Paragraph {i} 🐈 holds **a careful claim**, a [nearby link](other.md) and `inline_code({i})` for the reader. ' * 14)
                part = [f'## Section {i}', prose, prose, f'- point one of {i}\n- point two of {i}\n  - nested point', f'> A quoted remark for section {i}.', prose]
                if i % 2 == 0:
                    part.append('```python\n' + '\n'.join(f'def step_{i}_{k}(value):\n    return value * {k}  # 🐈' for k in range(12)) + '\n```')
                if i % 4 == 0:
                    (root / f'library/figures/figure-{i}.png').write_bytes(pixel)
                    part.append(f'![Figure {i}](figures/figure-{i}.png)')
                if i in (100, 300):
                    part.append('```mermaid\ngraph TD\n  A --> B\n```')
                part.append(f'The distinct observation for section {i} waits here.')
                sections.append('\n\n'.join(part))
            large = '---\ntitle: A very large document\nauthor: Ada\n---\n\n# A very large document\n\n' + '\n\n'.join(sections) + '\n'
            (root / 'library/large.md').write_text(large)
            works.append(dict(id='large.md', title='A very large document', primary='library/large.md', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-23', primary_format='.md', primary_bytes=len(large.encode())))
            late = large.index('distinct observation for section 390')
            Annotations(root).create(path='library/large.md', start=late, end=late + len('distinct observation for section 390'), owner='Ada', comment='A late note.', request_id=str(uuid4()))
        if '--resilience' in sys.argv:
            # A versioned header without `type`: legacy/partial metadata must not block margins.
            path = 'library/versioned.md'
            (root / path).write_text('---\nfrontmatter_schema_version: 1\ndocument_revision: 2\ntitle: A versioned note\n---\n# A versioned note\n\nA passage under a partial header.\n')
            works.append(dict(id=path, title='A versioned note', primary=path, authors=['Bo'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-22', primary_format='.md', primary_bytes=120))
        if '--callouts' in sys.argv:
            callouts = ('---\ntitle: Callout field guide\nauthor: Ada\n---\n\n# Callout field guide\n\nA plain opening paragraph.\n\n'
                '> [!note] A plain note\n> The note body holds a callout observation 🐈 worth keeping.\n\n'
                '> [!info]- Folded details\n> A folded observation sits behind the fold.\n\n'
                '> [!tip]+ Expanded hint\n> An expanded hint body.\n\n'
                '> [!WARNING]\n> Mind the warning step.\n\n'
                '> [!quote] Quoted voice\n> A quoted line of prose.\n\n'
                '> [!faq]\n> A question body.\n\n'
                '> [!marginalia] Custom kind\n> Unknown kinds look like notes.\n\n'
                '> [!example] Outer example\n> Outer body.\n>\n> > [!danger] Inner danger\n> > Inner danger body.\n\n'
                '> Just a plain quotation.\n')
            (root / 'library/callouts.md').write_text(callouts)
            works.append(dict(id='callouts.md', title='Callout field guide', primary='library/callouts.md', authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-23', primary_format='.md', primary_bytes=len(callouts.encode())))
            quote = 'a callout observation'
            start = len(callouts[:callouts.index(quote)])
            Annotations(root).create(path='library/callouts.md', start=start, end=start+len(quote), owner='Bo', comment='A note on a note.', request_id=str(uuid4()))
        if '--dates' in sys.argv:
            # Receipts near midnight UTC (needs --editions --versions): an evening reader in Los Angeles,
            # a morning reader in Tokyo, and two other readers whose marks fall on different local days.
            from reader_mcp.annotations import sha
            from reader_mcp.engagement import Engagement
            engagement = Engagement(root)
            tidal = 'library/essays/tidal/tidal.md'
            stamps = {'Evening tester': {tidal: '2026-10-25T00:16:00+00:00', 'library/thought.md': '2026-10-24T06:00:00+00:00', 'library/other.md': '2026-10-21T18:00:00+00:00'},
                      'Morning tester': {tidal: '2026-10-24T15:16:00+00:00', 'library/thought.md': '2026-10-24T14:00:00+00:00', 'library/other.md': '2026-10-20T03:00:00+00:00'},
                      'Night owl': {tidal: '2026-10-17T00:16:00+00:00'}, 'Early bird': {tidal: '2026-10-16T15:16:00+00:00'}}
            for name, reads in stamps.items():
                engagement.seen(name, [engagement.document(path) for path in reads])
                file = root / 'engagement' / (sha(name.encode()) + '.json')
                record = json.loads(file.read_text())
                for path, at in reads.items():
                    record['items']['document:' + path]['at'] = at
                file.write_text(json.dumps(record, indent=2) + '\n')
        if '--fragments' in sys.argv:
            # A heading far down a document, with an explicit id, and a document that links to it.
            far = '# Far document\n\n' + ''.join(f'Filler paragraph {i} keeps the heading out of view.\n\n' for i in range(120)) + '<h2 id="far-section">Far section</h2>\n\nThe far section begins here.\n\n' + ''.join(f'Closing paragraph {i}.\n\n' for i in range(60))
            for path, text in {'library/far.md': far, 'library/linker.md': '# Linker\n\nGo to [the far section](far.md#far-section).\n'}.items():
                (root / path).write_text(text)
                works.append(dict(id=path, title=text.split('\n')[0][2:], primary=path, authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-21', primary_format='.md', primary_bytes=len(text.encode())))
        (root / 'indexes/coverage.json').write_text(json.dumps({'as_of':'2026-10-23', 'works':works}))
        if '--shapes' in sys.argv:
            shapes_fixture(root, works, embed='--shapes-terms' not in sys.argv)
        if magazine_reads:
            from reader_mcp.engagement import Engagement
            engagement = Engagement(root)
            engagement.seen('Browser tester', [engagement.document(path) for path in magazine_reads])
        # Real, small PDFs generated from synthetic text, with no external font.
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
        def synthetic_pdf(count):
            writer = PdfWriter()
            for index in range(1, count + 1):
                page = writer.add_blank_page(width=400, height=600)
                font = DictionaryObject({NameObject('/Type'):NameObject('/Font'), NameObject('/Subtype'):NameObject('/Type1'), NameObject('/BaseFont'):NameObject('/Helvetica')})
                page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
                stream = DecodedStreamObject()
                stream.set_data(f'BT /F1 18 Tf 36 540 Td (Synthetic PDF page {index}) Tj 0 -32 Td (A precise observation.) Tj ET'.encode())
                page[NameObject('/Contents')] = writer._add_object(stream)
            return writer
        synthetic_pdf(6).write(root / 'library/pages.pdf')
        if '--transclusion' in sys.argv:
            # Obsidian embeds (tests/web_transclusion.cjs): the shared conformance corpus, a real image and PDF,
            # a long host for lazy loading and a 50-embed document for the performance check.
            import base64
            corpus = json.loads((Path(__file__).parent / 'fixtures/transclusion/corpus.json').read_text())
            for path, text in corpus['files'].items():
                (root / path).parent.mkdir(parents=True, exist_ok=True)
                (root / path).write_text(text)
            (root / 'library/assets/dot.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='))
            (root / 'library/assets/my dot.png').write_bytes((root / 'library/assets/dot.png').read_bytes())
            synthetic_pdf(4).write(root / 'library/assets/paper.pdf')
            (root / 'library/many').mkdir()
            for i in range(50):
                (root / f'library/many/note-{i:02}.md').write_text(f'# Note {i:02}\n\n' + f'Paragraph {i} of a synthetic note keeps a careful thought. ' * 40 + f'\n\n## Detail {i:02}\n\nThe distinct embedded line {i:02} waits here.\n')
            many = '# Fifty embeds\n\nAn opening paragraph of the host.\n\n' + '\n\n'.join(f'Host paragraph {i} before the next embed.\n\n![[note-{i:02}]]' for i in range(50)) + '\n\nThe host closing line.\n'
            (root / 'library/many.md').write_text(many)
            for path, title in [('library/main.md', 'Main'), ('library/many.md', 'Fifty embeds'), ('library/notes/deep/Target Note.md', 'Target Note')]:
                works.append(dict(id=path, title=title, primary=path, authors=['Ada'], topics=['Ideas'], projects=['Synthetic'], date='2026-10-25', primary_format='.md', primary_bytes=(root / path).stat().st_size))
            (root / 'indexes/coverage.json').write_text(json.dumps({'as_of':'2026-10-23', 'works':works}))
        if '--outline' in sys.argv:
            # An outline with a nested entry and a named destination.
            writer = synthetic_pdf(8)
            part = writer.add_outline_item('Part one', 0)
            writer.add_outline_item('Section on page 3', 2, parent=part)
            writer.add_outline_item('Part two', 4)
            writer.add_named_destination('closing', 6)
            from pypdf.generic import TextStringObject
            closing = writer.add_outline_item('Closing pages', 6).get_object()
            closing['/A'].get_object()[NameObject('/D')] = TextStringObject('closing')
            writer.write(root / 'library/outlined.pdf')
        start = source.index('a precise passage')
        Annotations(root).create(path='library/thought.md', start=start, end=start+len('a precise passage'), owner='Ada', kind='warning', comment='An observation to check.', request_id=str(uuid4()))
        if '--spread-pins' in sys.argv:
            # A margin thread on every chapter's closing sentence, so every two-page spread carries pins in both columns.
            for i in range(1, 45):
                quote = f'distinct observation for chapter {i} waits'
                at = source.index(quote)
                Annotations(root).create(path='library/thought.md', start=at, end=at + len(quote), owner='Bo', comment=f'Margin note {i}.', request_id=str(uuid4()))
        if '--reading-log' in sys.argv:
            from reader_mcp.engagement import Engagement
            engagement = Engagement(root)
            # Two voices, named by this vault's registry: one read the edition before a one-line revision, the other the current one.
            (root / 'voices.json').write_text(json.dumps({'schema_version': 1, 'voices': [{'name': 'Archivist'}, {'name': 'Builder'}]}))
            engagement.seen('Archivist', [engagement.document('library/thought.md')])
            (root / 'library/thought.md').write_text(source + '\nA revised closing line.\n')
            engagement.seen('Builder', [engagement.document('library/thought.md'), engagement.document('library/other.md')])
            for agent in ('task-agent-one', 'task-agent-two'):
                engagement.seen(agent, [engagement.document('library/thought.md')])
            Annotations(root).create(path='library/thought.md', start=start, end=start+len('a precise passage'), owner='Builder', comment='Worth a second look.', request_id=str(uuid4()))
        if '--dashboard' in sys.argv:
            # A raw span that crosses Markdown markers; the UI must show it as plain prose.
            marked = source.index('**a precise passage** worth')
            Annotations(root).create(path='library/thought.md', start=marked, end=marked+len('**a precise passage** worth'), owner='Bo', kind='highlight', comment='One remark.', request_id=str(uuid4()))
        fetcher = None
        if '--themes' in sys.argv:
            sys.path.insert(0, str(Path(__file__).parent))
            from test_themes import FakeFonts
            fetcher = FakeFonts()
        runners = None
        if '--maintenance' in sys.argv:
            import time
            def search():
                time.sleep(1.2)
                return {'documents': 3, 'chunks': 9, 'changed': 3, 'removed': 0, 'semantic': True, 'issues': 0}
            def catalog():
                time.sleep(.3)
                raise ValueError('Synthetic catalog failure')
            runners = {'search': search, 'catalog': catalog}
        chat_options = None
        if '--chat' in sys.argv:
            # Fake voice CLIs only: deterministic replies, never a model.
            import random
            sys.path.insert(0, str(Path(__file__).parent))
            from chat_vault import AGENTS, default_voices, executable
            (root / 'AGENTS.md').write_text(AGENTS)
            (root / 'bin').mkdir()
            fake = executable(root / 'bin')
            voices = default_voices(root, {'Claude': ['--chunks', '8', '--delay', '0.35', '--reply', 'The passage is **precise**: it names one thing and keeps it, which is rare and worth noticing here.'],
                                           # agy's real stream-json shapes: narration, a tool that works and one that fails, a draft, then result.response.
                                           'Agy': ['--narrate', 'Let me read the passage first.', '--tools', '--streamed', 'A rough draft that the final reply replaces.',
                                                   '--chunks', '6', '--delay', '0.2', '--reply', 'Agy reads the **effector boundary** here.',
                                                   '--listen', 'HAND: the runner boundary matters here', '--chime-reply', 'Agy adds that the runner boundary matters here.'],
                                           'Reader librarian': ['--reply', 'The librarian notes the provenance.']})
            voices.insert(3, {'name': 'Sloth', 'mention': ['sloth'], 'cli': 'fake', 'stream': 'claude', 'argv': ['--style', 'claude', '--name', 'Sloth', '--hang']})
            voices.insert(4, {'name': 'Garbled', 'mention': ['garbled'], 'cli': 'fake', 'stream': 'agy', 'argv': ['--style', 'garbage', '--name', 'Garbled']})
            (root / 'voices.json').write_text(json.dumps({'schema_version': 1, 'timeout_seconds': 60, 'voices': [
                (v | {'cli': str(fake)}) if v.get('cli') == 'fake' else v for v in voices]}))
            chat_options = {'rng': random.Random(7), 'git_locks': False}  # 7 picks Claude among the five runnable voices
        art_options = None
        if '--art' in sys.argv:
            # Bespoke art (RW-43): a git vault, one fake voice that answers art prompts slowly enough to watch,
            # and handcrafted art already stored for the cover story and one feature. Never a real model.
            import subprocess
            sys.path.insert(0, str(Path(__file__).parent))
            from chat_vault import AGENTS, executable
            env = {'PATH': os.environ.get('PATH', os.defpath), 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1', 'HOME': '/dev/null'}
            gitrun = lambda *a: subprocess.run(['git', '-C', str(root), *a], env=env, check=True, capture_output=True)
            if not (root / '.git').exists():
                gitrun('init', '-q', '-b', 'main')
            for key, value in (('user.name', 'Synthetic Owner'), ('user.email', 'owner@example.invalid'), ('commit.gpgsign', 'false')):
                gitrun('config', key, value)
            (root / 'AGENTS.md').write_text(AGENTS)
            (root / '.gitignore').write_text('.reader/\nbin/\n')
            (root / 'bin').mkdir(exist_ok=True)
            fake_cli = executable(root / 'bin', 'art-voice')
            demo = Path(__file__).parent.parent / 'src/reader_mcp/demo/content/art'
            (root / 'bin/scene.json').write_text(json.dumps(json.loads((demo / 'bank.json').read_text())['scene']))
            delay = sys.argv[sys.argv.index('--art-delay') + 1] if '--art-delay' in sys.argv else '0.25'
            (root / 'voices.json').write_text(json.dumps({'schema_version': 1, 'timeout_seconds': 60, 'voices': [
                {'name': 'Painter', 'mention': ['painter'], 'cli': str(fake_cli), 'stream': 'claude', 'model': 'fake-model-1',
                 'argv': ['--style', 'claude', '--name', 'Painter', '--chunks', '6', '--delay', delay, '--art-usage', '--art-scene', str(root / 'bin/scene.json'),
                          '--persona', '{persona}'], 'persona': {'text': 'A synthetic painter for tests.'}},
                {'name': 'Sketcher', 'mention': ['sketcher'], 'cli': None, 'manual': True}]}))
            gitrun('add', '-A'); gitrun('commit', '-q', '-m', 'Synthetic vault')
            art_options = {'git_locks': False, 'capacity': lambda _: True}
        inbox_environ = None
        if '--inbox' in sys.argv:
            inbox_environ = inbox_fixture(root)
        # Never reach the real AI-TTS daemon: --speech starts a fake one, otherwise the socket is absent.
        speech_folder = tempfile.mkdtemp(prefix='rs-', dir='/tmp' if Path('/tmp').is_dir() else None)
        os.environ['AI_TTS_SOCKET'] = str(Path(speech_folder) / 'ai-tts.sock')
        fake = None
        if '--speech' in sys.argv:
            sys.path.insert(0, str(Path(__file__).parent))
            from fake_aitts import FakeDaemon
            fake = FakeDaemon(speech_folder, step=0.7)
        # Never the real LM Studio: a fake loopback server and fake lms with --local-model, else a dead port and no CLI.
        sys.path.insert(0, str(Path(__file__).parent))
        import fake_lmstudio
        from contextlib import contextmanager
        from reader_mcp.local_model import CLI
        @contextmanager
        def gpu_lock(note, cancelled=None):
            yield {'job': 'fixture'}
        lms = CLI(str(root / 'no-lms'))
        if '--local-model' in sys.argv:
            os.environ['FAKE_LMS_STATE'] = str(root / '.fake-lms')
            (root / '.fake-lms').mkdir()
            (root / '.fake-lms/config.json').write_text(json.dumps({'delay': .12}))
            lms = CLI(str(fake_lmstudio.install(root / '.fake-bin')))
            for index, (title, text) in enumerate([('Margins and ledgers', 'Careful readers keep ledgers in the margins of every book.'),
                                                   ('A field guide to quiet', 'Quiet rooms help a reader return to difficult passages.'),
                                                   ('An invented claim', 'This note is short. PLANTED-INVENTION')]):
                path = f'library/lm-{index}.md'
                (root / path).write_text(f'# {title}\n\n{text}\n')
                works.append(dict(id=path, title=title, primary=path, authors=['Cy'], topics=['Reading'], projects=['Synthetic'], date=f'2026-10-2{4 + index}', primary_format='.md', primary_bytes=60))
            (root / 'indexes/coverage.json').write_text(json.dumps({'as_of':'2026-10-26', 'works':works}))
        if '--index-scale' in sys.argv:
            from reader_mcp.search import Search
            (root / 'library/receipt.json').write_text('{"machine": "record"}')
            (root / 'indexes/settings.json').write_text(json.dumps({'search': {'max_passages': 1000, 'max_database_mib': 64, 'max_cache_mib': 32}}))
            import sqlite3
            (root / '.reader').mkdir(exist_ok=True)
            with sqlite3.connect(root / '.reader/search.sqlite3') as legacy:  # A retired format 1 index left by older Reader code.
                legacy.executescript("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('version', '1');")
            Search(root).index(False)  # A real format 2 index beside it, keywords only.
            import time
            def stopped():
                time.sleep(.8)
                return {'documents': 5, 'chunks': 60, 'passages': 18400, 'changed': 2, 'removed': 0, 'semantic': True, 'complete': False,
                        'message': 'Stopped at the time limit; 18,400 passages saved. Run again to continue.', 'issues': 0}
            runners = {'search': stopped}
        local = {'url': f'http://127.0.0.1:{fake_lmstudio.free_port()}', 'cli': lms, 'gpu_lock': gpu_lock, 'data_usage': lambda: 0,
                 'capacity': lambda _: True, 'git_locks': False}
        providers = {}
        if '--local-provider' in sys.argv:
            # Fake Ollama and llama.cpp servers in this process. Every other address, a real local
            # server on its usual port included, looks switched off; a non-loopback ("remote") URL is
            # answered by the fake Ollama, so nothing ever leaves loopback.
            import http.client
            from fake_openai_servers import FakeServer, LIVE
            fake_ollama, fake_llamacpp = FakeServer('ollama'), FakeServer('llamacpp')
            providers = {'ollama': fake_ollama.url, 'llamacpp': fake_llamacpp.url}

            def connect(parts, timeout):
                if not parts['loopback']:
                    return http.client.HTTPConnection('127.0.0.1', fake_ollama.port, timeout=timeout)
                if parts['port'] not in LIVE:
                    raise ConnectionRefusedError('fixture: no server here')
                return http.client.HTTPConnection('127.0.0.1', parts['port'], timeout=timeout)
            local['connect'] = connect
        from reader_mcp.prose import Prose
        prose = None
        if '--prose' in sys.argv:
            # The synthetic stand-in for the Colorful CLI (tests/fake_colorful.py).
            fake_cli = root / 'colorful'
            fake_cli.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{Path(__file__).with_name("fake_colorful.py")}" "$@"\n')
            fake_cli.chmod(0o755)
            prose = Prose(fake_cli)
        elif '--prose-missing' in sys.argv:
            prose = Prose(environ={'PATH': str(root / 'inbox'), 'HOME': str(root)})
        # Never the real service script: it would report (and act on) this Mac's installed service.
        service = FakeService() if '--service' in sys.argv else (lambda argv: {'installed': False})
        writing_options = None
        if '--writing' in sys.argv:
            # A synthetic vault repository for scratch pad saves; commits use flock only (never the workstation lock store).
            import subprocess
            env = {'PATH': os.environ.get('PATH', os.defpath), 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1', 'HOME': '/dev/null'}
            if not (root / '.git').exists():
                subprocess.run(['git', '-C', str(root), 'init', '-q', '-b', 'main'], env=env, check=True, capture_output=True)
            for key, value in (('user.name', 'Synthetic Writer'), ('user.email', 'writer@example.invalid')):
                subprocess.run(['git', '-C', str(root), 'config', key, value], env=env, check=True, capture_output=True)
            (root / 'library/index.md').write_text('# Library index\n')
            subprocess.run(['git', '-C', str(root), 'add', 'library/index.md'], env=env, check=True, capture_output=True)
            subprocess.run(['git', '-C', str(root), 'commit', '-q', '-m', 'Synthetic index'], env=env, check=True, capture_output=True)
            # A local image and a note a scratch draft can show in its preview (#114).
            import base64
            (root / 'library/figures').mkdir(exist_ok=True)
            (root / 'library/figures/pixel.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='))
            (root / 'library/notes').mkdir(exist_ok=True)
            (root / 'library/notes/seed-note.md').write_text('# Seed note\n\nA small embedded idea.\n')
            writing_options = {'git_locks': False}
        companions = None
        if '--no-git-locks' in sys.argv:
            # git-locks hidden from PATH and the usual install folders, and no workstation store: every
            # caller must fall back to Reader's own locks (chat and scratch pad commits, the GPU lock).
            os.environ['PATH'] = '/usr/bin:/bin'
            os.environ['READER_GIT_LOCKS_CANDIDATES'] = ''
            for name in ('READER_GIT_LOCKS', 'READER_GIT_LOCKS_STORE', 'GIT_LOCKS_STORE'):
                os.environ.pop(name, None)
            if chat_options is not None:
                chat_options['git_locks'] = None
            if writing_options is not None:
                writing_options['git_locks'] = None
            local.pop('gpu_lock', None)
        if '--companions' in sys.argv:
            # Fake git, cargo and launchctl (tests/fake_toolchain.py): Install "builds" a colorful that runs
            # fake_colorful.py. Colorful starts missing; AI-TTS has no daemon. Nothing is cloned or built.
            sys.path.insert(0, str(Path(__file__).parent))
            import fake_toolchain
            fake_toolchain.install(root / '.fake-tools', ('git', 'cargo', 'launchctl'))
            home = root / '.fake-home'
            home.mkdir()
            prose = Prose(environ={'PATH': str(root / '.fake-home'), 'HOME': str(home)})
            # A stand-in for scripts/install_wide_md.py, so a wide-md Install never runs the real one.
            (root / '.fake-code/scripts').mkdir(parents=True)
            (root / '.fake-code/scripts/install_wide_md.py').write_text('import time\nprint("fake wide-md install", flush=True)\ntime.sleep(1)\nraise SystemExit(1)\n')
            companions = {'environ': {'PATH': f'{root / ".fake-tools"}:/usr/bin:/bin', 'HOME': str(home), 'FAKE_CARGO_SLEEP': '4',
                                      'READER_GIT_LOCKS_CANDIDATES': '', 'READER_CLI_CANDIDATES': '', 'FAKE_TOOL_LOG': str(root / '.fake-tools/calls.jsonl')},
                          'launchctl': str(root / '.fake-tools/launchctl'), 'code': root / '.fake-code'}
        if companions is None:
            # Never this Mac's companions: no ai-tts CLI or launch agent, no cargo, no agent CLIs, and launchctl is never reachable.
            (root / '.no-home').mkdir(exist_ok=True)
            companions = {'environ': {'PATH': '/usr/bin:/bin', 'HOME': str(root / '.no-home'), 'READER_GIT_LOCKS_CANDIDATES': '', 'READER_CLI_CANDIDATES': ''},
                          'launchctl': str(root / '.no-launchctl')}
        if '--chat-owned' in sys.argv:
            # Another Reader server owns chat for this vault (#20, #72): this fixture holds the supervisor lock and leaves
            # owner state with a queued turn, which the server under test must neither recover nor rewrite.
            from reader_mcp.voice_runner import Supervisor
            runtime = root / '.reader/voice-runner'
            other_owner = Supervisor(runtime, host='other-owner')
            assert other_owner.acquire()
            (runtime / 'state.json').write_text(json.dumps({'updated_at': '2026-01-01T00:00:00+00:00', 'supervisor_pid': 1, 'active': None, 'queue': ['t1'],
                                                            'turns': {'t1': {'id': 't1', 'chat_id': 'c1', 'voice': 'Claude', 'state': 'queued'}}}, indent=2) + '\n')
        if '--art-owned' in sys.argv:
            # Another Reader server owns art for this vault (#138): this fixture holds the art supervisor lock as another host
            # and leaves owner jobs (one running, one queued) that the server under test must neither recover nor run.
            from reader_mcp.voice_runner import Supervisor
            runtime = root / '.reader/art'
            other_owner = Supervisor(runtime, host='other-owner', name='fixture-art-owner')
            assert other_owner.acquire()
            (runtime / 'jobs.json').write_text(json.dumps({'schema_version': 1, 'updated_at': '2026-01-01T00:00:00+00:00', 'jobs': [
                {'id': 'art-ownedrun0000', 'path': 'library/issue/cover.md', 'title': 'The owner is making this', 'sha256': '0' * 64, 'producer': 'voice:Painter',
                 'producer_label': 'Painter', 'model': 'fake-model-1', 'state': 'running', 'stage': 'scene', 'message': 'Composing the scene',
                 'queued_at': '2026-01-01T00:00:02+00:00', 'started_at': '2026-01-01T00:00:03+00:00', 'owner_pid': 999999, 'auto': False},
                {'id': 'art-ownedwait000', 'path': 'library/issue/keep.md', 'title': 'The owner queued this', 'sha256': '0' * 64, 'producer': 'voice:Painter',
                 'producer_label': 'Painter', 'model': 'fake-model-1', 'state': 'queued', 'stage': None, 'message': 'Waiting to start',
                 'queued_at': '2026-01-01T00:00:01+00:00', 'owner_pid': 999999, 'auto': True}]}, indent=1) + '\n')
        coding_options, coding_world = None, None
        if '--coding' in sys.argv:
            # Coding jobs (RW-44): library/audit.md carries a prompt block for acme/widget, registered against a real local Git
            # fixture (a bare "remote", a dirty checkout, a worktree folder) outside the vault, with a fake coding CLI and an
            # in-process fake GitHub. `--coding-scenario JSON` sets the fake agent's behavior (tests/fake_coding_cli.py).
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from coding_fixture import World
            scenario = json.loads(sys.argv[sys.argv.index('--coding-scenario') + 1]) if '--coding-scenario' in sys.argv else {}
            coding_world = World(Path(tempfile.mkdtemp(prefix='reader-coding-fixture-')), vault=root, scenario=scenario,
                                 verify_exit=1 if '--coding-verify-fails' in sys.argv else 0)
            coding_options = coding_world.options()
        library = WebLibrary(root, writing_options=writing_options, font_fetcher=fetcher, maintenance_runners=runners, inbox_environ=inbox_environ, chat_options=chat_options, local_model=local, prose=prose, service_runner=service, companions=companions, art_options=art_options, coding_options=coding_options)
        if art_options and '--art-none' not in sys.argv:
            from reader_mcp.art import PROMPT_VERSIONS
            from reader_mcp.art_scene import validate
            arts = [('library/issue/cover.md', 'books'), ('library/issue/keep.md', 'loom')]
            if '--art-long' in sys.argv:
                # A long article with art (#145): its hero opens it; late blocks, headings and spreads stay reachable.
                (root / 'library/issue/long-art.md').write_text('---\ntitle: "A long piece with art"\nauthor: Ada\n---\n\n# A long piece with art\n\n' + ''.join(
                    f'## Part {i}\n\n' + f'Part {i} opens with a plain sentence about tides and ledgers. ' * 9 + f'\n\nThe distinct remark for part {i} rests here.\n\n' for i in range(1, 41)))
                arts.append(('library/issue/long-art.md', 'halo'))
            for target, name in arts:
                if not (root / target).exists():
                    continue
                entry = json.loads((demo / (name + '.json')).read_text())
                scene, counts = validate(entry['scene'])
                library.art.save({'path': target, 'sha256': library.digest(target), 'auto': False, 'log': None}, entry['title'], entry['brief'], scene, counts, {
                    'prompts': {k: (v if k != 'repair' else None) for k, v in PROMPT_VERSIONS.items()}, 'seconds': 131.0, 'stages': [], 'repaired': False,
                    'usage': {'input_tokens': 21000, 'output_tokens': 5200, 'usd': 0.31},
                    'producer': {'id': 'voice:Painter', 'kind': 'voice', 'label': 'Painter', 'model': 'fake-model-1', 'cli': 'art-voice', 'cli_version': None}})
            gitrun('add', '-A'); gitrun('commit', '-q', '-m', 'Synthetic art')
        if '--search-page' in sys.argv:
            search_page_fixture(root, works, library)
        server = WebServer(('127.0.0.1', 0), library, 'Browser tester')
        if '--chat-heartbeat' in sys.argv:
            server.chat_heartbeat = float(sys.argv[sys.argv.index('--chat-heartbeat') + 1])
        print(json.dumps({'url':f'http://127.0.0.1:{server.server_port}', 'speech':speech_folder, 'root': str(root), 'providers': providers, 'now': os.environ.get(clock.ENV)}), flush=True)
        try:
            server.serve_forever()
        finally:
            server.library.close()
            fake_lmstudio.stop(root / '.fake-lms')
            server.server_close()
            if fake:
                fake.close()
            import shutil
            shutil.rmtree(speech_folder, ignore_errors=True)
            if coding_world:
                shutil.rmtree(coding_world.tmp, ignore_errors=True)


class ConceptModel:
    """Deterministic test vectors over a few concept words: plumbing evidence, not semantic quality."""
    CONCEPTS = [('library', 'stacks', 'shelves', 'books', 'archive'), ('harbor', 'tide', 'lighthouse', 'boats', 'sea'),
                ('ledger', 'accounts', 'balance', 'audit'), ('thought', 'observation', 'passage', 'careful')]

    def vector(self, text):
        import re
        import numpy as np
        words = re.findall(r'\w+', text.casefold())
        return np.array([sum(words.count(w) for w in group) for group in self.CONCEPTS] + [0.05], dtype=np.float32)

    def passage_embed(self, texts, **kwargs):
        for text in texts:
            yield self.vector(text)

    def query_embed(self, text):
        import numpy as np
        vector = self.vector(text)
        if 'kept' in text.casefold():  # "somewhere volumes are kept" leans on the library concept.
            vector = vector + np.array([1, 0, 0, 0, 0], dtype=np.float32)
        yield vector


def shapes_fixture(root, works, embed=True):
    """Article shapes (with --magazine): a long wandering cover essay, a tight feature note, short related works, an index."""
    sys.path.insert(0, str(Path(__file__).parent))
    from shape_fixture import TopicModel, neighbours, tight, wandering
    from reader_mcp.search import Search
    by_path = {w['primary']: w for w in works}
    for path, text in {'library/issue/cover.md': wandering('The distance between the map and the coast'),
                       'library/issue/keep.md': tight('A ledger that remembers the tide')}.items():
        (root / path).write_text(text)
        if path in by_path:
            by_path[path]['primary_bytes'] = len(text.encode())
    (root / 'library/near').mkdir(exist_ok=True)
    for path, text in neighbours().items():
        (root / path).write_text(text)
        works.append(dict(id=path, title=text.split('\n')[0][2:], primary=path, authors=['Cy'], topics=['Ideas'], projects=['Elsewhere'],
                          types=['Note'], date='2026-01-05', primary_format='.md', primary_bytes=len(text.encode())))
    (root / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-23', 'works': works}))
    engine = Search(root)
    engine._model = TopicModel()
    engine._signature = 'topic-model'
    engine.index(embed)


def search_page_fixture(root, works, library):
    """Works across projects, authors, types and dates; a reading copy, a bundle, a machine file, a read work."""
    import hashlib
    from reader_mcp.engagement import Engagement
    from reader_mcp.search import Search
    (root / 'library/essays').mkdir()
    (root / 'library/reports/ledger').mkdir(parents=True)
    harbor = ('---\ntitle: Keepers of the harbor\nauthor: Bo\n---\n\n# Keepers of the harbor\n\n'
              + 'The lighthouse keeper logs each tide with a careful observation of the boats. ' * 3
              + '\n\nAt night the sea is quiet and the beam turns.\n')
    (root / 'library/essays/harbor.md').write_text(harbor)
    (root / 'library/essays/harbor.reading.md').write_text(harbor)
    (root / 'library/essays/stacks.md').write_text('# Rooms of shelves\n\nWhere the stacks rise, books wait on shelves in the archive.\n')
    (root / 'library/reports/ledger/index.md').write_text('---\ntitle: Ledger report\n---\n\n# Ledger report\n\nCatalog note.\n')
    (root / 'library/reports/ledger/ledger-report.md').write_text('# Ledger report\n\nThe audit balanced the accounts. One observation: the ledger was late. Raw record: {"observation":"'
                                                                     + ''.join(f'{i:02x}' for i in range(120)) + '"}\n')
    (root / 'library/reports/ledger/receipt.json').write_text('{"observation": "a delivery receipt"}')
    works += [
        dict(id='library/essays/harbor.md', title='Keepers of the harbor', primary='library/essays/harbor.md', path='library/essays/harbor.md',
             authors=['Bo'], topics=['Harbors'], projects=['Harbor'], types=['Essay'], date='2026-10-20', primary_format='.md', primary_bytes=len(harbor)),
        dict(id='library/essays/stacks.md', title='Rooms of shelves', primary='library/essays/stacks.md', path='library/essays/stacks.md',
             authors=['Cy'], topics=['Libraries'], projects=['Harbor'], types=['Note'], date='2026-09-01', primary_format='.md', primary_bytes=80),
        dict(id='library/reports/ledger/index.md', title='Ledger report', primary='library/reports/ledger/ledger-report.md',
             path='library/reports/ledger/index.md', authors=['Cy'], topics=['Ledgers'], projects=['Ledger'], types=['Report'],
             date='2025-01-05', primary_format='.md', primary_bytes=90)]
    (root / 'indexes/coverage.json').write_text(json.dumps({'as_of': '2026-10-23', 'works': works}))
    engine = Search(root)
    engine._model = ConceptModel()
    engine.index(True)
    library.engine._model = ConceptModel()
    digest = hashlib.sha256((root / 'library/essays/stacks.md').read_bytes()).hexdigest()
    Engagement(root).seen('Browser tester', [{'key': 'document:library/essays/stacks.md', 'version': digest}])


if __name__ == '__main__':
    main()
