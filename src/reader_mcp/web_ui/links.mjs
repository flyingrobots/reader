/** Link previews on hover and focus, and the "Linked from" list at the end of an article. */
import {escapeHTML as esc} from './logic.mjs';

const VISIBLE=12;
const plural=(n,one,many)=>n===1?one:many;

export function installLinks({state,api,reading,navigate,openBackstage,renderPreview}){
  const $=selector=>document.querySelector(selector);
  const param=encodeURIComponent;
  // The card itself is web/src/link-preview.tsx (a shadcn HoverCard); this module decides when it shows.
  const tip=()=>document.getElementById('link-preview');
  const inTip=node=>!!node&&!!tip()?.contains(node);
  const cache=new Map();let timer=0,current=null,token=0;
  // Only links written in the document: not Read next, Linked from, margin pins or embedded copies' chrome.
  const previewable=a=>!!a?.closest('#article')&&!a.closest('[data-reader-decoration],.annotation-pin,.embed-note')&&!!a.getAttribute('href')&&!a.getAttribute('href').startsWith('#');
  const sourceOf=a=>a.closest('[data-source-path]')?.dataset.sourcePath||state.doc?.path;
  const blocked=()=>{const selection=getSelection();return !state.doc||(selection&&!selection.isCollapsed)||reading.isTurning();};
  function load(a){
    const href=a.getAttribute('href'),from=sourceOf(a),key=from+'\n'+href;
    if(!cache.has(key)){
      if(cache.size>=200)cache.delete(cache.keys().next().value);
      cache.set(key,(async()=>{
        if(/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)){let host=href;try{host=new URL(href,location.href).host||href.replace(/^mailto:/i,'');}catch{}return {type:'external',host};}
        let target=href;try{target=decodeURI(href);}catch{}
        const resolved=await api('/api/resolve?from='+param(from)+'&target='+param(target));
        return {type:'document',...await api('/api/preview?path='+param(resolved.path)+'&fragment='+param(resolved.fragment||'')+'&participant='+param(state.prefs.participant))};
      })().catch(error=>({type:'missing',message:error.message})));
    }
    return cache.get(key);
  }
  async function show(a){
    if(blocked())return;const id=++token;current=a;
    const data=await load(a);if(id!==token||current!==a||blocked()||!a.isConnected)return;
    shown=true;renderPreview({anchor:a,data,sheet:innerWidth<=640},next=>{if(!current?.contains(next))hide();});a.setAttribute('aria-describedby','link-preview');
  }
  let shown=false;
  function hide(){token++;clearTimeout(timer);current?.removeAttribute('aria-describedby');current=null;if(shown){shown=false;renderPreview(null,()=>{});}}
  document.addEventListener('mouseover',event=>{
    const a=event.target.closest?.('a[href]');if(!previewable(a)||a===current)return;
    clearTimeout(timer);timer=setTimeout(()=>show(a),350);
  });
  document.addEventListener('mouseout',event=>{
    const a=event.target.closest?.('a[href]');if(!a||a.contains(event.relatedTarget))return;
    clearTimeout(timer);if(a===current&&!inTip(event.relatedTarget))hide();
  });
  document.addEventListener('focusin',event=>{const a=event.target.closest?.('a[href]');if(previewable(a)){clearTimeout(timer);show(a);}});
  document.addEventListener('focusout',event=>{if(current&&event.target===current)hide();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(current||shown))hide();},true);
  document.addEventListener('mousedown',event=>{if(!inTip(event.target))hide();},true);
  document.addEventListener('scroll',()=>{if(current)hide();},{capture:true,passive:true});
  document.addEventListener('selectionchange',()=>{if(current&&!getSelection()?.isCollapsed)hide();});

  // Linked from ------------------------------------------------------------
  function rows(items){
    return `<ol class="linked-from-list">${items.map(row=>`<li><a class="linked-from-row" href="${esc('#read='+param(row.source))}" data-source="${esc(row.source)}" data-fragment="${esc(row.fragment||'')}"><span class="linked-from-title">${esc(row.title)}</span><span class="linked-from-meta">${row.count} ${plural(row.count,'link','links')}${row.heading?` · § ${esc(row.heading)}`:''}</span></a></li>`).join('')}</ol>`;
  }
  function body(data,all){
    const count=data.inbound_count||0;
    if(data.state==='building')return '<p class="linked-from-note">Building the link graph…</p>';
    if(data.state==='failed')return `<p class="linked-from-note">The link graph couldn’t be built: ${esc(data.error||'unknown error')}. <a href="#admin/indexes" data-backstage>Reader Admin, Indexes</a></p>`;
    if(!count)return '<p class="linked-from-note">No other library document links here yet.</p>';
    const shown=all?data.inbound:data.inbound.slice(0,VISIBLE);
    return rows(shown)+(!all&&count>VISIBLE?`<button type="button" data-button="ghost xs" class="linked-from-more">Show all ${count}</button>`:'')+(all&&count>data.inbound.length?`<p class="linked-from-note">Showing the ${data.inbound.length} documents with the most links of ${count}.</p>`:'');
  }
  function wire(root,data,path){
    root.querySelectorAll('.linked-from-row').forEach(row=>row.addEventListener('click',event=>{event.preventDefault();hide();if(root.closest('#thread-panel'))$('#thread-panel').hidden=true;navigate(row.dataset.source,{fragment:row.dataset.fragment});}));
    root.querySelectorAll('[data-backstage]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();openBackstage();}));
    root.querySelector('.linked-from-more')?.addEventListener('click',()=>{const section=root;section.querySelector('.linked-from-body').innerHTML=body(data,true);wire(section,data,path);section.querySelector('.linked-from-row')?.focus();reading.reflow();});
  }
  function section(data,path){
    const element=document.createElement('section');element.className='linked-from';element.dataset.readerDecoration='';element.dataset.endOrder='1';element.dataset.state=data.state;element.setAttribute('aria-labelledby','linked-from-title');
    element.innerHTML=`<div class="eyebrow" id="linked-from-title">Linked from${data.inbound_count?` <span class="linked-from-count">${data.inbound_count}</span>`:''}</div><div class="linked-from-body">${body(data,false)}</div>${data.state==='ready'&&data.stale?'<p class="linked-from-stale">The link graph is older than the library. <a href="#backstage" data-backstage>Refresh it behind the scenes</a>.</p>':''}`;
    wire(element,data,path);return element;
  }
  function openList(data,path){
    hide();state.activeThread=null;$('#thread-panel').hidden=false;$('#thread-title').textContent='Linked from';
    const body=$('#thread-body');body.innerHTML=`<p class="thread-status">${data.inbound_count} ${plural(data.inbound_count,'document links','documents link')} here.</p><div class="linked-from in-panel"><div class="linked-from-body">${rows(data.inbound)}</div></div>`;
    wire(body.querySelector('.linked-from'),data,path);body.querySelector('.linked-from-row')?.focus();
  }
  function place(data,path){
    document.querySelectorAll('#main .linked-from,#main .linked-from-compact').forEach(el=>el.remove());
    const element=section(data,path);
    if(reading.placeAtEnd(element))return;
    // Two-page reading without room on the last spread: one line that opens the list in the side panel.
    if(!data.inbound_count)return;
    const compact=document.createElement('p');compact.className='linked-from-compact';compact.dataset.readerDecoration='';compact.dataset.endOrder='1';
    compact.innerHTML=`<button type="button" data-button="ghost xs">Linked from ${data.inbound_count} ${plural(data.inbound_count,'document','documents')}</button>`;
    compact.querySelector('button').addEventListener('click',()=>openList(data,path));
    reading.placeAtEnd(compact);
  }
  async function backlinks(path,routeId,attempt=0){
    if(state.prefs.backlinks===false)return;
    let data;try{data=await api('/api/links?path='+param(path));}catch{return;}
    if(routeId!==state.routeId||state.doc?.path!==path)return;
    place(data,path);
    if(data.state==='building'&&attempt<90)setTimeout(()=>backlinks(path,routeId,attempt+1),attempt<5?700:2000);
  }
  /** K: show a link's preview now, without the hover delay. */
  function preview(a){clearTimeout(timer);show(a);}
  return {backlinks,hide,preview};
}
