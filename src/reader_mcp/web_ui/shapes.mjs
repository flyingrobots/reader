/** Article shapes (RW-20, experiment): cover art and thumbnails drawn from an article's own text.

    The server (/api/shape) projects the article's passages, in reading order, into three
    dimensions; this module fetches that, then draws it with the lazy Three.js chunk
    (controls/shape.js) or, without WebGL, as a 2D SVG of the same projection. One live
    canvas per page at most (the cover, or an article's opening page in continuous reading);
    feature thumbnails, reduced motion and two-page reading get still images. All art is
    decoration (data-reader-decoration); the figure carries a text description, and a
    focused figure walks passages (← →) and neighbours (↑ ↓), Enter opening either. */
export const MIN_CHUNKS=6;
const TILT=.32;  // the still frame's view from slightly above; matches shape.ts at t = 0
const THUMB={width:320,height:150};
const SVG_NS='http://www.w3.org/2000/svg';
let stageLoad=null;
const loadStage=()=>stageLoad??=import('./controls/shape.js').then(m=>m.shapeStage()).catch(error=>{console.warn('Article shapes',error);return null;});
const data=new Map(),thumbs=new Map();
let figures=0;

/** /api/shape for a path, cached for this session (keyed by path; a changed source gets a new digest). */
export function fetchShape(api,path){
  const cached=data.get(path);if(cached&&Date.now()-cached.at<10*60000)return cached.promise;
  const promise=api('/api/shape?path='+encodeURIComponent(path)).catch(error=>{data.delete(path);throw error;});
  data.set(path,{at:Date.now(),promise});return promise;
}
export const drawable=shape=>!!shape&&Array.isArray(shape.points)&&shape.count>=(shape.min_chunks||MIN_CHUNKS)&&shape.points.length>=2;

/** The theme's tokens as concrete sRGB bytes (any CSS colour syntax a theme uses). */
export function palette(){
  const style=getComputedStyle(document.documentElement),canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgb=name=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='#808080';ctx.fillStyle=style.getPropertyValue(name).trim()||'#808080';ctx.fillRect(0,0,1,1);const [r,g,b]=ctx.getImageData(0,0,1,1).data;return [r,g,b];};
  return {series:[1,2,3,4,5,6,7,8].map(i=>rgb('--chart-'+i)),ink:rgb('--ink'),muted:rgb('--muted'),accent:rgb('--accent'),bg:rgb('--bg'),sans:style.getPropertyValue('--sans').trim()||'sans-serif'};
}
async function fontsReady(sans){try{await document.fonts?.load(`600 26px ${sans}`);await document.fonts?.ready;}catch{/* Labels fall back to the system face. */}}
const theme=()=>document.documentElement.dataset.theme||'';

