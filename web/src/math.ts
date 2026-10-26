/* TeX typeset by KaTeX. Loaded on demand (`controls/math.js`) only for documents whose
   Markdown produced math placeholders (`.reader-math[data-tex]`, see web_ui/math.mjs);
   its stylesheet and woff2 fonts are served from `controls/katex/`.

   A rendered formula's KaTeX markup is decoration: find, selection anchoring and the
   annotation projection skip it, and copying a selection that touches a formula copies
   its TeX. A formula KaTeX rejects keeps its original TeX, monospaced, with the reason
   in its title. */
import katex from 'katex';

export const MATH_LIMIT=2000;
const OPTIONS={throwOnError:true,output:'htmlAndMathml' as const,trust:false,strict:'warn' as const,maxSize:20,maxExpand:1000};
const SLICE_MS=12;
const idle=()=>new Promise<void>(resolve=>typeof requestIdleCallback==='function'?requestIdleCallback(()=>resolve(),{timeout:60}):setTimeout(resolve,0));
const display=(el:Element)=>el.classList.contains('reader-math-block');
/** The TeX of a formula with its delimiters, as copied. */
export const texOf=(el:Element)=>{const tex=el.getAttribute('data-tex')??'';return display(el)?'$$'+tex+'$$':'$'+tex+'$';};

function typeset(el:HTMLElement){
  const tex=el.dataset.tex??'';
  try{
    const host=document.createElement(display(el)?'div':'span');host.dataset.readerDecoration='';
    katex.render(tex,host,{...OPTIONS,displayMode:display(el)});
    el.replaceChildren(host);el.dataset.state='ready';el.removeAttribute('title');
  }catch(error){
    el.dataset.state='error';el.textContent=display(el)?'$$'+tex+'$$':'$'+tex+'$';
    el.title=String((error as Error)?.message??error).replace(/^KaTeX parse error:\s*/,'Couldn’t typeset this formula: ').slice(0,300);
  }
}
/** Typeset every pending formula under `root` in idle slices; at most MATH_LIMIT per call (the first in
    document order). `first` picks formulas to typeset before the rest (those near the reader); `onSlice`
    runs after each slice, while the page is still changing height. */
export async function renderMath(root:HTMLElement,{onRender,onSlice,first}:{onRender?:()=>void,onSlice?:()=>void,first?:(el:HTMLElement)=>boolean}={}){
  const pending=[...root.querySelectorAll<HTMLElement>('.reader-math[data-tex]:not([data-state])')];
  let queue=pending.slice(0,MATH_LIMIT);
  for(const el of pending.slice(MATH_LIMIT))el.dataset.state='skipped';
  if(first){const soon=queue.filter(first),set=new Set(soon);queue=[...soon,...queue.filter(el=>!set.has(el))];}
  for(let index=0;index<queue.length;){
    await idle();const start=performance.now();
    while(index<queue.length&&performance.now()-start<SLICE_MS){const el=queue[index++];if(el.isConnected&&!el.dataset.state)typeset(el);}
    if(index<queue.length)onSlice?.();
  }
  if(queue.length){root.dispatchEvent(new CustomEvent('reader:math',{bubbles:true}));onRender?.();}
  return {rendered:queue.length,skipped:pending.length-queue.length};
}
let copyInstalled=false;
/** Copying a selection that touches a formula yields the formula's TeX, not its glyphs. */
export function installMathCopy(){
  if(copyInstalled)return;copyInstalled=true;
  document.addEventListener('copy',event=>{
    const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed||!event.clipboardData)return;
    const range=selection.getRangeAt(0).cloneRange();
    const formula=(node:Node|null)=>(node instanceof Element?node:node?.parentElement)?.closest<HTMLElement>('.reader-math[data-state=ready]')??null;
    const startFormula=formula(range.startContainer),endFormula=formula(range.endContainer);
    if(startFormula)range.setStartBefore(startFormula);if(endFormula)range.setEndAfter(endFormula);
    const fragment=range.cloneContents();const touched=fragment.querySelectorAll('.reader-math[data-state=ready]');
    if(!touched.length)return;
    for(const el of touched)el.replaceWith(document.createTextNode(texOf(el)));
    event.clipboardData.setData('text/plain',fragment.textContent??'');event.preventDefault();
  });
}
