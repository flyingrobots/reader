/** How a piece of art was made (#146): hovering, focusing (the caption's Prompt button) or long-pressing art shows
    a card with the Artist's note, who made it, the prompt versions and date, and the prompts each stage sent, read
    from the version's archived run log by GET /api/art/prompt. The instructions show first; the quoted article,
    brief and scene-language reference are collapsed. Handcrafted art says so; versions made before run logs
    existed say the prompt was not recorded. One card per page, outside the article (it is never searched,
    selected or rasterized), closed by Esc, a click elsewhere, or leaving both the art and the card. */
import {renderArtPrompt} from './controls/reader-controls.js';

const answers=new Map();
const HOVER=350,LEAVE=220,PRESS=550,PRESS_MOVE=10;
let card=null,current=null,showTimer=0,hideTimer=0,pinned=false,opener=null;

function ensureCard(){
  if(card)return card;
  card=document.createElement('div');card.id='art-prompt-card';card.className='art-prompt-card';card.hidden=true;card.tabIndex=-1;
  card.setAttribute('role','dialog');card.setAttribute('aria-label','How this art was made');card.dataset.readerDecoration='';
  card.addEventListener('pointerenter',()=>clearTimeout(hideTimer));
  card.addEventListener('pointerleave',()=>{if(!pinned)scheduleHide();});
  card.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!event.artPromptClosed)hide(true);}});
  document.addEventListener('pointerdown',event=>{if(card.hidden||card.contains(event.target)||current?.anchor.contains(event.target)||current?.button?.contains(event.target))return;hide();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!card.hidden){event.artPromptClosed=true;hide(true);}},true);
  addEventListener('scroll',()=>{if(!card.hidden&&!pinned)hide();},{passive:true});
  document.body.append(card);return card;
}
const promptUrl=(path,art)=>`/api/art/prompt?path=${encodeURIComponent(path)}&edition=${art.edition}&generation=${encodeURIComponent(art.generation)}`;
export function loadPrompt(api,path,art){
  const key=path+'|'+art.generation;
  if(!answers.has(key))answers.set(key,api(promptUrl(path,art)).catch(error=>{answers.delete(key);throw error;}));
  return answers.get(key);
}

function place(anchor){
  const rect=anchor.getBoundingClientRect(),gutter=16,width=Math.min(460,innerWidth-2*gutter);card.style.width=width+'px';
  const tall=rect.height>innerHeight*.45;
  card.style.maxHeight=Math.max(200,Math.min(560,innerHeight*.72))+'px';
  const height=Math.min(card.scrollHeight,parseFloat(card.style.maxHeight));
  let left=tall?rect.right-width-gutter:rect.left,top=tall?Math.max(gutter,rect.top+gutter):rect.bottom+8;
  if(!tall&&top+height>innerHeight-40)top=Math.max(gutter,rect.top-8-height);
  left=Math.max(gutter,Math.min(left,innerWidth-width-gutter));top=Math.max(gutter,Math.min(top,innerHeight-height-40));
  card.style.left=left+'px';card.style.top=top+'px';
}
async function show(target,{focus=false}={}){
  ensureCard();clearTimeout(hideTimer);clearTimeout(showTimer);
  if(current&&current!==target)current.button?.setAttribute('aria-expanded','false');
  current=target;pinned=pinned||focus;card.hidden=false;card.dataset.state='loading';card.dataset.art=target.path;
  // The body is web/src/art-prompt-card.tsx; opening a collapsed quote re-places the card.
  const layout=()=>{if(current===target&&!card.hidden)place(target.anchor);};
  renderArtPrompt(card,{state:'loading'},layout);place(target.anchor);target.button?.setAttribute('aria-expanded','true');
  if(focus){opener=document.activeElement;card.focus({preventScroll:true});}
  let prompt;
  try{prompt=await loadPrompt(target.api,target.path,target.art);}
  catch(error){if(current!==target)return;card.dataset.state='error';renderArtPrompt(card,{state:'error',message:error.message||'The prompt could not be read.'},layout);return;}
  if(current!==target||card.hidden)return;
  renderArtPrompt(card,{state:'ready',prompt,title:target.art?.title,brief:target.art?.brief},layout);card.dataset.state=prompt.handcrafted?'handcrafted':prompt.recorded?'recorded':'unrecorded';
  place(target.anchor);
}
function scheduleHide(){clearTimeout(hideTimer);hideTimer=setTimeout(()=>hide(),LEAVE);}
export function hide(restore=false){
  clearTimeout(showTimer);clearTimeout(hideTimer);if(!card||card.hidden)return;
  card.hidden=true;pinned=false;current?.button?.setAttribute('aria-expanded','false');
  const back=restore?(current?.button||opener):null;current=null;opener=null;if(back?.isConnected)back.focus({preventScroll:true});
}

/** Show the card for `art` (an /api/art version) when `anchor` is hovered or long-pressed, or `button` is pressed. */
export function wireArtPrompt(anchor,{api,path,art,button=null,hover=true}){
  if(!api||!art?.generation)return;
  // A repaint (theme, version) keeps the anchor's listeners and points them at the version now shown.
  if(anchor.artPrompt){Object.assign(anchor.artPrompt,{api,path,art});return;}
  const target={anchor,api,path,art,button};anchor.artPrompt=target;
  if(button){button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','art-prompt-card');
    button.addEventListener('click',event=>{event.preventDefault();if(current===target&&!card.hidden&&pinned)hide(true);else{pinned=true;show(target,{focus:true});}});}
  if(!hover)return;  // Cover previews keep the explicit Prompt button without an automatic hover/long-press card.
  anchor.addEventListener('pointerenter',event=>{if(event.pointerType==='touch')return;clearTimeout(hideTimer);if(current===target&&!card?.hidden)return;clearTimeout(showTimer);showTimer=setTimeout(()=>show(target),HOVER);});
  anchor.addEventListener('pointerleave',event=>{if(event.pointerType==='touch')return;clearTimeout(showTimer);if(current===target&&!pinned)scheduleHide();});
  let press=0,pressed=false,start=null;
  const cancelPress=()=>{clearTimeout(press);start=null;};
  anchor.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'){clearTimeout(showTimer);if(current===target&&!pinned)hide();return;}pressed=false;cancelPress();start={id:event.pointerId,x:event.clientX,y:event.clientY};press=setTimeout(()=>{start=null;pressed=true;pinned=true;show(target);},PRESS);});
  anchor.addEventListener('pointermove',event=>{if(event.pointerType==='touch'&&start&&event.pointerId===start.id&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>PRESS_MOVE)cancelPress();});
  for(const type of ['pointerup','pointercancel','pointerleave'])anchor.addEventListener(type,cancelPress);
  anchor.addEventListener('contextmenu',event=>{if(pressed)event.preventDefault();});
  anchor.addEventListener('click',event=>{if(pressed){event.preventDefault();pressed=false;}},true);
}
