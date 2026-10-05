"""Live macOS regression: run from the vault root with Obsidian open and Reader installed.
Uses Obsidian CLI and Electron input; creates/removes one temporary library note.
"""
import subprocess,json,time,uuid,hashlib
from pathlib import Path
import os,shutil
CLI=os.environ.get('OBSIDIAN_CLI') or shutil.which('obsidian') or 'obsidian'
def ev(code):
    result=subprocess.run([CLI,'vault='+Path.cwd().name,'eval','code='+code],capture_output=True,text=True,timeout=25)
    output=result.stdout.strip()
    if result.returncode or output.startswith('Error:'):raise RuntimeError(output+result.stderr)
    if output=='(no output)':return None
    value=output.removeprefix('=> ')
    try:return json.loads(value)
    except ValueError:return value
path='library/menu-check-'+uuid.uuid4().hex+'.md'
q=json.dumps(path)
p='app.plugins.plugins.reader'
original=ev('JSON.stringify(app.plugins.plugins.reader.current?.path)')
participant=ev(p+'.participant()');test_participant='Menu check '+uuid.uuid4().hex
try:
 ev(p+'.setParticipant('+json.dumps(test_participant)+')')
 ev('(async()=>{await app.vault.create('+q+',"# Menu check\\n\\nA selected passage with context.\\n");return true})()')
 ev(p+'.navigate('+q+',false)');time.sleep(.3)
 ev(p+'.documentLeaf.setViewState({type:"markdown",state:{file:'+q+',mode:"source",source:false}})')
 time.sleep(.2)
 # Trigger the public editor-menu event and retain its callback, then clear selection before clicking.
 probe='''(()=>{const v=app.plugins.plugins.reader.documentLeaf.view;window.__readerMenu=[];const menu={addSeparator(){return this},addItem(fn){const item=new Proxy({setTitle(t){this.title=t;return this},setIcon(){return this},onClick(cb){window.__readerMenu.push({title:this.title,cb});return this}},{get(t,k){return t[k]??function(){return this}}});fn(item);return this}};app.workspace.trigger('editor-menu',menu,v.editor,v);return window.__readerMenu.filter(i=>i.title==='Highlight and comment in Reader').length})()'''
 ev(p+'.documentLeaf.view.editor.setSelection({line:2,ch:2},{line:2,ch:18})')
 assert ev(probe)==1
 ev(p+'.documentLeaf.view.editor.setCursor({line:0,ch:0})')
 ev('window.__readerMenu.find(i=>i.title==="Highlight and comment in Reader").cb()');time.sleep(.15)
 assert ev('document.querySelector(".modal blockquote")?.textContent')=='selected passage'
 ev('document.querySelector(".modal-header-button").click()')
 assert ev(probe)==0
 assert ev('[...app.workspace.getLeavesOfType("reader-view")[0].view.contentEl.querySelectorAll("button")].some(b=>b.textContent==="Highlight selection")') is False
 ev(p+'.documentLeaf.setViewState({type:"markdown",state:{file:'+q+',mode:"preview"}})');time.sleep(.3)
 select='''(()=>{const preview=app.plugins.plugins.reader.documentLeaf.view.containerEl.querySelector('.markdown-preview-view');const w=document.createTreeWalker(preview,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.textContent.includes('A selected passage')){const r=document.createRange();r.setStart(n,2);r.setEnd(n,18);const s=window.getSelection();s.removeAllRanges();s.addRange(r);window.electron.remote.getCurrentWindow().focus();const box=r.getBoundingClientRect();const wc=window.electron.remote.getCurrentWebContents();const scale=Math.pow(1.2,wc.getZoomLevel());const point={x:Math.round((box.left+3)*scale),y:Math.round((box.top+box.height/2)*scale),button:'right'};wc.sendInputEvent({type:'mouseDown',...point});wc.sendInputEvent({type:'mouseUp',...point});return true}}return false})()'''
 ev('window.__readerProbe=e=>{window.__readerEvent={trusted:e.isTrusted,target:e.target.outerHTML.slice(0,300),path:e.composedPath().map(n=>n.className).slice(0,7),selected:window.getSelection().toString(),prevented:e.defaultPrevented}};document.addEventListener("contextmenu",window.__readerProbe,true)')
 assert ev(select) is True
 time.sleep(.7)
 assert ev('window.__readerEvent?.trusted') is True
 ev('document.removeEventListener("contextmenu",window.__readerProbe,true);delete window.__readerProbe;delete window.__readerEvent')
 labels=ev('JSON.stringify([...document.querySelectorAll(".menu-item-title")].map(e=>e.textContent))')
 assert 'Copy' in labels and any(x.startswith('Look Up') for x in labels),labels
 print('Trusted right-click menu:',labels)
 # Preserve every clipboard format locally, and verify the real Copy action.
 ev('(()=>{const c=window.electron.clipboard;window.__readerClipboard=c.availableFormats().map(f=>[f,c.readBuffer(f)]);return true})()')
 try:
  ev('[...document.querySelectorAll(".menu-item")].find(e=>e.querySelector(".menu-item-title")?.textContent==="Copy").click()')
  time.sleep(.15)
  assert ev('JSON.stringify(window.electron.clipboard.readText())')=='selected passage'
 finally:
  ev('(()=>{const c=window.electron.clipboard;c.clear();for(const [f,b] of window.__readerClipboard)c.writeBuffer(f,b);delete window.__readerClipboard;return true})()')
 assert ev(select) is True
 time.sleep(.2)
 assert ev('[...document.querySelectorAll(".menu-item")].filter(e=>e.textContent.includes("Highlight and comment in Reader")).length')==1
 ev('window.getSelection().removeAllRanges();[...document.querySelectorAll(".menu-item")].find(e=>e.textContent.includes("Highlight and comment in Reader")).click()');time.sleep(.15)
 assert ev('document.querySelector(".modal blockquote")?.textContent')=='selected passage'
 ev('document.querySelector(".modal-header-button").click()')
 print('PASS: Copy and Look Up coexist with Reader; Copy works; editor selection-only action; editor and reading-view selection snapshots survive focus loss; reading-view real context menu opens modal; sidebar button removed.')
finally:
 ev('(async()=>{const f=app.vault.getAbstractFileByPath('+q+');if(f)await app.vault.delete(f);delete window.__readerMenu;return true})()')
 ev(p+'.setParticipant('+json.dumps(participant)+')')
 receipt='engagement/'+hashlib.sha256(test_participant.encode()).hexdigest()+'.json'
 ev('(async()=>{const f=app.vault.getAbstractFileByPath('+json.dumps(receipt)+');if(f)await app.vault.delete(f);return true})()')
 Path(receipt).unlink(missing_ok=True)
 if original:ev(p+'.navigate('+json.dumps(original)+',false)')
