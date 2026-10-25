"""Live reserved-inbox acceptance using one owned synthetic arrival; run from the vault."""
import json,os,subprocess,time,uuid
from pathlib import Path

ROOT=Path.cwd()
CLI=os.environ.get('OBSIDIAN_CLI','obsidian')
HELPER=Path.home()/'.codex/skills/upkeep/scripts/check.py'
owner=str(uuid.uuid4());path='inbox/reader-ui-check-'+owner+'.md'
def ev(code):
 r=subprocess.run([CLI,'vault='+ROOT.name,'eval','code='+code],capture_output=True,text=True,timeout=25,check=True)
 out=r.stdout.strip().removeprefix('=> ')
 if out.startswith('Error:'):raise RuntimeError(out)
 try:return json.loads(out)
 except ValueError:return out
p='app.plugins.plugins.reader'
original=ev('JSON.stringify(app.workspace.getActiveFile()?.path)')
tab=ev('app.workspace.getLeavesOfType("reader-view")[0].view.tab')
state=ROOT/'.reader/inbox-runner/state.json';before=state.read_bytes() if state.exists() else None
claimed=False
modal_selector='[data-reader-inbox-check="'+owner+'"]'
def close_modal():
 ev('(()=>{const m=document.querySelector('+json.dumps(modal_selector)+');m?.querySelector(".modal-close-button,.modal-header-button")?.click();return true})()')
 assert ev('document.querySelector('+json.dumps(modal_selector)+')===null'),'Owned test modal did not close'
try:
 ev('(async()=>{await app.vault.create('+json.dumps(path)+',"# Reader UI acceptance\\n\\nSynthetic arrival owned by the inbox UI test.\\n");return true})()')
 subprocess.run(['python3',str(HELPER),'--claim',owner,path],check=True,capture_output=True,timeout=30);claimed=True
 ev(p+'.refreshInbox()')
 value=ev('(()=>{const v=app.workspace.getLeavesOfType("reader-view")[0].view;v.selectTab("inbox");return JSON.stringify({disabled:v.contentEl.querySelector(".reader-process-inbox")?.disabled,text:v.contentEl.textContent,arrivals:[...v.contentEl.querySelectorAll(".reader-inbox-arrival")].map(e=>e.textContent)})})()')
 assert value['disabled'] is True,value
 assert 'Filing is already assigned' in value['text'],value
 assert Path(path).name in value['arrivals'],value
 assert 'Assigned for filing' in value['text'],value
 ev(p+'.processInbox()')
 assert (state.read_bytes() if state.exists() else None)==before,'Blocked UI spawned or changed a run'
 assert ev(p+'.launchingInbox') is False
 ev('[...document.querySelectorAll(".reader-inbox-arrival")].find(b=>b.textContent==='+json.dumps(Path(path).name)+').click()')
 for _ in range(30):
  if ev('JSON.stringify(app.workspace.getActiveFile()?.path)')==path:break
  time.sleep(.05)
 assert ev('JSON.stringify(app.workspace.getActiveFile()?.path)')==path, ev('JSON.stringify({active:app.workspace.getActiveFile()?.path,current:app.plugins.plugins.reader.current?.path,leaves:app.workspace.getLeavesOfType("markdown").map(l=>l.view.file?.path),notices:[...document.querySelectorAll(".notice")].map(e=>e.textContent)})')
 ev('(async()=>{await '+p+'.showInboxDetails();document.querySelectorAll(".modal").item(document.querySelectorAll(".modal").length-1).setAttribute("data-reader-inbox-check",'+json.dumps(owner)+');return true})()')
 modal=ev('JSON.stringify(document.querySelector('+json.dumps(modal_selector)+')?.textContent)')
 assert 'Filing is already assigned' in modal,modal
 assert 'Last run:' in modal or 'No Codex run' in modal or 'No report' in modal,modal
 close_modal()
 subprocess.run(['python3',str(HELPER),'--release',owner],check=True,capture_output=True,timeout=30);claimed=False
 ev(p+'.refreshInbox()')
 assert ev('document.querySelector(".reader-process-inbox")?.disabled') is False
 print('PASS: live reserved arrival disables duplicate intake; direct launch is refused without changing runner state; source opens; details show current assignment; release enables processing.',flush=True)
finally:
 close_modal()
 if claimed:subprocess.run(['python3',str(HELPER),'--release',owner],check=True,capture_output=True,timeout=30)
 ev('(async()=>{const f=app.vault.getAbstractFileByPath('+json.dumps(path)+');if(f)await app.vault.delete(f);return true})()')
 if original:ev('app.workspace.openLinkText('+json.dumps(original)+',"",false)')
 ev(p+'.refreshInbox()')
 ev('app.workspace.getLeavesOfType("reader-view")[0].view.selectTab('+json.dumps(tab)+')')
 assert not (ROOT/path).exists()
