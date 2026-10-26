/* Condition waits that explain themselves. A bare page.waitForFunction timeout says only "30000ms exceeded";
   waitFor names the wait, reports which sub-condition was still false, what had focus, and every 429/5xx
   response the page's context received, so a flake under load can be told apart from a product bug.

   const {waitFor,watch,settled,scrollUntilHeld}=require('./web_wait.cjs');
   watch(page);  // once per page, before it loads (counts 429s and 5xx responses in its context, frames included)
   await waitFor(page,'two-page layout',()=>({twoPage:document.body.classList.contains('two-page'),resumed:!document.querySelector('.resume-pending')}));
   await scrollUntilHeld(page,'heading at the reading line',  // native scrolling; returns the scrollY that places it
     title=>{const h=[...document.querySelectorAll('#article h2')].find(el=>el.textContent===title);return h?scrollY+h.getBoundingClientRect().top-innerHeight*.22:null;},{arg:'Chapter 30'});

   The condition runs in the page (or frame) and returns an object of named values; the wait ends when every value
   is truthy, except names starting with _, which are only reported on timeout. It must be self-contained, like any page.waitForFunction body; pass data through {arg}. */
const seen=new WeakMap();
const pageOf=target=>typeof target.page==='function'?target.page():target;
function watch(target){
  const context=pageOf(target).context();if(seen.has(context))return seen.get(context);
  const list=[],pending=new Map();list.pending=pending;seen.set(context,list);
  context.on('response',response=>{const status=response.status();if((status===429||status>=500)&&list.length<40)list.push(`${status} ${response.request().method()} ${new URL(response.url()).pathname}`);});
  // Requests still in flight, so a timeout can show a fetch that never came back.
  context.on('request',request=>{if(pending.size<200)pending.set(request,Date.now());});
  for(const event of ['requestfinished','requestfailed'])context.on(event,request=>pending.delete(request));
  return list;
}
const inFlight=list=>[...(list?.pending||[])].filter(([request])=>/\/api\//.test(request.url())).slice(0,10).map(([request,at])=>`${request.method()} ${new URL(request.url()).pathname} ${Math.round((Date.now()-at)/1000)}s`);
// Playwright sends a function's source over CDP and calls it in the page, which Reader's CSP allows; a string predicate
// would be eval'd in the page and refused (no unsafe-eval). So the wrapper is built here, in Node, as a real function.
const wrap=(condition,body)=>new Function('arg','const values=('+condition.toString()+')(arg);'+body);
const ALL="return Object.entries(values).every(([key,value])=>key[0]==='_'||value);";
const STATE=`const el=document.activeElement,cls=el&&typeof el.className==='string'?el.className.trim().split(/\\s+/).slice(0,3).join('.'):'';
  return {values,active:el?el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(cls?'.'+cls:''):null,hash:location.hash,ready:document.readyState};`;
async function describe(target,condition,arg){
  return target.evaluate(wrap(condition,STATE),arg).catch(error=>({unavailable:error.message.split('\n')[0]}));
}
/** Wait until every value the condition returns is truthy; on timeout, throw with the label and the state. */
async function waitFor(target,label,condition,{timeout=30000,arg=null,polling='raf'}={}){
  try{
    await target.waitForFunction(wrap(condition,ALL),arg,{timeout,polling});
  }catch(error){
    if(!/Timeout/.test(error.message))throw error;
    const state=await describe(target,condition,arg),responses=seen.get(pageOf(target).context())||null;
    throw new Error(`waitFor "${label}" timed out after ${timeout} ms: ${JSON.stringify(state)}; 429/5xx responses: ${responses?JSON.stringify(responses)+'; API requests in flight: '+JSON.stringify(inFlight(responses)):'not watched'}`);
  }
}
/** Wait until the document's height and scroll position are unchanged across two animation frames (late layout settled). */
async function settled(target,label='layout settled',{timeout=10000}={}){
  await target.evaluate(()=>{window.__readerSettle={h:-1,y:-1,stable:0};const tick=()=>{const s=window.__readerSettle;if(!s)return;const h=document.documentElement.scrollHeight,y=scrollY;s.stable=h===s.h&&y===s.y?s.stable+1:0;s.h=h;s.y=y;if(s.stable<2)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  await waitFor(target,label,()=>({stable:(window.__readerSettle?.stable||0)>=2}),{timeout});
}
/** Scroll until a block sits where `where` puts it and has held there, with the page height unchanged, for two frames.
    Blocks far from the window have estimated heights until they near it (content-visibility:auto), so a single scroll
    computed from a far block's estimated position lands short once the blocks around it are laid out (#155).
    `where` runs in the page (self-contained, data through {arg}) and returns the scrollY that puts the block in place.
    Native scrolling only: with smooth scrolling, use the app's own jumps. Resolves to the final scrollY. */
async function scrollUntilHeld(target,label,where,{arg=null,timeout=10000}={}){
  const run=new Function('arg',`const where=(${where.toString()});
    return new Promise((resolve,reject)=>{let stable=0,height=-1;const until=performance.now()+${+timeout};
      const tick=()=>{const want=where(arg);if(typeof want!=='number'||Number.isNaN(want)){reject(new Error('no position: '+want));return;}
        const y=Math.max(0,Math.min(want,document.documentElement.scrollHeight-innerHeight)),h=document.documentElement.scrollHeight;
        if(Math.abs(scrollY-y)>1){scrollTo(0,y);stable=0;}else stable=h===height?stable+1:0;height=h;
        if(stable>=2){resolve(Math.round(scrollY));return;}
        if(performance.now()>until){reject(new Error('still moving: scrollY '+Math.round(scrollY)+', wanted '+Math.round(y)));return;}
        requestAnimationFrame(tick);};
      requestAnimationFrame(tick);});`);
  try{return await target.evaluate(run,arg);}catch(error){throw new Error(`scrollUntilHeld "${label}": ${error.message.split('\n')[0]}`);}
}
/** Chrome 156 and later report a CSP violation (script-src-attr) whenever any parser in the page meets an inline event
    handler, inert documents included, so DOMPurify parsing a document's untrusted `<img onerror>` logs one although it
    strips the handler and nothing runs (#151). True for that report only: the inline-handler message, raised from
    DOMPurify itself. Every other console error, CSP reports from anywhere else included, still fails a suite. */
const sanitizerReport=message=>/^Executing inline event handler violates the following Content Security Policy directive/.test(message.text())
  &&/\/assets\/vendor\/purify\.min\.js$/.test(message.location()?.url||'');
module.exports={waitFor,watch,settled,scrollUntilHeld,sanitizerReport};
