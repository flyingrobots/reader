from concurrent.futures import ThreadPoolExecutor
import hashlib
from pathlib import Path
from uuid import uuid4

import pytest
from reader_mcp.annotations import Annotations


@pytest.fixture
def source(tmp_path):
    (tmp_path/'library').mkdir();p=tmp_path/'library/note.md'
    p.write_text('# A source\n\nBefore 😀 a selected passage. After.\n')
    return tmp_path,p,Annotations(tmp_path)


def create(source,**kwargs):
    root,p,store=source;text=p.read_text();start=text.index('selected')
    return store.create('library/note.md',start,start+len('selected passage'),'You',comment='Question?',**kwargs)


def test_shared_replies_resolution_idempotence_preserve_source(source):
    root,p,store=source;before=p.read_bytes();request=str(uuid4())
    thread=create(source,request_id=request,expected_sha256=hashlib.sha256(before).hexdigest())
    assert create(source,request_id=request)['id']==thread['id']
    parent=thread['comments'][0]['id'];reply_id=str(uuid4())
    replied=store.reply(thread['id'],'Reader librarian','Here is a qualification.',parent,reply_id)
    assert store.reply(thread['id'],'Reader librarian','Here is a qualification.',parent,reply_id)==replied
    assert len(replied['comments'])==2 and replied['comments'][1]['reply_to']==parent
    with pytest.raises(ValueError,match='changed'):store.resolve(thread['id'],True,1)
    assert store.resolve(thread['id'],True,2)['resolved']
    assert store.resolve(thread['id'],False,3)['revision']==4
    assert p.read_bytes()==before
    assert store.list('library/note.md')['threads'][0]['location']['status']=='exact'


def test_relocation_and_orphaned_or_ambiguous_anchors(source):
    root,p,store=source;thread=create(source)
    p.write_text('New introduction.\n'+p.read_text())
    assert store.list('library/note.md')['threads'][0]['location']['status']=='relocated'
    p.write_text('selected passage and selected passage')
    assert store.list('library/note.md')['threads'][0]['location']['status']=='ambiguous'
    p.write_text('The passage is gone.')
    assert store.list('library/note.md')['threads'][0]['location']['status']=='orphaned'
    assert store.read(thread['id'])['anchor']['quote']=='selected passage'


def test_concurrent_replies_are_not_lost(source):
    _,_,store=source;thread=create(source)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda n:store.reply(thread['id'],f'Participant {n}',f'Reply {n}'),range(8)))
    saved=store.read(thread['id']);assert len(saved['comments'])==9 and saved['revision']==9


def test_stale_selection_and_invalid_parent_or_path(source):
    root,p,store=source
    with pytest.raises(ValueError,match='changed'):create(source,expected_sha256='0'*64)
    thread=create(source)
    with pytest.raises(ValueError,match='parent'):store.reply(thread['id'],'Reader librarian','Reply',str(uuid4()))
    with pytest.raises(ValueError,match='library-relative'):store.list('library/../secret.md')
    with pytest.raises(ValueError,match='Markdown only'):store.list('library/source.pdf')


def test_warning_requires_explanation_and_preserves_kind_on_retry(source):
    root,p,store=source
    before=p.read_bytes();request=str(uuid4())
    warning=create(source,kind='warning',request_id=request)
    assert warning['kind']=='warning' and warning['comments'][0]['body']=='Question?'
    assert create(source,kind='warning',request_id=request)==warning
    with pytest.raises(ValueError,match='different input'):create(source,kind='highlight',request_id=request)
    for comment in ('','   '):
        with pytest.raises(ValueError,match='Warning explanation'):store.create('library/note.md',0,2,'Reader librarian',comment,kind='warning')
    with pytest.raises(ValueError,match='kind'):create(source,kind='alarm')
    reply=store.reply(warning['id'],'You','That qualification helps.')
    assert reply['kind']=='warning'
    assert store.resolve(warning['id'],True,reply['revision'])['kind']=='warning'
    assert p.read_bytes()==before


def test_legacy_highlight_retries_remain_compatible(source):
    root,p,store=source;request=str(uuid4())
    thread=create(source,request_id=request);thread.pop('kind');store.write(thread)
    assert create(source,request_id=request)['id']==request
