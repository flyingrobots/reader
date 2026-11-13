import json
from datetime import date
from pathlib import Path, PurePath
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


def grouping_cases(vault):
    """Overlapping roots, lexical siblings and both kinds of nested receipt."""
    note(vault,'library/reports/package/index.md','title: Package\nkind: catalog\nauthor: Package author')
    note(vault,'library/reports/package/source.md','title: Hidden source')
    note(vault,'library/reports/package/nested/index.md','title: Nested catalog')
    note(vault,'library/reports/package/nested/source.md','title: Hidden nested source')
    note(vault,'library/reports/package/aside.md','title: Package aside\nauthor: Essay author\nwriting_type: Essay')
    note(vault,'library/reports/package-neighbor/source.md','title: Lexical neighbor\nauthor: Neighbor author')
    note(vault,'library/reports/navigation/index.md','title: Navigation over receipts')
    note(vault,'library/reports/navigation/loose.md','title: Loose work beside receipts')

    def delivered(folder, title, attachments=None):
        receipt=Store(vault).ingest(Submission(request_id=uuid4(),title=title,markdown='Preserved source.',
            provenance={'author':'Source author'},attachments=attachments or []))
        target=vault/folder;target.parent.mkdir(parents=True,exist_ok=True)
        (vault/receipt['bundle_path']).rename(target)
        return receipt['id']

    # The attached receipt is payload, while a separate delivery under it remains a work.
    attachment=vault/'attached-receipt.json';attachment.write_text('{"reader_receipt": 1}')
    outer=delivered('library/reports/navigation/outer','Outer delivery',
                    [{'source_path':str(attachment),'path':'attached/receipt.json'}])
    inner=delivered('library/reports/navigation/outer/inner','Nested delivery')
    note(vault,'library/reports/navigation/outer/index.md','title: Delivery wrapper\nkind: catalog')
    note(vault,'library/reports/navigation/outer/aside.md','title: Delivery aside\nwriting_type: Essay')
    return outer,inner


def test_group_ancestry_preserves_nested_receipts_writing_and_siblings(vault):
    outer,inner=grouping_cases(vault)
    before={p.relative_to(vault):p.read_bytes() for p in (vault/'library').rglob('*') if p.is_file()}
    units=Browse(vault).inventory({})
    assert [u['title'] for u in units]==['Delivery aside','Lexical neighbor','Loose work beside receipts',
                                       'Nested delivery','Outer delivery','Package','Package aside']
    deliveries=[u for u in units if u['id'].startswith('receipt:')]
    assert {u['id'] for u in deliveries}=={'receipt:'+outer,'receipt:'+inner}
    assert all(u['authors']==['Source author'] for u in deliveries)
    assert next(u for u in units if u['title']=='Package')['authors']==['Package author']
    assert next(u for u in units if u['title']=='Outer delivery')['path'].endswith('/outer/index.md')
    Browse(vault).run(today=TODAY)
    outputs={p.relative_to(vault):p.read_bytes() for p in (vault/'indexes').rglob('*') if p.is_file()}
    outputs[Path('README.md')]=(vault/'README.md').read_bytes()
    assert json.loads(outputs[Path('indexes/coverage.json')])['works']==units
    assert Browse(vault).run(check=True,today=TODAY)['status']=='current'
    assert Browse(vault).run(today=TODAY)['changed']==[]
    assert all((vault/p).read_bytes()==data for p,data in outputs.items())
    assert all((vault/p).read_bytes()==data for p,data in before.items())


@pytest.mark.parametrize('kind',['catalog','receipt'])
def test_group_membership_cost_grows_with_files_not_all_groups(tmp_path,monkeypatch,kind):
    relative=PurePath.is_relative_to;equal=PurePath.__eq__
    counts=[]
    for total in (40,80):
        root=tmp_path/str(total)
        for i in range(total):
            folder=root/'library/reports'/str(i)
            note(root,str(folder.relative_to(root)/'source.md'),'title: Source')
            if kind=='catalog':
                note(root,str(folder.relative_to(root)/'index.md'),'title: Catalog\nkind: catalog')
            else:
                (folder/'receipt.json').write_text(json.dumps({'reader_receipt':1,'id':str(i),
                    'document':'source.md','files':[{'path':'source.md'}],'title':'Delivery'}))
                note(root,str(folder.relative_to(root)/'aside.md'),'title: Aside\nwriting_type: Essay')
        operations=0
        def related(path,*args):
            nonlocal operations
            operations+=1
            return relative(path,*args)
        def compared(path,other):
            nonlocal operations
            operations+=1
            return equal(path,other)
        with monkeypatch.context() as patch:
            patch.setattr(PurePath,'is_relative_to',related)
            patch.setattr(PurePath,'__eq__',compared)
            units=Browse(root).inventory({})
        assert len(units)==total*(2 if kind=='receipt' else 1)
        counts.append(operations)
    assert counts[0]>0
    assert counts[1]*2<=counts[0]*5, counts


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


