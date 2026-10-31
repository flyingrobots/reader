/** Quiet reading chrome, real column pagination, and version-bound resume positions. */
import {modalOpen} from './modal.mjs';
import {codePointOffset} from './logic.mjs';
import {shownTop} from './place.mjs';
export function installReading({scratchStatus, statusOverride, onStatus, mayCurl, controls, state, api, toast, openAdmin, openThread, revealRange, scrollToPosition, savePrefs, reloadDocument, positionPins, updateBreadcrumbs, keyStatus = () => null}) {
  const $ = selector => document.querySelector(selector);
  const clamp = n => Math.max(0, Math.min(1, n));
  let turner=null,turnerLoad=null,turnerModule=null;
  // The 3D page turn loads only when two-page reading starts; until then, or without WebGL, spreads slide.
  const loadTurner=()=>turnerLoad??=import('./controls/page-turn.js').then(m=>{turnerModule=m;turner=m.createPageTurner();return turner;}).catch(()=>null);
  const curl=()=>turner&&(!mayCurl||mayCurl())&&state.prefs.pageTurn!=='slide'&&book?.columns===2&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ready=false, book=null, saveTimer, saveQueue=Promise.resolve(), lastSaved='', words=0, frame=0;
  // Layout listeners (the outline) run in the same animation frame as the status line, and on reflow/prepare.
  const listeners=new Set(),notify=reason=>{for(const listener of listeners)listener(reason);};
  const hasBook=()=>!!book;
  const scrollSpan=()=>Math.max(0,document.documentElement.scrollHeight-innerHeight);
  const progress=()=>book?(book.spreads>1?Math.round(book.viewport.scrollLeft/book.stride)/(book.spreads-1):0):scrollSpan()?clamp(scrollY/scrollSpan()):0;
  // A document whose end is in view counts as finished after a short dwell, so one-screen documents can finish without scrolling.
  const DWELL=3000;let openedAt=0,dwellTimer;
  const endVisible=()=>{
    if(book)return book.spreads<=1||Math.round(book.viewport.scrollLeft/book.stride)>=book.spreads-1;
    const last=[...document.querySelectorAll('#article [data-source-start], #article [data-pdf-page]')].filter(el=>!el.closest('.document-embed,[data-reader-decoration]')).at(-1);
    return !!last&&last.getBoundingClientRect().bottom<=innerHeight+1;
  };
  const savedProgress=()=>endVisible()&&performance.now()-openedAt>=DWELL?1:clamp(progress());
  function updateStatus(){
    if(statusOverride?.())return;
    const active=document.activeElement;
    let mode='NORMAL',keys='<kbd>Space e</kbd> files <kbd>/</kbd> find <kbd>?</kbd> keys';
    const scratch=scratchStatus?.();
    // The keymap owns LEADER, WINDOW (Ctrl-w), VISUAL and COMMAND, and generates their hints from its table.
    const owned=keyStatus();
    if(owned){mode=owned.mode;keys=owned.keys;}
    else if(scratch&&!modalOpen()){mode=scratch.mode;keys=scratch.keys;}
    else if($('#picker')?.matches('[data-open]')){mode=$('#picker-filter').hidden?'BROWSE':'SEARCH';keys=$('#picker-filter').hidden?'<kbd>j k</kbd> choose <kbd>/</kbd> filter <kbd>Enter</kbd> open <kbd>Esc</kbd> close':'<kbd>↑ ↓</kbd> choose <kbd>Enter</kbd> open <kbd>Esc</kbd> clear filter';}
    else if($('#status-location details[open]')){mode='BROWSE';keys='<kbd>↑ ↓</kbd> folders <kbd>Enter</kbd> browse <kbd>Esc</kbd> close';}
    else if(!$('#find-bar').hidden){mode='SEARCH';keys='<kbd>Enter</kbd> find <kbd>n N</kbd> next / previous <kbd>Esc</kbd> close';}
    else if(active?.closest('#chat-panel')&&!$('#chat-panel').hidden){mode='CHAT';keys=active.matches('textarea,input')?'<kbd>@</kbd> mention <kbd>Enter</kbd> send <kbd>Shift Enter</kbd> new line <kbd>Esc</kbd> close':'<kbd>Tab</kbd> move <kbd>Esc</kbd> close';}
    else if(active?.matches('textarea,input,[contenteditable=true]')&&!(state.view==='search'&&active.id==='search-query')){mode='INSERT';keys='<kbd>⌘ Enter</kbd> send <kbd>Esc</kbd> normal';}
    else if(state.themeEditorOpen){mode='SETTINGS';keys='<kbd>Tab</kbd> move <kbd>F10</kbd> <kbd>Esc</kbd> close';}
    else if($('#help')?.matches('[data-open]')){mode='HELP';keys='<kbd>Esc</kbd> return to reading';}
    else if(!$('#queue-panel').hidden){mode='QUEUE';keys='<kbd>j k</kbd> move <kbd>Enter</kbd> open <kbd>Tab</kbd> up next / history <kbd>Esc</kbd> close';}
    else if(!$('#list-panel').hidden){mode=$('#list-panel').dataset.mode||'LIST';keys='<kbd>j k</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close';}
    else if(!$('#versions-panel').hidden){mode='VERSIONS';keys='<kbd>j k</kbd> move <kbd>Enter</kbd> open <kbd>c</kbd> compare <kbd>Esc</kbd> close';}
    else if($('#chat-panel')&&!$('#chat-panel').hidden){mode='CHAT';keys='<kbd>Tab</kbd> move to the composer <kbd>Space m</kbd> <kbd>Esc</kbd> close';}
    else if(!$('#thread-panel').hidden){mode='THREAD';keys='<kbd>Tab</kbd> move <kbd>Esc</kbd> return to reading';}
    else if(active?.matches?.('.cover-shape,.article-shape')){mode='SHAPE';keys='<kbd>← →</kbd> passages <kbd>↑ ↓</kbd> related works <kbd>Enter</kbd> open <kbd>Esc</kbd> page';}
    else if(state.view==='issue'&&!state.doc){keys='<kbd>j k</kbd> pieces <kbd>↵</kbd> open <kbd>g c</kbd> cover <kbd>[ ]</kbd> issues <kbd>Space e</kbd> files';}
    else if(state.view==='search'&&!active?.matches('input,textarea')){mode='SEARCH';keys='<kbd>j k</kbd> passages <kbd>J K</kbd> works <kbd>Enter</kbd> open <kbd>o</kbd> new tab <kbd>/</kbd> query <kbd>Esc</kbd> back';}
    else if(state.view==='search'){mode='SEARCH';keys='<kbd>↓</kbd> results <kbd>Enter</kbd> open <kbd>Esc</kbd> results';}
    else if(state.view==='admin'){mode='ADMIN';keys='<kbd>Tab</kbd> move <kbd>h</kbd> back <kbd>Space p</kbd> settings <kbd>Space h</kbd> home';}
    else if(book){keys='<kbd>j k</kbd> or wheel to turn <kbd>/</kbd> find <kbd>Space e</kbd> files';}
    // Mode changes are announced once, for screen readers; the label itself is not a live region.
    if($('#vim-mode').dataset.mode&&$('#vim-mode').dataset.mode!==mode&&$('#mode-live'))$('#mode-live').textContent=mode==='NORMAL'?'Normal mode':mode.charAt(0)+mode.slice(1).toLowerCase()+' mode';
    $('#vim-mode').textContent=mode;$('#vim-mode').dataset.mode=mode;$('#status-keys').innerHTML=keys;
    updateBreadcrumbs(state.doc?.path || (state.view==='admin'?state.adminPath:state.view==='search'?':search':null));
    $('#status-position').textContent=state.doc?Math.round(progress()*100)+'%':scratch?scratch.position:'';
    controls.update({value:clamp(progress()),words,pdfPages:state.doc?.kind==='.pdf'?(state.pdf?.count||0):null,pace:state.prefs.pace||220,spread:book?Math.round(book.viewport.scrollLeft/book.stride):0,spreads:book?.spreads||0,pages:book?.pages||0,columns:book?.columns||2,theme:state.prefs.theme});

    $('#layout-swap').textContent=state.prefs.layout==='spread'?'Scroll':'2 pages';$('#layout-swap').setAttribute('aria-label',state.prefs.layout==='spread'?'Switch to continuous reading':'Switch to two-page reading');
    onStatus?.();
  }
  function measureBook(){
    if(!book)return;
    const width=book.viewport.clientWidth,gap=parseFloat(getComputedStyle(book.article).columnGap)||40;
    book.columns=parseInt(getComputedStyle(book.article).columnCount)||1;book.stride=width+gap;book.width=width;
    // scrollWidth includes the empty facing column. Measure occupied fragments so
    // short documents and a final odd page don't advertise a blank extra page.
    const left=book.article.getBoundingClientRect().left;
    let occupied=0;
    for(const element of book.article.children)if(!element.classList.contains('annotation-pin'))for(const rect of element.getClientRects())if(rect.width>0&&rect.height>0)occupied=Math.max(occupied,rect.right-left);
    book.pages=Math.max(1,Math.ceil((occupied+gap-1)/(book.stride/book.columns)));book.spreads=Math.ceil(book.pages/book.columns);
    book.tail.style.left=(book.spreads-1)*book.stride+width-1+'px';
  }
  /** Put an end-of-document aside after the article, but in two-page mode only if it fits the last spread.
   *  Asides keep a stable order by data-end-order (Linked from 1, Read next 2), whichever arrives first. */
  function placeAtEnd(element){
    const article=$('#article');if(!article)return false;
    const order=+element.dataset.endOrder||0,parent=book?book.article:article.parentElement;
    const peers=[...parent.children].filter(el=>el!==element&&el.dataset.endOrder!==undefined);
    const next=peers.find(el=>+el.dataset.endOrder>order);
    const insert=()=>next?next.before(element):book?book.article.append(element):(peers.at(-1)||article).after(element);
    if(!book){insert();update();return true;}
    // Remember every end aside, including one that does not fit now, so a resize can place them again.
    book.ends||=new Set();for(const old of book.ends)if(old!==element&&old.dataset.endOrder===element.dataset.endOrder)book.ends.delete(old);
    const before=book.spreads;book.ends.add(element);insert();measureBook();
    if(book.spreads>before){element.remove();measureBook();update();return false;}
    update();return true;
  }
  function turn(delta){if(!book)return;seekSpread(Math.round(book.viewport.scrollLeft/book.stride)+delta);}
  function seekSpread(index,animate=true){
    if(!book)return;index=Math.max(0,Math.min(book.spreads-1,index));
    const target=index*book.stride,viewport=book.viewport;
    if(Math.abs(viewport.scrollLeft-target)<1){update();return;}
    const current=Math.round(viewport.scrollLeft/book.stride);
    if(animate&&Math.abs(index-current)===1&&curl()){
      book.animating=true;gsap.killTweensOf(viewport);
      turner.turn({viewport,article:book.article,direction:index>current?1:-1,stride:book.stride,commit:()=>{viewport.scrollLeft=target;update();}}).then(()=>{if(book?.viewport===viewport)book.animating=false;update();scheduleSave();});
      return;
    }
    turner?.finish();
    book.animating=true;
    if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.to(viewport,{scrollLeft:target,duration:.48,ease:'power2.inOut',overwrite:true,onUpdate:update,onComplete:()=>{if(book?.viewport===viewport)book.animating=false;update();scheduleSave();}});
    else{gsap.killTweensOf(viewport);viewport.scrollLeft=target;book.animating=false;update();}
  }
  function seek(fraction,animate=true){if(book)seekSpread(Math.round(clamp(fraction)*(book.spreads-1)),animate);else scrollToPosition(scrollSpan()*clamp(fraction),animate);}
  function reveal(range,animate=true){
    if(!book)return false;const rect=[...range.getClientRects()][0];if(!rect)return true;
    const x=rect.left-book.viewport.getBoundingClientRect().left+book.viewport.scrollLeft;
    seekSpread(Math.floor((x+2)/book.stride),animate);return true;
  }
  /** The element (or a text range, for plain text) holding a 1-based source line; a PDF page for PDFs. */
  function lineTarget(line,page){
    if(state.pdf)return document.querySelector(`#article [data-pdf-page="${page||1}"]`);
    const text=state.doc?.text;if(typeof text!=='string')return null;
    let index=0;for(let n=1;n<line;n++){const next=text.indexOf('\n',index);if(next<0)break;index=next+1;}
    const blocks=[...document.querySelectorAll('#article [data-source-start]')].filter(el=>!el.closest('.document-embed'));
    if(blocks.length){
      const offset=codePointOffset(text,index),size=el=>+el.dataset.sourceEnd-el.dataset.sourceStart;
      return blocks.filter(el=>+el.dataset.sourceStart<=offset&&offset<+el.dataset.sourceEnd).sort((a,b)=>size(a)-size(b))[0]||blocks.find(el=>+el.dataset.sourceStart>=offset)||blocks.at(-1);
    }
    const node=document.querySelector('#article > pre')?.firstChild;
    if(node?.nodeType!==Node.TEXT_NODE)return null;
    const range=document.createRange(),at=Math.min(index,node.length);range.setStart(node,at);range.setEnd(node,Math.min(at+1,node.length));return range;
  }
  /** Bring a source line into view: scroll in continuous layout, turn to its spread in two-page mode. Returns its range. */
  function revealLine(line,page=null){
    const target=lineTarget(line,page);if(!target)return null;
    let range=target;if(!(target instanceof Range)){range=document.createRange();range.selectNodeContents(target);}
    if(!reveal(range,false)){const rect=(target instanceof Range?range:target).getBoundingClientRect();scrollToPosition(shownTop(state.smoother)+rect.top-innerHeight*.3,false,target);}
    update();return range;
  }
  function capture(){
    // Inbox previews and historical versions are read-only: no reading position is saved for them.
    if(!state.doc||state.doc.preview||state.doc.historical)return null;
    const blocks=[...document.querySelectorAll('#article [data-source-start], #article [data-pdf-page]')].filter(el=>!el.closest('.document-embed'));
    let target=null,fraction=0;
    if(book){
      const box=book.viewport.getBoundingClientRect();
      const visible=blocks.flatMap(el=>[...el.getClientRects()].map(rect=>({el,rect}))).filter(({rect})=>rect.right>box.left+2&&rect.left<box.right-2&&rect.bottom>box.top&&rect.top<box.bottom);
      visible.sort((a,b)=>Math.floor((a.rect.left-box.left)/(book.stride/2))-Math.floor((b.rect.left-box.left)/(book.stride/2)) || a.rect.top-b.rect.top);
      target=visible[0]?.el;
    }else{
      const line=innerHeight*.22;
      target=blocks.filter(el=>{const r=el.getBoundingClientRect();return r.top<=line&&r.bottom>line;}).sort((a,b)=>(+a.dataset.sourceEnd-a.dataset.sourceStart)-(+b.dataset.sourceEnd-b.dataset.sourceStart))[0];
      if(target){const r=target.getBoundingClientRect();fraction=clamp((line-r.top)/r.height);}
    }
    return {participant:state.prefs.participant,path:state.doc.path,source_sha256:state.doc.sha256,progress:savedProgress(),source_offset:target?.dataset.sourceStart!==undefined?+target.dataset.sourceStart:null,pdf_page:target?.dataset.pdfPage?+target.dataset.pdfPage:null,block_fraction:fraction,layout:book?'spread':'scroll',spread_count:book?.spreads || null};
  }
  function save(keepalive=false){
    if(!ready)return saveQueue;const snapshot=capture();if(!snapshot)return saveQueue;
    const key=JSON.stringify(snapshot);if(lastSaved===key)return saveQueue;lastSaved=key;
    saveQueue=saveQueue.catch(()=>{}).then(()=>api('/api/bookmark',snapshot,{keepalive})).catch(error=>{if(lastSaved===key)lastSaved='';if(!error.offline)toast('Couldn’t save your place: '+error.message);});
    return saveQueue;
  }
  function saveWhenSettled(){
    // Native scroll events precede the smooth renderer. Saving mid-glide can replace a restored
    // bookmark with a transient block fraction; wait for the page the reader actually sees.
    if(state.smoother&&Math.abs(scrollY-shownTop(state.smoother))>1)scheduleSave();else save();
  }
  function scheduleSave(){if(!ready)return;clearTimeout(saveTimer);saveTimer=setTimeout(saveWhenSettled,450);}
  async function leave(){turner?.finish();clearTimeout(saveTimer);clearTimeout(dwellTimer);await save();ready=false;book?.observer?.disconnect();book=null;}
  function prepare(){
    controls.update({pips:[]});
    ready=false;lastSaved='';book=null;
    const paged=!!state.doc&&state.prefs.layout==='spread'&&(state.doc.text!==null||!!state.pdf);
    document.body.classList.toggle('two-page',paged);document.body.classList.toggle('zen',!!state.prefs.zen);
    $('#reading-progress').hidden=!state.doc;
    if(paged){
      const article=$('#article'),viewport=document.createElement('div'),tail=document.createElement('span');viewport.className='book-viewport';viewport.tabIndex=-1;tail.className='book-tail';article.before(viewport);viewport.append(article,tail);
      book={article,viewport,tail,stride:1,spreads:1,animating:false,lastTurn:0,accumulated:0};
      viewport.addEventListener('wheel',event=>{if(event.ctrlKey)return;event.preventDefault();book.accumulated+=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;if(Math.abs(book.accumulated)<25||Date.now()-book.lastTurn<500)return;const delta=Math.sign(book.accumulated);book.accumulated=0;book.lastTurn=Date.now();turn(delta);},{passive:false});
      viewport.addEventListener('scroll',()=>{update();scheduleSave();if(!book.animating){clearTimeout(viewport.snapTimer);viewport.snapTimer=setTimeout(()=>{if(book?.viewport===viewport)seekSpread(Math.round(viewport.scrollLeft/book.stride));},150);}});
      measureBook();if(!mayCurl||mayCurl())loadTurner().then(()=>turnerModule?.scheduleWarm(0));
    }
    notify('prepare');updateStatus();
  }
  async function restore(doc){
    await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,700))]);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    measureBook();const mark=doc.bookmark;
    if(mark?.source_sha256===doc.sha256){
      const targets=mark.pdf_page?[...document.querySelectorAll('#article [data-pdf-page]')].filter(el=>+el.dataset.pdfPage===mark.pdf_page):mark.source_offset!==null?[...document.querySelectorAll('#article [data-source-start]')].filter(el=>+el.dataset.sourceStart===mark.source_offset):[];
      const target=targets.sort((a,b)=>(+a.dataset.sourceEnd-a.dataset.sourceStart)-(+b.dataset.sourceEnd-b.dataset.sourceStart))[0];
      if(book && mark.layout==='spread' && mark.spread_count===book.spreads)seek(mark.progress,false);
      else if(target){
        const range=document.createRange();range.selectNode(target);
        if(!reveal(range,false)){const r=target.getBoundingClientRect();scrollToPosition(shownTop(state.smoother)+r.top+r.height*(mark.block_fraction || 0)-innerHeight*.22,false,target,mark.block_fraction || 0);}
      }else seek(mark.progress,false);
    }else if(mark)toast('This edition has changed. Starting at the beginning.');
    words=($('#article')?.textContent || '').split(/\s+/u).filter(Boolean).length;
    ready=true;update();$('#main .resume-pending')?.classList.remove('resume-pending');
    openedAt=performance.now();clearTimeout(dwellTimer);dwellTimer=setTimeout(()=>{if(ready&&endVisible())saveWhenSettled();},DWELL+50);
  }
  function update(){
    if(frame)return;frame=requestAnimationFrame(()=>{frame=0;updateStatus();if(book)positionPins();state.pdf?.reflow();
      // Remember the settled reading position; a resize reflows columns before its event arrives.
      // It changes only when the reader moves to another spread, so repeated resizes don't drift.
      if(book&&!book.animating&&!prepare.resizeTimer&&book.viewport.clientWidth===book.width){const index=Math.round(book.viewport.scrollLeft/book.stride);if(index!==book.anchorSpread){book.anchor=spreadAnchor();book.anchorSpread=index;}}notify('frame');});
  }
  function pips(){
    const pips=[];
    for(const {thread,range} of state.ranges){
      const rect=[...range.getClientRects()][0];if(!rect)continue;
      let fraction;
      if(book){const x=rect.left-book.viewport.getBoundingClientRect().left+book.viewport.scrollLeft;fraction=book.spreads>1?Math.floor((x+2)/book.stride)/(book.spreads-1):0;}
      else fraction=scrollSpan()?clamp((rect.top+shownTop(state.smoother)-innerHeight*.36)/scrollSpan()):0;
      pips.push({id:thread.id,owner:thread.owner,quote:thread.anchor.quote.slice(0,180),kind:thread.kind,own:thread.owner===state.prefs.participant,fraction:clamp(fraction)});
    }
    controls.update({pips});update();
  }
  $('#settings-open').onclick=()=>openAdmin();  // The footer's Backstage: Reader Admin's Overview.

  $('#layout-swap').onclick=async()=>{await save();state.prefs.layout=state.prefs.layout==='spread'?'scroll':'spread';savePrefs();if(state.doc)await reloadDocument();else updateStatus();};
  document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'&&event.target.matches('textarea')){event.preventDefault();event.target.closest('form')?.requestSubmit();}queueMicrotask(updateStatus);});
  document.addEventListener('focusin',updateStatus);document.addEventListener('focusout',()=>queueMicrotask(updateStatus));
  for(const el of document.querySelectorAll('dialog'))el.addEventListener('toggle',updateStatus);
  const observer=new MutationObserver(updateStatus);for(const el of [$('#find-bar'),$('#thread-panel'),$('#versions-panel'),$('#queue-panel'),$('#list-panel')])observer.observe(el,{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('scroll',()=>{update();scheduleSave();},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')save(true);});window.addEventListener('pagehide',()=>save(true));
  /** The first visible character of the first visible block: the reading position a reflow must keep. */
  function spreadAnchor(){
    const offset=capture()?.source_offset,block=offset!=null&&book.article.querySelector(`[data-source-start="${offset}"]`);if(!block)return null;
    const left=book.viewport.getBoundingClientRect().left-2,range=document.createRange();
    const shown=(node,index)=>{range.setStart(node,index);range.setEnd(node,index+1);const rect=range.getClientRects()[0];return !!rect&&rect.left>=left;};
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement.closest('.annotation-pin,[data-reader-decoration]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
    for(let node;(node=walker.nextNode());){
      if(!node.data.trim()||!shown(node,node.data.length-1))continue;
      // Text flows forward through the columns, so the first character on this spread can be bisected.
      let lo=0,hi=node.data.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(shown(node,mid))hi=mid;else lo=mid+1;}
      range.setStart(node,lo);range.setEnd(node,lo+1);return range;
    }
    range.selectNode(block);return range;
  }
  window.addEventListener('resize',()=>{
    if(!book)return;const index=Math.round(book.viewport.scrollLeft/book.stride);
    // Columns reflow at the new size, so the same spread index shows other text; keep the remembered first visible text instead.
    clearTimeout(prepare.resizeTimer);prepare.resizeTimer=setTimeout(()=>{
      prepare.resizeTimer=null;if(!book)return;const anchor=book.anchor;measureBook();
      // Read next appears only when it fits the last spread, so re-check it at the new size.
      if(book.ends?.size){const ends=[...book.ends].sort((x,y)=>(+x.dataset.endOrder||0)-(+y.dataset.endOrder||0));for(const end of ends)end.remove();measureBook();for(const end of ends)placeAtEnd(end);}
      if(!anchor||!reveal(anchor,false))seekSpread(index,false);book.anchorSpread=Math.round(book.viewport.scrollLeft/book.stride);pips();notify('reflow');
    },160);
  });
  /** Split view: only the focused pane holds a WebGL context; the others turn spreads by sliding. */
  function paneFocus(focused){
    if(focused){if(book)loadTurner().then(()=>turnerModule?.scheduleWarm(0));return;}
    turner?.finish();turner?.dispose?.();turner=null;turnerLoad=null;
  }
  return {prepare,restore,leave,save,capture,update,pips,hasBook,paneFocus,progress:()=>clamp(progress()),isTurning:()=>!!book?.animating,placeAtEnd,turn,seek,seekSpread,reveal,revealLine,updateStatus,reflow(){measureBook();pips();notify('reflow');},subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    /** Two-page geometry for spread-based consumers; null in continuous reading. */
    geometry(){return book?{viewport:book.viewport,article:book.article,stride:book.stride,columns:book.columns,pages:book.pages,spreads:book.spreads,spread:Math.round(book.viewport.scrollLeft/book.stride)}:null;},toggleZen(){state.prefs.zen=!state.prefs.zen;document.body.classList.toggle('zen',state.prefs.zen);savePrefs();updateStatus();}};
}
