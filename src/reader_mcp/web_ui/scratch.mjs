/** Scratch pad: Markdown buffers with Vim keys (the lazy controls/editor.js) and a live preview drawn by
 *  the document renderer. Drafts live in this browser's IndexedDB; "Save to vault" files one through
 *  POST /api/writing as your own committed writing in library/notebook/. Route: #scratch[=<id>]. */
import {escapeHTML as esc} from './logic.mjs';

export const SCRATCH_LIMITS={body:64*1024,drafts:200,title:200};
const LAYOUTS=['split','source','preview'],LAYOUT_LABEL={split:'Side by side',source:'Source',preview:'Preview'};
const DB='reader-scratch',STORE='drafts';

/** A slug from a title: lowercase ASCII letters, digits and single hyphens, at most 60. */
export function slugify(title){
  return String(title||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60).replace(/-+$/,'')||'untitled';
}
/** A draft's title: its first heading, else its first line, else Untitled. */
export function titleOf(body){
  const heading=/^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(body||'');if(heading)return heading[1].trim().slice(0,SCRATCH_LIMITS.title);
  const line=(body||'').split('\n').find(l=>l.trim());return line?line.trim().replace(/^[>*\-+\s]+/,'').slice(0,80)||'Untitled':'Untitled';
}
export const wordCount=text=>(String(text||'').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)||[]).length;
/** A cited quote block for a passage, linked relative to the notebook (library/notebook/). */
export function citation({quote,path,title}){
  const lines=String(quote||'').trim().split(/\r?\n/).map(line=>'> '+line.trim());
  const href=path?.startsWith('library/')?'../'+path.slice(8).split('/').map(encodeURIComponent).join('/'):null;
  return lines.join('\n')+'\n>\n> — '+(href?`[${String(title||path).replace(/[[\]]/g,'')}](${href})`:String(title||'Source'))+'\n\n';
}
/** The innermost block whose source range holds a code-point offset (the preview's data-source-start/end). */
export function blockAt(blocks,offset){
  let best=null;for(const b of blocks){const s=+b.start,e=+b.end;if(s<=offset&&offset<e&&(!best||e-s<best.end-best.start))best={...b,start:s,end:e};}
  if(best)return best;let next=null;for(const b of blocks)if(+b.start>=offset&&(!next||+b.start<next.start))next={...b,start:+b.start,end:+b.end};return next;
}