def test_navigation_author_comes_from_settings_and_defaults_unchanged(vault):
    note(vault,'library/a.md','title: A\nauthor: Someone\nadded: 2026-10-20')
    Browse(vault).run(today=TODAY)
    assert '\nauthor: Reader librarian\n' in (vault/'indexes/index.md').read_text(),'default bytes unchanged'
    (vault/'indexes/settings.json').write_text(json.dumps({'navigation_author':'Demo: the editors'}))
    Browse(vault).run(today=TODAY)
    assert '\nauthor: "Demo: the editors"\n' in (vault/'indexes/by-author.md').read_text(),'quoted when not plain'
    (vault/'indexes/settings.json').write_text(json.dumps({'navigation_author':'two\nlines'}))
    with pytest.raises(ValueError,match='navigation_author'):
        Browse(vault).run(today=TODAY)


def test_receipt_wrapper_and_opening_byline_attribution_fallbacks(vault):
    r1=Store(vault).ingest(Submission(request_id=uuid4(),title='Wrapper attributed',markdown='Body without header.'))
    f1=vault/'library/reports/wrapped';f1.parent.mkdir(parents=True);(vault/r1['bundle_path']).rename(f1)
    note(vault,'library/reports/wrapped/index.md','title: Wrapper\ntype: report\nkind: catalog\nauthor: External Writer')

    r2=Store(vault).ingest(Submission(request_id=uuid4(),title='Role withheld',markdown='Plain opening body.'))
    f2=vault/'library/reports/role-only';(vault/r2['bundle_path']).rename(f2)
    note(vault,'library/reports/role-only/index.md','title: Wrapper\ntype: report\nkind: catalog\nauthor: Reader intake')

    r2b=Store(vault).ingest(Submission(request_id=uuid4(),title='Legacy wrapper role withheld',markdown='Plain opening body.'))
    f2b=vault/'library/reports/legacy-role';(vault/r2b['bundle_path']).rename(f2b)
    note(vault,'library/reports/legacy-role/index.md','title: Legacy wrapper\ntype: report\nauthor: Reader librarian (worker)')

    r3=Store(vault).ingest(Submission(request_id=uuid4(),title='Byline inside receipt',
                                      markdown='---\ntitle: Inner\n---\n\nWritten by Ada Lovelace\n\nMain body.'))
    f3=vault/'library/reports/byline-receipt';(vault/r3['bundle_path']).rename(f3)
    note(vault,'library/reports/byline-receipt/index.md','title: Wrapper\ntype: report\nkind: catalog\nauthor: Reader librarian')

    (vault/'library/essays').mkdir(parents=True)
    (vault/'library/essays/no-frontmatter.md').write_text('Written by Grace Hopper\n\nDetails follow.\n')
    note(vault,'library/essays/prose-by.md','title: Prose By\nadded: 2026-10-22','By default, the build skips caches.')
    note(vault,'library/essays/reading-notes.md','title: My Reading Notes\nauthor: Reader librarian\nsource_author: Original Author\nwriting_type: Reading notes\nadded: 2026-10-22','Notes on the text.')
    note(vault,'library/reports/blank-source-author/index.md','title: Blank Source Author\ntype: report\nkind: catalog\nsource_author: "   "\nauthor: Ada Lovelace\nadded: 2026-10-22')

    units={u['title']:u['authors'] for u in Browse(vault).inventory({})}
    assert units['Blank Source Author']==['Ada Lovelace']
    assert units['Wrapper attributed']==['External Writer']
    assert units['Role withheld']==['Unspecified author']
    assert units['Legacy wrapper role withheld']==['Unspecified author']
    assert units['Byline inside receipt']==['Ada Lovelace']
    assert units['no-frontmatter']==['Grace Hopper']
    assert units['Prose By']==['Unspecified author']
    assert units['My Reading Notes']==['Reader librarian']
