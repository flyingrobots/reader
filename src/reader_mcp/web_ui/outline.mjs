/** Document outline: a quiet rail in continuous reading, a popover in two-page reading, a sheet on phones. */
import {escapeHTML as esc} from './logic.mjs';
const LIMIT=500,FOLD=150,RAIL_MIN=150,RAIL_MAX=240;
const PHONE='(max-width: 700px)';

/** GitHub-style heading slug; ids already used anywhere in the page get a numeric suffix. */
export function slugify(text){return text.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s+/g,'-').slice(0,80) || 'section';}

export function installOutline({state,reading,$,controls,scrollToPosition,savePrefs,notify}){
  // entries: every extracted heading; shown: the subset at visible levels. Index math uses shown.
  let entries=[],shown=[],allLevels=false,eligible=false,pinned=false,open=false,mode=null,active=-1,pending=null,pendingAt=0,spreads=[],route=0;
  const rail=document.createElement('nav');rail.id='outline-rail';rail.className='outline-rail';rail.hidden=true;rail.dataset.readerDecoration='';rail.setAttribute('aria-label','Document outline');
  document.body.append(rail);
  const line=()=>innerHeight*.22;
  const expired=()=>performance.now()-pendingAt>1500;
  const phone=()=>matchMedia(PHONE).matches;
  const geometry=()=>reading.geometry();
  const target=entry=>entry.el || state.pdf?.pages[entry.page-1];
  const top=entry=>target(entry)?.getBoundingClientRect().top ?? Infinity;
  const spreadOf=(element,book)=>{const rect=element?[...element.getClientRects()][0]:null;if(!rect)return 0;const x=rect.left-book.viewport.getBoundingClientRect().left+book.viewport.scrollLeft;return Math.max(0,Math.floor((x+2)/book.stride));};
  const pageLabel=(spread,book)=>{const first=spread*book.columns+1,last=Math.min(book.pages,first+book.columns-1);return first>=last?'p. '+first:`p. ${first}–${last}`;};

  /** The rail's right edge: left of the article and of the wider blocks after it (Read next, Linked from, the footer), which start at the shell's content edge. */
  function railEdge(){
    const article=$('#article'),shell=article?.parentElement;if(!article)return 0;
    const clear=shell?shell.getBoundingClientRect().left+parseFloat(getComputedStyle(shell).paddingLeft||0):Infinity;
    return Math.min(article.getBoundingClientRect().left-48,clear-16);
  }
  function railFits(){
    if(!$('#article')||geometry()||phone())return false;
    return railEdge()>=RAIL_MIN+8;
  }
  function chooseMode(){if(!shown.length)return null;if(phone())return 'sheet';if(geometry()||!railFits())return 'popover';return 'rail';}
  const railVisible=()=>mode==='rail'&&state.prefs.outline!==false&&(eligible||pinned);

  function clear(){route++;allLevels=false;entries=[];shown=[];spreads=[];active=-1;pending=null;open=false;pinned=false;mode=null;rail.hidden=true;rail.replaceChildren();$('#status-section').textContent='';publish();}
  /** Collect headings after a document renders; PDFs use their own outline. */
  async function refresh(article){
    clear();const id=route;if(!state.doc||!article)return;
    if(state.pdf){
      const list=await state.pdf.outline();if(id!==route)return;
      entries=list.map(entry=>({...entry}));eligible=entries.length>0;
    }else{
      const headings=[...article.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(el=>el.hasAttribute('data-source-start')&&!el.closest('.document-embed,[data-reader-decoration]')).slice(0,LIMIT);
      const used=new Set([...document.querySelectorAll('[id]')].map(el=>el.id));
      entries=headings.map(el=>{
        const title=(el.textContent || '').replace(/\s+/g,' ').trim().slice(0,300) || 'Untitled';
        if(!el.id){const base=slugify(title);let slug=base,n=1;while(used.has(slug))slug=`${base}-${n++}`;el.id=slug;used.add(slug);}
        return {el,title,level:+el.tagName[1]};
      });
      const words=(article.textContent || '').split(/\s+/u).filter(Boolean).length;
      eligible=entries.length>=3||words>1500;
    }
    filter();
  }
  function filter(){
    shown=allLevels||entries.length<=FOLD?entries:entries.filter(entry=>entry.level<=3);
    measure();render();
  }
  /** Two-page spreads and page labels change only on reflow. */
  function measure(){
    const book=geometry();spreads=book?shown.map(entry=>spreadOf(target(entry),book)):[];
    for(const [index,entry] of shown.entries())entry.label=book?pageLabel(spreads[index],book):state.pdf?'p. '+entry.page:'';
  }
  function render(){
    mode=chooseMode();
    const minimum=Math.min(...shown.map(entry=>entry.level));
    if(mode==='rail'){
      const folded=!allLevels&&entries.length>shown.length;
      rail.innerHTML=`<div class="outline-head">Contents</div><ol class="outline-list">${shown.map((entry,index)=>`<li data-depth="${Math.min(3,entry.level-minimum)}"><a href="#${esc(entry.el?.id || 'page-'+entry.page)}" data-outline-index="${index}">${esc(entry.title)}</a></li>`).join('')}</ol>${folded||allLevels&&entries.length>FOLD?`<button type="button" data-button="ghost xs" class="outline-levels">${allLevels?'Show fewer levels':'Show all levels'}</button>`:''}`;
      rail.querySelectorAll('[data-outline-index]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();go(+link.dataset.outlineIndex);}));
      rail.querySelector('.outline-levels')?.addEventListener('click',()=>{allLevels=!allLevels;filter();});
      const bar=document.createElement('span');bar.className='outline-progress';bar.setAttribute('aria-hidden','true');bar.innerHTML='<span></span>';rail.append(bar);
      place();
    }else rail.replaceChildren();
    rail.hidden=!railVisible();active=-1;sync();publish();
  }
  function place(){
    if(!$('#article'))return;
    const edge=railEdge(),width=Math.max(RAIL_MIN,Math.min(RAIL_MAX,edge-24));
    rail.style.width=width+'px';rail.style.left=Math.max(16,edge-width)+'px';
  }
  function publish(){
    const minimum=shown.length?Math.min(...shown.map(entry=>entry.level)):1;
    controls.update({outline:{mode:mode==='rail'?(shown.length?'rail':null):mode,open:open&&mode!=='rail',title:state.doc?.metadata?.title || '',entries:shown.map(entry=>({title:entry.title,depth:Math.min(3,entry.level-minimum),label:entry.label || ''})),folded:!allLevels&&entries.length>shown.length,railOpen:railVisible()},outlineActive:active});
  }

  /** Index of the section being read and how far through it, or -1 before the first heading. */
  function locate(){
    if(!shown.length)return {index:-1,progress:0};
    const book=geometry();
    if(book){
      let index=-1;for(let i=0;i<spreads.length;i++)if(spreads[i]<=book.spread)index=i;
      // A jump target wins while the view still shows its spread (several headings can share one).
      if(pending!==null){if(spreads[pending]===book.spread)index=pending;else if(expired())pending=null;}
      if(index<0)return {index,progress:0};
      const start=spreads[index],end=index+1<spreads.length?spreads[index+1]+1:book.spreads;
      return {index,progress:Math.max(0,Math.min(1,(book.spread-start+1)/Math.max(1,end-start)))};
    }
    const reading=line();let index=-1;
    if(state.pdf){
      // PDF outlines need not be in page order: the furthest destination at or before the reading line wins.
      let best=-Infinity;for(let i=0;i<shown.length;i++){const t=top(shown[i]);if(t<=reading+1&&t>=best){best=t;index=i;}}
    }else{let low=0,high=shown.length-1;while(low<=high){const mid=(low+high)>>1;if(top(shown[mid])<=reading+1){index=mid;low=mid+1;}else high=mid-1;}}
    const bottom=scrollY>=document.documentElement.scrollHeight-innerHeight-2;
    // Headings near the end cannot reach the reading line; a jump to one still selects it.
    if(pending!==null){if(bottom&&pending>index)index=pending;else if(!bottom&&expired())pending=null;}
    if(index<0)return {index,progress:0};
    const start=top(shown[index]),next=index+1<shown.length?top(shown[index+1]):$('#article')?.getBoundingClientRect().bottom ?? start;
    return {index,progress:bottom&&index===shown.length-1?1:Math.max(0,Math.min(1,(reading-start)/Math.max(1,next-start)))};
  }
  function sync(){
    if(!shown.length)return;
    const {index,progress}=locate();
    if(index!==active){
      active=index;
      for(const link of rail.querySelectorAll('[aria-current]'))link.removeAttribute('aria-current');
      const link=rail.querySelector(`[data-outline-index="${index}"]`);
      if(link){link.setAttribute('aria-current','location');link.parentElement.append(rail.querySelector('.outline-progress'));
        const list=rail.querySelector('.outline-list'),item=link.parentElement;
        if(item.offsetTop<list.scrollTop||item.offsetTop+item.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=item.offsetTop-list.clientHeight/3;}
      $('#status-section').textContent=index>=0?shown[index].title:'';$('#status-section').title=index>=0?shown[index].title:'';
      publish();
    }
    const bar=rail.querySelector('.outline-progress');if(bar){bar.hidden=index<0;bar.firstElementChild.style.transform=`scaleX(${progress})`;}
  }
  /** Move to a shown entry: turn to its spread in two-page mode, otherwise scroll it to the reading line. */
  function go(index,{close=true}={}){
    const entry=shown[index],element=entry&&target(entry);if(!element)return;
    pending=index;pendingAt=performance.now();
    const range=document.createRange();range.selectNode(element);
    if(!reading.reveal(range)){
      const content=$('#smooth-content').getBoundingClientRect().top;
      scrollToPosition(element.getBoundingClientRect().top-content-line()+2,true,element);
    }
    if(close&&open){open=false;publish();$('#main').focus({preventScroll:true});}
    reading.update();
  }
  /** `]]` and `[[`: the next heading, or the start of the current section, then the previous one. */
  function jump(delta){
    if(!state.doc)return;
    if(!shown.length){notify('This document has no headings.');return;}
    const {index}=locate(),book=geometry();
    let next=index+delta;
    if(delta<0&&index>=0){const into=book?book.spread>spreads[index]:top(shown[index])<line()-8;if(into)next=index;}
    if(next<0){book?reading.seekSpread(0):scrollToPosition(0);pending=null;return;}
    if(next>=shown.length){notify('This is the last heading.');return;}
    go(Math.min(shown.length-1,next),{close:false});
  }
  /** Space o: the rail toggles and is remembered per device; popover and sheet open on demand. */
  function toggle(){
    if(!state.doc)return;
    if(!shown.length){notify(state.pdf?'This PDF has no outline.':'This document has no headings.');return;}
    mode=chooseMode();
    if(mode==='rail'){
      const visible=railVisible();
      state.prefs.outline=!visible;pinned=!visible;savePrefs();rail.hidden=!railVisible();
      if(railVisible())(rail.querySelector('[aria-current]') || rail.querySelector('a'))?.focus({preventScroll:true});
      else if(rail.contains(document.activeElement))$('#main').focus({preventScroll:true});
      controls.update({prefs:{...state.prefs}});publish();return;
    }
    setOpen(!open);
  }
  function setOpen(value){open=value&&!!shown.length;publish();if(!value&&!document.activeElement?.closest('input,textarea'))$('#main').focus({preventScroll:true});}
  reading.subscribe(reason=>{
    if(reason==='prepare'){if(!state.doc||!document.getElementById('article')?.isConnected)clear();return;}
    if(!shown.length)return;
    if(reason==='reflow'){const before=mode;measure();if(chooseMode()!==before)render();else{place();active=-1;sync();publish();}return;}
    sync();
  });
  addEventListener('resize',()=>{clearTimeout(rail.resizeTimer);rail.resizeTimer=setTimeout(()=>{if(shown.length){measure();render();}},180);});
  return {refresh,clear,toggle,jump,go,setOpen,entries:()=>shown};
}
