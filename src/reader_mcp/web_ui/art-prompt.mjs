/** How a piece of art was made (#146): hovering, focusing (the caption's Prompt button) or long-pressing art shows
    a card with the Artist's note, who made it, the prompt versions and date, and the prompts each stage sent, read
    from the version's archived run log by GET /api/art/prompt. The instructions show first; the quoted article,
    brief and scene-language reference are collapsed. Handcrafted art says so; versions made before run logs
    existed say the prompt was not recorded. One card per page, outside the article (it is never searched,
    selected or rasterized), closed by Esc, a click elsewhere, or leaving both the art and the card. */
const answers=new Map();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STAGES={brief:'Brief prompt',scene:'Scene prompt',repair:'Repair prompt'};
const PARTS={article:'The article, as quoted',brief:'The brief, as quoted',reference:'The scene language reference'};
const HOVER=350,LEAVE=220,PRESS=550;
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
const day=value=>{const d=value?new Date(value):null;return d&&!isNaN(d)?d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):null;};
const count=n=>Number(n).toLocaleString();

/** The card's body for one answer: who, when, which prompt versions, the note, then each stage's prompt. */
export function promptMarkup(prompt,art){
  const who=prompt.producer||{},versions=Object.entries(prompt.prompts||{}).filter(([,v])=>v).map(([,v])=>v);
  const head=[who.label?`Made by ${who.label}${who.model?` (${who.model})`:''}`:null,day(prompt.created_at),versions.length?'prompts '+versions.join(' · '):null].filter(Boolean).join(' · ');
  const note=(art?.brief||'').split(/\n{2,}/)[0];
  let body;
  if(prompt.handcrafted)body=`<p class="art-prompt-message">${esc(prompt.message)}</p>`;
  else if(!prompt.recorded)body=`<p class="art-prompt-message">${esc(prompt.message||'Prompt not recorded for this version.')}</p>`;
  else body=prompt.stages.map((stage,index)=>`<section class="art-prompt-stage" data-stage="${esc(stage.name)}"><div class="art-prompt-stage-head"><h4>${esc(STAGES[stage.name]||stage.name)}</h4><button type="button" data-button="outline xs" data-copy="${index}">Copy</button></div>`
    +stage.parts.map(part=>part.kind==='instructions'?`<pre class="art-prompt-text">${esc(part.text.trim())}</pre>`
      :`<details class="art-prompt-quote" data-part="${esc(part.kind)}"><summary>${esc(PARTS[part.kind]||part.kind)} <span>${count(part.chars)} characters</span></summary><pre class="art-prompt-text">${esc(part.text)}</pre></details>`).join('')
    +(stage.truncated?'<p class="art-prompt-message">The rest of this prompt is in the run log.</p>':'')+'</section>').join('');
  return `<div class="art-prompt-head"><p class="art-prompt-kicker">How this art was made</p><h3 class="art-prompt-title">${esc(prompt.title||art?.title||'Untitled')}</h3><p class="art-prompt-meta">${esc(head)}</p></div>`
    +(note?`<p class="art-prompt-note"><span>Artist’s note</span> ${esc(note)}</p>`:'')+body
    +(prompt.recorded&&prompt.log?`<p class="art-prompt-log">Run log <code>${esc(prompt.log)}</code></p>`:'');
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
  card.innerHTML='<p class="art-prompt-message">Reading the run log…</p>';place(target.anchor);target.button?.setAttribute('aria-expanded','true');
  if(focus){opener=document.activeElement;card.focus({preventScroll:true});}
  let prompt;
  try{prompt=await loadPrompt(target.api,target.path,target.art);}
  catch(error){if(current!==target)return;card.dataset.state='error';card.innerHTML=`<p class="art-prompt-message">${esc(error.message||'The prompt could not be read.')}</p>`;return;}
  if(current!==target||card.hidden)return;
  card.innerHTML=promptMarkup(prompt,target.art);card.dataset.state=prompt.handcrafted?'handcrafted':prompt.recorded?'recorded':'unrecorded';
  card.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async event=>{event.preventDefault();
    const text=prompt.stages[+button.dataset.copy].parts.map(p=>p.text).join('');
    try{await navigator.clipboard.writeText(text);button.textContent='Copied';}catch{button.textContent='Copy failed';}
    setTimeout(()=>{if(button.isConnected)button.textContent='Copy';},1600);});
  card.querySelectorAll('details').forEach(d=>d.addEventListener('toggle',()=>place(target.anchor)));
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
  if(!hover)return;  // the focus view: its Prompt button only, so resting the pointer on the art never covers it
  anchor.addEventListener('pointerenter',event=>{if(event.pointerType==='touch')return;clearTimeout(hideTimer);if(current===target&&!card?.hidden)return;clearTimeout(showTimer);showTimer=setTimeout(()=>show(target),HOVER);});
  anchor.addEventListener('pointerleave',event=>{if(event.pointerType==='touch')return;clearTimeout(showTimer);if(current===target&&!pinned)scheduleHide();});
  let press=0,pressed=false;
  anchor.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')return;pressed=false;clearTimeout(press);press=setTimeout(()=>{pressed=true;pinned=true;show(target);},PRESS);});
  for(const type of ['pointerup','pointercancel','pointerleave'])anchor.addEventListener(type,()=>clearTimeout(press));
  anchor.addEventListener('contextmenu',event=>{if(pressed)event.preventDefault();});
  anchor.addEventListener('click',event=>{if(pressed){event.preventDefault();pressed=false;}},true);
}