/** The same projection as the 3D still, flattened: x right, y up, seen from slightly above. */
function flat(shape,width,height){
  const scale=Math.min(width,height)*.42,cos=Math.cos(TILT),sin=Math.sin(TILT);
  const at=([x,y,z])=>[width/2+x*scale,height/2-(y*cos-z*sin)*scale];
  const beads=shape.points.map((p,i)=>{const [x,y]=at(p);return [x,y,2.2+4.5*(shape.weights[i]||0)];});
  const stars=shape.neighbours.map(({xyz})=>{const n=Math.hypot(...xyz)||1;const [x,y]=at(xyz.map(v=>v/n*1.12));return [x,y];});
  return {beads,stars};
}
/** The 2D fallback: the ribbon as a smoothed path, beads, rings, terms and stars in theme tokens. */
export function shapeSVG(shape,width,height,{labels=true}={}){
  const svg=document.createElementNS(SVG_NS,'svg'),layout=flat(shape,width,height),{beads}=layout;
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));svg.setAttribute('aria-hidden','true');svg.classList.add('shape-svg');
  const el=(name,attrs,parent=svg)=>{const node=document.createElementNS(SVG_NS,name);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));parent.append(node);return node;};
  const id='shape-gradient-'+(++figures),defs=el('defs',{}),gradient=el('linearGradient',{id,gradientUnits:'userSpaceOnUse',x1:beads[0][0],y1:beads[0][1],x2:beads.at(-1)[0],y2:beads.at(-1)[1]},defs);
  el('stop',{offset:0,'stop-color':'var(--chart-1)'},gradient);el('stop',{offset:1,'stop-color':'var(--chart-2)','stop-opacity':.62},gradient);
  let d=`M${beads[0][0].toFixed(1)} ${beads[0][1].toFixed(1)}`;
  for(let i=0;i<beads.length-1;i++){const p0=beads[Math.max(0,i-1)],p1=beads[i],p2=beads[i+1],p3=beads[Math.min(beads.length-1,i+2)];
    d+=`C${(p1[0]+(p2[0]-p0[0])/6).toFixed(1)} ${(p1[1]+(p2[1]-p0[1])/6).toFixed(1)} ${(p2[0]-(p3[0]-p1[0])/6).toFixed(1)} ${(p2[1]-(p3[1]-p1[1])/6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;}
  for(const [x,y] of layout.stars)el('circle',{cx:x.toFixed(1),cy:y.toFixed(1),r:1.8,fill:'var(--muted)','fill-opacity':.55});
  el('path',{d,fill:'none',stroke:`url(#${id})`,'stroke-width':2,'stroke-linecap':'round','stroke-opacity':.9});
  const headings=new Set(shape.headings);
  beads.forEach(([x,y,r],i)=>{const u=beads.length>1?i/(beads.length-1):0;
    if(headings.has(i))el('circle',{cx:x.toFixed(1),cy:y.toFixed(1),r:(r+3).toFixed(1),fill:'none',stroke:'var(--muted)','stroke-width':1,'stroke-opacity':.7});
    const bead=el('circle',{cx:x.toFixed(1),cy:y.toFixed(1),r:r.toFixed(1)});bead.style.fill=shape.threads[i]?'var(--accent)':`color-mix(in srgb, var(--chart-1) ${Math.round(100-100*u)}%, var(--chart-2))`;bead.style.fillOpacity=String(1-.35*u);});
  if(labels)shape.terms.forEach((term,k)=>{const [x,y]=beads[Math.min(term.i,beads.length-1)];const text=el('text',{x:(x+7).toFixed(1),y:(y-6).toFixed(1),'font-size':12,'font-weight':k<3?600:500});text.style.fill=k<3?'var(--ink)':'var(--muted)';text.style.fontFamily='var(--sans)';text.textContent=term.text;});
  return {svg,layout};
}

function describe(figure,shape,title){
  const description=document.createElement('div'),id='shape-description-'+(++figures);
  description.id=id;description.className='sr-only';description.dataset.readerDecoration='';
  const list=(label,items)=>{if(!items.length)return;const heading=document.createElement('p');heading.textContent=label;const ol=document.createElement('ol');for(const item of items){const li=document.createElement('li');li.textContent=item;ol.append(li);}description.append(heading,ol);};
  const summary=document.createElement('p');
  summary.textContent=`${shape.form==='terms'?'A term shape (the simpler form; rebuild the search index for the full shape)':'The shape of the argument'}: ${shape.count} ${shape.count===1?'passage':'passages'}${shape.sampled?`, ${shape.points.length} drawn`:''}. Key terms: ${shape.terms.map(t=>t.text).join(', ')||'none'}.`;
  description.append(summary);
  list('Passages, in reading order',(shape.excerpts||[]).map((line,i)=>`${line||'Passage'} (line ${shape.lines[i]})`));
  list('Nearest works',shape.neighbours.map(n=>n.title));
  figure.append(description);
  figure.setAttribute('aria-label',`Shape of ${title}. Left and right arrows move between passages${shape.neighbours.length?', up and down between related works':''}; Enter opens.`);
  figure.setAttribute('aria-describedby',id);
}

/** Hover, click and keys over any drawing: positions come from the current layout. */
function interact(figure,shape,{layout,highlight,onPassage,onNeighbour,signal}){
  // One tooltip on <body>: fixed positioning must not sit inside the smooth-scroll transform.
  let tip=document.getElementById('shape-tooltip');if(!tip){tip=document.createElement('div');tip.id='shape-tooltip';tip.className='chart-tooltip shape-tip';tip.dataset.readerDecoration='';tip.setAttribute('aria-hidden','true');document.body.append(tip);}
  const live=document.createElement('div');live.className='sr-only';live.setAttribute('aria-live','polite');live.dataset.readerDecoration='';
  const ring=document.createElement('div');ring.className='shape-marker';ring.hidden=true;ring.dataset.readerDecoration='';
  figure.append(live,ring);
  let current={kind:'bead',index:-1},hovered=null;
  const surface=()=>figure.querySelector('.shape-surface');
  const pick=(x,y)=>{const {beads,stars}=layout();let best=null,distance=Infinity;
    beads.forEach(([bx,by,r],i)=>{const d=Math.hypot(bx-x,by-y);if(d<=Math.max(r+4,9)&&d<distance){best={kind:'bead',index:i};distance=d;}});
    if(!best)stars.forEach(([sx,sy],i)=>{const d=Math.hypot(sx-x,sy-y);if(d<=10&&d<distance){best={kind:'star',index:i};distance=d;}});return best;};
  const label=hit=>hit.kind==='bead'?{title:`Passage ${hit.index+1} of ${shape.points.length}`,detail:shape.excerpts?.[hit.index]||`Line ${shape.lines[hit.index]}`}:{title:'Related work',detail:shape.neighbours[hit.index].title};
  const show=(hit,clientX,clientY)=>{const {title,detail}=label(hit);tip.replaceChildren();const strong=document.createElement('strong');strong.textContent=title;tip.append(strong,document.createTextNode(detail));
    tip.style.left=Math.max(12,Math.min(innerWidth-312,clientX+12))+'px';tip.style.top=Math.max(12,Math.min(innerHeight-110,clientY+16))+'px';tip.classList.add('visible');};
  const mark=hit=>{const box=surface()?.getBoundingClientRect();highlight(null);ring.hidden=true;if(!hit||!box)return null;
    const point=hit.kind==='bead'?layout().beads[hit.index]:layout().stars[hit.index];if(!point)return null;
    // A live view lights the bead itself; stills, the SVG and stars get a marker ring.
    if(!(hit.kind==='bead'&&highlight(hit.index))){const r=hit.kind==='bead'?point[2]+5:8,origin=figure.getBoundingClientRect();ring.hidden=false;ring.style.left=(box.left-origin.left+point[0]-r)+'px';ring.style.top=(box.top-origin.top+point[1]-r)+'px';ring.style.width=ring.style.height=2*r+'px';}
    return {x:box.left+point[0],y:box.top+point[1]};};
  const open=hit=>{if(!hit)return;tip.classList.remove('visible');if(hit.kind==='bead')onPassage(hit.index);else onNeighbour(shape.neighbours[hit.index].path);};
  figure.addEventListener('pointermove',event=>{const box=surface()?.getBoundingClientRect();if(!box)return;hovered=pick(event.clientX-box.left,event.clientY-box.top);figure.classList.toggle('shape-pointing',!!hovered);if(hovered)show(hovered,event.clientX,event.clientY);else tip.classList.remove('visible');},{signal});
  figure.addEventListener('pointerleave',()=>{hovered=null;tip.classList.remove('visible');figure.classList.remove('shape-pointing');},{signal});
  figure.addEventListener('click',event=>{const box=surface()?.getBoundingClientRect();if(!box)return;const hit=pick(event.clientX-box.left,event.clientY-box.top);if(hit){event.preventDefault();open(hit);}},{signal});
  figure.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const beads=shape.points.length,stars=shape.neighbours.length;let next=null;
    if(event.key==='ArrowRight'||event.key==='ArrowLeft')next={kind:'bead',index:current.kind==='bead'&&current.index>=0?Math.max(0,Math.min(beads-1,current.index+(event.key==='ArrowRight'?1:-1))):0};
    else if(event.key==='Home'||event.key==='End')next={kind:'bead',index:event.key==='Home'?0:beads-1};
    else if((event.key==='ArrowDown'||event.key==='ArrowUp')&&stars)next={kind:'star',index:current.kind==='star'?(current.index+(event.key==='ArrowDown'?1:-1)+stars)%stars:0};
    else if(event.key==='Enter'&&current.index>=0){event.preventDefault();event.stopPropagation();open(current);return;}
    if(!next)return;
    event.preventDefault();event.stopPropagation();current=next;const at=mark(current);const {title,detail}=label(current);live.textContent=`${title}: ${detail}`;if(at)show(current,at.x,at.y);
    document.dispatchEvent(new CustomEvent('reader:shape-focus'));
  },{signal});
  figure.addEventListener('blur',()=>{tip.classList.remove('visible');ring.hidden=true;highlight(null);},{capture:true,signal});
}

