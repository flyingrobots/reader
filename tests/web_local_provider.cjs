/* Reader Admin · Models: the local model with any OpenAI-compatible provider: presets, discovery, "start it yourself", a run on fake Ollama, llama.cpp, the remote opt-in and its notice, the API key never shown, phone width. Fake servers only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--local-model','--local-provider'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,providers}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/status of 400/.test(m.text()))errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  const toast=text=>page.locator('[data-sonner-toast]').filter({hasText:text});
  const status=()=>page.evaluate(async()=>(await fetch('/api/local-model')).json());
  const choosePreset=async label=>{await page.locator('#lm-preset').click();await page.getByRole('option',{name:label,exact:true}).click();};
  const saveProvider=async()=>{await page.locator('#lm-provider-save:not([disabled])').click();};
  await page.goto(url+'#admin/models');await page.locator('#local-model').waitFor();
  // The default provider is LM Studio on loopback, with its lms extras.
  await page.locator('.lm-provider[data-provider=lmstudio]').waitFor();
  assert.equal(await page.locator('#lm-provider-scope').textContent(),'This machine only');
  assert.equal(await page.locator('#lm-base-url').inputValue(),(await status()).provider.base_url);
  assert.match(await page.locator('.lm-server [data-slot=card-title]').textContent(),/^LM Studio server$/);
  assert.equal(await page.locator('#lm-remote-notice').count(),0);
  // Ollama preset: its default URL fills in; with nothing on that port the server card says to start it yourself (no Start button).
  await choosePreset('Ollama');
  assert.equal(await page.locator('#lm-base-url').inputValue(),'http://127.0.0.1:11434/v1');
  await page.locator('#lm-model').fill('llama3.2:3b');
  await saveProvider();await toast('Local-model settings saved.').waitFor();
  await page.locator('.lm-server[data-provider=ollama][data-server-state=off]').waitFor();
  assert.equal(await page.locator('#lm-server-state').textContent(),'Not reachable');
  assert.match(await page.locator('#lm-start-yourself').textContent(),/start it yourself.*ollama serve.*ollama pull/s);
  assert.equal(await page.locator('#lm-server-start').count(),0,'no Start button for a server Reader does not control');
  assert.equal(await page.locator('.lm-server [data-slot=card-title]').textContent(),'Ollama server');
  // Point it at the fake Ollama: discovery through GET /v1/models, no Load buttons.
  await page.locator('#lm-base-url').fill(providers.ollama);await saveProvider();
  await page.locator('.lm-server[data-server-state=ready]').waitFor({timeout:10000});
  assert.equal(await page.locator('#lm-server-state').textContent(),'Ready · 2 models');
  assert.deepEqual(await page.locator('.lm-models li').evaluateAll(els=>els.map(e=>e.dataset.model)),['llama3.2:3b','nomic-embed-text:latest']);
  assert.equal(await page.locator('[data-load],[data-unload]').count(),0);
  assert.deepEqual(await page.locator('#lm-model-options option').evaluateAll(els=>els.map(e=>e.value)),['llama3.2:3b'],'model suggestions from discovery');
  // The provider's embedding models are offered for search, named by provider.
  await page.locator('#lm-embedding').click();
  await page.getByRole('option',{name:'nomic-embed-text:latest (Ollama)'}).waitFor();
  await page.keyboard.press('Escape');
  // A run against Ollama: queue, Run, one batch toast, outputs marked with the Ollama model.
  await page.locator('[data-enqueue=standfirst][data-scope=recent]').click();
  await toast('Queued 5 items').waitFor();
  await page.locator('[data-run=standfirst]:not([disabled])').click();
  await toast('Local model finished').waitFor({timeout:30000});
  assert.match(await toast('Local model finished').textContent(),/Standfirsts: 4 done, 1 rejected/);
  await page.waitForFunction(()=>document.querySelectorAll('.lm-items li[data-item-state=done]').length===4);
  assert.match(await page.locator('.lm-items li[data-item-state=done]').first().textContent(),/llama3\.2:3b/);
  // llama.cpp: one served model, from its mixed models/data listing.
  await choosePreset('llama.cpp');
  assert.equal(await page.locator('#lm-base-url').inputValue(),'http://127.0.0.1:8080/v1');
  await page.locator('#lm-base-url').fill(providers.llamacpp);await page.locator('#lm-model').fill('models/tiny-q4_k_m.gguf');await saveProvider();
  await page.locator('.lm-server[data-provider=llamacpp][data-server-state=ready]').waitFor({timeout:10000});
  assert.equal(await page.locator('#lm-server-state').textContent(),'Ready · 1 model');
  // A URL on another machine is refused until the opt-in is on, and the form warns before saving.
  await choosePreset('Other OpenAI-compatible server');
  await page.locator('#lm-base-url').fill('http://192.0.2.10:11434/v1');await page.locator('#lm-model').fill('llama3.2:3b');
  await page.locator('#lm-remote-warning.lm-remote-refused').waitFor();
  await saveProvider();
  await toast('Local model: that didn’t work').waitFor();
  assert.match(await toast('Local model: that didn’t work').textContent(),/not a loopback address/);
  assert.equal((await status()).provider.preset,'llamacpp','a refused URL changes nothing');
  await page.locator('.lm-provider [data-slot=switch]').click();
  assert.match(await page.locator('#lm-remote-warning').textContent(),/leave this machine/);
  await saveProvider();await toast('Local-model settings saved.').nth(0).waitFor();
  await page.locator('#lm-remote-notice').waitFor({timeout:10000});
  assert.equal(await page.locator('#lm-remote-notice').textContent(),'Text leaves this machine. Document text and prompts are sent to 192.0.2.10. They leave this machine, unencrypted over http.');
  assert.equal(await page.locator('#lm-provider-scope').textContent(),'Leaves this machine');
  await page.locator('.lm-server[data-server-state=ready]').waitFor({timeout:10000});
  assert.match(await page.locator('.lm-now').textContent(),/sent to the remote provider/);
  // An API key is saved but never comes back to the page.
  const secret='sk-fixture-'+'z'.repeat(24);
  await page.locator('#lm-api-key').fill(secret);await saveProvider();
  await page.waitForFunction(()=>document.querySelector('#lm-api-key')?.getAttribute('placeholder')==='Saved · type to replace');
  assert.equal(await page.locator('#lm-api-key').inputValue(),'','the field empties after saving');
  const body=JSON.stringify(await status());
  assert.ok(!body.includes(secret),'the key is never in the status');assert.ok(!(await page.content()).includes(secret),'nor in the page');
  assert.deepEqual((await status()).provider.api_key,{set:true,source:'file',env:'READER_LLM_API_KEY'});
  await page.locator('#local-model').screenshot({path:'.reader/web-dev/local-provider-remote.png'});
  await page.locator('#lm-api-key-clear').click();
  await page.waitForFunction(()=>document.querySelector('#lm-api-key')?.getAttribute('placeholder')==='Most local servers need none');
  // Phone width: no horizontal scroll with the long URL and notice.
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  await page.locator('#local-model').screenshot({path:'.reader/web-dev/local-provider-phone.png'});
  // Back to this machine: turning the opt-in off with a remote URL is refused; returning to LM Studio clears the notice.
  await page.setViewportSize({width:1300,height:900});
  await choosePreset('LM Studio');await page.locator('.lm-provider [data-slot=switch]').click();await saveProvider();
  await page.locator('.lm-provider[data-provider=lmstudio][data-remote=false]').waitFor({timeout:10000});
  assert.equal(await page.locator('#lm-remote-notice').count(),0);
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await context.close();
  console.log('Local provider passed: LM Studio default, Ollama preset URL and start-it-yourself guidance, discovery from /v1/models without lms controls, a run on fake Ollama, llama.cpp listing, remote refused then opted in with the notice and badge, API key saved but never shown, phone width, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
