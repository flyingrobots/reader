/* Reader Admin · Models (local model): server card, load, queue counts, streaming preview, batch toast, Recent reasons, phone width. Fake LM Studio only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--local-model'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'user-reader-test'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  const toast=text=>page.locator('[data-sonner-toast]').filter({hasText:text});
  await page.goto(url+'#admin/models');await page.locator('#local-model').waitFor();
  // Server card: off, then Start goes to Ready, then a model loads.
  const card=page.locator('[data-lm=server]');
  await page.locator('[data-lm=server][data-server-state=off]').waitFor();
  assert.equal(await page.locator('#lm-server-state').textContent(),'Server off');
  assert.equal(await page.locator('[data-lm=models] [data-model]').count(),3,'models on disk from lms ls');
  assert.ok(await page.locator('[data-load="google/gemma-4-e4b"]').isDisabled(),'Load waits for the server');
  await page.locator('#lm-server-start').click();
  await page.locator('[data-lm=server][data-server-state=ready]').waitFor({timeout:15000});
  assert.equal(await page.locator('#lm-server-state').textContent(),'Ready · no model loaded');
  await page.locator('[data-load="google/gemma-4-e4b"]:not([disabled])').click();
  await page.locator('[data-model="google/gemma-4-e4b"][data-loaded=true]').waitFor({timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#lm-server-state')?.textContent==='Ready · 1 model loaded');
  assert.match(await card.textContent(),/4\.1 GB/,'memory of the loaded model');
  // Stop asks for confirmation first.
  await page.locator('#lm-server-stop').click();await page.locator('#lm-server-stop-confirm').waitFor();
  await page.getByRole('button',{name:'Keep running'}).click();await page.locator('#lm-server-stop').waitFor();
  // Enqueue standfirsts: queue counts by task.
  await page.locator('[data-enqueue=standfirst][data-scope=recent]').click();
  await toast('Queued 5 items').waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-queue=standfirst] [data-lm=count]')?.textContent==='5 waiting');
  // Queue recent again: nothing further back is added.
  await page.locator('[data-enqueue=standfirst][data-scope=recent]').click();
  await toast('Nothing new to queue; 5 already current or waiting.').waitFor();
  assert.equal(await page.locator('[data-queue=standfirst] [data-lm=count]').textContent(),'5 waiting');
  assert.equal(await page.locator('[data-queue=keyterms] [data-lm=count]').textContent(),'0 waiting');
  // Run: a loading toast, the Now card with a streaming preview and the machine mark.
  await page.locator('[data-run=standfirst]').click();
  await toast('Local model running…').waitFor();assert.equal(await toast('Local model running…').getAttribute('data-type'),'loading');
  await page.locator('[data-lm=now][data-now=running]').waitFor({timeout:10000});
  await page.locator('#lm-preview p:not(.lm-thinking)').waitFor({timeout:10000});
  const first=await page.locator('#lm-preview p').textContent();
  await page.waitForFunction(before=>document.querySelector('#lm-preview p')?.textContent!==before,first,{timeout:5000});
  assert.equal(await page.locator('#lm-preview .lm-mark').textContent(),'local model · gemma-4-e4b');
  assert.ok(await page.locator('#lm-preview').evaluate(el=>el.hasAttribute('data-reader-decoration')));
  assert.ok(await page.locator('#lm-pause').isVisible()&&await page.locator('#lm-cancel').isVisible());
  await page.locator('[data-lm=server][data-server-state=busy]').waitFor();
  await page.locator('#local-model').screenshot({path:'.reader/web-dev/local-model-running.png'});
  // One batch toast for the run, not one per item.
  await toast('Local model finished').waitFor({timeout:30000});
  assert.match(await toast('Local model finished').textContent(),/Standfirsts: 4 done, 1 rejected/);
  assert.equal(await page.locator('[data-sonner-toast]').filter({hasText:'Standfirsts:'}).count(),1);
  await page.locator('[data-lm=now][data-now=idle]').waitFor();
  // Recent: outcomes, and a rejected item shows its reason, output and mark.
  await page.waitForFunction(()=>document.querySelectorAll('[data-lm=items] [data-item]').length===5);
  assert.equal(await page.locator('[data-lm=items] [data-item-state=done]').count(),4);
  const rejected=page.locator('[data-lm=items] [data-item-state=rejected]');
  assert.match(await rejected.textContent(),/An invented claim.*Rejected by validation/);
  await rejected.locator('[data-lm=item-trigger]').click();
  await rejected.locator('[data-lm=reason]').waitFor();
  assert.equal(await rejected.locator('[data-lm=reason]').textContent(),'Rejected: Number “1999” is not in the source');
  assert.match(await rejected.locator('.lm-output').textContent(),/Zanzibar reports 1999.*local model · gemma-4-e4b/);
  assert.match(await rejected.textContent(),/standfirst-v1/);
  // Outputs in use count the four accepted standfirsts, with samples marked.
  await page.waitForFunction(()=>document.querySelector('[data-outputs=standfirst] [data-current]')?.textContent==='4',null,{timeout:40000});
  assert.ok(await page.locator('[data-outputs=standfirst] [data-lm=sample] .lm-mark').first().isVisible());
  // Reader loaded nothing itself here (the model was already loaded), so it stays loaded.
  assert.equal(await page.locator('[data-model="google/gemma-4-e4b"]').getAttribute('data-loaded'),'true');
  // The magazine cover uses a current local-model standfirst after an authored one and before the opening paragraph, with its mark.
  const served=await page.evaluate(async()=>(await fetch('/api/standfirst?path=library/lm-0.md')).json());
  assert.equal(served.source,'local-model');assert.equal(served.model,'google/gemma-4-e4b');
  await page.goto(url+'#issue=2026-W43');await page.locator('.issue-cover').waitFor();
  const machine=page.locator('[data-standfirst="library/lm-0.md"][data-source=local-model]');
  await machine.waitFor({timeout:10000});
  assert.equal(await machine.textContent(),served.standfirst);
  const mark=page.locator('[data-standfirst="library/lm-0.md"] + .issue-machine-mark');
  assert.equal(await mark.textContent(),'local model · gemma-4-e4b');
  assert.ok(await mark.evaluate(el=>el.hasAttribute('data-reader-decoration')&&el.checkVisibility()));
  assert.equal(await page.locator('.issue-machine-mark').count(),await page.locator('[data-standfirst][data-source=local-model]').count(),'every machine standfirst is marked');
  await page.locator('.issue-cover').screenshot({path:'.reader/web-dev/local-model-cover.png'});
  await page.goto(url+'#admin/models');await page.locator('#local-model').waitFor();
  // Settings: turning a task off disables its queue buttons.
  await page.locator('[data-setting=keyterms] [data-slot=switch]').click();await page.locator('#lm-settings-form button[type=submit]').click();
  await toast('Local-model settings saved.').waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-enqueue=keyterms]')?.disabled===true);
  await page.locator('#local-model').screenshot({path:'.reader/web-dev/local-model.png'});
  // Phone width: no horizontal scroll.
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  await page.locator('#local-model').screenshot({path:'.reader/web-dev/local-model-phone.png'});
  // Stopping the server: confirm, then Server off.
  await page.setViewportSize({width:1300,height:900});
  await page.locator('#lm-server-stop').click();await page.locator('#lm-server-stop-confirm').click();
  await page.locator('[data-lm=server][data-server-state=off]').waitFor({timeout:15000});
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await context.close();
  console.log('Local model passed: server off → Start → Ready, load with memory, stop confirmation, queue counts by task, streaming preview with mark, loading and one batch toast, Recent outcomes and rejection reason, outputs in use, the marked local-model standfirst on the cover, task settings, phone width, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
