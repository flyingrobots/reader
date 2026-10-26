/** Bespoke article art (RW-43): cover art, feature thumbnails and an article's art, made per article by
    an agent and drawn by Reader's own interpreter (controls/art.js) from a validated scene description.

    The server (/api/art) holds versions per edition; this module draws the chosen one: one live canvas
    per page (the cover, or an article's art in continuous reading), still images for thumbnails,
    reduced motion and two-page reading; without WebGL, the still image captured when the art was
    first drawn, or the Artist's note alone. The brief (the Artist's note) is the text alternative.
    Every element here is decoration (data-reader-decoration). Commissions are background jobs:
    `artJobs` polls /api/art/jobs while one runs and announces each start, finish and failure. */
import {SCHEMA,TOKENS,validate} from './art-scene.mjs';
const DERIVED=SCHEMA.derived_tokens;

const THUMB={width:320,height:150},STILL={width:960,height:480};
let stageLoad=null;
const loadStage=()=>stageLoad??=import('./controls/art.js').then(m=>m.artStage()).catch(error=>{console.warn('Article art',error);return null;});
const cache=new Map(),thumbs=new Map(),uploaded=new Set();
let figures=0;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const theme=()=>document.documentElement.dataset.theme||'';

/** The theme's tokens as sRGB bytes, and whether the page is dark (any CSS color syntax a theme uses). */
export function artPalette(){
  const style=getComputedStyle(document.documentElement),canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgb=name=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='#808080';ctx.fillStyle=style.getPropertyValue('--'+name).trim()||'#808080';ctx.fillRect(0,0,1,1);const [r,g,b]=ctx.getImageData(0,0,1,1).data;return [r,g,b];};
  const tokens=Object.fromEntries(TOKENS.filter(name=>!DERIVED[name]).map(name=>[name,rgb(name)]));
  const luma=([r,g,b])=>(.2126*r+.7152*g+.0722*b)/255,dark=luma(tokens.bg)<.5;
  // Derived roles: light stays light on every theme (ink is dark on a light page).
  tokens.bright=dark?tokens.ink:tokens.bg;tokens.deep=dark?tokens.bg:tokens.ink;
  return {tokens,dark};
}

/** /api/art for a path (or one version of it), cached briefly; `fresh` skips the cache. */
export function fetchArt(api,path,{edition,generation,fresh=false}={}){
  const key=[path,edition||'',generation||''].join('|'),cached=cache.get(key);
  if(!fresh&&cached&&Date.now()-cached.at<30000)return cached.promise;
  const promise=api('/api/art?path='+encodeURIComponent(path)+(edition?'&edition='+edition+'&generation='+encodeURIComponent(generation):'')).catch(error=>{cache.delete(key);throw error;});
  cache.set(key,{at:Date.now(),promise});return promise;
}
export const forgetArt=path=>{for(const key of [...cache.keys()])if(key.startsWith(path+'|'))cache.delete(key);};
export const hasArt=data=>!!data?.art?.scene;
const stillUrl=(path,art)=>art?.still?`/api/art/still?path=${encodeURIComponent(path)}&edition=${art.edition}&generation=${encodeURIComponent(art.generation)}`:null;

function duration(seconds){if(!Number.isFinite(seconds))return null;const s=Math.round(seconds);return s<60?`${s} s`:`${Math.floor(s/60)} min ${String(s%60).padStart(2,'0')} s`;}
function tokens(usage){if(!usage)return null;const total=(usage.input_tokens||0)+(usage.output_tokens||0);return total?`${total>=1000?Math.round(total/1000)+'k':total} tokens`:null;}
/** Who made it, with what, for which edition, how long it took and what it cost, as far as the producer reported. */
export function provenanceLine(art){
  const p=art.provenance||{},who=p.producer||{},made=p.created_at?new Date(p.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):null;
  const cost=p.usage?.usd!=null?'$'+Number(p.usage.usd).toFixed(2):p.producer?.kind==='local'?'local GPU':'cost not reported';
  return [`Made by ${who.label||'an unknown producer'}${who.model?` (${who.model})`:''}`,art.current?'for this edition':'for an earlier edition',made,duration(p.seconds),tokens(p.usage),cost,p.repaired?'repaired once':null].filter(Boolean).join(' · ');
}

