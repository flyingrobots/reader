/** Version explorer: the version chip under the title, its status-bar twin, and the timeline panel (Space v).
 *
 * Data comes from /api/versions (edition family + each member's git history + read markers). A
 * reference is a library path (the file as it is now) or `path@commit` (that file at a commit in its
 * own history, opened read-only). Comparisons go to /api/changes?a=&b= and reuse the changes panel. */
import {escapeHTML as esc, formatDate} from './logic.mjs';

const REF=/^(library\/.+\.[A-Za-z0-9]{1,10})@([0-9a-f]{7,40})$/;
export const splitRef=ref=>{const m=REF.exec(ref||'');return m?{path:m[1],commit:m[2]}:{path:ref,commit:null};};
// Commit dates and receipt times are instants: shown as the reader's local day. Plain catalog dates stay as written.
const day=iso=>iso?formatDate(String(iso)):'';
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
const topRevision=v=>Math.max(0,...(v?.family||[]).filter(e=>e.role==='version').map(e=>e.revision));
const readingCopyLabel=e=>e.label==='Reading copy'?'Reading copy of the original':e.label;

/** What the chip and its twin say: {chip, twin, title, newer} or null when there is nothing to tell. */
export function describe(v,doc){
  if(!v)return null;
  const current=v.family.find(e=>e.current)||v.family[0];if(!current)return null;
  const top=topRevision(v),revisions=current.revisions||0;
  if(doc?.historical){
    const label=v.family.length>1?(current.role==='version'?`v${current.revision}`:readingCopyLabel(current))+' as of ':'As of ';
    return {chip:label+day(doc.date),twin:'@'+doc.short,title:`Historical version from commit ${doc.short}`,historical:true};
  }
  let chip,twin;
  if(v.family.length>1){
    if(current.role==='version'){chip=`v${current.revision} of ${top}`;twin=`v${current.revision}/${top}`;}
    else if(current.role==='reading-copy'){chip=readingCopyLabel(current);twin='copy';}
    else{const copies=v.family.filter(e=>e.role==='reading-copy').length;chip=current.label+(copies?' · '+plural(copies,'reading copy').replace('copys','copies'):'');twin='orig';}
  }else if(revisions>1){chip=`Current · ${plural(revisions,'revision')}`;twin=`${revisions} rev`;}
  else return null;
  return {chip,twin,title:'Versions · Space v',newer:v.newer};
}

/** The chip line under the title meta. Part of the first layout; decoration, not source text. */
export function chipMarkup(v,doc,param){
  const d=describe(v,doc);if(!d||d.historical)return '';
  const current=v.family.find(e=>e.current);
  const parts=[];
  if(d.newer)parts.push(`<span class="version-newer">Newer v${esc(d.newer.revision)} available <a href="${esc('#read='+param(d.newer.path))}" data-path="${esc(d.newer.path)}">Open v${esc(d.newer.revision)}</a><button type="button" data-button="link sm" class="compare-successor" data-compare="successor">Compare ${esc(compareLabel(v))}</button></span>`);
  const read=v.read;
  if(read?.where==='current'&&read.at)parts.push(`<span class="version-read">${read.path===current?.path?'You read this':'You read '+esc(read.label)} on ${esc(day(read.at))}</span>`);
  return `<div class="version-line${d.newer?' has-newer':''}" data-reader-decoration><button type="button" class="version-chip" data-version-chip aria-haspopup="dialog" aria-controls="versions-panel" title="${esc(d.title)}"><span class="version-dot" aria-hidden="true"></span>${esc(d.chip)}<svg class="version-caret" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 6.5 8 9.5l3-3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>${parts.join('')}</div>`;
}
export function compareLabel(v){const current=v.family.find(e=>e.current);const from=current?.role==='version'?'v'+current.revision:current?.label||'this';return `${from} → v${v.newer.revision}`;}

/** Banner for a historical version: read-only, with a way back. */
export function historicalMarkup(doc,param){
  return `<aside class="historical-banner" data-reader-decoration role="note"><span><strong>Historical version</strong> · ${esc(day(doc.date))} · commit <code>${esc(doc.short)}</code>${doc.subject?` · ${esc(doc.subject)}`:''}</span><span class="historical-note">Read-only: no read marks, bookmarks or annotations.</span><a href="${esc('#read='+param(doc.path))}" data-path="${esc(doc.path)}">Return to current</a></aside>`;
}

/** Everything the timeline shows (web/src/versions-timeline.tsx), as plain data. `at` is the open reference, `marked` the
    version chosen to compare from, `labelOf` names a reference. */
