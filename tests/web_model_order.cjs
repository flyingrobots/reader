/* Reader Admin · Models: the filing model order and how the local model starts, saved through /api/model-chain. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--local-model'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu']});
  const page=await (await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const saved=()=>page.evaluate(async()=>(await fetch('/api/model-chain')).json());
  await page.goto(url+'#admin/models');
  const card=page.locator('[data-lm=model-order]');await card.waitFor();
  assert.deepEqual((await card.locator('[data-provider]').evaluateAll(rows=>rows.map(r=>r.dataset.provider))),['codex','claude','agy','local']);
  assert.equal(await page.locator('#model-order-save').isDisabled(),true);
  assert.equal(await page.locator('#model-order-command').count(),0,'the command appears only when chosen');
  // Turning a provider off keeps the prescribed order for the rest.
  await page.locator('[data-provider=claude] [data-slot=switch]').click();
  await page.locator('#model-order-save:not([disabled])').click();
  await page.waitForFunction(()=>document.querySelector('#model-order-save').disabled);
  assert.deepEqual((await saved()).config.order,['codex','agy','local']);
  // A command must be an absolute path; the server's refusal is shown and nothing is saved.
  await page.locator('#model-order-start').click();await page.getByRole('option',{name:'Run a command',exact:true}).click();
  await page.locator('#model-order-command').fill('start-model qwen');
  await page.locator('#model-order-save:not([disabled])').click();
  await page.locator('#model-order-error').filter({hasText:'absolute path'}).waitFor();
  assert.equal((await saved()).config.local.start,'lmstudio');
  await page.locator('#model-order-command').fill('/usr/local/bin/start-model qwen');await page.locator('#model-order-model').fill('some/model');
  await page.locator('#model-order-save:not([disabled])').click();
  await page.waitForFunction(()=>document.querySelector('#model-order-save').disabled);
  const local=(await saved()).config.local;
  assert.deepEqual(local,{start:'command',command:['/usr/local/bin/start-model','qwen'],model:'some/model'});
  assert.equal(await page.locator('#model-order-error').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Model order passed: prescribed order, provider switch, start modes, command refusal and argv save.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');}}
})().catch(error=>{console.error(error);process.exitCode=1;});
