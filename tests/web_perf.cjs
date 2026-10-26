/* Large-document regression benchmark: a ~2 MB synthetic Markdown document must render, anchor and paginate promptly. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
// Generous ceilings: the quadratic anchoring this guards against took well over 10 s on this fixture.
const FIRST_RENDER_MS=+(process.env.READER_PERF_FIRST_RENDER_MS||5000),FIND_MS=+(process.env.READER_PERF_FIND_MS||2500),KEYSTROKE_MS=+(process.env.READER_PERF_KEYSTROKE_MS||30);
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--perf'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking']});
  const path='library/large.md',timings={};
  const open=async(prefs)=>{
    const context=await browser.newContext({viewport:{width:1300,height:820}});
    await context.addInitScript(value=>{try{if(!sessionStorage.getItem('perf-prefs')){localStorage.setItem('reader.preferences.v1',value);sessionStorage.setItem('perf-prefs','1');}}catch{}},JSON.stringify(prefs));
    const page=await context.newPage(),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))requests.push(r.method()+' '+u.pathname);});
    return {context,page,errors,requests};
  };
  const visible=async page=>{await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'),null,{timeout:60000,polling:50});return page.evaluate(()=>performance.now());};
  const text=(await (await fetch(url+'/api/document?path='+encodeURIComponent(path))).json()).text;
  assert.ok(text.length>1.8e6,'fixture is about 2 MB: '+text.length);
  // Continuous reading: first render, batched image resolution, exact anchors, annotations, find and resume.
  {const {context,page,errors,requests}=await open({layout:'scroll',smooth:false});
   await page.goto(url+'#read='+encodeURIComponent(path));
   timings.scroll=Math.round(await visible(page));
   assert.ok(timings.scroll<FIRST_RENDER_MS,`first render took ${timings.scroll} ms (limit ${FIRST_RENDER_MS})`);
   await page.waitForFunction(()=>document.querySelectorAll('.annotation-pin').length===1,null,{timeout:10000});
   // Diagrams draw after first paint, not before it.
   await page.waitForFunction(()=>document.querySelectorAll('#article .reader-diagram-canvas[data-state=ready]').length===2,null,{timeout:20000,polling:50});timings.diagrams=Math.round(await page.evaluate(()=>performance.now()));
   const facts=await page.evaluate(()=>{const heading=[...document.querySelectorAll('#article h2')].find(h=>h.textContent==='Section 390');const images=[...document.querySelectorAll('#article img')];
     const own=CSS.highlights?.get('reader-other');return {start:+heading.dataset.sourceStart,end:+heading.dataset.sourceEnd,images:images.length,loaded:images.filter(i=>i.getAttribute('src')?.startsWith('/api/file?path=library%2Ffigures%2Ffigure-')).length,code:document.querySelectorAll('#article .reader-code-block').length,highlight:own?[...own][0]?.toString():null};});
   const at=text.indexOf('## Section 390\n'),cp=offset=>Array.from(text.slice(0,offset)).length;
   assert.equal(facts.start,cp(at),'heading anchor is an exact code-point offset after thousands of emoji');
   assert.equal(facts.end,cp(text.indexOf('\n',at)+1));
   assert.equal(facts.images,100);assert.equal(facts.loaded,100,'every local image resolves');
   assert.ok(facts.code>=200,'code blocks are mounted: '+facts.code);
   assert.equal(facts.highlight,'distinct observation for section 390','a late annotation paints at its exact passage');
   assert.equal(requests.filter(r=>r==='GET /api/resolve').length,0,'no per-image resolve round trips');
   assert.equal(requests.filter(r=>r==='GET /api/resolve-batch').length,2,'100 images resolve in two batches');
   await page.locator('#main').focus();await page.keyboard.press('/');
   const findStarted=Date.now();await page.locator('#find-query').fill('observation for section 399 waits');
   await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='1 / 1',null,{timeout:FIND_MS*2});
   timings.find=Date.now()-findStarted;assert.ok(timings.find<FIND_MS,`find took ${timings.find} ms (limit ${FIND_MS})`);
   // Typing more of the query reuses the article's projection: each later keystroke only searches it (#35).
   const keys=await page.evaluate(()=>{const q=document.querySelector('#find-query'),times=[];q.value='';
     for(const ch of 'observation for section 399 waits'){q.value+=ch;const t=performance.now();q.dispatchEvent(new Event('input'));times.push(performance.now()-t);}
     return {times,count:document.querySelector('#find-count').textContent};});
   assert.equal(keys.count,'1 / 1','typed one key at a time, find lands on the same single hit');
   const later=keys.times.slice(1).sort((a,b)=>a-b);timings.keystroke=Math.round(later[later.length>>1]);timings.keystrokeMax=Math.round(later.at(-1));
   // Text that changes after the projection was built is found at once: the projection is rebuilt, from typed arrays.
   const late=await page.evaluate(()=>{const q=document.querySelector('#find-query'),p=document.createElement('p'),article=document.querySelector('#article');
     p.textContent='a late paragraph arrives';article.append(p);q.value='late paragraph arrives';const t=performance.now();q.dispatchEvent(new Event('input'));const ms=performance.now()-t,count=document.querySelector('#find-count').textContent;
     p.firstChild.data='a late paragraph changes';q.dispatchEvent(new Event('input'));const changed=document.querySelector('#find-count').textContent;
     p.remove();q.dispatchEvent(new Event('input'));const removed=document.querySelector('#find-count').textContent;
     q.value='observation for section 399 waits';q.dispatchEvent(new Event('input'));return {ms,count,changed,removed};});
   assert.deepEqual([late.count,late.changed,late.removed],['1 / 1','0 / 0','0 / 0'],'added, edited and removed article text invalidates find\'s projection');
   timings.rebuild=Math.round(late.ms);
   // The hits are the very ranges the per-character projection gave (the code before #35), emoji and all.
   const same=await page.evaluate(queries=>{const q=document.querySelector('#find-query'),article=document.querySelector('#article'),out=[];
     const skip='.annotation-pin,[data-reader-decoration],script,style',walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT,{acceptNode(node){const hit=node.parentElement?.closest(skip);return hit&&article.contains(hit)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}});
     let text='',nodes=[],offsets=[],node;while((node=walker.nextNode()))for(let i=0;i<node.data.length;i++){text+=node.data[i];nodes.push(node);offsets.push(i);}
     let normalized='',starts=[],ends=[];for(const match of text.matchAll(/\s+|\S/gu)){const space=/\s/u.test(match[0]);normalized+=space?' ':match[0];const last=match.index+match[0].length-1;
       for(let k=0;k<(space?1:match[0].length);k++){starts.push([nodes[match.index+k],offsets[match.index+k]]);ends.push([nodes[last],offsets[last]+1]);}}
     for(const query of queries){q.value=query;q.dispatchEvent(new Event('input'));const got=[...CSS.highlights.get('reader-find')],regex=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
       const want=[...normalized.matchAll(regex)].slice(0,2000).map(m=>[starts[m.index],ends[m.index+m[0].length-1]]);
       out.push(got.length===want.length&&got.every((r,i)=>r.startContainer===want[i][0][0]&&r.startOffset===want[i][0][1]&&r.endContainer===want[i][1][0]&&r.endOffset===want[i][1][1])?got.length:`${query}: ${got.length} vs ${want.length}`);}
     q.value='observation for section 399 waits';q.dispatchEvent(new Event('input'));return out;},['e','🐈','section 39','. ','observation for section 399 waits']);
   assert.ok(same.every(n=>typeof n==='number')&&same[0]===2000&&same[1]>0,'find hits match the per-character projection: '+same.join(', '));
   assert.ok(timings.keystroke<KEYSTROKE_MS,`a find keystroke took ${timings.keystroke} ms at the median (limit ${KEYSTROKE_MS}); all: ${keys.times.map(Math.round).join(' ')}`);
   await page.keyboard.press('Enter');
   // Resume: the saved position returns to the same late section after reopening.
   // Blocks far from the window have estimated heights (content-visibility), which settle once the scroll arrives; scroll again until it holds.
   await page.evaluate(async()=>{const h=[...document.querySelectorAll('#article h2')].find(h=>h.textContent==='Section 300');for(let i=0;i<5;i++){scrollTo(0,h.getBoundingClientRect().top+scrollY-innerHeight*.22+4);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,100))));if(Math.abs(h.getBoundingClientRect().top-(innerHeight*.22-4))<2)break;}});
   await page.waitForResponse(r=>r.url().includes('/api/bookmark')&&r.request().method()==='POST',{timeout:5000});
   await page.reload();timings.reopen=Math.round(await visible(page));
   const top=await page.evaluate(()=>{const h=[...document.querySelectorAll('#article h2')].find(h=>h.textContent==='Section 300');return h.getBoundingClientRect().top;});
   assert.ok(top>-40&&top<820*.4,'reopened at the saved section: '+top);
   assert.deepEqual(errors,[]);await context.close();}
  // Two-page reading paginates the whole document and turns pages.
  {const {context,page,errors}=await open({layout:'spread',smooth:false,pageTurn:'slide'});
   await page.goto(url+'#read='+encodeURIComponent(path));
   timings.spread=Math.round(await visible(page));
   assert.ok(timings.spread<FIRST_RENDER_MS,`two-page first render took ${timings.spread} ms (limit ${FIRST_RENDER_MS})`);
   assert.ok(await page.evaluate(()=>document.body.classList.contains('two-page')));
   const spreads=await page.evaluate(()=>{const v=document.querySelector('.book-viewport');return Math.round(v.scrollWidth/v.clientWidth);});
   assert.ok(spreads>50,'a 2 MB document spans many spreads: '+spreads);
   // The scroll-mode bookmark resumes at Section 300's spread; the next turn advances one spread.
   const before=await page.locator('#pagination-slot [aria-current=page]').textContent(),next=before.split('–').map(n=>String(+n+2)).join('–');
   assert.ok(+before.split('–')[0]>100,'two-page resume lands deep in the document: '+before);
   const section=await page.evaluate(()=>{const h=[...document.querySelectorAll('#article h2')].find(h=>h.textContent==='Section 300'),v=document.querySelector('.book-viewport').getBoundingClientRect(),r=h.getBoundingClientRect();return r.left>=v.left-2&&r.right<=v.right+2;});
   assert.ok(section,'the resumed spread shows the saved section');
   await page.locator('#main').focus();await page.keyboard.press('j');
   await page.waitForFunction(expected=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent===expected,next,{timeout:5000});
   assert.deepEqual(errors,[]);await context.close();}
  console.log(`Large-document benchmark passed (${(text.length/1e6).toFixed(1)} MB): first render ${timings.scroll} ms scroll / ${timings.spread} ms two-page (limit ${FIRST_RENDER_MS}), diagrams drawn by ${timings.diagrams} ms, find ${timings.find} ms, find keystroke median ${timings.keystroke} ms / max ${timings.keystrokeMax} ms (limit ${KEYSTROKE_MS}), find after a text change ${timings.rebuild} ms, reopen ${timings.reopen} ms; exact anchors, batched images, late diagrams, annotation, resume and pagination.`);
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
