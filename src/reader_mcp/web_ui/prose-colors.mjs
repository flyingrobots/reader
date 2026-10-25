/** Prose colors: Colorful Language roles painted as CSS custom highlights over unchanged text.
    Blocks are projected like find (whitespace collapsed, decorations excluded), sent visible-first
    to /api/prose, and each token becomes a Range confined to one text node, so selection, find,
    annotations and the page-turn rasterizer keep working. Nothing in the DOM changes. */
export const ROLES=['function','proper','quote','number','punct','noun','verb','adjective','adverb'];
/** Highlight names: Colorful's roles plus "quoted", the passage between paired quote marks. */
export const PAINTED=[...ROLES,'quoted'];
/** Intensities, weakest first; Space c steps through them and back to off. */
export const INTENSITIES=['off','subtle','clear','vivid'];
const LABELS={subtle:'Subtle',clear:'Clear',vivid:'Vivid'};
/** Settings saved before the intensity scale (Skim, Full) map onto it. */
export const intensityOf=value=>({skim:'subtle',full:'vivid'})[value]??(INTENSITIES.includes(value)?value:'off');
const OPEN={'“':'”','«':'»','"':'"'};
/** [start,end] runs of quoted text between paired quote marks of one segment (marks excluded).
    Curly and guillemet marks pair by shape; straight double quotes alternate. Unpaired marks are ignored. */
export function quotedRuns(text,spans){
  const runs=[];let open=null;
  for(const [start,end,role] of spans){if(role!=='quote')continue;const mark=text.slice(start,end);
    if(open&&mark===OPEN[open.mark]){if(start>open.end)runs.push([open.end,start]);open=null;}
    else if(mark in OPEN)open={mark,end};}
  return runs;
}
const BLOCKS='p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,dt,dd,figcaption';
// Never colored: code, math, diagrams and every non-source decoration (embed headers and notes included).
// Embedded documents are prose on the page and are colored like the document around them.
const EXCLUDED='pre,code,kbd,samp,var,math,svg,.callout-title,.katex,.MathJax,mjx-container,.mermaid,.reader-code-block,[data-reader-decoration],.annotation-pin,.next-reads,script,style,textarea';
const BATCH_BYTES=96*1024,BATCH_SEGMENTS=400,SEGMENT_BYTES=128*1024;
const encoder=new TextEncoder();