// Drafts: IndexedDB, every access guarded; without it the editor still works and says so.
function store(){
  return new Promise((resolve,reject)=>{
    let request;try{request=indexedDB.open(DB,1);}catch(error){reject(error);return;}
    request.onupgradeneeded=()=>{request.result.createObjectStore(STORE,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('blocked'));
  });
}
async function tx(mode,work){const db=await store();try{return await new Promise((resolve,reject)=>{const t=db.transaction(STORE,mode),s=t.objectStore(STORE);let value;Promise.resolve(work(s,v=>{value=v;})).catch(reject);t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}finally{db.close();}}
const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
export const drafts={
  async all(){return tx('readonly',async(s,set)=>set(await req(s.getAll())));},
  async get(id){return tx('readonly',async(s,set)=>set(await req(s.get(id))));},
  async put(draft){return tx('readwrite',s=>{s.put(draft);});},
  async remove(id){return tx('readwrite',s=>{s.delete(id);});},
};

export function installScratch({state,api,notify,renderMarkdown,navigate,focusMain,updateStatus,openChat,savedChanged=()=>{},registers=()=>null,confirmAction=message=>confirm(message)}){
  const $=s=>document.querySelector(s);
  let editor=null,editorModule=null,draft=null,root=null,mode='NORMAL',layout=null,saveState='Unsaved',local=true,dirty=false,autosave=0,previewTimer=0,cursor=0,list=null,lastSaved=null;
  const narrow=()=>innerWidth<900;
  const now=()=>new Date().toISOString();
  // A new buffer responds, by default, to the document you came from; the draft keeps that across reloads.
  const fresh=(id=crypto.randomUUID())=>({id,title:'Untitled',body:'',created:now(),updated:now(),responds_to:state.lastDocPath||null});
  async function loadEditor(){
    if(editorModule)return editorModule;
    try{editorModule=await import('./controls/editor.js');return editorModule;}
    catch(error){console.error(error);notify('The editor couldn’t load.','error');throw error;}
  }
  /** Persist the draft on this device (800 ms after typing stops, on hide, before leaving). */
  async function persist(){
    clearTimeout(autosave);autosave=0;if(!draft||!dirty)return;
    const body=editor?editor.text():draft.body;
    if(!body.trim()&&!draft.vault_path){dirty=false;return;}  // An empty new buffer is not a draft yet.
    draft={...draft,body,title:titleOf(body),updated:now()};dirty=false;
    try{
      const existing=await drafts.all();
      if(!existing.some(d=>d.id===draft.id)&&existing.length>=SCRATCH_LIMITS.drafts){
        const oldest=existing.sort((a,b)=>a.updated.localeCompare(b.updated))[0];
        if(!confirmAction(`This browser keeps ${SCRATCH_LIMITS.drafts} drafts. Remove the oldest, “${oldest.title}”, to keep this one?`)){saveState='Unsaved';dirty=true;paint();return;}
        await drafts.remove(oldest.id);
      }
      await drafts.put(draft);local=true;saveState=draft.vault_path&&draft.body===lastSaved?'In vault':'Saved on this device';
    }catch{local=false;saveState='Not saved on this device';}
    paint();
  }
  function changed(){
    dirty=true;saveState='Unsaved';clearTimeout(autosave);autosave=setTimeout(persist,800);
    clearTimeout(previewTimer);previewTimer=setTimeout(preview,150);paint();
  }
  async function preview(){
    const target=root?.querySelector('.scratch-preview-body');if(!target||!editor)return;
    const text=editor.text();
    try{await renderMarkdown(target,text);}catch(error){console.error(error);}
    follow();
  }
  /** Keep the cursor's block in view in the preview (offsets are code points into the buffer). */
  function follow(){
    const pane=root?.querySelector('.scratch-preview');if(!pane||layout!=='split')return;
    const elements=[...pane.querySelectorAll('[data-source-start]')];
    const hit=blockAt(elements.map(el=>({el,start:el.dataset.sourceStart,end:el.dataset.sourceEnd})),cursor);if(!hit)return;
    pane.querySelectorAll('.scratch-current').forEach(el=>el.classList.remove('scratch-current'));hit.el.classList.add('scratch-current');
    const box=pane.getBoundingClientRect(),rect=hit.el.getBoundingClientRect();
    if(rect.top<box.top+8||rect.bottom>box.bottom-8)pane.scrollTop+=rect.top-box.top-box.height*.3;
  }
  function setLayout(next){
    layout=next;if(!root)return;root.dataset.layout=layout;
    const button=root.querySelector('[data-scratch-layout]');button.textContent=LAYOUT_LABEL[layout];button.title='Layout: '+LAYOUT_LABEL[layout]+' (:preview cycles)';
    if(layout!=='source')preview();paint();
  }
  const cycle=()=>setLayout(LAYOUTS[(LAYOUTS.indexOf(layout)+1)%LAYOUTS.length]);
  function paint(){
    if(!root)return;
    const status=root.querySelector('.scratch-state');if(status)status.textContent=saveState;
    root.querySelector('[data-scratch-vault-path]')?.replaceChildren(document.createTextNode(draft?.vault_path||''));
    updateStatus();
  }
  async function open(main,id){
    await leave();
    let found=null;
    try{
      if(id)found=await drafts.get(id);
      else{const all=await drafts.all();found=all.sort((a,b)=>b.updated.localeCompare(a.updated))[0]||null;}
    }catch{local=false;}
    draft=found||fresh(id||undefined);lastSaved=draft.vault_path?draft.body:null;
    saveState=!local?'Not saved on this device':found?(draft.vault_path&&draft.body===lastSaved?'In vault':'Saved on this device'):'Unsaved';
    if(!id)history.replaceState(history.state,'','#scratch='+draft.id);
    layout??=narrow()?'source':'split';
    main.innerHTML=`<section class="scratch" data-layout="${layout}" aria-label="Scratch pad">
      <div class="scratch-bar" data-reader-decoration><span class="eyebrow">Scratch pad</span><span class="scratch-state" role="status" aria-live="polite">${esc(saveState)}</span><span class="scratch-vault-path" data-scratch-vault-path></span>
      <span class="scratch-actions" data-button-group><button type="button" data-button="outline xs" data-scratch-layout>${LAYOUT_LABEL[layout]}</button><button type="button" data-button="outline xs" data-scratch-drafts>Drafts</button><button type="button" data-button="outline xs" data-scratch-new>New</button><button type="button" data-button="default xs" data-scratch-vault>Save to vault</button><button type="button" data-button="outline xs" data-scratch-voice hidden>Ask a voice to respond</button></span></div>
      <div class="scratch-panes"><div class="scratch-editor"></div><div class="scratch-preview" tabindex="-1" aria-label="Preview"><div class="article scratch-preview-body"></div></div></div>
      <aside class="scratch-drafts" aria-label="Drafts" hidden></aside></section>`;
    root=main.querySelector('.scratch');
    if(draft.prompt){const context=document.createElement('aside');context.className='scratch-prompt-context';context.dataset.readerDecoration='';
      const by=document.createElement('p');by.className='eyebrow';by.textContent='A question from '+draft.prompt.author;
      const question=document.createElement('p');question.textContent=draft.prompt.question;context.append(by,question);root.querySelector('.scratch-panes').before(context);}
    root.querySelector('[data-scratch-layout]').onclick=cycle;
    root.querySelector('[data-scratch-drafts]').onclick=()=>toggleDrafts();
    root.querySelector('[data-scratch-new]').onclick=()=>navigate(':scratch='+crypto.randomUUID());
    root.querySelector('[data-scratch-vault]').onclick=()=>saveDialog();
    root.querySelector('[data-scratch-voice]').onclick=askVoice;
    root.querySelector('[data-scratch-voice]').hidden=!(openChat&&draft.vault_path);
    const module=await loadEditor();if(!root?.isConnected)return;
    editor=module.createMarkdownEditor(root.querySelector('.scratch-editor'),{doc:draft.body,label:'Scratch pad Markdown',placeholder:'Write in Markdown. i to insert, Esc Esc to leave.',
      onChange:changed,onCursor:offset=>{cursor=offset;if(layout==='split'&&!previewTimer)follow();},onMode:next=>{mode=next;updateStatus();},onExit:()=>focusMain(),onRegister:pasteRegister,
      commands:{write:args=>args==='vault'?saveDialog():persist().then(()=>notify(local?'Saved on this device.':'This browser can’t keep drafts; copy your text to keep it.',local?'success':'error')),preview:cycle,drafts:()=>toggleDrafts(true),cite,enew:()=>navigate(':scratch='+crypto.randomUUID()),
        edit:args=>{const m=/^scratch(?:=(\S+))?$/.exec(args);if(m)navigate(m[1]?':scratch='+m[1]:':scratch');else notify('In the scratch pad, :e scratch or :e scratch=<id> opens a draft.');}}});
    mode='NORMAL';editor.focus();if(layout!=='source')preview();paint();
  }
  async function leave(){
    if(!editor&&!root)return;clearTimeout(previewTimer);previewTimer=0;
    if(dirty)await persist();
    editor?.destroy();editor=null;root=null;list=null;
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&dirty)persist();});
  // Drafts panel ------------------------------------------------------------------------------------
  async function toggleDrafts(show){
    const panel=root?.querySelector('.scratch-drafts');if(!panel)return;
    if(show===undefined)show=panel.hidden;
    if(!show){panel.hidden=true;editor?.focus();return;}
    await persist();let all=[];try{all=(await drafts.all()).sort((a,b)=>b.updated.localeCompare(a.updated));}catch{local=false;}
    panel.hidden=false;
    panel.innerHTML=`<div class="thread-top"><h2>Drafts</h2><button type="button" data-button="ghost icon-sm" class="close-button" aria-label="Close drafts" data-drafts-close>×</button></div><p class="quiet">Drafts are kept in this browser only.${local?'':' This browser can’t keep them right now.'}</p>`+
      (all.length?`<ul class="scratch-draft-list" role="listbox" aria-label="Drafts">${all.map(d=>`<li role="option" tabindex="-1" data-draft="${esc(d.id)}" aria-selected="${d.id===draft?.id}"><strong>${esc(d.title)}</strong><small>${esc(new Date(d.updated).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))} · ${wordCount(d.body)} words${d.vault_path?' · In vault':''}</small></li>`).join('')}</ul><p class="quiet"><kbd>j</kbd> <kbd>k</kbd> move <kbd>Enter</kbd> open <kbd>x</kbd> delete <kbd>Esc</kbd> close</p>`:'<p class="empty-note">No drafts yet.</p>');
    panel.querySelector('[data-drafts-close]').onclick=()=>toggleDrafts(false);
    list=[...panel.querySelectorAll('[data-draft]')];
    list.forEach(item=>item.addEventListener('click',()=>navigate(':scratch='+item.dataset.draft)));
    (list.find(i=>i.dataset.draft===draft?.id)||list[0]||panel.querySelector('button'))?.focus();
    panel.onkeydown=async event=>{
      const index=list.indexOf(document.activeElement);
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();toggleDrafts(false);}
      else if(index<0)return;
      else if(['j','ArrowDown','k','ArrowUp'].includes(event.key)){event.preventDefault();list[(index+(['j','ArrowDown'].includes(event.key)?1:-1)+list.length)%list.length].focus();}
      else if(event.key==='Enter'){event.preventDefault();navigate(':scratch='+list[index].dataset.draft);}
      else if(event.key==='x'){event.preventDefault();const id=list[index].dataset.draft,name=list[index].querySelector('strong').textContent;
        if(!confirmAction(`Delete the draft “${name}” from this browser?`))return;
        try{await drafts.remove(id);}catch{notify('The draft couldn’t be deleted.','error');return;}
        notify('Draft deleted.');if(id===draft?.id){dirty=false;navigate(':scratch='+crypto.randomUUID());}else toggleDrafts(true);}
    };
  }
  // Citing your last reader selection, or a register (Ctrl-r a in insert mode) ----------------------------
  function pasteRegister(name){
    const entry=registers()?.get(name);
    if(!entry){notify(`Register ${name} is empty. Select a passage with v and press "${name==='"'?'':name}y.`.replace('""','"'));return;}
    editor?.insert(citation(entry));
  }
  function cite(){
    const quote=state.lastQuote;if(!quote){notify('Select a passage in a document first; :cite inserts it here.');return;}
    editor?.insert(citation(quote));
  }
  // Save to vault ---------------------------------------------------------------------------------------
  function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  async function saveDialog(){
    if(!editor)return;await persist();
    const body=editor.text();
    if(!body.trim()){notify('Write something first.');return;}
    if(new TextEncoder().encode(body).length>SCRATCH_LIMITS.body){notify('A piece can be at most 64 KiB; this one is longer.','error');return;}
    let dialog=$('#scratch-save');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='scratch-save';dialog.className='scratch-save-dialog';dialog.setAttribute('aria-labelledby','scratch-save-title');document.body.append(dialog);}
    const revising=!!draft.base,title=draft.title&&draft.title!=='Untitled'?draft.title:titleOf(body),responds=draft.responds_to??state.lastDocPath??'';
    dialog.innerHTML=`<div class="dialog-heading"><h2 id="scratch-save-title">${revising?'Save a new version':'Save to vault'}</h2><button type="button" data-button="ghost icon-sm" class="close-button" aria-label="Close" data-save-close>×</button></div>
      <form class="scratch-save-form" method="dialog">
        <label>Title<input name="title" maxlength="200" required value="${esc(title)}"></label>
        ${revising?`<label>What shifted (optional)<input name="shifted" maxlength="2000"></label>`:`<label>Slug<input name="slug" maxlength="60" pattern="[a-z0-9\\-]{1,60}" required value="${esc(slugify(title))}"></label>`}
        <label>Status<select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label>
        <label>Responds to (optional)<input name="responds_to" value="${esc(responds)}" placeholder="library/…" spellcheck="false"></label>
        <p class="scratch-save-path">Saves <code data-save-path></code> as your own writing and commits only that file.</p>
        <p class="scratch-save-error" role="alert" hidden></p>
        <div class="scratch-save-actions"><button type="button" data-button="ghost sm" data-save-close>Cancel</button><button type="submit" data-button="default sm">Save and commit</button>${draft.prompt?'<button type="submit" data-button="outline sm" name="reply" value="yes">Save and ask for a reply</button>':''}</div>
      </form>`;
    const form=dialog.querySelector('form'),slug=form.elements.slug,error=dialog.querySelector('.scratch-save-error');
    let slugEdited=false;
    const showPath=()=>{dialog.querySelector('[data-save-path]').textContent=revising?nextVersion(draft.base.path):`library/notebook/${today()}-${slug.value||'…'}.md`;};
    form.elements.title.addEventListener('input',()=>{if(slug&&!slugEdited){slug.value=slugify(form.elements.title.value);showPath();}});
    slug?.addEventListener('input',()=>{slugEdited=true;showPath();});showPath();
    dialog.querySelectorAll('[data-save-close]').forEach(b=>b.onclick=()=>dialog.close());
    dialog.onclose=()=>editor?.focus();
    const requestId=crypto.randomUUID();
    form.onsubmit=async event=>{
      event.preventDefault();error.hidden=true;const buttons=[...form.querySelectorAll('[type=submit]')];buttons.forEach(button=>button.disabled=true);
      const fields=Object.fromEntries(new FormData(form));
      const payload={action:'save',request_id:requestId,body:editor.text(),title:fields.title.trim(),status:fields.status,participant:state.prefs.participant,...(fields.responds_to?.trim()?{responds_to:fields.responds_to.trim()}:{}),
        ...(draft.prompt?{prompt_id:draft.prompt.id,ask_reply:event.submitter?.value==='yes'}:{}),
        ...(revising?{base:draft.base,...(fields.shifted?.trim()?{shifted:fields.shifted.trim()}:{})}:{slug:fields.slug})};
      try{
        const result=await api('/api/writing',payload);
        draft={...draft,title:payload.title,vault_path:result.path,base:{path:result.path,sha256:result.sha256},responds_to:payload.responds_to||null};lastSaved=payload.body;dirty=false;
        try{await drafts.put({...draft,body:payload.body,updated:now()});}catch{local=false;}
        saveState='In vault';dialog.close();paint();
        if(result.status==='committed')notify(`Saved to ${result.path} and committed.`,'success');
        else notify(`Saved to ${result.path}, but not committed: ${result.error||result.status}.`,'error');
        if(openChat)root?.querySelector('[data-scratch-voice]')?.removeAttribute('hidden');
        savedChanged();
        if(result.reply_error)notify(result.reply_error,'error');
        if(result.chat_id&&openChat){await navigate(draft.prompt.document_path);openChat(draft.prompt.document_path,fields.title.trim(),state.prefs.participant,result.chat_id);}
      }catch(failure){
        buttons.forEach(button=>button.disabled=false);error.hidden=false;
        if(failure.status===409&&failure.data?.suggestion&&slug){slug.value=failure.data.suggestion;slugEdited=true;showPath();error.textContent=failure.message+'. The slug now suggests a free name.';}
        else error.textContent=failure.message||String(failure);
      }
    };
    dialog.showModal();form.elements.title.focus();form.elements.title.select();
  }
  function nextVersion(path){const m=/^(.*?)(?:\.v(\d+))?\.md$/.exec(path);return m?`${m[1]}.v${(+m[2]||1)+1}.md`:path;}
  function askVoice(){
    if(!openChat||!draft?.vault_path)return;
    openChat(draft.vault_path,draft.title,state.prefs.participant);
    requestAnimationFrame(()=>{const input=document.getElementById('chat-input');if(input&&!input.value){input.value=`I wrote “${draft.title}”. Please read it and respond.`;input.dispatchEvent(new Event('input',{bubbles:true}));}});
  }
  /** "Edit in scratch" on a saved notebook piece: a draft whose base is that file; saving writes the next .vN.md. */
  async function editSaved(doc,body){
    const id=crypto.randomUUID(),title=String(doc.metadata?.title||doc.title||'Untitled');
    const meta=doc.metadata||{},prompt=meta.prompt_id&&meta.prompt?{id:meta.prompt_id,author:meta.prompt.by,question:meta.prompt.text,document_path:meta.responds_to,evidence:meta.prompt.evidence}:null;
    const record={...fresh(id),title,body,base:{path:doc.path,sha256:doc.sha256},vault_path:doc.path,responds_to:meta.responds_to||null,prompt};
    try{await drafts.put(record);}catch{local=false;}
    navigate(':scratch='+id);
  }
  async function forPrompt(prompt){
    await persist();const participant=state.prefs.participant;
    const previous=(await drafts.all()).find(d=>d.prompt?.id===prompt.id&&d.promptParticipant===participant);
    const record=previous||{...fresh(),title:'On '+(state.doc?.title||'this article'),responds_to:prompt.document_path,prompt,promptParticipant:participant};
    if(!previous)await drafts.put(record);
    navigate(':scratch='+record.id);
  }
  return {open,leave,editSaved,forPrompt,isOpen:()=>!!root,
    status(){
      const words=wordCount(editor?editor.text():draft?.body);
      return {mode:'SCRATCH · '+mode,keys:mode==='INSERT'?'<kbd>Esc</kbd> normal':'<kbd>i</kbd> insert <kbd>:w</kbd> save here <kbd>:write vault</kbd> save to vault <kbd>:preview</kbd> layout <kbd>:drafts</kbd> drafts <kbd>Esc Esc</kbd> leave',position:`${words} ${words===1?'word':'words'} · ${saveState}`};
    },
    focus(){editor?.focus();}};
}
