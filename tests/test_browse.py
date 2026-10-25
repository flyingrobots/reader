import json
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest

from reader_mcp.browse import Browse
from reader_mcp.store import Store, Submission

TODAY = date(2026, 10, 22)


def note(root, path, header, body='A paragraph.'):
    p=root/path;p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text('---\n'+header+'\n---\n'+body+'\n');return p


@pytest.fixture
def vault(tmp_path):
    (tmp_path/'inbox').mkdir();(tmp_path/'library').mkdir();(tmp_path/'README.md').write_text('# Reader\n\nKeep this introduction.\n')
    return tmp_path


def test_bundle_grouping_attribution_and_source_preservation(vault):
    attachment=vault/'diagram.svg';attachment.write_text('<svg/>')
    r=Store(vault).ingest(Submission(request_id=uuid4(),title='A delivered design',markdown='Source text',provenance={'author':'Original author','project':'Compiler'},attachments=[{'source_path':str(attachment),'path':'diagram.svg'}]))
    folder=vault/'library/reports/design';folder.parent.mkdir();(vault/r['bundle_path']).rename(folder)
    note(vault,'library/reports/design/index.md','title: Wrapper\ntype: report\nkind: catalog\nauthor: Reader librarian (intake worker)')
    note(vault,'library/reports/design/source.reading.md','title: Derivative\nkind: reading-copy\nreading_source: source.md')
    note(vault,'library/reports/design/reading-notes.md','title: My interpretation\nauthor: Reader librarian\nwriting_type: Reading notes\nadded: 2026-10-22')
    before={str(p):p.read_bytes() for p in folder.iterdir()}
    result=Browse(vault).run(today=TODAY);data=json.loads((vault/'indexes/coverage.json').read_text())
    assert result['work_entries']==2
    original=next(u for u in data['works'] if u['title']=='A delivered design')
    assert original['authors']==['Original author'] and original['projects']==['Compiler']
    assert {str(p):p.read_bytes() for p in folder.iterdir()}==before
    assert not (vault/'engagement').exists() and not (vault/'curation').exists()


def test_packet_group_and_nested_receipts_are_not_double_counted(vault):
    note(vault,'library/books/geometry/index.md','title: Geometry\ntype: book\nkind: catalog\nauthor: Reader librarian\nadded: 2026-10-20')
    (vault/'library/books/geometry/complete.txt').write_text('Long text '*500)
    note(vault,'library/books/geometry/chapter.md','title: Chapter\nauthor: Writer')
    note(vault,'library/reports/set/index.md','title: Group navigation\ntype: collection')
    for i in range(2):
        r=Store(vault).ingest(Submission(request_id=uuid4(),title='Same title',markdown='Separate edition'))
        folder=vault/f'library/reports/set/{i}';folder.parent.mkdir(exist_ok=True);(vault/r['bundle_path']).rename(folder)
    data=Browse(vault).inventory({})
    assert len(data)==3 and len([u for u in data if u['title']=='Same title'])==2
    book=next(u for u in data if u['title']=='Geometry')
    assert book['authors']==['Unspecified author'] and book['primary'].endswith('complete.txt')
    assert book['primary_bytes']==5000


def test_weeks_are_arrivals_not_source_dates_and_unknowns_remain_unknown(vault):
    note(vault,'library/essays/one.md','title: One\nauthor:\n  - A\n  - B\nadded: 2026-10-19\ncreated: 1999-01-01\nupdated: 2026-10-22')
    note(vault,'library/essays/two.md','title: Two\nauthor: A\ncreated: 2000-01-01')
    Browse(vault).run(today=TODAY);u=json.loads((vault/'indexes/coverage.json').read_text())['works']
    one=next(x for x in u if x['title']=='One');two=next(x for x in u if x['title']=='Two')
    assert one['week'].startswith('2026-W43') and one['authors']==['A','B']
    assert two['date'] is None and two['week']=='Unknown arrival week'
    assert 'Unknown arrival week' in (vault/'indexes/by-week.md').read_text()
    assert '2000-01-01' not in (vault/'README.md').read_text()


def test_topics_do_not_match_the_universal_library_prefix(vault):
    note(vault,'library/physics/one.md','title: Motion\nauthor: A')
    units=Browse(vault).inventory({'topics':[{'name':'Library','terms':['library']} ]})
    assert units[0]['topics']==['Unclassified topic']


def test_check_detects_new_work_and_never_writes_and_refresh_is_idempotent(vault):
    note(vault,'library/essays/a.md','title: A\nauthor: A')
    browse=Browse(vault);browse.run(today=TODAY)
    assert browse.run(check=True,today=TODAY)['status']=='current'
    before=(vault/'README.md').read_bytes()
    note(vault,'library/essays/b.md','title: B\nauthor: B')
    assert browse.run(check=True,today=TODAY)['status']=='stale'
    assert (vault/'README.md').read_bytes()==before
    browse.run(today=TODAY)
    assert browse.run(today=TODAY)['changed']==[]
    assert (vault/'README.md').read_text().count('reader-dashboard:start')==1
    assert 'Keep this introduction.' in (vault/'README.md').read_text()


