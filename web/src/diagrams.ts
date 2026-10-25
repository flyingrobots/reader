/* Mermaid diagrams drawn by Pele. Loaded on demand (`controls/diagrams.js`) only for
   documents that contain a Mermaid fence; each diagram type is its own lazy chunk.

   app.mjs has already wrapped every fence in
     <figure class="reader-diagram"><div class="reader-diagram-canvas" data-state="loading">
     <details class="reader-diagram-source"><summary>Diagram source</summary><pre>…</pre></details></figure>
   and left the source on the canvas as `diagramSource`. The canvas is decoration (no
   source coordinates); the `pre` keeps the text that find and annotations use.
   Colors come from CSS variables (`--pele-*` mapped to Reader tokens in styles.css), so
   a theme change recolors diagrams without re-rendering. */
import {mountAsync, type Mounted} from 'pele/lazy';

declare const DOMPurify:{sanitize(source:string,config:Record<string,unknown>):DocumentFragment};
type Canvas=HTMLElement&{diagramSource?:string};
export const DIAGRAM_LIMITS={sourceBytes:64*1024,perDocument:64};
const mounted=new WeakMap<HTMLElement,Mounted>();
let serial=0;
const idle=()=>new Promise<void>(resolve=>typeof requestIdleCallback==='function'?requestIdleCallback(()=>resolve(),{timeout:60}):setTimeout(resolve,0));
// Pele already escapes text and filters links and styles; DOMPurify's SVG profile is a second, independent pass.
const sanitize=(svg:string):Node=>DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},RETURN_DOM_FRAGMENT:true,FORBID_TAGS:['a','image','foreignObject','use','script']});
function summary(error:unknown){
  const lines=String((error as Error)?.message??error??'unknown error').split('\n').map(line=>line.trim()).filter(line=>line&&line!=='^');
  const text=lines.length>1?lines[0].replace(/:$/,'')+' — '+lines.at(-1):lines[0]||'unknown error';
  return text.length>240?text.slice(0,239)+'…':text;
}
/** Show the source instead of the drawing, with a short reason beside it. */
export function failDiagram(canvas:HTMLElement,reason:string){
  mounted.get(canvas)?.destroy();mounted.delete(canvas);
  canvas.replaceChildren();canvas.dataset.state='error';
  for(const name of ['role','aria-label','aria-describedby','tabindex','title'])canvas.removeAttribute(name);
  canvas.style.removeProperty('position');canvas.textContent='Couldn’t draw this diagram: '+reason;
  const details=canvas.closest('figure')?.querySelector<HTMLDetailsElement>('details.reader-diagram-source');if(details)details.open=true;
}
function describe(canvas:Canvas,svg:SVGSVGElement){
  const first=(canvas.diagramSource??'').split('\n').map(line=>line.trim()).find(line=>line&&!line.startsWith('%%'))??'Diagram';
  const labels=[...new Set([...svg.querySelectorAll('text')].map(text=>text.textContent?.replace(/\s+/g,' ').trim()).filter(Boolean))].slice(0,24);
  const label='Diagram, '+first+(labels.length?': '+labels.join(', '):'');
  return label.length>400?label.slice(0,399)+'…':label;
}
function ready(canvas:Canvas){
  const svg=canvas.querySelector<SVGSVGElement>(':scope > svg');if(!svg){failDiagram(canvas,'Pele returned no drawing');return false;}
  svg.setAttribute('aria-hidden','true');svg.removeAttribute('tabindex');
  const details=canvas.closest('figure')?.querySelector('details.reader-diagram-source');
  if(details&&!details.id)details.id='reader-diagram-source-'+(++serial);
  canvas.dataset.state='ready';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',describe(canvas,svg));canvas.tabIndex=0;canvas.title='Open full size (Enter)';
  if(details)canvas.setAttribute('aria-describedby',details.id);
  canvas.dispatchEvent(new CustomEvent('reader:diagram',{bubbles:true}));
  return true;
}
/** Draw every pending diagram under `root`, one per idle slice. Resolves when all are drawn or have failed. */
export async function mountDiagrams(root:HTMLElement,{onRender}:{onRender?:()=>void}={}){
  // The per-document limit counts this document's own figures, not those of documents embedded in it.
  const scope=root.closest('.embedded-content'),own=[...root.querySelectorAll<Canvas>('.reader-diagram-canvas')].filter(canvas=>canvas.closest('.embedded-content')===scope);
  let drawn=0;
  for(const canvas of own){
    if(canvas.dataset.state!=='loading')continue;
    const index=own.indexOf(canvas),source=canvas.diagramSource??'';
    if(index>=DIAGRAM_LIMITS.perDocument){failDiagram(canvas,`only the first ${DIAGRAM_LIMITS.perDocument} diagrams in a document are drawn`);continue;}
    if(new TextEncoder().encode(source).length>DIAGRAM_LIMITS.sourceBytes){failDiagram(canvas,'its source is larger than 64 KiB');continue;}
    await idle();if(!canvas.isConnected)continue;
    try{
      let failed:unknown=null,settled=false;
      const instance=await mountAsync(canvas,source,{zoom:false,links:false,images:false,idPrefix:'reader-diagram-'+(++serial)+'-',sanitize,
        onError:error=>{failed=error;if(settled)failDiagram(canvas,summary(error));},
        onRender:()=>{if(settled&&ready(canvas))onRender?.();}});
      settled=true;mounted.set(canvas,instance);
      if(failed||instance.error)failDiagram(canvas,summary(failed??instance.error));else if(ready(canvas))drawn++;
    }catch(error){failDiagram(canvas,summary(error));}
  }
  if(drawn)onRender?.();
  return drawn;
}
