/** Split view: up to four panes, each the unchanged app in an embedded same-origin iframe (`/?pane=1#…`).
 *
 * The shell (the top document) owns the layout tree, the status bar and the shared panels; each pane keeps
 * its own state, #article, highlight registry, reading controller and key target. Pure layout and scroll-map
 * helpers are exported for tests; `installSplit` runs in the shell and `installPane` inside a pane. */

export const MAX_PANES=4,MIN_WIDTH=320,MIN_HEIGHT=200,DIVIDER=6,NARROW=700,MESSAGE_LIMIT=64*1024,STAGGER=250;
const DIRS=['row','col'];  // row: side by side (Ctrl-w v); col: stacked (Ctrl-w s)

// Layout tree ---------------------------------------------------------------------------------
// A leaf is {id, route}; a node is {dir, sizes, children} with fractional sizes that sum to 1.
export const isLeaf=node=>!!node&&'id' in node;
export function leaves(node){return isLeaf(node)?[node]:node.children.flatMap(leaves);}
const copy=node=>isLeaf(node)?{...node}:{dir:node.dir,sizes:[...node.sizes],children:node.children.map(copy)};
const normal=sizes=>{const total=sizes.reduce((a,b)=>a+b,0)||1;return sizes.map(s=>s/total);};
/** Collapse single-child nodes and merge a child that runs the same way as its parent. */
function tidy(node){
  if(isLeaf(node))return node;
  let children=[],sizes=[];
  node.children.forEach((child,i)=>{const t=tidy(child);if(!isLeaf(t)&&t.dir===node.dir){t.children.forEach((c,k)=>{children.push(c);sizes.push(node.sizes[i]*t.sizes[k]);});}else{children.push(t);sizes.push(node.sizes[i]);}});
  if(children.length===1)return children[0];
  return {dir:node.dir,sizes:normal(sizes),children};
}
/** Split leaf `id` in `dir`, putting `leaf` after it (or before it). The split halves that leaf's share. */
export function splitLeaf(tree,id,dir,leaf,{before=false}={}){
  if(!DIRS.includes(dir))throw new Error('Unknown split direction');
  const walk=node=>{
    if(isLeaf(node)){if(node.id!==id)return node;return {dir,sizes:[.5,.5],children:before?[leaf,node]:[node,leaf]};}
    if(node.dir===dir){const i=node.children.findIndex(c=>isLeaf(c)&&c.id===id);
      if(i>=0){const children=[...node.children],sizes=[...node.sizes],half=sizes[i]/2;children.splice(before?i:i+1,0,leaf);sizes.splice(i,1,half,half);return {dir,sizes,children};}}
    return {dir:node.dir,sizes:[...node.sizes],children:node.children.map(walk)};
  };
  return tidy(walk(copy(tree)));
}
/** Remove a leaf; its share goes to its siblings. Returns null when nothing is left. */
export function removeLeaf(tree,id){
  const walk=node=>{
    if(isLeaf(node))return node.id===id?null:node;
    const kept=[],sizes=[];node.children.forEach((c,i)=>{const t=walk(c);if(t){kept.push(t);sizes.push(node.sizes[i]);}});
    if(!kept.length)return null;return {dir:node.dir,sizes:normal(sizes),children:kept};
  };
  const result=walk(copy(tree));return result&&tidy(result);
}
/** Exchange a leaf with the next one in reading order (the last swaps with the first). */
export function swapNext(tree,id){
  const order=leaves(tree),i=order.findIndex(l=>l.id===id);if(i<0||order.length<2)return copy(tree);
  const a=order[i],b=order[(i+1)%order.length];
  const walk=node=>isLeaf(node)?(node.id===a.id?{...b}:node.id===b.id?{...a}:{...node}):{dir:node.dir,sizes:[...node.sizes],children:node.children.map(walk)};
  return walk(tree);
}
export function equalize(tree){const walk=node=>isLeaf(node)?{...node}:{dir:node.dir,sizes:node.children.map(()=>1/node.children.length),children:node.children.map(walk)};return walk(tree);}
export function setRoute(tree,id,route){const walk=node=>isLeaf(node)?(node.id===id?{...node,route}:{...node}):{dir:node.dir,sizes:[...node.sizes],children:node.children.map(walk)};return walk(tree);}
/** Leaves needed side by side along an axis: the minimum size of a subtree is this many minimum panes. */
function span(node,dir){if(isLeaf(node))return 1;const spans=node.children.map(c=>span(c,dir));return node.dir===dir?spans.reduce((a,b)=>a+b,0):Math.max(...spans);}
const minimum=(node,dir)=>{const n=span(node,dir);return n*(dir==='row'?MIN_WIDTH:MIN_HEIGHT)+(n-1)*DIVIDER;};

