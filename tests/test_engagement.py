from concurrent.futures import ThreadPoolExecutor
import pytest
from reader_mcp.annotations import Annotations
from reader_mcp.engagement import Engagement

@pytest.fixture
def store(tmp_path):
    (tmp_path/'library').mkdir()
    (tmp_path/'library/note.md').write_text('A source passage.\n')
    a=Annotations(tmp_path)
    t=a.create('library/note.md',2,8,'You','Question?')
    return Engagement(tmp_path),a,t

def tokens(items):return [dict(key=i['key'],version=i['version']) for i in items]

def test_independent_receipts_new_reply_and_source_change(store):
    e,a,t=store
    items=e.attention('Reader librarian','library/note.md')['items']
    assert all(not i['read'] for i in items)
    e.seen('Reader librarian',tokens(items))
    assert not e.attention('Reader librarian')['pending']
    user=e.attention('You','library/note.md')['items']
    assert all(not i['read'] and i['seen_by'][0]['participant']=='Reader librarian' for i in user)
    a.reply(t['id'],'You','Another question')
    newer=e.attention('Reader librarian','library/note.md')['items']
    assert [i['kind'] for i in newer if not i['read']]==['comment','thread']
    with pytest.raises(ValueError,match='Content changed'):e.seen('Reader librarian',tokens(items))
    assert e.attention('Reader librarian')['total']==1
    (e.root/'library/note.md').write_text('An edited source passage.\n')
    newer=e.attention('Reader librarian','library/note.md')['items']
    assert not newer[0]['read']
    assert next(i for i in newer if i['kind']=='highlight')['read']
    # Clearing one's document receipt cannot erase others or mark discussion read.
    e.seen('You',tokens(newer[:1]))
    e.seen('You',tokens(newer[:1]),False)
    assert not e.attention('You','library/note.md')['items'][0]['read']

def test_concurrent_participants_and_same_participant_items(store):
    e,a,t=store
    items=e.attention('Agent','library/note.md')['items']
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda i:e.seen('Agent',tokens([i])),items))
    assert all(i['read'] for i in e.attention('Agent','library/note.md')['items'])
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda who:e.seen(who,tokens(items)),['You','Other agent']))
    assert all(len(i['seen_by'])==3 for i in e.attention('Agent','library/note.md')['items'])

def test_partial_reads_pagination_and_atomic_stale_rejection(store):
    e,a,t=store
    items=e.attention('Agent','library/note.md')['items']
    e.seen('Agent',tokens([items[1]]))
    assert e.attention('Agent')['total']==1
    a.create('library/note.md',9,16,'You')
    first=e.attention('Agent',limit=1)
    assert first['next_offset']==1 and len(e.attention('Agent',offset=1,limit=1)['pending'])==1
    bad=tokens(items);bad[-1]['version']='stale'
    with pytest.raises(ValueError):e.seen('You',bad)
    assert not any(i['read'] for i in e.attention('You','library/note.md')['items'])
    assert (e.root/'library/note.md').read_text()=='A source passage.\n'

def test_invalid_paths_and_receipt_symlinks(store,tmp_path):
    e,_,_=store
    for path in ['../file','library/../file','library//file']:
        with pytest.raises(ValueError):e.attention('Agent',path)
    outside=tmp_path/'outside';outside.mkdir();e.folder.symlink_to(outside,target_is_directory=True)
    with pytest.raises(ValueError):e.attention('Agent')
