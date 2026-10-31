/* Resilience: partial metadata loads margins; secondary-request failures keep the article; assets survive concurrency. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--resilience'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const errors=[];
  const open=async(prefs={})=>{const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',layout:'scroll',...prefs}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,context};};
  const toast=(page,text)=>page.locator('[data-sonner-toast]').filter({hasText:text});
  // A versioned header without `type` opens with its margins and no error toast.
  {const {page,context}=await open();const statuses=[];
   page.on('response',r=>{if(r.url().includes('/api/discussion'))statuses.push(r.status());});
   await page.goto(url+'#read='+encodeURIComponent('library/versioned.md'));
   await page.getByRole('heading',{name:'A versioned note'}).waitFor();
   await page.waitForResponse(r=>r.url().includes('/api/seen')).catch(()=>{});
   await page.waitForTimeout(300);
   assert.deepEqual(statuses,[200],'discussion loads for partial metadata');
   assert.equal(await page.locator('text=Document unavailable').count(),0);
   assert.equal(await page.locator('[data-sonner-toast][data-type=error]').count(),0);
   await context.close();}
  // Failing secondary requests keep the rendered article and show a quiet toast.
  {const {page,context}=await open();
   await page.route(/\/api\/discussion\?/,route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Synthetic margin failure'})}));
   await page.route(/\/api\/seen$/,route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic read-mark failure'})}));
   await page.route(/\/api\/next\?/,route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Synthetic next failure'})}));
   // Every other secondary request fails too: versions, what changed, reading log, links, queue/history, prose, images and embeds.
   for(const pattern of [/\/api\/versions\?/,/\/api\/changes\?/,/\/api\/readers\?/,/\/api\/links\?/,/\/api\/history/,/\/api\/queue\?/,/\/api\/prose/,/\/api\/resolve-batch\?/])
     await page.route(pattern,route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic secondary failure'})}));
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));
   await toast(page,'Margins could not load: Synthetic margin failure').waitFor();
   await toast(page,'Read mark could not load: Synthetic read-mark failure').waitFor();
   assert.notEqual(await toast(page,'Synthetic margin failure').getAttribute('data-type'),'error','quiet, not an error toast');
   await page.waitForTimeout(300);
   assert.equal(await page.locator('text=Document unavailable').count(),0,'article is not replaced');
   assert.ok(await page.locator('#article').isVisible());
   assert.ok((await page.locator('#article').textContent()).includes('The distinct observation for chapter 44'));
   assert.equal(await page.locator('#main .next-reads').count(),0);
   // The document itself failing still reports it as unavailable.
   await page.route(/\/api\/document\?/,route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Synthetic document failure'})}));
   await page.evaluate(()=>{location.hash='#read='+encodeURIComponent('library/other.md');});
   await page.getByRole('heading',{name:'Document unavailable'}).waitFor();
   await context.close();}
  // Many concurrent asset and read requests are never refused with 429.
  {const {page,context}=await open();await page.goto(url);await page.locator('#home-title').waitFor();
   const statuses=await page.evaluate(async()=>{const paths=['/','/assets/app.mjs','/assets/style.css','/assets/reading.mjs','/api/library','/api/document?path=library%2Fthought.md'];
     return Promise.all(Array.from({length:48},(_,i)=>fetch(paths[i%paths.length],{cache:'no-store'}).then(r=>r.status)));});
   assert.deepEqual([...new Set(statuses)],[200]);
   await context.close();}
  assert.deepEqual(errors,[],'no page errors');
  console.log('web resilience checks passed');
 }finally{await browser?.close();fixture.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
