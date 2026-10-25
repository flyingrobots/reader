/* Large-document regression benchmark: a ~2 MB synthetic Markdown document must render, anchor and paginate promptly. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
// Generous ceilings: the quadratic anchoring this guards against took well over 10 s on this fixture.
const FIRST_RENDER_MS=+(process.env.READER_PERF_FIRST_RENDER_MS||5000),FIND_MS=+(process.env.READER_PERF_FIND_MS||2500);
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
   await page.keyboard.press('Enter');
   // Resume: the saved position returns to the same late section after reopening.
   await page.evaluate(()=>{const h=[...document.querySelectorAll('#article h2')].find(h=>h.textContent==='Section 300');scrollTo(0,h.getBoundingClientRect().top+scrollY-innerHeight*.22+4);});
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
  console.log(`Large-document benchmark passed (${(text.length/1e6).toFixed(1)} MB): first render ${timings.scroll} ms scroll / ${timings.spread} ms two-page (limit ${FIRST_RENDER_MS}), diagrams drawn by ${timings.diagrams} ms, find ${timings.find} ms, reopen ${timings.reopen} ms; exact anchors, batched images, late diagrams, annotation, resume and pagination.`);
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
