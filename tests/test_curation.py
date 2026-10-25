import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest

from reader_mcp.catalog import Catalog
from reader_mcp.curation import Curation
from reader_mcp.engagement import Engagement
from reader_mcp.store import Store, Submission


@pytest.fixture
def vault(tmp_path):
    (tmp_path/'library').mkdir(); (tmp_path/'inbox').mkdir()
    (tmp_path/'library/index.md').write_text('# Library\n')
    return tmp_path


def filed(vault, title='Source', body='A source paragraph.\n'):
    receipt=Store(vault).ingest(Submission(request_id=uuid4(),title=title,markdown=body))
    destination=vault/'library/reports'/receipt['id']
    destination.parent.mkdir(exist_ok=True)
    (vault/receipt['bundle_path']).rename(destination)
    (destination/'index.md').write_text('# Catalog context\n')
    Catalog(vault).run('migrate')
    return 'receipt:'+receipt['id'], destination


def source_coverage(unit, full=False):
    member=unit['sources'][0]
    return [{**member, 'scope':'Complete raw source' if full else 'Selected introduction', 'full':full}]


def test_other_filer_and_empty_inbox_still_discover_one_packet(vault):
    attachment=vault/'chart.txt';attachment.write_text('attachment bytes')
    receipt=Store(vault).ingest(Submission(request_id=uuid4(),title='A delivered work',markdown='Original',
                                         attachments=[{'source_path':str(attachment),'path':'chart.txt'}]))
    folder=vault/'library/reports/packet';folder.parent.mkdir();(vault/receipt['bundle_path']).rename(folder)
    (folder/'index.md').write_text('# Work\n')
    (folder/'report.reading.md').write_text('---\ntitle: Reading copy\ntype: note\nadded: 2026-10-07\nkind: reading-copy\nreading_source: library/reports/packet/report.md\n---\nDerived\n')
    (folder/'reading-record.md').write_text('# Partial reading notes\n')
    Catalog(vault).run('migrate')
    c=Curation(vault);before={p:p.read_bytes() for p in folder.iterdir()}
    result=c.pending('Curator')
    assert not list((vault/'inbox').iterdir())
    assert result['total']==1 and result['pending'][0]['source_count']==2
    assert result['pending'][0]['title']=='A delivered work'
    assert not (vault/'curation').exists() and not (vault/'engagement').exists()
    assert {p:p.read_bytes() for p in folder.iterdir()}==before


def test_independent_curator_dispositions_do_not_mark_documents_read(vault):
    key,_=filed(vault);c=Curation(vault);unit=c.pending('A',key=key)['item']
    assert c.pending('A')['total']==c.pending('B')['total']==1
    c.mark('A',key,unit['version'],'scanned',source_coverage(unit))
    assert c.pending('A')['total']==0 and c.pending('B')['total']==1
    assert not (vault/'engagement').exists()
    assert not Engagement(vault).attention('A',unit['path'])['items'][0]['read']
    c.mark('A',key,unit['version'],'unscanned',[])
    assert c.pending('A')['total']==1 and c.pending('A')['pending'][0]['status']=='unscanned'


def test_source_and_catalog_context_changes_requeue_without_sql_refresh(vault):
    key,folder=filed(vault);c=Curation(vault);unit=c.pending('A',key=key)['item']
    c.mark('A',key,unit['version'],'scanned',source_coverage(unit))
    source=vault/unit['path'];source.write_text(source.read_text()+'New source content\n')
    pending=c.pending('A')['pending'][0]
    assert pending['status']=='changed' and pending['integrity']=='needs_attention'
    record=(vault/'curation').glob('*.json');before=next(record).read_bytes()
    with pytest.raises(ValueError,match='version changed'):
        c.mark('A',key,unit['version'],'scanned',source_coverage(unit))
    assert next((vault/'curation').glob('*.json')).read_bytes()==before
    newer=c.pending('A',key=key)['item'];c.mark('A',key,newer['version'],'scanned',source_coverage(newer))
    wrapper=folder/'index.md';wrapper.write_text(wrapper.read_text()+'Later review qualification\n')
    assert c.pending('A')['pending'][0]['status']=='changed'