def test_limits_and_unowned_outputs_preserve_prior_publication(vault,monkeypatch):
    import reader_mcp.browse as module
    note(vault,'library/essays/a.md','title: A\nauthor: A')
    browse=Browse(vault);browse.run(today=TODAY);before=(vault/'README.md').read_bytes()
    monkeypatch.setattr(module,'MAX_METADATA_BYTES',2)
    with pytest.raises(ValueError,match='32 MiB'):browse.run(today=TODAY)
    assert (vault/'README.md').read_bytes()==before
    monkeypatch.setattr(module,'MAX_METADATA_BYTES',32*1024**2)
    (vault/'indexes/by-topic.md').write_text('A human-owned page.')
    with pytest.raises(ValueError,match='unowned'):browse.run(today=TODAY)
    assert (vault/'indexes/by-topic.md').read_text()=='A human-owned page.'


def test_symlink_and_concurrent_changes_refuse_before_publication(vault,monkeypatch):
    outside=vault/'outside';outside.mkdir();(vault/'indexes').symlink_to(outside,target_is_directory=True)
    with pytest.raises(ValueError,match='Unsafe'):Browse(vault).run(today=TODAY)
    assert not list(outside.iterdir());(vault/'indexes').unlink()
    note(vault,'library/one.md','title: One')
    b=Browse(vault);scan=b.scan;calls=0
    def changing():
        nonlocal calls
        calls+=1
        data=scan()
        if calls==2:data['new.md']=(0,0)
        return data
    monkeypatch.setattr(b,'scan',changing)
    with pytest.raises(ValueError,match='changed during'):b.run(today=TODAY)
    assert not (vault/'indexes').exists()


def test_escaped_links_svg_and_empty_library(vault):
    Browse(vault).run(today=TODAY)
    note(vault,'library/essays/a #1.md','title: "A [link] | <tag>"\nauthor: "A < B"\nadded: 2026-10-22')
    Browse(vault).run(today=TODAY)
    text=(vault/'indexes/by-author.md').read_text()
    assert 'a%20%231.md' in text and '&lt;tag&gt;' in text
    import xml.etree.ElementTree as ET
    for p in (vault/'indexes/assets').glob('*.svg'):ET.fromstring(p.read_text())
    assert '&lt;' in (vault/'README.md').read_text()


def test_standalone_pdf_uses_sidecar_without_loading_pdf(vault):
    p=vault/'library/papers/paper.pdf';p.parent.mkdir();p.write_bytes(b'%PDF-1.0 synthetic')
    note(vault,'catalog/metadata/papers/paper.pdf.md','title: Paper\nauthor: Scientist\nadded: 2026-10-20\ntype: Research')
    u=Browse(vault).inventory({})
    assert len(u)==1 and u[0]['authors']==['Scientist'] and u[0]['primary_bytes']==len(b'%PDF-1.0 synthetic')


def test_cli_check_exit_status_and_refresh(vault):
    import subprocess,sys
    args=[sys.executable,'-m','reader_mcp.cli','--root',str(vault),'browse']
    r=subprocess.run(args+['--check'],capture_output=True,text=True)
    assert r.returncode==1 and json.loads(r.stdout)['status']=='stale'
    assert subprocess.run(args,capture_output=True).returncode==0
    assert subprocess.run(args+['--check'],capture_output=True).returncode==0


def test_author_aliases_group_variants_keep_originals_and_expand_coauthors(vault):
    note(vault,'library/essays/a.md','title: A\nauthor: agy')
    note(vault,'library/essays/b.md','title: B\nauthor: Agy')
    note(vault,'library/essays/c.md','title: C\nauthor: James Ross with Codex')
    settings={'author_aliases':{'agy':['Agy'],'james ross with codex':['James Ross','Codex']}}
    before=(vault/'library/essays/a.md').read_bytes()
    units=Browse(vault).inventory(settings)
    assert [u['authors'] for u in units if u['title'] in {'A','B'}]==[['Agy'],['Agy']]
    c=next(u for u in units if u['title']=='C')
    assert c['authors']==['Codex','James Ross'] and c['source_authors']==['James Ross with Codex']
    assert (vault/'library/essays/a.md').read_bytes()==before


def test_receipt_timezone_defines_week_and_retains_precise_recency(vault):
    r=Store(vault).ingest(Submission(request_id=uuid4(),title='Sunday locally',markdown='Source'))
    folder=vault/'library/reports/one';folder.parent.mkdir();(vault/r['bundle_path']).rename(folder)
    p=folder/'receipt.json';receipt=json.loads(p.read_text());receipt['received_at']='2026-10-18T23:30:00-02:00';p.write_text(json.dumps(receipt))
    u=Browse(vault).inventory({})[0]
    assert u['date']=='2026-10-19' and u['week'].startswith('2026-W43')
    assert u['arrival_time']=='2026-10-19T01:30:00+00:00'