/** Pixel rectangles for every leaf, and the dividers between siblings. */
export function layout(tree,box){
  const panes=new Map(),dividers=[];
  const walk=(node,{x,y,w,h},path)=>{
    if(isLeaf(node)){panes.set(node.id,{x,y,w,h});return;}
    const along=node.dir==='row'?w:h,free=Math.max(0,along-DIVIDER*(node.children.length-1));let at=node.dir==='row'?x:y;
    node.children.forEach((child,i)=>{
      const size=i===node.children.length-1?(node.dir==='row'?x+w:y+h)-at:Math.round(free*node.sizes[i]);
      walk(child,node.dir==='row'?{x:at,y,w:size,h}:{x,y:at,w,h:size},[...path,i]);at+=size;
      if(i<node.children.length-1){
        const before=leaves(child).at(-1),after=leaves(node.children[i+1])[0];
        dividers.push({path,index:i,dir:node.dir,before:before.id,after:after.id,...(node.dir==='row'?{x:at,y,w:DIVIDER,h}:{x,y:at,w,h:DIVIDER})});at+=DIVIDER;
      }
    });
  };
  walk(tree,box,[]);return {panes,dividers};
}
/** True when every pane keeps its minimum size in `box`. */
export function fits(tree,box){for(const r of layout(tree,box).panes.values())if(r.w<MIN_WIDTH||r.h<MIN_HEIGHT)return false;return true;}
/** Move the divider after child `index` of the node at `path` by `delta` pixels, keeping both sides above their minimum. */
export function resize(tree,path,index,delta,box){
  const next=copy(tree);let node=next,rect=box;
  for(const step of path){const sub=layout(node,rect);const child=node.children[step];rect=isLeaf(child)?sub.panes.get(child.id):boxOf(sub,child,node,step,rect);node=child;}
  if(isLeaf(node))return next;
  const along=(node.dir==='row'?rect.w:rect.h)-DIVIDER*(node.children.length-1);if(along<=0)return next;
  const a=node.children[index],b=node.children[index+1],pair=node.sizes[index]+node.sizes[index+1];
  const lo=minimum(a,node.dir)/along,hi=pair-minimum(b,node.dir)/along;if(hi<lo)return next;
  const size=Math.max(lo,Math.min(hi,node.sizes[index]+delta/along));
  node.sizes[index]=size;node.sizes[index+1]=pair-size;return next;
}
function boxOf(sub,child,node,step,rect){
  // The bounding box of a child subtree: the union of its leaves' rectangles.
  const rects=leaves(child).map(l=>sub.panes.get(l.id));const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));
  return {x,y,w:Math.max(...rects.map(r=>r.x+r.w))-x,h:Math.max(...rects.map(r=>r.y+r.h))-y};
}
/** The nearest pane from `id` in a direction (h j k l), by geometry; null when there is none. */
export function neighbor(rects,id,key){
  const from=rects.get(id);if(!from)return null;
  const cx=from.x+from.w/2,cy=from.y+from.h/2;let best=null,score=Infinity;
  for(const [other,r] of rects){
    if(other===id)continue;
    const ok=key==='h'?r.x+r.w<=from.x+1:key==='l'?r.x>=from.x+from.w-1:key==='k'?r.y+r.h<=from.y+1:key==='j'?r.y>=from.y+from.h-1:false;if(!ok)continue;
    const horizontal=key==='h'||key==='l';
    const gap=horizontal?Math.abs((key==='l'?r.x:r.x+r.w)-(key==='l'?from.x+from.w:from.x)):Math.abs((key==='j'?r.y:r.y+r.h)-(key==='j'?from.y+from.h:from.y));
    const overlap=horizontal?Math.min(r.y+r.h,from.y+from.h)-Math.max(r.y,from.y):Math.min(r.x+r.w,from.x+from.w)-Math.max(r.x,from.x);
    const off=horizontal?Math.abs(r.y+r.h/2-cy):Math.abs(r.x+r.w/2-cx);
    const s=gap*10+(overlap>0?0:1e5)+off;if(s<score){score=s;best=other;}
  }
  return best;
}

// Routes and the #split= hash --------------------------------------------------------------------
/** A pane route keeps a path, never text: `#read=<path>` (a heading id survives), the homepage, an issue, Search
 *  or a scratch pad (`#scratch`, the latest draft, or `#scratch=<id>`, as app.mjs routes it). Reader Admin (and legacy
 *  `#backstage`) is the window's own layout, never a pane's: those routes become the homepage. */
