"""Live shared receipt acceptance; run from the vault root with Obsidian open."""
import hashlib,json,subprocess,time,uuid
from pathlib import Path
import os,shutil
CLI=os.environ.get('OBSIDIAN_CLI') or shutil.which('obsidian') or 'obsidian'
def ev(code):
    r=subprocess.run([CLI,'vault='+Path.cwd().name,'eval','code='+code],capture_output=True,text=True,timeout=25)
    value=r.stdout.strip()
    if r.returncode or value.startswith('Error:'):raise RuntimeError(value+r.stderr)
    if value=='(no output)':return None
    value=value.removeprefix('=> ')
    try:return json.loads(value)
    except ValueError:return value

def api(**request):
    r=subprocess.run([str(Path('.venv/bin/reader').resolve()),'--root',str(Path.cwd()),'annotate','-'],input=json.dumps(request),capture_output=True,text=True,timeout=25)
    if r.returncode:raise RuntimeError(r.stderr+r.stdout)
    return json.loads(r.stdout)

def wait(code):
    for _ in range(80):
        if ev(code):return
        time.sleep(.1)
    raise AssertionError(code)

ident=uuid.uuid4().hex
path='library/receipt-check-'+ident+'.md'
human='Human check '+ident;agent='Agent check '+ident
p='app.plugins.plugins.reader';q=json.dumps(path)
original=ev('JSON.stringify('+p+'.current?.path)');participant=ev(p+'.participant()')
thread=None
try:
    ev('(async()=>{await app.vault.create('+q+',"A selected passage.\\n");return true})()')
    thread=api(operation='create',path=path,start=2,end=18,owner=human,comment='An initial question.')
    ev(p+'.setParticipant('+json.dumps(human)+')')
    ev(p+'.navigate('+q+',false)')
    ev(p+'.loadAnnotations('+q+',true,true)');ev(p+'.loadAttention('+q+')')
    wait(p+'.seenItem('+q+','+json.dumps('thread:'+thread['id'])+')?.read===false')
    wait(p+'.isRead('+q+')')
    ev(p+'.openThread('+json.dumps(thread['id'])+')')
    wait('!!document.querySelector(".reader-thread")')
    wait(p+'.seenItem('+q+','+json.dumps('thread:'+thread['id'])+')?.read===true')
    wait(p+'.isRead('+q+')')
    items=api(operation='attention',participant=agent,path=path)['items']
    assert not any(i['read'] for i in items)
    api(operation='seen',participant=agent,items=[dict(key=i['key'],version=i['version']) for i in items])
    wait('document.querySelector(".reader-sidebar").textContent.includes('+json.dumps('Seen by '+agent)+') || [...document.querySelectorAll(".reader-caption")].some(e=>e.textContent.includes('+json.dumps(agent)+'))')
    updated=api(operation='reply',thread_id=thread['id'],author=agent,body='A new reply after acknowledgement.')
    comment=updated['comments'][-1]['id']
    wait(p+'.seenItem('+q+','+json.dumps('thread:'+thread['id'])+')?.read===false')
    wait('document.querySelector(".reader-thread summary")?.textContent.includes("Unread")')
    assert ev(p+'.seenItem('+q+','+json.dumps('comment:'+thread['id']+':'+comment)+')?.read') is False
    assert ev(p+'.seenItem('+q+','+json.dumps('comment:'+thread['id']+':'+thread['comments'][0]['id'])+')?.read') is True
    assert ev(p+'.isRead('+q+')') is True
    wait(p+'.unreadDiscussions.some(t=>t.thread_id==='+json.dumps(thread['id'])+')')
    # Reopen a discussion through its actual disclosure; pips clear without a manual mark.
    ev('document.querySelector(".reader-thread summary").click()')
    time.sleep(.1)
    ev('document.querySelector(".reader-thread summary").click()')
    wait(p+'.seenItem('+q+','+json.dumps('thread:'+thread['id'])+')?.read===true')
    wait('!document.querySelector(".reader-thread summary")?.textContent.includes("Unread")')
    wait('!'+p+'.unreadDiscussions.some(t=>t.thread_id==='+json.dumps(thread['id'])+')')
    assert ev('document.querySelector("[data-reader-tab=discussion]").getAttribute("aria-selected")') is True
    assert ev('document.querySelector(".reader-search")===null')
    ev('document.querySelector("[data-reader-tab=library]").click()')
    assert ev('!!document.querySelector(".reader-search") && !document.querySelector(".reader-threads") && !document.querySelector(".reader-inbox-callout")')
    ev('(()=>{const i=document.querySelector(".reader-search input");i.value="kept filter";i.dispatchEvent(new Event("input"));return true})()')
    ev('document.querySelector("[data-reader-tab=inbox]").click()')
    assert ev('!document.querySelector(".reader-search") && !document.querySelector(".reader-threads")')
    assert ev('document.querySelector("[role=tabpanel]").textContent.includes("inbox")')
    ev('document.querySelector("[data-reader-tab=inbox]").dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true}))')
    assert ev('document.activeElement.getAttribute("data-reader-tab")')=='library'
    assert ev('document.querySelector(".reader-search input").value')=='kept filter'
    # Mark unread remains an override until reopening; rendering alone does not clear it.
    ev('document.querySelector(".reader-mark-read").click()')
    wait('!'+p+'.isRead('+q+')')
    ev(p+'.render()')
    time.sleep(.2)
    assert ev(p+'.isRead('+q+')') is False
    # Reopening clears the deliberate unread override; a reload then preserves it.
    ev('(async()=>{await app.vault.create('+json.dumps(path+'.other.md')+',"Another small document.");return true})()')
    ev(p+'.navigate('+json.dumps(path+'.other.md')+',false)')
    ev(p+'.navigate('+q+',false)')
    wait(p+'.isRead('+q+')')
    subprocess.run([CLI,'vault='+Path.cwd().name,'plugin:reload','id=reader'],check=True,capture_output=True,timeout=25)
    time.sleep(.5)
    ev(p+'.loadAttention('+q+')')
    wait(p+'.isRead('+q+')')
    assert Path(path).read_text()=='A selected passage.\n'
    print('PASS: opening auto-reads documents/threads and clears badges; isolated tabs, keyboard navigation, preserved filter and mark-unread override; separate identities, seen-by refresh from agent, new-reply unread badge, prior comment preservation, global pending list, restart persistence, unchanged source.')
finally:
    ev(p+'.setParticipant('+json.dumps(participant)+')')
    for target in [path,path+'.other.md']+(['annotations/'+thread['id']+'.json'] if thread else [])+['engagement/'+hashlib.sha256(who.encode()).hexdigest()+'.json' for who in [human,agent]]:
        ev('(async()=>{const f=app.vault.getAbstractFileByPath('+json.dumps(target)+');if(f)await app.vault.delete(f);return true})()')
        Path(target).unlink(missing_ok=True)
    if original:ev(p+'.navigate('+json.dumps(original)+',false)')
    ev(p+'.refreshAttention()')