/** Draw a stored version into a figure. `live` asks for the animated canvas (the page's one); otherwise a still image.
    `hero` (#145) makes it an article's opener: a way into the text and, in two-page reading (`hero.book`), the title,
    kicker, byline and any standfirst over the art, for the eye only (the article's own title follows on the next
    spread), with the still image kept under the live canvas so the page turn can paint it. */
export async function paintArt(figure,data,{live=false,motion=true,api,actions={},compact=false,hero=null}={}){
  const art=data.art,path=data.path,title=art.title||'Untitled';
  figure.artView?.destroy();figure.artView=null;
  figure.classList.remove('art-empty','art-unavailable','art-error');figure.classList.add('art-figure');
  figure.dataset.readerDecoration='';figure.dataset.art=path;figure.dataset.generation=art.generation;delete figure.dataset.frames;
  const surface=document.createElement('div');surface.className='art-surface';surface.setAttribute('role','img');surface.setAttribute('aria-label',`Art: ${title}`);
  const note=document.createElement('div'),id='art-note-'+(++figures);note.className='art-note';note.id=id;note.hidden=true;surface.setAttribute('aria-describedby',id);
  note.innerHTML=`<h3 class="art-note-title">${esc(title)}</h3>${art.brief.split(/\n{2,}/).map(p=>`<p>${esc(p)}</p>`).join('')}<p class="art-provenance">${esc(provenanceLine(art))}${data.count>1?` · version ${data.versions.findIndex(v=>v.generation===art.generation)+1} of ${data.count}`:''}</p><div class="art-actions" data-button-group></div>`;
  const buttons=note.querySelector('.art-actions');
  const button=(label,run,hint)=>{const b=document.createElement('button');b.type='button';b.dataset.button='outline xs';b.textContent=label;if(hint)b.title=hint;b.onclick=event=>{event.preventDefault();run();};buttons.append(b);return b;};
  if(actions.generate)button('Make another version',()=>actions.generate(path),'Commission a new version; this one is kept');
  if(data.count>1&&actions.version){const at=data.versions.findIndex(v=>v.generation===art.generation);
    if(at>0)button('‹ Newer',()=>actions.version(path,data.versions[at-1]));if(at<data.versions.length-1)button('Older ›',()=>actions.version(path,data.versions[at+1]));}
  if(data.count>1&&!art.favorite&&actions.favorite)button('Keep this one',()=>actions.favorite(path,art),'Show this version from now on');
  if(!buttons.children.length)buttons.remove();
  const caption=document.createElement('figcaption');caption.className='art-caption';
  caption.innerHTML=`<button type="button" class="art-note-toggle" data-button="ghost xs" aria-expanded="false" aria-controls="${id}">Artist’s note</button><span class="art-credit">${esc(art.provenance?.producer?.label||'')}${art.current?'':' · earlier edition'}</span>`;
  const toggle=caption.querySelector('button');toggle.onclick=event=>{event.preventDefault();note.hidden=!note.hidden;toggle.setAttribute('aria-expanded',String(!note.hidden));};
  const extra=[];
  if(hero){
    if(hero.book){const opener=document.createElement('div');opener.className='art-hero-opener';opener.setAttribute('aria-hidden','true');
      opener.innerHTML=`${hero.kicker?`<p class="art-hero-kicker">${esc(hero.kicker)}</p>`:''}<p class="art-hero-title">${esc(hero.title)}</p><p class="art-hero-standfirst" hidden></p>${hero.byline?`<p class="art-hero-byline">${esc(hero.byline)}</p>`:''}`;
      hero.standfirst?.then(text=>{const slot=opener.querySelector('.art-hero-standfirst');if(text&&slot){slot.textContent=text;slot.hidden=false;}});extra.push(opener);}
    const go=document.createElement('button');go.type='button';go.className='art-hero-continue';go.dataset.button='outline sm';
    go.innerHTML=hero.book?'Turn the page <span aria-hidden="true">→</span>':'Begin reading <span aria-hidden="true">↓</span>';go.onclick=event=>{event.preventDefault();hero.go?.();};extra.push(go);
  }
  figure.replaceChildren(surface,...extra,caption,note);figure.classList.toggle('art-compact',compact);
  const image=(src,state)=>{const img=new Image();img.className='art-still';img.alt='';img.src=src;surface.replaceChildren(img);figure.dataset.state=state;};
  const unavailable=message=>{figure.classList.add('art-unavailable');figure.dataset.state='unavailable';surface.innerHTML=`<p class="art-message">${esc(message)}</p>`;note.hidden=false;toggle.setAttribute('aria-expanded','true');};
  let scene;
  try{scene=validate(art.scene).scene;}catch(error){figure.classList.add('art-error');const stored=stillUrl(path,art);if(stored)image(stored,'image');else unavailable('This art could not be drawn: '+(error.errors?.[0]||error.message));figure.dataset.state=stored?'image':'error';return figure;}
  const stage=await loadStage();if(!figure.isConnected)return figure;
  const fallback=()=>{const stored=stillUrl(path,art);if(stored)image(stored,'image');else unavailable('This browser cannot draw 3D art here. The Artist’s note describes it.');};
  if(!stage){fallback();return figure;}
  const palette=artPalette();
  try{
    if(live&&motion){
      // Two-page reading: the page turn paints images, not a WebGL canvas, so the still frame lies under the live one.
      if(hero?.book){const width=Math.max(160,Math.round(surface.clientWidth||STILL.width)),height=Math.max(80,Math.round(surface.clientHeight||width/2));image(stage.still(scene,palette,width,height),'still');}
      const view=stage.mount(surface,scene,palette,{onStill:(url,reason)=>{image(url,'still');figure.dataset.reason=reason;},onLost:fallback});figure.artView=view;
      if(!view.still)figure.dataset.state='live';
      figure.artFrameTimes=()=>({cpu:view.frameTimes(),interval:view.intervals()});
    }else{const width=Math.max(160,Math.round(surface.clientWidth||STILL.width)),height=Math.max(80,Math.round(surface.clientHeight||width/2));image(stage.still(scene,palette,width,height),'still');figure.dataset.frames='1';}
  }catch(error){console.warn('Article art',error);fallback();return figure;}
  keepStill(api,data,stage,scene,palette);
  return figure;
}