export function cleanRoute(hash){
  hash=String(hash||'');
  if(hash.startsWith('#read=')){const [value,...rest]=hash.slice(6).split('&');const heading=rest.find(p=>p.startsWith('h='));return value?'#read='+value+(heading&&heading.length<=200?'&'+heading:''):'';}
  if(/^#scratch(=[0-9a-f-]{36})?$/.test(hash))return hash;
  if(hash.startsWith('#search'))return '#search';
  if(/^#issue=[0-9]{4}-W[0-9]{2}$/.test(decodeSafe(hash)))return hash;
  return '';
}
const decodeSafe=text=>{try{return decodeURIComponent(text);}catch{return text;}};
export function encodeLayout(tree,focus,bind){
  const walk=node=>isLeaf(node)?cleanRoute(node.route):{d:node.dir,s:node.sizes.map(s=>Math.round(s*1000)/1000),c:node.children.map(walk)};
  const order=leaves(tree),value={t:walk(tree),f:Math.max(0,order.findIndex(l=>l.id===focus))};
  if(bind){const a=order.findIndex(l=>l.id===bind[0]),b=order.findIndex(l=>l.id===bind[1]);if(a>=0&&b>=0)value.b=[a,b];}
  return '#split='+encodeURIComponent(JSON.stringify(value));
}
/** Parse a #split= hash into {tree, focus, bind} with fresh ids, or null when it is malformed or too large. */
export function decodeLayout(hash,firstId=1){
  if(typeof hash!=='string'||!hash.startsWith('#split=')||hash.length>8192)return null;
  let value;try{value=JSON.parse(decodeURIComponent(hash.slice(7)));}catch{return null;}
  let id=firstId,count=0;
  const walk=(node,depth)=>{
    if(typeof node==='string'){if(++count>MAX_PANES||node.length>2048)throw 0;return {id:id++,route:cleanRoute(node)};}
    if(!node||depth>3||!DIRS.includes(node.d)||!Array.isArray(node.c)||node.c.length<2||!Array.isArray(node.s)||node.s.length!==node.c.length||node.s.some(s=>typeof s!=='number'||!(s>0)))throw 0;
    return {dir:node.d,sizes:normal(node.s),children:node.c.map(c=>walk(c,depth+1))};
  };
  let tree;try{tree=tidy(walk(value?.t,0));}catch{return null;}
  if(isLeaf(tree))return null;
  const order=leaves(tree),focus=order[Number.isInteger(value.f)&&value.f>=0&&value.f<order.length?value.f:0].id;
  const bind=Array.isArray(value.b)&&value.b.length===2&&value.b.every(i=>Number.isInteger(i)&&i>=0&&i<order.length)&&value.b[0]!==value.b[1]?[order[value.b[0]].id,order[value.b[1]].id]:null;
  return {tree,focus,bind,next:id};
}

// Synchronized scrolling ---------------------------------------------------------------------------
/** Translate a source offset across /api/changes?a=&b= hunks: from a's text to b's (`forward`), or back. */
export function mapOffset(hunks,offset,forward=true){
  const [from,to]=forward?['old','new']:['new','old'];
  const spans=(hunks||[]).filter(h=>typeof h[from+'_start']==='number'&&typeof h[to+'_start']==='number');if(!spans.length)return offset;
  for(const h of spans){
    const s=h[from+'_start'],e=h[from+'_end'],ts=h[to+'_start'],te=h[to+'_end'];
    if(e<=s||offset<s||offset>=e)continue;
    if(h.op==='equal')return Math.min(te,ts+(offset-s));
    if(h.op==='replace')return Math.round(ts+(offset-s)/(e-s)*(te-ts));
    return ts;  // A deleted (or inserted) block maps to the point where it was.
  }
  const after=spans.find(h=>h[from+'_start']>=offset);
  return after?after[to+'_start']:spans.at(-1)[to+'_end'];
}
const norm=text=>String(text||'').replace(/\s+/gu,' ').trim().toLowerCase();
/** Index of the heading matching {text, level, nth} (the nth heading with that text and level), or -1. */
export function matchHeading(headings,target){
  if(!target)return -1;const text=norm(target.text);let seen=0,first=-1;
  for(let i=0;i<headings.length;i++){const h=headings[i];if(h.level!==target.level||norm(h.text)!==text)continue;if(first<0)first=i;if(seen++===(target.nth||0))return i;}
  return first;
}
/** {text, level, nth} for heading `index` among `headings`. */
export function headingKey(headings,index){
  const h=headings[index];if(!h)return null;const text=norm(h.text);let nth=0;
  for(let i=0;i<index;i++)if(headings[i].level===h.level&&norm(headings[i].text)===text)nth++;
  return {text:h.text,level:h.level,nth};
}

// Messages -----------------------------------------------------------------------------------------
const sized=data=>{try{return JSON.stringify(data).length<=MESSAGE_LIMIT;}catch{return false;}};
const SHELL_TYPES=new Set(['status','toast','focus-request','window-key','open-in-split','open-admin','scroll','doc','saved']);
const PANE_TYPES=new Set(['focus','blur','open','scroll-to','prefs-changed','save']);

// The shell ----------------------------------------------------------------------------------------
/** Shell side. `suspend()` empties the single-pane view before a split appears; `resume(route)` navigates to the last pane's route. */
export function installSplit({notify,suspend,resume,paint,api,param,refocus,openAdmin}){
  const panes=new Map();  // id -> {frame, box, status, doc}
  let tree=null,focus=null,bind=null,hunks=null,root=null,nextId=1,frame=0,drag=null;
  const active=()=>!!tree;
  const order=()=>tree?leaves(tree):[];
  const statusHeight=()=>document.querySelector('#statusline')?.getBoundingClientRect().height||32;
  const box=()=>({x:0,y:0,w:innerWidth,h:Math.max(0,innerHeight-statusHeight())});
  const narrow=()=>innerWidth<NARROW;
  const hashNow=()=>encodeLayout(tree,focus,bind);
  const remember=()=>{if(tree)history.replaceState({reader:true,split:true},'',location.pathname+location.search+hashNow());};
  const post=(id,data)=>{const pane=panes.get(id);if(pane?.frame.contentWindow&&sized(data))pane.frame.contentWindow.postMessage(data,location.origin);};
  const paneOf=source=>{for(const [id,pane] of panes)if(pane.frame.contentWindow===source)return id;return null;};
  const numberOf=id=>order().findIndex(l=>l.id===id)+1;
  const bound=id=>!!bind&&bind.includes(id);

  function mount(){
    root=document.createElement('div');root.id='split-root';root.className='split-root';root.setAttribute('role','group');root.setAttribute('aria-label','Split view');
    document.body.append(root);document.body.classList.add('split-active');
  }
  function addFrame(leaf,delay=0,extra=''){
    const host=document.createElement('div');host.className='split-pane';host.dataset.pane=String(leaf.id);
    const iframe=document.createElement('iframe');iframe.className='split-frame';iframe.title='Pane';iframe.setAttribute('loading','eager');
    host.append(iframe);root.append(host);
    // Panes load 250 ms apart so four apps never open together (the server admits a bounded number of requests).
    const src='/?pane=1'+extra+(leaf.route||'');
    if(delay)setTimeout(()=>{if(panes.has(leaf.id))iframe.src=src;},delay);else iframe.src=src;
    panes.set(leaf.id,{frame:iframe,host,status:null,doc:null});
  }
  function render(){
    if(!root)return;
    const {panes:rects,dividers}=layout(tree,box());
    root.classList.toggle('split-narrow',narrow());
    for(const [id,pane] of panes){
      const r=rects.get(id);if(!r)continue;
      Object.assign(pane.host.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});
      pane.host.classList.toggle('focused',id===focus);pane.host.classList.toggle('bound',bound(id));
      pane.frame.title=`Pane ${numberOf(id)} of ${panes.size}`;
    }
    root.querySelectorAll('.split-divider').forEach(el=>el.remove());
    for(const d of dividers){
      const el=document.createElement('div');el.className='split-divider '+d.dir;el.setAttribute('role','separator');el.setAttribute('aria-orientation',d.dir==='row'?'vertical':'horizontal');el.dataset.readerDecoration='';
      Object.assign(el.style,{left:d.x+'px',top:d.y+'px',width:d.w+'px',height:d.h+'px'});
      const linked=!!bind&&bind.includes(d.before)&&bind.includes(d.after);
      const toggle=document.createElement('button');toggle.type='button';toggle.className='split-bind';toggle.dataset.button='outline icon-xs';toggle.textContent='⇅';toggle.setAttribute('aria-pressed',String(linked));
      toggle.title=linked?'Stop scrolling these panes together':'Scroll these panes together';toggle.setAttribute('aria-label',toggle.title);
      toggle.addEventListener('pointerdown',event=>event.stopPropagation());
      toggle.addEventListener('click',()=>toggleBind(d.before,d.after));
      el.append(toggle);
      el.addEventListener('pointerdown',event=>{
        event.preventDefault();drag={d,start:d.dir==='row'?event.clientX:event.clientY,tree};root.classList.add('dragging');
        const moveTo=e=>{if(!drag)return;const now=d.dir==='row'?e.clientX:e.clientY;tree=resize(drag.tree,d.path,d.index,now-drag.start,box());schedule();};
        const end=()=>{removeEventListener('pointermove',moveTo);removeEventListener('pointerup',end);drag=null;root?.classList.remove('dragging');remember();render();};
        addEventListener('pointermove',moveTo);addEventListener('pointerup',end);
      });
      root.append(el);
    }
    paint();
  }
  // Resizing moves boxes; it never re-parents an iframe (that would reload its app).
  // While a divider is dragged, boxes move in place; the dividers are rebuilt when it is let go.
  const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;if(!tree)return;if(!drag){render();return;}
    const {panes:rects,dividers}=layout(tree,box());for(const [id,pane] of panes){const r=rects.get(id);if(r)Object.assign(pane.host.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});}
    root.querySelectorAll('.split-divider').forEach((el,i)=>{const d=dividers[i];if(d)Object.assign(el.style,{left:d.x+'px',top:d.y+'px',width:d.w+'px',height:d.h+'px'});});});};
  addEventListener('resize',()=>{if(tree)schedule();});

  function setFocus(id,{move=true}={}){
    if(!panes.has(id))return;const previous=focus;focus=id;
    if(previous!==id&&panes.has(previous))post(previous,{type:'blur'});
    post(id,{type:'focus',bound:bound(id),move});
    if(move)panes.get(id).frame.focus();
    render();remember();
  }
  /** Start a split from the single-pane view: `current` is the shell's route, the new pane opens `route` (or the picker). */
  async function start(dir,current,{route=null,before=null,picker=false}={}){
    if(narrow()){notify('Splitting needs a wider window.');return false;}
    const a={id:nextId++,route:cleanRoute(current)},b={id:nextId++,route:cleanRoute(route??current)};
    const candidate={dir,sizes:[.5,.5],children:before?[b,a]:[a,b]};
    if(!fits(candidate,box())){nextId-=2;notify('There isn’t room for another pane here.');return false;}
    await suspend();
    tree=candidate;mount();addFrame(a);addFrame(b,STAGGER,picker?'&picker=1':'');
    focus=b.id;history.pushState({reader:true,split:true},'',location.pathname+location.search+hashNow());
    render();setTimeout(()=>{if(focus===b.id)setFocus(b.id);},STAGGER);
    return b.id;
  }
  function restore(hash){
    const parsed=decodeLayout(hash,nextId);if(!parsed)return false;
    if(narrow()&&!tree){/* A narrow window still restores; only the focused pane shows. */}
    nextId=parsed.next;tree=parsed.tree;focus=parsed.focus;bind=parsed.bind;mount();
    order().forEach((leaf,i)=>addFrame(leaf,i*STAGGER));
    render();setTimeout(()=>setFocus(focus),STAGGER);
    if(bind)loadHunks();
    return true;
  }
  /** Split the focused pane; the new pane shows the same document and opens the picker (Esc keeps it). */
  function split(dir,{route=null,picker=true,before=false}={}){
    if(panes.size>=MAX_PANES){notify(`Up to ${MAX_PANES} panes.`);return null;}
    if(narrow()){notify('Splitting needs a wider window.');return null;}
    const current=order().find(l=>l.id===focus),leaf={id:nextId++,route:cleanRoute(route??panes.get(focus)?.doc?.hash??current?.route)};
    const candidate=splitLeaf(tree,focus,dir,leaf,{before});
    if(!fits(candidate,box())){nextId--;notify('There isn’t room for another pane here.');return null;}
    tree=candidate;addFrame(leaf,0,picker?'&picker=1':'');setFocus(leaf.id);return leaf.id;
  }
  async function close(id=focus){
    if(!panes.has(id))return;
    if(panes.size<=2){const keep=order().find(l=>l.id!==id);await collapse(keep.id);return;}
    await save(id);
    const next=order(),index=next.findIndex(l=>l.id===id);
    panes.get(id).host.remove();panes.delete(id);tree=removeLeaf(tree,id);if(bind?.includes(id)){bind=null;hunks=null;}
    if(focus===id)setFocus((next[index+1]||next[index-1]).id);else{render();remember();}
  }
  /** Keep one pane: the shell navigates itself to its document and the iframes go away. */
  async function collapse(id=focus){
    const leaf=order().find(l=>l.id===id);if(!leaf)return;
    const route=panes.get(id)?.doc?.hash??leaf.route;
    await Promise.all([...panes.keys()].map(save));
    root?.remove();root=null;panes.clear();tree=null;bind=null;hunks=null;focus=null;document.body.classList.remove('split-active');
    await resume(cleanRoute(route));
  }
  /** Every pane saves its place, then the panes close without navigating: Reader Admin replaces the layout, and Back
   *  (or Back to Library) restores it from its #split= entry. */
  async function detach(){if(!tree)return;await Promise.all([...panes.keys()].map(save));dismiss();}
  /** Tear down without navigating (browser Back left the split). */
  function dismiss(){if(!tree)return;root?.remove();root=null;panes.clear();tree=null;bind=null;hunks=null;focus=null;document.body.classList.remove('split-active');}
  // Ask a pane to save its place before it goes; it answers `saved`, or the shell moves on after 600 ms.
  const waiting=new Map();
  function save(id){if(!panes.has(id))return Promise.resolve();return new Promise(resolve=>{const timer=setTimeout(()=>{waiting.delete(id);resolve();},600);waiting.set(id,()=>{clearTimeout(timer);waiting.delete(id);resolve();});post(id,{type:'save'});});}
  function swap(){tree=swapNext(tree,focus);render();remember();}
  function equal(){tree=equalize(tree);render();remember();}
  function cycle(delta=1){const list=order(),i=list.findIndex(l=>l.id===focus);setFocus(list[(i+delta+list.length)%list.length].id);}
  function move(key){const target=neighbor(layout(tree,box()).panes,focus,key);if(target!=null)setFocus(target);}
  function toggleBind(a,b){
    if(bind&&bind.includes(a)&&bind.includes(b)){bind=null;hunks=null;notify('Panes scroll on their own.');}
    else{bind=[a,b];hunks=null;loadHunks();notify('Panes scroll together.');}
    for(const id of panes.keys())if(id===focus)post(id,{type:'focus',bound:bound(id),move:false});
    render();remember();
  }
  /** Versions of one document map offsets across /api/changes?a=&b= hunks (fetched once per pair). */
  async function loadHunks(refs=null){
    if(!bind)return;const pair=bind;
    const [a,b]=refs||pair.map(id=>panes.get(id)?.doc?.ref||refOf(order().find(l=>l.id===id)?.route));
    hunks={a,b,list:null};
    const base=x=>String(x||'').split('@')[0];
    if(!a||!b||a===b||(!refs&&base(a)!==base(b)))return;
    try{const data=await api('/api/changes?a='+param(a)+'&b='+param(b));if(bind===pair&&hunks?.a===a)hunks.list=data.hunks||[];}catch{/* Headings and fractions still align. */}
  }
  const refOf=route=>route?.startsWith('#read=')?decodeSafe(route.slice(6).split('&')[0]):null;
  /** Side by side compare: the older version opens left of the current one, scrolling together. */
  async function compare(older,newer,current){
    let left;
    if(!tree){const id=await start('row',current,{route:'#read='+param(older),before:true});if(!id)return;left=id;}
    else{left=split('row',{route:'#read='+param(older),picker:false,before:true});if(left==null)return;}
    const right=tree&&order()[order().findIndex(l=>l.id===left)+1]?.id;
    bind=[left,right];await loadHunks([older,newer]);render();remember();
    post(focus,{type:'focus',bound:true,move:false});
  }
  function onScroll(id,data){
    if(!bind||!bind.includes(id)||id!==focus)return;
    const other=bind[0]===id?bind[1]:bind[0];const out={type:'scroll-to',top:data.top,fraction:data.fraction,heading:data.heading,docFraction:data.docFraction};
    if(hunks?.list&&typeof data.start==='number'){const fromA=(panes.get(id)?.doc?.ref||hunks.a)===hunks.a;out.offset=mapOffset(hunks.list,data.start,fromA);}
    else if(typeof data.start==='number'&&(panes.get(id)?.doc?.ref||1)===(panes.get(other)?.doc?.ref||2))out.offset=data.start;
    post(other,out);
  }
  addEventListener('message',event=>{
    if(event.origin!==location.origin||!tree)return;const id=paneOf(event.source),data=event.data;
    if(id==null||!data||typeof data!=='object'||!SHELL_TYPES.has(data.type)||!sized(data))return;
    const pane=panes.get(id);
    // A pane's first message says its app is listening: (re)send focus, which may have gone out before it loaded.
    if(!pane.ready){pane.ready=true;if(id===focus)post(id,{type:'focus',bound:bound(id),move:true});}
    if(data.type==='status'){pane.status={mode:String(data.mode||'NORMAL').slice(0,20),position:String(data.position||'').slice(0,12),path:typeof data.path==='string'?data.path.slice(0,2048):null};if(id===focus)paint();}
    else if(data.type==='doc'){pane.doc={hash:cleanRoute(data.hash),ref:typeof data.ref==='string'?data.ref.slice(0,2048):null,title:String(data.title||'').slice(0,300),path:typeof data.path==='string'?data.path:null,preview:!!data.preview,historical:!!data.historical};tree=setRoute(tree,id,pane.doc.hash);remember();if(id===focus)paint();}
    else if(data.type==='toast')notify(String(data.message||'').slice(0,2000),typeof data.kind==='string'?data.kind:undefined,data.options&&typeof data.options==='object'?{id:typeof data.options.id==='string'?data.options.id:undefined,duration:typeof data.options.duration==='number'?data.options.duration:undefined}:undefined);
    else if(data.type==='focus-request'){if(id!==focus)setFocus(id,{move:false});}
    else if(data.type==='window-key')command(String(data.key||''),{shell:!!data.shell,route:typeof data.route==='string'?cleanRoute(data.route.slice(0,4096)):null});
    else if(data.type==='open-admin'&&typeof data.route==='string')openAdmin?.(data.route.slice(0,512));  // The shell validates the route.
    else if(data.type==='open-in-split'){if(data.compare&&typeof data.compare.a==='string'&&typeof data.compare.b==='string')compare(data.compare.a,data.compare.b);else openInSplit(cleanRoute(data.route));}
    else if(data.type==='scroll')onScroll(id,data);
    else if(data.type==='saved')waiting.get(id)?.();
  });
  /** Open a route in the pane after the focused one, splitting first when there is one pane. */
  async function openInSplit(route,current=null){
    if(!route)return;
    if(!tree){await start('row',current,{route});return;}
    const list=order(),i=list.findIndex(l=>l.id===focus),target=list[(i+1)%list.length].id;
    post(target,{type:'open',route});setFocus(target);
  }
  function openInFocused(route){if(!route)return;post(focus,{type:'open',route});panes.get(focus)?.frame.focus();}
  let shellCommands={};
  /** :set scrollbind / noscrollbind / scrollbind!: bind the focused pane with the next one, or unbind it. */
  function scrollbind(on){
    const list=order(),i=list.findIndex(l=>l.id===focus);if(i<0||list.length<2)return;
    if(on==='toggle')on=!bound(focus);
    if(!on){if(bound(focus))toggleBind(...bind);else notify('This pane scrolls on its own.');return;}
    if(bound(focus)){notify('This pane already scrolls with its neighbor.');return;}
    toggleBind(focus,list[(i+1)%list.length].id);
  }
  function command(key,{shell=false,route=null}={}){
    if(shell){shellCommands[key]?.();return;}
    if(!tree)return;
    const open=route?{route,picker:false}:{};
    const actions={v:()=>split('row',open),s:()=>split('col',open),scrollbind:()=>scrollbind(true),noscrollbind:()=>scrollbind(false),'scrollbind!':()=>scrollbind('toggle'),w:()=>cycle(1),W:()=>cycle(-1),h:()=>move('h'),j:()=>move('j'),k:()=>move('k'),l:()=>move('l'),x:swap,'=':equal,o:()=>collapse(focus),q:()=>close(focus)};
    if(actions[key])actions[key]();
  }
  return {active,start,restore,split,close,collapse,dismiss,detach,hash:()=>tree?hashNow():null,command,openInSplit,openInFocused,compare,
    setShellCommands(map){shellCommands=map;},
    refocus(){if(tree&&focus!=null)setFocus(focus);},
    broadcast(data){for(const id of panes.keys())post(id,data);},
    focused(){const pane=panes.get(focus);return pane?{number:numberOf(focus),count:panes.size,status:pane.status,doc:pane.doc,bound:bound(focus)}:null;},
    snapshot(){return tree?{tree:JSON.parse(JSON.stringify(tree)),focus,bind:bind?[...bind]:null,hunks:!!hunks?.list}:null;}};
}

