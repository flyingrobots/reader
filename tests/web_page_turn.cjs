/* Two-page reading: the Three.js page turn, its fallbacks and the blank facing page. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {waitFor,watch,sanitizerReport}=require('./web_wait.cjs');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async(reducedMotion,prefs,path)=>{const context=await browser.newContext({viewport:{width:1300,height:820},reducedMotion});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({layout:'spread',smooth:false,theme:'paper',...prefs}));
    const page=await context.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!sanitizerReport(m))errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
    watch(page);await page.goto(url+'#read='+encodeURIComponent(path));
    // #76: say which half is missing when a loaded machine is slow to lay out the spread or to resume.
    await waitFor(page,'two-page layout, resumed',()=>({twoPage:document.body.classList.contains('two-page'),resumed:!document.querySelector('.resume-pending'),article:!!document.querySelector('#article p')}));
    return {page,errors,external,context};};
  const current=page=>page.locator('#pagination-slot [aria-current=page]').textContent();
  // A turn lasts 900 ms of animation, which a loaded machine can spend in a frame or two, so a poll can miss the sheet.
  // Record it instead: the page notes the sheet and the turning class the moment they appear, and the check reads that.
  const record=page=>page.evaluate(()=>{const seen=window.__turn={sheet:false,turning:false};window.__turnObserver?.disconnect();
    (window.__turnObserver=new MutationObserver(()=>{seen.sheet||=!!document.querySelector('.page-turn-canvas');seen.turning||=document.body.classList.contains('page-turning');}))
      .observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});});
  const turned=(page,label,expected)=>waitFor(page,label,expected=>({done:!document.querySelector('.page-turn-canvas')&&!document.body.classList.contains('page-turning'),page:document.querySelector('#pagination-slot [aria-current=page]')?.textContent===expected,_page:document.querySelector('#pagination-slot [aria-current=page]')?.textContent}),{arg:expected,timeout:3000});
  // A one-page document keeps its facing page empty.
  {const {page,errors,context}=await open('no-preference',{},'library/other.md');
   const layout=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect();const text=[...document.querySelectorAll('#article > *')].flatMap(el=>[...el.getClientRects()]).filter(r=>r.width>0);return {half:v.left+v.width/2,right:Math.max(...text.map(r=>r.right)),left:Math.min(...text.map(r=>r.left)),vleft:v.left};});
   assert.ok(layout.right<layout.half,'content stays on the left page; the facing page is empty');assert.ok(Math.abs(layout.left-layout.vleft)<2,'single page is not centered');
   assert.equal(await current(page),'1');await page.screenshot({path:'.reader/web-dev/page-turn-single.png'});assert.deepEqual(errors,[]);await context.close();}
  // The 3D turn: overlay during the turn, real DOM after; forward, backward, rapid presses.
  {const {page,errors,external,context}=await open('no-preference',{},'library/thought.md');
   await page.waitForFunction(()=>import('/assets/controls/page-turn.js').then(()=>true));await page.waitForTimeout(200);
   assert.equal(await current(page),'1–2');
   await page.locator('#main').focus();await record(page);await page.keyboard.press('j');
   await page.screenshot({path:'.reader/web-dev/page-turn-mid.png'});
   await turned(page,'forward turn to 3–4','3–4');assert.deepEqual(await page.evaluate(()=>window.__turn),{sheet:true,turning:true},'WebGL sheet is drawn mid-turn');
   await record(page);await page.keyboard.press('k');
   await turned(page,'backward turn to 1–2','1–2');assert.deepEqual(await page.evaluate(()=>window.__turn),{sheet:true,turning:true},'backward turn uses the sheet too');
   await page.keyboard.press('j');await page.waitForTimeout(120);await page.keyboard.press('j');
   await turned(page,'a second press finishes the first turn and starts the next','5–6');
   await record(page);await page.locator('#pagination-slot [aria-label="Pages 1–2"]').click();await turned(page,'the jump back to 1–2','1–2');
   assert.equal((await page.evaluate(()=>window.__turn)).sheet,false,'multi-spread jumps slide');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}
  // Slide preference and reduced motion never create the overlay.
  for(const [motion,prefs] of [['no-preference',{pageTurn:'slide'}],['reduce',{}]]){
   const {page,errors,context}=await open(motion,prefs,'library/thought.md');
   // The book opens at the last saved place, which an earlier context's late save can move: wait for the spread to hold
   // still before reading it, then turn from there.
   await page.evaluate(()=>{const v=document.querySelector('.book-viewport'),s=window.__still={x:-1,n:0};const tick=()=>{s.n=v.scrollLeft===s.x?s.n+1:0;s.x=v.scrollLeft;if(s.n<3)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
   await waitFor(page,'the spread holds still',()=>({still:(window.__still?.n||0)>=3}),{timeout:10000});
   const before=await current(page),next=before.split('–').map(n=>String(+n+2)).join('–');
   await page.locator('#main').focus();await record(page);await page.keyboard.press('j');
   await turned(page,'j turns to '+next,next);assert.equal((await page.evaluate(()=>window.__turn)).sheet,false,JSON.stringify(prefs)+motion);assert.deepEqual(errors,[]);await context.close();}
  console.log('Page turn passed: blank facing page, WebGL sheet forward/backward, rapid presses, multi-spread slide, Slide and reduced-motion fallbacks, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
