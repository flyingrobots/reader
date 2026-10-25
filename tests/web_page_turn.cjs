/* Two-page reading: the Three.js page turn, its fallbacks and the blank facing page. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async(reducedMotion,prefs,path)=>{const context=await browser.newContext({viewport:{width:1300,height:820},reducedMotion});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({layout:'spread',smooth:false,theme:'paper',...prefs}));
    const page=await context.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
    await page.goto(url+'#read='+encodeURIComponent(path));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
    return {page,errors,external,context};};
  const current=page=>page.locator('#pagination-slot [aria-current=page]').textContent();
  const overlay=page=>page.evaluate(()=>!!document.querySelector('.page-turn-canvas'));
  // A one-page document keeps its facing page empty.
  {const {page,errors,context}=await open('no-preference',{},'library/other.md');
   const layout=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect();const text=[...document.querySelectorAll('#article > *')].flatMap(el=>[...el.getClientRects()]).filter(r=>r.width>0);return {half:v.left+v.width/2,right:Math.max(...text.map(r=>r.right)),left:Math.min(...text.map(r=>r.left)),vleft:v.left};});
   assert.ok(layout.right<layout.half,'content stays on the left page; the facing page is empty');assert.ok(Math.abs(layout.left-layout.vleft)<2,'single page is not centered');
   assert.equal(await current(page),'1');await page.screenshot({path:'.reader/web-dev/page-turn-single.png'});assert.deepEqual(errors,[]);await context.close();}
  // The 3D turn: overlay during the turn, real DOM after; forward, backward, rapid presses.
  {const {page,errors,external,context}=await open('no-preference',{},'library/thought.md');
   await page.waitForFunction(()=>import('/assets/controls/page-turn.js').then(()=>true));await page.waitForTimeout(200);
   assert.equal(await current(page),'1–2');
   await page.locator('#main').focus();await page.keyboard.press('j');
   await page.waitForTimeout(350);assert.ok(await overlay(page),'WebGL sheet is drawn mid-turn');assert.ok(await page.evaluate(()=>document.body.classList.contains('page-turning')));
   await page.screenshot({path:'.reader/web-dev/page-turn-mid.png'});
   await page.waitForFunction(()=>!document.querySelector('.page-turn-canvas'),null,{timeout:3000});assert.equal(await current(page),'3–4');
   await page.keyboard.press('k');await page.waitForTimeout(300);assert.ok(await overlay(page),'backward turn uses the sheet too');
   await page.waitForFunction(()=>!document.querySelector('.page-turn-canvas'),null,{timeout:3000});assert.equal(await current(page),'1–2');
   await page.keyboard.press('j');await page.waitForTimeout(120);await page.keyboard.press('j');
   await page.waitForFunction(()=>!document.querySelector('.page-turn-canvas'),null,{timeout:3000});assert.equal(await current(page),'5–6','a second press finishes the first turn and starts the next');
   await page.locator('#pagination-slot [aria-label="Pages 1–2"]').click();await page.waitForTimeout(150);assert.equal(await overlay(page),false,'multi-spread jumps slide');
   await page.waitForFunction(async()=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent==='1–2');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}
  // Slide preference and reduced motion never create the overlay.
  for(const [motion,prefs] of [['no-preference',{pageTurn:'slide'}],['reduce',{}]]){
   const {page,errors,context}=await open(motion,prefs,'library/thought.md');await page.waitForTimeout(300);
   const before=await current(page),next=before.split('–').map(n=>String(+n+2)).join('–');
   await page.locator('#main').focus();await page.keyboard.press('j');await page.waitForTimeout(200);assert.equal(await overlay(page),false,JSON.stringify(prefs)+motion);
   await page.waitForFunction(expected=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent===expected,next,{timeout:5000});assert.deepEqual(errors,[]);await context.close();}
  console.log('Page turn passed: blank facing page, WebGL sheet forward/backward, rapid presses, multi-spread slide, Slide and reduced-motion fallbacks, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