def test_explicit_coverage_and_study_depth(vault):
    key,_=filed(vault);c=Curation(vault);unit=c.pending('A',key=key)['item']
    with pytest.raises(ValueError,match='explicit source coverage'):
        c.mark('A',key,unit['version'],'scanned',[])
    with pytest.raises(ValueError,match='full reading'):
        c.mark('A',key,unit['version'],'studied',source_coverage(unit))
    wrong=source_coverage(unit);wrong[0]['sha256']='0'*64
    with pytest.raises(ValueError,match='hash changed'):
        c.mark('A',key,unit['version'],'scanned',wrong)
    forged=source_coverage(unit);forged[0]['path']='library/outside.md'
    with pytest.raises(ValueError,match='current work member'):
        c.mark('A',key,unit['version'],'scanned',forged)
    context=[{**next(m for m in unit['context'] if m['path'].endswith('index.md')),
              'scope':'Catalog only','full':True}]
    with pytest.raises(ValueError,match='not only its catalog'):
        c.mark('A',key,unit['version'],'studied',context)
    c.mark('A',key,unit['version'],'studied',source_coverage(unit,True),note='Source fully read; no runtime audit')
    assert c.pending('A')['total']==0
    assert not (vault/'engagement').exists()


def test_duplicate_deliveries_and_direct_work_grouping(vault):
    first,_=filed(vault);second,_=filed(vault)
    direct=vault/'library/books/example';direct.mkdir(parents=True)
    (direct/'index.md').write_text('# A direct-drop book\n')
    (direct/'original.txt').write_text('Book source')
    (direct/'cover.png').write_bytes(b'cover')
    (direct/'reading-record.md').write_text('# A reading record\n')
    (vault/'library/reflection.md').write_text('# Standalone reflection\n')
    Catalog(vault).run('migrate');c=Curation(vault);units=c.pending('A')['pending']
    assert len(units)==4
    assert {first,second} <= {u['key'] for u in units}
    grouped=next(u for u in units if u['kind']=='collection-work')
    assert grouped['source_count']==2
    assert c.pending('A',key=grouped['key'])['item']['catalog_path'].endswith('/index.md')


def test_pages_and_timezone_filters_do_not_create_review_state(vault):
    for title,received in [('Earlier','2026-10-07T09:00:00-07:00'),('Boundary','2026-10-07T10:00:00-07:00'),('Later','2026-10-07T18:00:00+00:00')]:
        _,folder=filed(vault,title)
        p=folder/'receipt.json';d=json.loads(p.read_text());d['received_at']=received;p.write_text(json.dumps(d))
    Catalog(vault).run('sync');c=Curation(vault)
    first=c.pending('A',limit=1,since='2026-10-07T17:00:00Z')
    assert first['total']==2 and first['pending'][0]['title']=='Later' and first['next_offset']==1
    second=c.pending('A',offset=1,limit=1,since='2026-10-07T10:00:00-07:00',expected_snapshot=first['snapshot_version'])
    assert second['pending'][0]['title']=='Boundary' and second['next_offset'] is None
    with pytest.raises(ValueError,match='explicit timezone'):c.pending('A',since='2026-10-07T10:00:00')
    assert not (vault/'curation').exists()


def test_concurrent_participants_and_idempotent_same_record(vault):
    key,_=filed(vault);c=Curation(vault);unit=c.pending('A',key=key)['item'];coverage=source_coverage(unit)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda name:c.mark(name,key,unit['version'],'scanned',coverage),['A','B']))
    assert c.pending('A')['total']==c.pending('B')['total']==0
    before={p:p.read_bytes() for p in (vault/'curation').glob('*.json')}
    c.mark('A',key,unit['version'],'scanned',coverage)
    assert {p:p.read_bytes() for p in before}==before


