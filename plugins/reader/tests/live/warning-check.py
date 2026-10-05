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
path='library/warning-check-'+ident+'.md';q=json.dumps(path);p='app.plugins.plugins.reader'
original=ev('JSON.stringify('+p+'.current?.path)');thread=None
participant=ev(p+'.participant()');test_participant='Warning check '+uuid.uuid4().hex
try:
    ev(p+'.setParticipant('+json.dumps(test_participant)+')')
    ev('(async()=>{await app.vault.create('+q+',"# Warning check\\n\\nA selected passage with context.\\n");return true})()')
    ev(p+'.navigate('+q+',false)')
    ev(p+'.documentLeaf.setViewState({type:"markdown",state:{file:'+q+',mode:"source",source:false}})')
    time.sleep(.2)
    ev(p+'.documentLeaf.view.editor.setSelection({line:2,ch:2},{line:2,ch:18})')
    ev(p+'.highlightSelection()')
    ev('(()=>{const s=document.querySelector(".modal select");s.value="warning";s.dispatchEvent(new Event("change"));return true})()')
    ev('[...document.querySelectorAll(".modal button")].find(b=>b.textContent==="Save warning").click()')
    assert ev('document.querySelector(".modal [role=status]").textContent.includes("needs a comment")')
    assert not api(operation='list',path=path)['threads']
    ev('document.querySelector(".modal textarea").value="Suspected issue: this fixture claim lacks an explicit assumption."')
    ev('[...document.querySelectorAll(".modal button")].find(b=>b.textContent==="Save warning").click()')
    wait(p+'.threadsFor('+q+').length===1')
    thread=api(operation='list',path=path)['threads'][0]
    assert thread['kind']=='warning' and thread['comments']
    wait('!!document.querySelector(".cm-content .reader-warning-annotation")')
    assert ev('getComputedStyle(document.querySelector(".cm-content .reader-warning-annotation")).textDecorationStyle')=='wavy'
    assert ev('document.querySelector(".cm-content .reader-comment-icon").getAttribute("aria-label").includes("warning")')
    assert ev('document.querySelector(".reader-thread summary").textContent.includes("Warning")')
    ev(p+'.documentLeaf.setViewState({type:"markdown",state:{file:'+q+',mode:"preview"}})')
    wait('!!document.querySelector(".markdown-preview-view .reader-warning-annotation")')
    assert ev('getComputedStyle(document.querySelector(".markdown-preview-view .reader-warning-annotation")).textDecorationStyle')=='wavy'
    ev('document.querySelector(".markdown-preview-view .reader-comment-icon").click()')
    assert ev(p+'.activeThread')==thread['id']
    assert Path(path).read_text()=='# Warning check\n\nA selected passage with context.\n'
    ev('[...document.querySelectorAll(".reader-thread button")].find(b=>b.textContent==="Resolve thread").click()')
    wait(p+'.threadsFor('+q+')[0]?.resolved===true')
    wait('document.querySelectorAll(".markdown-preview-view .reader-warning-annotation").length===0')
    print('PASS: warning requires comment, persists kind, preserves source, wavy editor/preview underline, warning icon/label, thread navigation, resolution removes decoration.')
finally:
    ev('document.querySelector(".modal-header-button")?.click()')
    for target in [path]+(['annotations/'+thread['id']+'.json'] if thread else []):
        ev('(async()=>{const f=app.vault.getAbstractFileByPath('+json.dumps(target)+');if(f)await app.vault.delete(f);return true})()')
        Path(target).unlink(missing_ok=True)
    ev(p+'.setParticipant('+json.dumps(participant)+')')
    receipt='engagement/'+hashlib.sha256(test_participant.encode()).hexdigest()+'.json'
    ev('(async()=>{const f=app.vault.getAbstractFileByPath('+json.dumps(receipt)+');if(f)await app.vault.delete(f);return true})()')
    Path(receipt).unlink(missing_ok=True)
    if original:ev(p+'.navigate('+json.dumps(original)+',false)')
