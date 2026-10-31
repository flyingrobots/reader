/** A quiet, accessible breadcrumb trail with a menu for collapsed ancestors. */
import {escapeHTML as esc} from './logic.mjs';

// Non-document views use a ':' sentinel instead of a library path.
const VIEWS={':search':'Search'};
export function breadcrumbTrail(path, narrow=false) {
  // Reader Admin has its own header breadcrumb; the status line names the layout.
  if(path===':admin'||path?.startsWith(':admin/'))return {items:[{label:'Reader Admin',current:true,title:'Reader Admin'}],hidden:[]};
  if(path?.startsWith(':section='))return {items:[{label:path.slice(9),current:true}],hidden:[]};
  if(VIEWS[path])return {items:[{label:VIEWS[path],current:true,title:VIEWS[path]}],hidden:[]};
  if(!path)return {items:[],hidden:[]};
  // Inbox previews are not library folders; name the inbox instead of offering folder browsing.
  if(path.startsWith('inbox/'))return {items:[{label:'Inbox · '+path.split('/').at(-1),current:true,title:path}],hidden:[]};
  const parts=path.split('/'), folders=parts.slice(1,-1).map((label,index)=>({label,folder:parts.slice(0,index+2).join('/')+'/'}));
  const hidden=narrow?folders:folders.length>2?folders.slice(0,-1):[];
  return {items:[...(hidden.length?[{collapsed:true}]:[]),...(narrow?[]:hidden.length?folders.slice(-1):folders),{label:parts.at(-1),current:true}],hidden};
}

export function installBreadcrumbs({container,openFolder,onChange}) {
  const narrow=matchMedia('(max-width:700px)');
  let previous, currentPath=null;
  const separator='<li class="breadcrumb-separator" role="presentation" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="m6 4 4 4-4 4"/></svg></li>';
  function closeMenu(focus=false){const details=container.querySelector('details');if(details?.open){details.open=false;const summary=details.querySelector('summary');summary.setAttribute('aria-expanded','false');if(focus)summary.focus();}}
  function update(path=currentPath){
    currentPath=path;const key=JSON.stringify([path,narrow.matches]);if(key===previous)return;previous=key;
    const {items,hidden}=breadcrumbTrail(path,narrow.matches);
    container.hidden=items.length===0;
    container.innerHTML='<ol class="breadcrumb-list">'+items.map(item=>{
      if(item.collapsed)return '<li class="breadcrumb-item breadcrumb-overflow"><details><summary class="breadcrumb-link" aria-label="Show parent folders" aria-haspopup="menu" aria-expanded="false"><span aria-hidden="true">…</span></summary><div class="breadcrumb-menu" role="menu" aria-label="Parent folders">'+hidden.map(parent=>`<button type="button" role="menuitem" data-folder="${esc(parent.folder)}" title="${esc(parent.folder)}">${esc(parent.label)}</button>`).join('')+'</div></details></li>';
      if(item.current)return `<li class="breadcrumb-item breadcrumb-current"><span aria-current="page" title="${esc(item.title || path || 'Library')}">${esc(item.label)}</span></li>`;
      return `<li class="breadcrumb-item"><button type="button" class="breadcrumb-link" data-folder="${esc(item.folder)}" title="${esc(item.folder)}">${esc(item.label)}</button></li>`;
    }).join(separator)+'</ol>';
    const details=container.querySelector('details');
    details?.addEventListener('toggle',()=>{
      const summary=details.querySelector('summary');summary.setAttribute('aria-expanded',String(details.open));
      onChange?.();
      if(!details.open)return;
      const menu=details.querySelector('[role=menu]'),box=details.getBoundingClientRect();
      const width=menu.getBoundingClientRect().width;menu.style.left=Math.max(8,Math.min(innerWidth-width-8,box.left))-box.left+'px';
      menu.querySelector('button')?.focus();
    });
  }
  container.addEventListener('click',event=>{
    const folder=event.target.closest('[data-folder]');
    if(folder){closeMenu();openFolder(folder.dataset.folder);}
  });
  container.addEventListener('keydown',event=>{
    // Native link/button/summary activation takes priority over Vim motions here.
    if(event.key===' '||event.key==='Enter')event.stopPropagation();
    const details=container.querySelector('details');if(!details?.contains(event.target))return;
    if(event.key==='Escape'&&details.open){event.preventDefault();event.stopPropagation();closeMenu(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    if(!details.open){details.open=true;return;}
    const buttons=[...details.querySelectorAll('[role=menuitem]')],index=buttons.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    buttons[next]?.focus();
  });
  document.addEventListener('click',event=>{if(!container.contains(event.target))closeMenu();});
  container.addEventListener('focusout',()=>queueMicrotask(()=>{if(!container.contains(document.activeElement))closeMenu();}));
  narrow.addEventListener('change',()=>update());
  return {update};
}
