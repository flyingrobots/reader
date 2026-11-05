/** Zoom for the expanded diagram. It opens fitted to the window and stays fitted as the window changes, until you zoom.
 *  Buttons or + - 0 keys zoom, 1 is full size, Ctrl/⌘-scroll or a pinch zooms at the pointer, and dragging moves a diagram larger than its box. */
const MIN=.1,MAX=8,STEP=1.25;
export function fitScale(width,height,room){return Math.min(3,room.width/width,room.height/height);}

export function mountDiagramZoom(body,svg,width,height,room){
  let scale=fitScale(width,height,room()),fitted=true;
  const button=(label,name,run)=>{const b=document.createElement('button');b.type='button';b.dataset.button='outline sm';b.dataset.diagramZoom=name;b.setAttribute('aria-label',name);b.textContent=label;b.addEventListener('click',run);return b;};
  const readout=document.createElement('span');readout.className='diagram-zoom-level';readout.setAttribute('aria-live','polite');
  const bar=document.createElement('div');bar.className='diagram-zoom';bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Diagram zoom');
  const paint=()=>{svg.style.width=Math.round(width*scale)+'px';svg.classList.add('max-w-none!','h-auto');readout.textContent=Math.round(scale*100)+'%';
    svg.classList.toggle('diagram-pannable',body.scrollWidth>body.clientWidth+1||body.scrollHeight>body.clientHeight+1);};
  /** Change the scale, keeping the same point of the diagram under the pointer or the middle of the box. */
  function zoom(next,clientX,clientY){
    const box=body.getBoundingClientRect(),x=clientX??box.left+body.clientWidth/2,y=clientY??box.top+body.clientHeight/2,before=svg.getBoundingClientRect();
    const fx=(x-before.left)/before.width,fy=(y-before.top)/before.height;
    scale=Math.min(MAX,Math.max(MIN,next));fitted=false;paint();
    const after=svg.getBoundingClientRect();
    body.scrollLeft+=after.left+fx*after.width-x;body.scrollTop+=after.top+fy*after.height-y;
  }
  const fit=()=>{scale=fitScale(width,height,room());fitted=true;paint();body.scrollTo(0,0);};
  bar.append(button('−','Zoom out',()=>zoom(scale/STEP)),readout,button('+','Zoom in',()=>zoom(scale*STEP)),button('Fit','Fit to window',fit),button('100%','Full size',()=>zoom(1)));
  // The bar sits outside the scrolling box, so it stays in view at any scroll position.
  body.before(bar);body.replaceChildren(svg);paint();
  const onKey=event=>{
    if(event.metaKey||event.ctrlKey||event.altKey)return;
    const run={'+':()=>zoom(scale*STEP),'=':()=>zoom(scale*STEP),'-':()=>zoom(scale/STEP),'0':fit,'1':()=>zoom(1)}[event.key];
    if(run){event.preventDefault();event.stopPropagation();run();}
  };
  body.addEventListener('keydown',onKey);bar.addEventListener('keydown',onKey);
  body.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();zoom(scale*Math.exp(-event.deltaY/200),event.clientX,event.clientY);},{passive:false});
  let drag=null;
  svg.addEventListener('pointerdown',event=>{if(event.button||!svg.classList.contains('diagram-pannable'))return;drag={x:event.clientX,y:event.clientY,left:body.scrollLeft,top:body.scrollTop};svg.setPointerCapture(event.pointerId);event.preventDefault();});
  svg.addEventListener('pointermove',event=>{if(drag){body.scrollLeft=drag.left-(event.clientX-drag.x);body.scrollTop=drag.top-(event.clientY-drag.y);}});
  for(const name of ['pointerup','pointercancel'])svg.addEventListener(name,()=>{drag=null;});
  const resized=()=>{if(fitted)fit();};addEventListener('resize',resized);
  return ()=>removeEventListener('resize',resized);
}