/** Draw one shape into a figure. `live` asks for the animated canvas (the page's one); otherwise a still image. */
export async function paintShape(figure,shape,{title,live=false,motion=true,onPassage,onNeighbour}){
  const width=Math.max(120,Math.round(figure.clientWidth)),height=Math.max(90,Math.round(figure.clientHeight||width*.5));
  const tokens=palette();await fontsReady(tokens.sans);if(!figure.isConnected)return;
  // A repaint (theme change) replaces the earlier drawing, its live view and its listeners.
  figure.shapeView?.destroy();figure.shapeView=null;figure.shapeListeners?.abort();const listeners=new AbortController();figure.shapeListeners=listeners;
  const surface=document.createElement('div');surface.className='shape-surface';surface.dataset.readerDecoration='';
  figure.replaceChildren(surface);figure.dataset.form=shape.form;figure.dataset.readerDecoration='';figure.tabIndex=0;
  if(shape.form==='terms')figure.title=shape.note||'Rebuild the search index for the full shape';
  const caption=document.createElement('figcaption');caption.className='shape-caption';caption.textContent=shape.form==='terms'?'Article shape · terms only':'Article shape · experiment';figure.append(caption);
  describe(figure,shape,title);
  let layout=()=>({beads:[],stars:[]}),highlight=null;
  const asImage=(url,frame)=>{const image=new Image();image.className='shape-still';image.alt='';image.src=url;image.width=width;image.height=height;surface.replaceChildren(image);layout=()=>frame;figure.dataset.state='still';};
  const stage=await loadStage();if(!figure.isConnected)return;
  try{
    if(!stage)throw new Error('WebGL unavailable');
    if(live&&motion){const view=stage.mount(surface,shape,tokens,{onStill:(url,frame)=>{highlight=null;asImage(url,frame);}});layout=()=>view.layout();highlight=index=>view.highlight(index);figure.shapeView=view;figure.dataset.state='live';}
    else{const {url,layout:frame}=stage.still(shape,tokens,width,height);asImage(url,frame);figure.dataset.frames='1';}
  }catch(error){
    if(stage)console.warn('Article shape',error);
    const {svg,layout:frame}=shapeSVG(shape,width,height);surface.replaceChildren(svg);layout=()=>frame;figure.dataset.state='svg';
  }
  figure.shapeLayout=()=>layout();  // where beads and stars are drawn (tests and assistive overlays)
  interact(figure,shape,{layout:()=>layout(),highlight:index=>{if(!highlight)return false;highlight(index);return true;},onPassage,onNeighbour,signal:listeners.signal});
}

/** A small still image for a feature, rendered once per path, digest, theme and size this session. */
export async function paintThumb(slot,shape){
  const key=[shape.path,shape.sha256,theme(),THUMB.width,THUMB.height].join('|');
  let url=thumbs.get(key);
  if(!url){
    const tokens=palette(),stage=await loadStage();if(!slot.isConnected)return;
    if(stage){try{url=stage.still(shape,tokens,THUMB.width,THUMB.height,{labels:false}).url;}catch(error){console.warn('Article shape',error);}}
    if(url)thumbs.set(key,url);
  }
  if(url){const image=new Image();image.className='shape-thumb-image';image.alt='';image.src=url;image.width=THUMB.width;image.height=THUMB.height;slot.replaceChildren(image);slot.dataset.state='still';}
  else{slot.replaceChildren(shapeSVG(shape,THUMB.width,THUMB.height,{labels:false}).svg);slot.dataset.state='svg';}
}
