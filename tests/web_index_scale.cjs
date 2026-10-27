/* Index budgets on Reader Admin's Indexes cards, other inventories, and a rebuild stopped at its time limit. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--index-scale'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  await page.goto(url+'#admin/indexes');await page.locator('#backstage-indexes').waitFor();
  const fact=(index,label)=>page.locator(`[data-index=${index}] [data-fact="${label}"] dd`);
  await page.locator('[data-index=search][data-state=partial]').waitFor({timeout:20000});
  assert.match(await fact('search','Passages').textContent(),/^\d+ of 1,000$/);
  assert.match(await fact('search','Database').textContent(),/^\d+(\.\d)? of 64 MiB$/);
  assert.match(await fact('search','Embedding cache').textContent(),/ of 32 MiB$/);
  assert.equal(await fact('search','Machine files').textContent(),'1 indexed by path only');
  await page.locator('[data-index=limits][data-state=ok]').waitFor();
  assert.equal(await fact('limits','Works').textContent(),'2 of 10,000');
  assert.equal(await fact('limits','Inbox files').textContent(),'0 of 10,000');
  assert.equal(await fact('limits','Annotation threads').textContent(),'1 of 5,000');
  assert.equal(await page.locator('[data-index=limits] [data-job]').count(),0,'the inventories card has no actions');
  const legacy=page.locator('[data-index=search] [data-legacy=retired]');
  assert.match(await legacy.textContent(),/^Old search index \(format 1, no longer read\): \d+ MB · Remove$/);
  await page.screenshot({path:'.reader/web-dev/index-scale.png',fullPage:true});
  await page.locator('[data-job=search]').click();
  const toast=page.locator('[data-sonner-toast]').filter({hasText:'Search index (with embeddings) finished'});
  await toast.waitFor({timeout:10000});
  assert.match(await toast.textContent(),/Stopped at the time limit; 18,400 passages saved\. Run again to continue\./);
  await page.locator('.backstage-jobs li[data-job-state=succeeded]').filter({hasText:'Run again to continue'}).waitFor();
  // Removal is explicit: one click runs the guarded job, and the note goes away.
  await page.locator('[data-job="remove-legacy-search"]:not([disabled])').waitFor();await page.locator('[data-job="remove-legacy-search"]').click();
  const removed=page.locator('[data-sonner-toast]').filter({hasText:'Remove legacy search index finished'});
  await removed.waitFor({timeout:10000});assert.match(await removed.textContent(),/Removed the format 1 index; \d+ MB freed\./);
  await legacy.waitFor({state:'detached',timeout:15000});
  for(const theme of ['ink','orchid-dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    const contrast=await page.locator('[data-index=search] [data-fact=Passages] dd').evaluate(el=>getComputedStyle(el).color!==getComputedStyle(el.closest('.backstage-card')).backgroundColor);
    assert.ok(contrast,'facts stay readable in '+theme);}
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  await context.close();
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Index scale passed: passage, database and cache budgets, machine files by path only, other inventories, legacy index note and explicit removal, stopped-at-time-limit toast and run summary, themes, phone width, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