/** Text-node projection of one block: whitespace runs become one space; index = UTF-16 unit. */
export function projectBlock(block,accept){
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT,{acceptNode:node=>accept(node)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
  let text='',nodes=[],offsets=[],node;
  while((node=walker.nextNode()))for(let i=0;i<node.data.length;i++){text+=node.data[i];nodes.push(node);offsets.push(i);}
  let normalized='';const at=[];
  for(const match of text.matchAll(/\s+|\S/gu)){
    const space=/\s/u.test(match[0]);normalized+=space?' ':match[0];
    for(let k=0;k<(space?1:match[0].length);k++)at.push(match.index+k);
  }
  return {text:normalized,ranges(start,end){
    // One Range per text node, so a word split by <em> still colors and rasterizes.
    const out=[];let first=null,last=null;
    for(let i=start;i<end&&i<at.length;i++){
      const raw=at[i];if(first!==null&&nodes[raw]!==nodes[first]){out.push(span(first,last));first=null;}
      if(first===null)first=raw;last=raw;
    }
    if(first!==null)out.push(span(first,last));return out;
  }};
  function span(a,b){const range=document.createRange();range.setStart(nodes[a],offsets[a]);range.setEnd(nodes[b],offsets[b]+1);return range;}
}

export function installProseColors({state,api,notify,companion=null,onChange=()=>{}}){
  const highlights=Object.fromEntries(PAINTED.map(role=>[role,window.Highlight?new Highlight():null]));
  for(const h of Object.values(highlights))if(h)h.priority=-1; // find, annotations and selection paint over prose
  const cache=new Map();let cachedUnits=0;
  let style='off',doc=null,article=null,generation=0,status=null,statusAt=0,observer=null,running=false,stopped=false;
  let blocks=new Map(),urgent=new Set(),pending=[],done=new WeakSet(),pageRanges=new Map(),nextId=0;
  // The server colors only the open, current edition: never a historical version or an inbox preview.
  const supported=d=>!!d&&!d.historical&&!d.preview&&['.md','.markdown','.pdf'].includes(d.kind);
  const on=()=>style!=='off';

  async function probe(force=false){
    if(status&&(status.available||!force)&&Date.now()-statusAt<300000)return status;
    try{status=await api('/api/prose');}catch(error){status={available:false,message:error.message};}
    statusAt=Date.now();return status;
  }
  function paint(){
    for(const level of INTENSITIES.slice(1))document.body.classList.toggle('prose-'+level,style===level&&!!doc);
    if(CSS.highlights)for(const role of PAINTED){if(on()&&doc&&highlights[role])CSS.highlights.set('reader-prose-'+role,highlights[role]);else CSS.highlights.delete('reader-prose-'+role);}
    const chip=document.getElementById('prose-chip');
    if(chip){chip.hidden=!(on()&&doc);chip.dataset.intensity=style;if(on()){chip.setAttribute('aria-label','Prose colors: '+LABELS[style]);chip.title=`Prose colors: ${LABELS[style]} · Space c`;}}
    onChange(style);
  }
  // A block owns the text whose nearest block ancestor is itself (a list item, not its nested list).
  const accept=block=>node=>{const parent=node.parentElement;return !!parent&&!parent.closest(EXCLUDED)&&parent.closest(BLOCKS)===block;};
  function register(block,pdf=false){
    if(blocks.has(block))return;const id='b'+(nextId++).toString(36);
    blocks.set(block,{id,pdf});pending.push(block);observer?.observe(block);
  }
  function scan(){
    if(!article)return;
    if(doc.kind==='.pdf'){for(const layer of article.querySelectorAll('.textLayer'))textLayer(layer);return;}
    for(const block of article.querySelectorAll(BLOCKS))if(!block.closest(EXCLUDED))register(block);
  }
  function textLayer(layer){
    const page=layer.closest('[data-pdf-page]')?.dataset.pdfPage;if(!page)return;
    // A re-rendered page replaces its layer: drop the old page's ranges first.
    for(const range of pageRanges.get(page)||[])for(const h of Object.values(highlights))h?.delete(range);
    pageRanges.set(page,[]);for(const [block] of blocks)if(!block.isConnected)blocks.delete(block);
    register(layer,true);if(on())pump();
  }
  function segment(block){
    const info=blocks.get(block),pdf=info.pdf;
    const projection=projectBlock(block,pdf?node=>!!node.parentElement&&!node.parentElement.closest(EXCLUDED):accept(block));
    return {block,info,projection,text:projection.text};
  }
  function apply(item,spans){
    if(done.has(item.block))return;done.add(item.block);
    const page=item.info.pdf?item.block.closest('[data-pdf-page]')?.dataset.pdfPage:null;
    const add=(h,start,end)=>{for(const range of item.projection.ranges(start,end)){h.add(range);if(page)pageRanges.get(page)?.push(range);}};
    for(const [start,end,role] of spans)if(highlights[role])add(highlights[role],start,end);
    if(highlights.quoted)for(const [start,end] of quotedRuns(item.text,spans))add(highlights.quoted,start,end);
  }
  function remember(text,spans){
    cache.set(text,spans);cachedUnits+=text.length;
    for(const [key] of cache){if(cachedUnits<=8e6&&cache.size<=20000)break;cache.delete(key);cachedUnits-=key.length;}
  }
  async function pump(){
    if(running||!on()||!doc||stopped)return;running=true;const id=generation;
    try{
      while(id===generation&&on()&&!stopped){
        const order=new Set([...urgent].filter(b=>blocks.has(b)&&!done.has(b)));urgent.clear();
        for(const block of pending)if(!done.has(block))order.add(block);
        if(!order.size)break;
        const batch=[];let bytes=0;
        for(const block of order){
          if(!block.isConnected){done.add(block);continue;}
          const item=segment(block);
          if(!item.text.trim()){done.add(block);continue;}
          if(cache.has(item.text)){apply(item,cache.get(item.text));continue;}
          const size=encoder.encode(item.text).length;
          if(size>SEGMENT_BYTES){done.add(block);continue;}
          if(batch.length&&(bytes+size>BATCH_BYTES||batch.length>=BATCH_SEGMENTS))break;
          batch.push(item);bytes+=size;
        }
        pending=pending.filter(block=>!done.has(block)&&blocks.has(block));
        if(!batch.length)continue;
        let result;
        try{result=await api('/api/prose',{path:doc.path,sha256:doc.sha256,segments:batch.map(item=>({id:item.info.id,text:item.text}))});}
        catch(error){
          if(id!==generation)return;
          if(/busy/i.test(error.message)){await new Promise(resolve=>setTimeout(resolve,800));continue;}
          stopped=true;if(error.data?.unavailable&&companion){status=null;style='off';paint();companion('colorful',error.message);}else notify(error.message,'error');return;
        }
        if(id!==generation)return;
        for(const item of batch){const spans=result.segments[item.info.id]||[];remember(item.text,spans);apply(item,spans);}
        // Visible blocks go first and immediately; the rest of the document fills in when idle.
        if(!urgent.size)await new Promise(resolve=>(window.requestIdleCallback||setTimeout)(resolve,{timeout:250}));
      }
    }finally{if(id===generation)running=false;}
  }
  // quiet: the Settings default turning colors on as a document opens says nothing when Colorful is missing.
  async function enable(next,quiet=false){
    const value=await probe(!quiet);
    if(!value.available){style='off';paint();if(!quiet){if(companion)companion('colorful',value.message);else notify(value.message||'Colorful Language is unavailable.','error');}return false;}
    style=next;paint();if(!blocks.size)scan();pump();return true;
  }
  return {
    get style(){return style;},
    status:probe,
    /** Start a document: called after it is rendered, with its default style from Settings. */
    attach(element,current){
      this.detach();if(!supported(current))return;
      article=element;doc=current;generation++;stopped=false;
      const root=article.closest('.book-viewport');
      observer=window.IntersectionObserver?new IntersectionObserver(entries=>{let any=false;for(const entry of entries)if(entry.isIntersecting&&!done.has(entry.target)){urgent.add(entry.target);any=true;}if(any)pump();},{root,rootMargin:root?'0px 100% 0px 100%':'600px 0px'}):null;
      article.addEventListener('reader-textlayer',onLayer);
      const initial=state.proseStyles?.get(doc.path)??intensityOf(state.prefs.proseColors);
      style='off';if(initial!=='off')enable(initial,true);else paint();
    },
    detach(){
      generation++;running=false;observer?.disconnect();observer=null;article?.removeEventListener('reader-textlayer',onLayer);
      for(const h of Object.values(highlights))h?.clear();
      blocks=new Map();urgent=new Set();pending=[];done=new WeakSet();pageRanges=new Map();article=null;doc=null;paint();
    },
    /** Embeds that loaded after the document joined the page: color their blocks too. */
    rescan(){if(!article||!on()||doc?.kind==='.pdf')return;scan();pump();},
    /** Space c: step Off → Subtle → Clear → Vivid → Off for this document. */
    async press(){
      if(!supported(doc)){notify(state.doc?.historical?'Prose colors work on the current edition, not a past version.':'Prose colors work in Markdown documents and PDF text.');return;}
      const next=INTENSITIES[(INTENSITIES.indexOf(style)+1)%INTENSITIES.length];
      (state.proseStyles??=new Map()).set(doc.path,next);
      if(next==='off'){style='off';paint();notify('Prose colors off.');return;}
      if(on()){style=next;paint();notify(`Prose colors: ${LABELS[next]}.`);return;}
      if(await enable(next))notify(`Prose colors: ${LABELS[next]}.`);
    },
  };
  function onLayer(event){if(doc?.kind==='.pdf')textLayer(event.target.querySelector?.('.textLayer')||event.target);}
}