export function timelineModel(v,{at,marked,participant,title,historical,sideBySide,labelOf}){
  const top=topRevision(v),read=v.read;
  const readRef=read?(read.where==='commit'?read.path+'@'+read.commit:read.where==='current'?read.path:null):null;
  const commits=Object.values(v.history||{}).reduce((n,list)=>n+list.length,0);
  const readers=names=>{
    if(!names?.length)return null;
    const mine=names.includes(participant),others=names.filter(n=>n!==participant);
    return {label:'Read by '+[mine&&'you',...others].filter(Boolean).join(', '),own:mine,others:Math.min(5,others.length)};
  };
  const editions=v.family.map(e=>{
    const newest=e.role==='version'&&e.revision===top&&v.family.some(x=>x.role==='version'&&x.revision<top);
    const isHere=at===e.path,isRead=readRef===e.path,history=v.history?.[e.path]||[];
    const tags=[isHere&&{kind:'here',text:'reading'},isRead&&{kind:'read',text:'you read '+day(read.at)},newest&&{kind:'newest',text:'newest'},e.uncommitted&&{kind:'edited',text:'edited since last commit'}].filter(Boolean);
    const status=v.history_status?.[e.path];
    return {ref:e.path,here:isHere,newest,marked:marked===e.path,mark:isHere?'●':isRead?'◐':newest?'★':'○',
      name:e.role==='version'?'v'+e.revision:e.label,where:e.where||null,
      meta:[e.role==='version'?null:e.role==='reading-copy'?'Reading copy':null,e.date?day(e.date):null,e.author].filter(Boolean).join(' · '),
      tags,readers:readers(e.readers),compareLabel:'Compare '+labelOf(e.path),
      historyOpen:!!history.length&&(isHere||history.some(c=>at===e.path+'@'+c.commit)),historyLabel:'History · '+plural(history.length,'revision'),
      historyNote:status==='truncated'?'Older revisions not shown':status==='timeout'?'History took too long to read':null,
      commits:history.map(c=>{const ref=e.path+'@'+c.commit,isAt=at===ref,isR=readRef===ref;
        return {ref,here:isAt,marked:marked===ref,mark:isAt?'●':isR?'◐':'·',when:day(c.date),subject:c.subject,short:c.short,
          tags:[isAt&&{kind:'here',text:'reading'},isR&&{kind:'read',text:'you read'},c.matches_current&&{kind:'same',text:'same as file'}].filter(Boolean),
          readers:readers(c.readers),compareLabel:'Compare '+labelOf(ref)};})};
  });
  return {title,counts:(v.family.length>1?plural(v.family.length,'edition')+' · ':'')+plural(commits,'revision')+' in the vault history'+(v.git?'':' (no git history)'),
    sideBySide:!!sideBySide,openNewer:v.newer&&!historical&&at!==v.newer.path?{ref:v.newer.path,label:'Open v'+v.newer.revision}:null,
    marked:marked?labelOf(marked):null,editions,more:v.more||0,catalog:v.catalog||null};
}