// A pane -------------------------------------------------------------------------------------------
/** Pane side: messages to and from the shell, focus, and the scroll position for synchronized scrolling. */
export function installPane({open,save,onFocus,reveal,scrollBy,seek,docFraction}){
  const parent=window.parent;let focused=false,bound=false,frame=0,quietUntil=0;
  const post=data=>{if(sized(data))parent.postMessage(data,location.origin);};
  const article=()=>document.querySelector('#article');
  const blocks=()=>[...(article()?.querySelectorAll('[data-source-start]')||[])].filter(el=>!el.closest('.document-embed,[data-reader-decoration]'));
  const headings=()=>[...(article()?.querySelectorAll('h1,h2,h3,h4,h5,h6')||[])].filter(el=>!el.closest('.document-embed'));
  const LINE=8;
  /** The innermost block at the top of the view (or the first below it) and how far into it the view is. */
  function position(){
    const book=document.querySelector('.book-viewport');const list=blocks();if(!list.length)return null;
    let block,fraction=0,top=0;
    if(book){const box=book.getBoundingClientRect();block=list.find(el=>{const r=el.getClientRects()[0];return r&&r.width>0&&r.right>box.left+2&&r.left<box.right-2;});}
    else{
      const hits=list.filter(el=>{const r=el.getBoundingClientRect();return r.top<=LINE&&r.bottom>LINE;}).sort((a,b)=>(+a.dataset.sourceEnd-a.dataset.sourceStart)-(+b.dataset.sourceEnd-b.dataset.sourceStart));
      block=hits[0]||list.find(el=>el.getBoundingClientRect().top>LINE);
      if(block){const r=block.getBoundingClientRect();top=r.top;fraction=r.height?Math.max(0,Math.min(1,(LINE-r.top)/r.height)):0;}
    }
    if(!block)return null;
    const all=headings(),blockTop=block.getBoundingClientRect().top;let index=-1;
    for(let i=0;i<all.length;i++){if(all[i]===block||all[i].compareDocumentPosition(block)&Node.DOCUMENT_POSITION_FOLLOWING||all[i].contains(block))index=i;else break;}
    const heading=index>=0?{...headingKey(all.map(el=>({text:el.textContent,level:+el.tagName[1]})),index),top:all[index].getBoundingClientRect().top}:null;
    return {start:+block.dataset.sourceStart,fraction,top:book?0:blockTop,heading,docFraction:docFraction()};
  }
  const report=()=>{if(!focused||!bound||performance.now()<quietUntil||frame)return;frame=requestAnimationFrame(()=>{frame=0;const at=position();if(at)post({type:'scroll',...at});});};
  addEventListener('scroll',report,{passive:true,capture:true});
  function follow(data){
    quietUntil=performance.now()+120;
    const list=blocks();
    if(typeof data.offset==='number'&&list.length){
      const size=el=>+el.dataset.sourceEnd-el.dataset.sourceStart;
      const block=list.filter(el=>+el.dataset.sourceStart<=data.offset&&data.offset<+el.dataset.sourceEnd).sort((a,b)=>size(a)-size(b))[0]||list.find(el=>+el.dataset.sourceStart>=data.offset)||list.at(-1);
      if(reveal(block))return;
      const r=block.getBoundingClientRect(),line=typeof data.top==='number'?data.top+(data.fraction||0)*r.height:LINE;
      scrollBy(r.top+(data.fraction||0)*r.height-line);return;
    }
    const all=headings(),index=matchHeading(all.map(el=>({text:el.textContent,level:+el.tagName[1]})),data.heading);
    if(index>=0){if(reveal(all[index]))return;scrollBy(all[index].getBoundingClientRect().top-(typeof data.heading.top==='number'?data.heading.top:LINE));return;}
    if(typeof data.docFraction==='number')seek(data.docFraction);
  }
  addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==parent)return;const data=event.data;
    if(!data||typeof data!=='object'||!PANE_TYPES.has(data.type)||!sized(data))return;
    if(data.type==='focus'){focused=true;bound=!!data.bound;document.documentElement.classList.add('pane-focused');onFocus(true,data.move!==false);}
    else if(data.type==='blur'){focused=false;document.documentElement.classList.remove('pane-focused');onFocus(false,false);}
    else if(data.type==='open'&&typeof data.route==='string')open(cleanRoute(data.route));
    else if(data.type==='scroll-to')follow(data);
    else if(data.type==='prefs-changed')dispatchEvent(new Event('reader:prefs'));
    else if(data.type==='save')Promise.resolve(save()).finally(()=>post({type:'saved'}));
  });
  // A click, or focus while this frame really has the keyboard (Tab), makes this the focused pane; a script's focus() in a background pane does not.
  const claim=()=>{if(!focused)post({type:'focus-request'});};
  addEventListener('pointerdown',claim,true);addEventListener('focusin',()=>{if(document.hasFocus())claim();},true);
  return {post,focused:()=>focused,bound:()=>bound,position};
}