/** The first browser to draw a version gives the server a still image for browsers without WebGL. */
function keepStill(api,data,stage,scene,palette){
  const art=data.art,key=data.path+'|'+art.generation;
  if(!api||art.still||uploaded.has(key))return;uploaded.add(key);
  setTimeout(async()=>{try{
    let image=stage.still(scene,palette,STILL.width,STILL.height,{type:'image/webp',quality:.86});
    if(!image.startsWith('data:image/webp'))image=stage.still(scene,palette,STILL.width,STILL.height);
    if(image.length>2.6e6)return;
    await api('/api/art',{action:'still',path:data.path,edition:art.edition,generation:art.generation,image});forgetArt(data.path);
  }catch(error){console.warn('Article art still',error);}},1200);
}

/** A small still image for a feature, rendered once per version, theme and size this session. */
export async function paintArtThumb(slot,data){
  const art=data.art,key=[data.path,art.generation,theme()].join('|');let url=thumbs.get(key);
  if(!url){let scene=null;try{scene=validate(art.scene).scene;}catch{/* drawn below from the stored still, if any */}
    const stage=scene&&await loadStage();if(!slot.isConnected)return;
    if(stage){try{url=stage.still(scene,artPalette(),THUMB.width,THUMB.height);thumbs.set(key,url);}catch(error){console.warn('Article art',error);}}
    url??=stillUrl(data.path,art);}
  if(!url){slot.remove();return;}
  const img=new Image();img.className='art-thumb-image';img.alt='';img.src=url;img.width=THUMB.width;img.height=THUMB.height;slot.replaceChildren(img);slot.dataset.state='still';
  slot.title=`${art.title} · art by ${art.provenance?.producer?.label||'an unknown producer'}`;
}

