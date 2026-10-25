"""Read next ranking: relatedness pool, then unread first and latest first."""
import sqlite3

import numpy as np

from reader_mcp.related import Related
from reader_mcp.search import pack


def work(name, date, projects=('P',), topics=('T',), title=None):
    return dict(title=title or name, primary=f'library/{name}.md', path=f'library/{name}.md', authors=['Ada'],
                projects=list(projects), topics=list(topics), date=date)


def index(root, vectors):
    (root / '.reader').mkdir(exist_ok=True)
    con = sqlite3.connect(root / '.reader/search.v2.sqlite3')
    con.executescript('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); '
                      'CREATE TABLE passages (id INTEGER PRIMARY KEY, vector BLOB); '
                      'CREATE TABLE chunks (id INTEGER PRIMARY KEY, path TEXT, passage_id INTEGER);')
    con.execute("INSERT INTO settings VALUES ('indexed_at', '2026-10-24T00:00:00+00:00'), ('version', '2')")
    for path, vector in vectors.items():
        passage = con.execute('INSERT INTO passages(vector) VALUES (?)', (pack(vector),)).lastrowid
        con.execute('INSERT INTO chunks(path, passage_id) VALUES (?, ?)', (path, passage))
    con.commit()
    con.close()


def test_metadata_only_unread_first_then_latest(tmp_path):
    works = [work('current', '2026-10-01'), work('old-unread', '2026-09-01'), work('new-read', '2026-10-20'),
             work('new-unread', '2026-10-10'), work('elsewhere', '2026-10-23', projects=('Q',), topics=('U',))]
    read = {'library/new-read.md'}
    result = Related(tmp_path).suggest('library/current.md', works, lambda w: w['primary'] in read)
    assert [i['primary'] for i in result['items']] == ['library/new-unread.md', 'library/old-unread.md', 'library/new-read.md']
    assert result['items'][0]['reasons'] == ['P', 'T'] and result['embedded'] is False


def test_fills_with_new_unread_works_and_skips_same_title(tmp_path):
    works = [work('current', '2026-10-01', title='Plan (draft)'), work('copy', '2026-10-02', title='Plan (final)'),
             work('a', '2026-10-05', projects=('X',), topics=('Y',)), work('b', '2026-10-06', projects=('X',), topics=('Y',))]
    result = Related(tmp_path).suggest('library/current.md', works, lambda w: False)
    assert [i['primary'] for i in result['items']] == ['library/b.md', 'library/a.md']
    assert all(i['reasons'] == ['New in the library'] for i in result['items'])


def test_embeddings_skip_near_copies_and_repeat_picks(tmp_path):
    works = [work('current', '2026-10-01', projects=(), topics=()), work('copy', '2026-10-09', projects=(), topics=()),
             work('twin-a', '2026-10-08', projects=(), topics=()), work('twin-b', '2026-10-07', projects=(), topics=()),
             work('other', '2026-10-06', projects=(), topics=())]
    index(tmp_path, {'library/current.md': [1, 0, 0], 'library/copy.md': [1, 0.01, 0],
                     'library/twin-a.md': [1, 1, 0], 'library/twin-b.md': [1, 1, 0.01], 'library/other.md': [1, 0, 1]})
    result = Related(tmp_path).suggest('library/current.md', works, lambda w: False)
    paths = [i['primary'] for i in result['items']]
    assert 'library/copy.md' not in paths, 'near-identical text is another edition'
    assert paths[:2] == ['library/twin-a.md', 'library/other.md'], 'twin-b repeats twin-a'
    assert result['items'][0]['reasons'] == ['Similar ideas'] and result['embedded'] is True