def test_concurrent_library_change_and_corrupt_record_fail_closed(vault,monkeypatch):
    key,folder=filed(vault);c=Curation(vault)
    original=c.catalog.inventory;calls=0
    def changing_inventory():
        nonlocal calls
        calls+=1
        if calls==2:(folder/'report.md').write_text('Concurrent changed source')
        return original()
    monkeypatch.setattr(c.catalog,'inventory',changing_inventory)
    with pytest.raises(ValueError,match='changed during'):c.pending('A')
    assert not (vault/'curation').exists()
    monkeypatch.setattr(c.catalog,'inventory',original)
    unit=c.pending('A',key=key)['item'];c.mark('A',key,unit['version'],'scanned',source_coverage(unit))
    next((vault/'curation').glob('*.json')).write_text('{bad')
    with pytest.raises(ValueError,match='Invalid curation JSON'):c.pending('A')


def test_cli_curation_and_source_hash_bounds(vault):
    key,_=filed(vault)
    cmd=[sys.executable,'-m','reader_mcp.cli','--root',str(vault),'curation']
    listed=subprocess.run(cmd+['list','--participant','CLI curator','--key',key],capture_output=True,text=True,check=True)
    unit=json.loads(listed.stdout)['item']
    request=dict(participant='CLI curator',key=key,expected_version=unit['version'],status='scanned',coverage=source_coverage(unit))
    result=subprocess.run(cmd+['mark','-'],input=json.dumps(request),capture_output=True,text=True,check=True)
    assert json.loads(result.stdout)['review']['status']=='scanned'
    assert hashlib.sha256((vault/unit['path']).read_bytes()).hexdigest()==unit['sources'][0]['sha256']


def test_metadata_and_membership_changes_return_a_direct_work_to_queue(vault):
    from reader_mcp.catalog import emit, frontmatter
    folder=vault/'library/books/example';folder.mkdir(parents=True);(folder/'index.md').write_text('# Book\n')
    (folder/'chapter.txt').write_text('Chapter one')
    Catalog(vault).run('migrate');c=Curation(vault)
    first=c.pending('A')['pending'][0];unit=c.pending('A',key=first['key'])['item']
    c.mark('A',unit['key'],unit['version'],'scanned',source_coverage(unit))
    (folder/'chapter-two.txt').write_text('Chapter two');Catalog(vault).run('migrate')
    assert c.pending('A')['pending'][0]['status']=='changed'
    unit=c.pending('A',key=unit['key'])['item'];c.mark('A',unit['key'],unit['version'],'scanned',source_coverage(unit))
    row=next(r for r in Catalog(vault).prepare()[2] if r[2].endswith('chapter.txt'))
    owner=vault/row[-3];meta,body=frontmatter(owner.read_bytes());meta['title']='Qualified source title'
    meta['document_revision']+=1;owner.write_bytes(emit(meta,body))
    assert c.pending('A')['pending'][0]['status']=='changed'


def test_nested_reader_receipt_is_an_artifact_not_another_work(vault):
    store=Store(vault)
    inner=store.ingest(Submission(request_id=uuid4(),title='Archived inner receipt',markdown='Inner source'))
    folder=vault/inner['bundle_path']
    outer=store.ingest(Submission(request_id=uuid4(),title='Outer work',markdown='Outer source',attachments=[
        {'source_path':str(folder/'receipt.json'),'path':'nested/receipt.json'},
        {'source_path':str(folder/'report.md'),'path':'nested/report.md'}]))
    target=vault/'library/outer';(vault/outer['bundle_path']).rename(target)
    (target/'index.md').write_text('# Outer\n');Catalog(vault).run('migrate')
    queue=Curation(vault).pending('A')
    assert queue['total']==1 and queue['pending'][0]['source_count']==3
    assert queue['pending'][0]['key']=='receipt:'+outer['id']