/** The calm placeholder for a piece without art: what would make it, and a button to ask (or the running job). */
export function paintPlaceholder(figure,{path,job,producer,local=false,generate,cancel,setup}){
  figure.artView?.destroy();figure.artView=null;
  figure.classList.remove('art-unavailable','art-error','art-compact');figure.classList.add('art-figure','art-empty');figure.dataset.readerDecoration='';delete figure.dataset.generation;delete figure.dataset.frames;figure.dataset.art=path;figure.dataset.state=job?'working':'placeholder';
  const estimate=producer?.estimate_seconds?`usually about ${duration(producer.estimate_seconds)}`:'usually a few minutes';
  if(job){
    figure.innerHTML=`<div class="art-placeholder" role="status" aria-live="polite"><p class="art-placeholder-title">${esc(job.state==='queued'?'Waiting to make art…':job.message||'Making art…')}</p><p>${esc(job.producer_label)} is ${job.stage==='scene'||job.stage==='repair'?'composing the scene':'reading the article'}${job.elapsed?` · ${duration(job.elapsed)}`:''}${job.ahead?` · ${job.ahead} ahead`:''}. You can keep reading.</p><div data-button-group><button type="button" data-button="outline xs" data-art-cancel="${esc(job.id)}">Cancel</button></div></div>`;
    figure.querySelector('[data-art-cancel]').onclick=event=>{event.preventDefault();cancel?.(job.id);};
  }else{
    // The static web demo (local: the reason, from the controls bundle) has no server to run a voice: Generate art is disabled and says so.
    const body=local?'A voice or local model on your computer reads a piece, writes an art brief, then composes a scene for Reader to draw. Run Reader locally to make art: reader demo has a scripted voice that answers art commissions.'
      :producer?`${esc(producer.label)} would read it, write an art brief, then compose a scene for Reader to draw: ${esc(estimate)}.`
      :'No voice or local model can make art here yet. Add a voice to voices.json or set up a local model; Behind the scenes, Companions, shows which agent command lines Reader found.';
    const button=local?`<button type="button" data-button="outline sm" data-art-generate disabled data-needs-reader title="${esc(local)}">Generate art</button>`
      :producer?'<button type="button" data-button="outline sm" data-art-generate>Generate art</button>'
      :setup?'<button type="button" data-button="outline sm" data-art-setup>Set up a voice</button>':'';
    figure.innerHTML=`<div class="art-placeholder"><p class="art-placeholder-title">No art for this piece yet.</p><p>${body}</p>${button?`<div data-button-group>${button}</div>`:''}</div>`;
    figure.querySelector('[data-art-generate]')?.addEventListener('click',event=>{event.preventDefault();generate?.(path);});
    figure.querySelector('[data-art-setup]')?.addEventListener('click',event=>{event.preventDefault();setup?.();});
  }
  return figure;
}

/** Background commissions: poll while any runs, toast each transition, and tell the page when art is ready. */
export function artJobs({api,notify}){
  const seen=new Map();let timer=0,last=null;
  const label=job=>`‘${job.title||job.path.split('/').pop()}’`;
  async function poll(){
    clearTimeout(timer);timer=0;
    let status;try{status=await api('/api/art/jobs');}catch{timer=setTimeout(poll,8000);return;}
    last=status;
    for(const job of status.jobs){
      const before=seen.get(job.id),key=job.state+'|'+(job.stage||'');
      if(before===undefined&&!['queued','waiting','running'].includes(job.state)){seen.set(job.id,key);continue;}
      if(before===key)continue;seen.set(job.id,key);
      if(['queued','waiting','running'].includes(job.state))notify(`Making art for ${label(job)}…`,'info',{id:job.id,duration:Infinity,description:`${job.producer_label} · ${job.message||'waiting'}`});
      else if(job.state==='done'){notify(`Art ready for ${label(job)}`,'success',{id:job.id,duration:7000,description:`by ${job.producer_label}${job.seconds?` · ${duration(job.seconds)}`:''}${job.warning?` · ${job.warning}`:''}`});forgetArt(job.path);document.dispatchEvent(new CustomEvent('reader:art-ready',{detail:job}));}
      else if(job.state==='cancelled'){notify(`Art for ${label(job)} cancelled`,'info',{id:job.id,duration:4000});document.dispatchEvent(new CustomEvent('reader:art-ready',{detail:job}));}
      else{notify(`Art for ${label(job)} failed`,'error',{id:job.id,duration:12000,description:job.error||undefined});forgetArt(job.path);document.dispatchEvent(new CustomEvent('reader:art-ready',{detail:job}));}
    }
    document.dispatchEvent(new CustomEvent('reader:art-jobs',{detail:status}));
    if(status.active)timer=setTimeout(poll,2000);
  }
  return {
    poll,
    status:()=>last,
    async generate(path,producer){const {job}=await api('/api/art',{action:'generate',path,producer:producer||undefined});poll();return job;},
    async commission(paths,producer){const result=await api('/api/art',{action:'commission',paths,producer:producer||undefined});if(result.queued.length)poll();return result;},
    async cancel(id){const {job}=await api('/api/art',{action:'cancel',job:id});poll();return job;},
  };
}
