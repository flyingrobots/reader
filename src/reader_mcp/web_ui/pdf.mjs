/** Local PDF pages: selectable text, bounded live canvases, and page-based resume. */
import {occurrences} from './logic.mjs';
export async function openPDF(container, url) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdf.worker.min.mjs';
  const loading = pdfjs.getDocument({url, standardFontDataUrl:'/assets/vendor/standard_fonts/', cMapUrl:'/assets/vendor/cmaps/', cMapPacked:true, isEvalSupported:false, useWasm:false});
  const pdf = await loading.promise;
  if(pdf.numPages>5000){await loading.destroy();throw new Error('PDF exceeds the 5,000-page reading limit. Open the original.');}
  let disposed=false, running=false, queue=[], generation=0;
  const live=new Map(), texts=new Map();
  const first=await pdf.getPage(1), unit=first.getViewport({scale:1});
  container.classList.add('pdf-document');
  const pages=Array.from({length:pdf.numPages},(_,index)=>{
    const page=document.createElement('section');page.className='pdf-page';page.dataset.pdfPage=index+1;page.setAttribute('aria-label',`PDF page ${index+1} of ${pdf.numPages}`);page.style.aspectRatio=unit.width+'/'+unit.height;
    const label=document.createElement('span');label.className='pdf-page-label';label.textContent=`${index+1} / ${pdf.numPages}`;page.append(label);container.append(page);return page;
  });
  function evict(number){const entry=live.get(number);if(!entry)return;entry.task?.cancel();entry.text?.cancel();entry.canvas.width=entry.canvas.height=0;entry.surface.remove();live.delete(number);}
  async function render(number){
    if(disposed)return;const element=pages[number-1];if(!element)return;
    const page=await pdf.getPage(number);if(disposed)return;
    const raw=page.getViewport({scale:1}), paged=document.body.classList.contains('two-page');
    const width=element.clientWidth || 640, height=paged?element.clientHeight:Infinity;
    const scale=Math.min(width/raw.width,height/raw.height), viewport=page.getViewport({scale});
    const signature=`${Math.round(viewport.width)}:${Math.round(viewport.height)}`;
    if(live.get(number)?.signature===signature)return;
    evict(number);
    while(live.size>=6)evict(live.keys().next().value);
    const surface=document.createElement('div');surface.className='pdf-surface';surface.style.width=viewport.width+'px';surface.style.height=viewport.height+'px';surface.style.setProperty('--scale-factor',String(scale));surface.style.setProperty('--total-scale-factor',String(scale));
    const canvas=document.createElement('canvas'), layer=document.createElement('div');layer.className='textLayer';
    const ratio=Math.min(devicePixelRatio || 1,2,Math.sqrt(4000000/(viewport.width*viewport.height)));
    canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.setAttribute('aria-hidden','true');
    surface.append(canvas,layer);element.append(surface);
    const entry={canvas,surface,signature};live.set(number,entry);
    try {
      entry.task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null});await entry.task.promise;
      if(disposed || live.get(number)!==entry)return;
      entry.text=new pdfjs.TextLayer({textContentSource:await page.getTextContent(),container:layer,viewport});await entry.text.render();
      // Match the separation used by extracted-text find without moving absolute runs.
      for(const span of entry.text.textDivs)span.after(document.createTextNode(' '));
      element.dispatchEvent(new CustomEvent('reader-textlayer',{bubbles:true}));
    }catch(error){if(!disposed && !/cancel/i.test(error.name || ''))throw error;}
  }
  async function pump(){
    if(running)return;running=true;
    try{while(queue.length&&!disposed){const number=queue.shift();try{await render(number);}catch(error){pages[number-1].dataset.error='Could not render this page. Open the original.';console.warn('PDF page render failed',error);}}}
    finally{running=false;}
  }
  function request(number){if(!queue.includes(number))queue.push(number);pump();}
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)request(+entry.target.dataset.pdfPage);},{rootMargin:'500px'});
  for(const page of pages)observer.observe(page);
  return {
    pages, count:pdf.numPages,
    reflow(){for(const page of pages){const rect=page.getBoundingClientRect();if(rect.right>0&&rect.left<innerWidth&&rect.bottom>0&&rect.top<innerHeight)request(+page.dataset.pdfPage);}},
    async show(number){await render(number);return pages[number-1];},
    async find(query){
      const id=++generation,hits=[],started=performance.now();let bytes=0,examined=0,limited=false;
      if(!query)return {hits,examined:0,complete:true};
      for(let number=1;number<=pdf.numPages;number++){
        if(disposed||id!==generation)return null;
        let text=texts.get(number);
        if(text===undefined){const page=await pdf.getPage(number),content=await page.getTextContent();text=content.items.map(item=>item.str || '').join(' ');if(text.length>200000)throw new Error('A PDF page exceeds the 200,000-character find limit.');if(texts.size>=100)texts.delete(texts.keys().next().value);texts.set(number,text);}
        examined++;bytes+=text.length*2;
        for(const [index] of occurrences(text,query).entries()){hits.push({page:number,occurrence:index});if(hits.length>=2000)break;}
        if(hits.length>=2000||bytes>=32*1024**2||performance.now()-started>15000){limited=true;break;}
      }
      return {hits,examined,complete:!limited&&examined===pdf.numPages};
    },
    /** The PDF's own outline, flattened to three levels and resolved to 1-based pages; at most 500 entries. */
    async outline(){
      let items;try{items=await pdf.getOutline();}catch{return [];}
      const entries=[];
      async function walk(list,level){
        for(const item of list || []){
          if(disposed || entries.length>=500)return;
          let page=null;
          try{
            const dest=typeof item.dest==='string'?await pdf.getDestination(item.dest):item.dest;
            if(Array.isArray(dest))page=typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]);
          }catch{/* An unresolvable destination keeps its children but is not listed. */}
          if(Number.isInteger(page)&&page>=0&&page<pdf.numPages)entries.push({title:String(item.title || '').replace(/\s+/g,' ').trim().slice(0,300) || 'Untitled',level,page:page+1});
          if(level<3)await walk(item.items,level+1);
        }
      }
      await walk(items,1);return disposed?[]:entries;
    },
    cancelFind(){generation++;},
    destroy(){disposed=true;generation++;queue=[];observer.disconnect();for(const number of [...live.keys()])evict(number);return loading.destroy();}
  };
}