def test_corrupt_reader_receipt_is_not_reclassified_as_a_reviewed_direct_work(vault):
    key,folder=filed(vault);c=Curation(vault);unit=c.pending('A',key=key)['item']
    c.mark('A',key,unit['version'],'scanned',source_coverage(unit))
    before=next((vault/'curation').glob('*.json')).read_bytes()
    (folder/'receipt.json').write_text('{broken')
    with pytest.raises(ValueError,match='Invalid receipt JSON'):c.pending('A')
    assert next((vault/'curation').glob('*.json')).read_bytes()==before


def test_publication_capacity_counts_old_record_and_abandoned_stage(vault,monkeypatch):
    import reader_mcp.curation as module
    key,_=filed(vault);c=Curation(vault);unit=c.pending('A',key=key)['item'];coverage=source_coverage(unit)
    c.mark('A',key,unit['version'],'scanned',coverage)
    record=next((vault/'curation').glob('*.json'));before=record.read_bytes()
    (vault/'curation/.curation-abandoned').write_bytes(b'x'*1000)
    monkeypatch.setattr(module,'MAX_TOTAL',len(before)+1001)
    with pytest.raises(ValueError,match='publication/staging'):
        c.mark('A',key,unit['version'],'scanned',coverage,note='New disposition')
    assert record.read_bytes()==before


def test_labelled_reading_copy_can_be_reviewed_without_marking_original_read(vault):
    key,folder=filed(vault);source=folder/'report.md';original=hashlib.sha256(source.read_bytes()).hexdigest()
    copy=folder/'report.reading.md';copy.write_text('---\ntitle: Reading edition\ntype: note\nadded: 2026-10-07\nkind: reading-copy\nreading_source: '+source.relative_to(vault).as_posix()+'\nreading_source_sha256: '+original+'\n---\nReading body\n')
    Catalog(vault).run('migrate');c=Curation(vault);unit=c.pending('A',key=key)['item']
    assert c.pending('A')['total']==1 and unit['source_count']==1
    edition=unit['reading_copies'][0];assert edition['current_source']
    coverage=[{'path':edition['path'],'sha256':edition['sha256'],'scope':'Complete labelled reading edition','full':True}]
    c.mark('A',key,unit['version'],'studied',coverage)
    assert c.pending('A')['total']==0 and not (vault/'engagement').exists()
    source.write_text(source.read_text()+'New original version\n')
    newer=c.pending('A',key=key)['item'];assert not newer['reading_copies'][0]['current_source']
    with pytest.raises(ValueError,match='current reading copy'):
        c.mark('A',key,newer['version'],'studied',coverage)


def test_pagination_refuses_a_concurrently_changed_queue(vault):
    filed(vault,'First');filed(vault,'Second');c=Curation(vault)
    first=c.pending('A',limit=1)
    filed(vault,'New arrival')
    with pytest.raises(ValueError,match='restart paging'):
        c.pending('A',offset=first['next_offset'],limit=1,expected_snapshot=first['snapshot_version'])
    refreshed=c.pending('A',limit=1)
    assert refreshed['total']==3 and refreshed['pending'][0]['title']=='New arrival'
    page=c.pending('A',offset=refreshed['next_offset'],limit=1,expected_snapshot=refreshed['snapshot_version'])
    assert page['snapshot_version']==refreshed['snapshot_version']


def test_semantically_corrupt_disposition_cannot_clear_the_queue(vault):
    key,_=filed(vault);c=Curation(vault);unit=c.pending('A',key=key)['item']
    c.mark('A',key,unit['version'],'scanned',source_coverage(unit))
    p=next((vault/'curation').glob('*.json'));record=json.loads(p.read_text())
    record['items'][key]['coverage']=[];p.write_text(json.dumps(record))
    with pytest.raises(ValueError,match='missing coverage'):c.pending('A')