export function installVersions({state,api,navigate,openCompare,openSideBySide,notify,param,onChange,renderTimeline}){
  const $=s=>document.querySelector(s);
  const panel=$('#versions-panel'),body=$('#versions-body'),twin=$('#status-version');
  let marked=null,focusRef=null,hashedFor=null,lastItem=null;

  /** The status-bar twin: compact, accent when a newer version exists, warning tone when historical. */
  function update(){
    const d=describe(state.versions,state.doc);
    twin.hidden=!d;if(!d)return;
    twin.querySelector('span').textContent=d.twin;
    twin.classList.toggle('newer',!!d.newer);twin.classList.toggle('historical',!!d.historical);
    twin.title=d.newer?`${d.chip} · newer v${d.newer.revision} available · Space v`:`${d.chip} · Space v`;
    twin.setAttribute('aria-label',twin.title.replace(' · Space v','. Open versions, Space then v.'));
  }
  const here=()=>state.doc?(state.doc.historical?state.doc.path+'@'+state.doc.commit:state.doc.path):null;
  const labelOf=ref=>{
    const {path,commit}=splitRef(ref),e=state.versions?.family.find(x=>x.path===path);
    const name=e?(e.role==='version'?'v'+e.revision:e.where?e.label+' · '+e.where:e.label):path.split('/').pop();
    if(!commit)return name;
    const c=state.versions?.history?.[path]?.find(x=>x.commit.startsWith(commit));
    return `${name} @ ${c?day(c.date):commit.slice(0,7)}`;
  };
  // Opening the current file's newest commit is the same as opening the file.
  const resolve=ref=>{const {path,commit}=splitRef(ref);if(!commit)return ref;const c=state.versions?.history?.[path]?.find(x=>x.commit.startsWith(commit));return c?.matches_current&&!state.versions.family.find(e=>e.path===path)?.uncommitted?path:ref;};

  function render(){
    const v=state.versions;if(!v){renderTimeline(body,null);return;}
    renderTimeline(body,timelineModel(v,{at:here(),marked,participant:state.prefs.participant,title:state.doc?.metadata?.title||state.doc?.title||'',
      historical:!!state.doc?.historical,sideBySide:!!openSideBySide,labelOf}),state.doc?.path||'');
  }
  const items=()=>[...body.querySelectorAll('[data-vt-item]')].filter(el=>el.offsetParent!==null);
  function focus(ref){
    const all=items();
    const target=(ref&&all.find(el=>el.dataset.ref===ref))||all.find(el=>el.getAttribute('aria-current')==='true')||all[0];
    target?.focus({preventScroll:false});target?.scrollIntoView({block:'nearest'});
  }
  async function choose(ref){
    if(!marked){marked=ref;focusRef=ref;render();focus(ref);return;}
    if(marked===ref){marked=null;render();focus(ref);return;}
    const a=marked;marked=null;close();await compare(a,ref);
  }
  async function compare(a,b){
    let data;
    try{data=await api('/api/changes?a='+param(a)+'&b='+param(b));}catch(error){notify(error.message,'error');return;}
    if(data.status==='unchanged'){notify(`${labelOf(a)} and ${labelOf(b)} are identical.`);return;}
    openCompare({...data,title:`${labelOf(a)} → ${labelOf(b)}`,compared:true},b===here()||(resolve(b)===here()));
  }
  async function go(ref){
    const target=resolve(ref);if(target===here()){close();return;}
    focusRef=target;close();await navigate(target);open({focus:target});
  }
  async function open({focus:ref}={}){
    if(!state.doc||!describe(state.versions,state.doc)){notify(state.doc?'This document has one version and no earlier revisions in the vault history.':'Open a document to see its versions.');return;}
    panel.hidden=false;render();focus(ref||here());onChange?.();
    // Content hashes place your read marker (and other readers) on historical revisions; fetched on demand.
    const key=state.doc.path;
    if(hashedFor!==key&&state.versions.git){
      try{const fresh=await api('/api/versions?path='+param(key)+'&participant='+param(state.prefs.participant)+'&hashes=1');
        if(state.doc?.path!==key)return;hashedFor=key;state.versions=fresh;
        const active=document.activeElement?.dataset?.ref;if(!panel.hidden){render();focus(active||here());}update();}
      catch{/* The timeline stays usable without read markers on old revisions. */}
    }
  }
  function close(){if(panel.hidden)return;panel.hidden=true;onChange?.();}
  function reset(){hashedFor=null;marked=null;lastItem=null;}

  panel.addEventListener('click',event=>{
    if(event.target.closest('[data-unmark]')){marked=null;render();focus(focusRef);return;}
    const compareButton=event.target.closest('[data-compare-ref]');if(compareButton){choose(compareButton.dataset.compareRef);return;}
    const openButton=event.target.closest('[data-open-ref]');if(openButton){go(openButton.dataset.openRef);return;}
    if(event.target.closest('[data-compare-split]')){
      const selected=marked||lastItem,base=here();const from=selected&&resolve(selected)!==base?selected:null;
      if(!from){notify('Select another version on the timeline, then Compare side by side.');return;}
      marked=null;close();openSideBySide(from,base);return;
    }
    if(event.target.closest('[data-compare-current]')){
      const selected=marked||lastItem;
      const base=state.doc?.path;const from=selected&&resolve(selected)!==base?selected:state.doc?.historical?here():null;
      if(!from){notify('Select another version on the timeline, then Compare with current.');return;}
      marked=null;close();compare(from,base);return;
    }
    const item=event.target.closest('[data-vt-item][data-ref]');if(item)go(item.dataset.ref);
  });
  panel.addEventListener('focusin',event=>{if(event.target.matches('[data-vt-item][data-ref]'))lastItem=event.target.dataset.ref;});
  panel.addEventListener('keydown',event=>{
    if(event.isComposing||event.metaKey||event.ctrlKey||event.altKey)return;
    const all=items(),index=all.indexOf(document.activeElement);
    if(['j','k','ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();if(!all.length)return;
      const next={j:index+1,ArrowDown:index+1,k:index-1,ArrowUp:index-1,Home:0,End:all.length-1}[event.key];
      all[Math.max(0,Math.min(all.length-1,index<0?0:next))].focus();
    }else if(event.key==='c'){
      event.preventDefault();const ref=document.activeElement?.dataset?.ref;
      if(ref)choose(ref);else notify('Move to a version with j and k, then press c.');
    }else if(event.key==='Escape'){
      event.preventDefault();if(marked){marked=null;render();focus(focusRef);return;}
      close();$('#main').focus({preventScroll:true});
    }
  });
  twin.addEventListener('click',()=>panel.hidden?open():close());
  $('#versions-close').addEventListener('click',()=>{close();$('#main').focus({preventScroll:true});});
  return {open,close,update,reset,isOpen:()=>!panel.hidden,wire(root){root.querySelector('[data-version-chip]')?.addEventListener('click',()=>open());}};
}
