/** The art focus view (#147): one piece of art full screen, live where motion is allowed (drag or the arrow keys turn
    around the scene, the wheel or + and − zoom, 0 resets), else the still image. Its Artist's note and prompt card
    (#146) are overlays; **Regenerate this** opens the Prompt Input island (web/src/art-regenerate.tsx), prefilled with
    the direction this version was made with (or its Artist's note), to queue a new version that carries the reader's
    direction. Opened by the caption's Focus button, a double click or tap on the art, Space G or :art-focus; Esc or
    Close returns to the same place in the article with focus back where it was. Decoration throughout. */
import {validate} from './art-scene.mjs';
import {wireArtPrompt,hide as hidePrompt,loadPrompt} from './art-prompt.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let open=null;
export const focusOpen=()=>!!open;

/** Open `data` (an /api/art answer) full screen. `stage` is the art renderer (or null); `restore` repaints the figure it left. */
export function openArtFocus(data,{api,stage,palette,motion,stillUrl,restore,regenerate}){
  closeArtFocus();
  const art=data.art,title=art.title||'Untitled',back=document.activeElement,scroll=[scrollX,scrollY];
  const view=document.createElement('div');view.className='art-focus';view.setAttribute('role','dialog');view.setAttribute('aria-modal','true');
  view.setAttribute('aria-label',`Art: ${title}`);view.dataset.readerDecoration='';view.dataset.art=data.path;view.tabIndex=-1;
  view.innerHTML=`<div class="art-focus-stage" tabindex="0" role="img" aria-label="Art: ${esc(title)}${motion?'. Drag or use the arrow keys to turn, + and − to zoom, 0 to reset.':''}" aria-describedby="art-focus-note"></div>
    <div class="art-focus-bar"><div class="art-focus-heading"><p class="art-focus-kicker">Art</p><h2 class="art-focus-title">${esc(title)}</h2><p class="art-focus-credit">${esc(art.provenance?.producer?.label?`by ${art.provenance.producer.label}${art.provenance.producer.model?` (${art.provenance.producer.model})`:''}`:'')}</p></div>
      <div class="art-focus-actions" data-button-group><button type="button" data-button="outline sm" data-focus-note aria-expanded="false" aria-controls="art-focus-note">Artist’s note</button><button type="button" data-button="outline sm" data-focus-prompt>Prompt</button><button type="button" data-button="outline sm" data-focus-regenerate>Regenerate this</button><button type="button" data-button="default sm" data-focus-close aria-label="Close the focus view (Esc)">Close</button></div></div>
    <div class="art-focus-note" id="art-focus-note" hidden><h3>Artist’s note</h3>${(art.brief||'').split(/\n{2,}/).map(p=>`<p>${esc(p)}</p>`).join('')}</div>
    <div class="art-focus-regenerate" hidden></div><p class="art-focus-status" role="status" aria-live="polite"></p>`;
  document.body.append(view);document.documentElement.classList.add('art-focusing');
  const host=view.querySelector('.art-focus-stage'),note=view.querySelector('.art-focus-note'),noteButton=view.querySelector('[data-focus-note]'),panel=view.querySelector('.art-focus-regenerate'),status=view.querySelector('.art-focus-status');
  let live=null,island=null;
  const image=(src,state)=>{const img=new Image();img.className='art-still';img.alt='';img.src=src;host.replaceChildren(img);view.dataset.state=state;};
  const fallback=()=>{const stored=stillUrl;if(stored)image(stored,'image');else{view.dataset.state='unavailable';host.innerHTML='<p class="art-message">This browser cannot draw 3D art here. The Artist’s note describes it.</p>';note.hidden=false;noteButton.setAttribute('aria-expanded','true');}};
  let scene=null;try{scene=validate(art.scene).scene;}catch{/* the stored still, below */}
  if(!stage||!scene)fallback();
  else try{
    if(motion){live=stage.mount(host,scene,palette,{interactive:true,onStill:url=>image(url,'still'),onLost:fallback});view.artView=live;if(!live.still)view.dataset.state='live';}
    else image(stage.still(scene,palette,Math.max(320,Math.round(host.clientWidth)),Math.max(200,Math.round(host.clientHeight))),'still');
  }catch(error){console.warn('Article art',error);fallback();}
  wireArtPrompt(host,{api,path:data.path,art,button:view.querySelector('[data-focus-prompt]'),hover:false});
  noteButton.onclick=()=>{note.hidden=!note.hidden;noteButton.setAttribute('aria-expanded',String(!note.hidden));};
  const regen=view.querySelector('[data-focus-regenerate]');
  if(regenerate?.disabled){regen.disabled=true;regen.title=regenerate.disabled;regen.dataset.needsReader='';}
  regen.onclick=async()=>{
    if(!panel.hidden){closePanel();return;}
    hidePrompt();panel.hidden=false;regen.setAttribute('aria-expanded','true');
    let prompt=null;try{prompt=await loadPrompt(api,data.path,art);}catch{/* the note is the starting point */}
    if(!open||panel.hidden)return;
    const direction=prompt?.direction||art.provenance?.direction||'';
    island=regenerate.mount(panel,{title:regenerate.title||title,initial:direction||art.brief||'',from:direction?'direction':'brief',producers:regenerate.producers(),producer:regenerate.producer(),max:regenerate.max,disabled:regenerate.disabled||null,
      close:closePanel,submit:async(text,producer)=>{const job=await regenerate.submit(text,producer);closePanel();status.textContent=`Queued: ${job?.producer_label||'the producer'} is making a new version with your direction. This one is kept.`;}});
  };
  function closePanel(){island?.unmount();island=null;panel.hidden=true;panel.replaceChildren();regen.setAttribute('aria-expanded','false');regen.focus({preventScroll:true});}
  view.querySelector('[data-focus-close]').onclick=()=>closeArtFocus();
  view.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(event.artPromptClosed||event.artFormClosed)return;event.preventDefault();if(!panel.hidden)closePanel();else closeArtFocus();}
    else if(event.key==='Tab'){const items=[...view.querySelectorAll('button:not([disabled]),textarea,[tabindex="0"]')].filter(el=>el.offsetParent||el===host);if(!items.length)return;
      const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    event.stopPropagation();  // the reader's keys stay with the page behind
  });
  view.addEventListener('wheel',event=>event.preventDefault(),{passive:false});
  open={view,live,back,scroll,restore,close:()=>{island?.unmount();live?.destroy();}};
  host.focus({preventScroll:true});
  return view;
}
export function closeArtFocus(){
  if(!open)return;const {view,back,scroll,restore,close}=open;open=null;
  hidePrompt();close();view.remove();document.documentElement.classList.remove('art-focusing');
  if(scrollX!==scroll[0]||scrollY!==scroll[1])scrollTo(scroll[0],scroll[1]);
  // The figure repaints (the focus view held the page's one live canvas), so its Focus button may be a new element.
  const origin=back?.closest?.('figure');
  Promise.resolve(restore?.()).catch(()=>{}).then(()=>{const target=back?.isConnected?back:origin?.isConnected?origin.querySelector('.art-focus-toggle')||origin:null;target?.focus({preventScroll:true});});
}
