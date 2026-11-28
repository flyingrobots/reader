/* Real browser → Reader API → synthetic LM Studio. No live model or library. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--local-model'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter']});
  const page=await browser.newPage({viewport:{width:1200,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'#admin/voices');
  await page.locator('#lm-model').waitFor({timeout:10000});
  await page.locator('#lm-model').fill('qwen3.6-27b-mtp');
  await page.locator('#lm-provider-save').click();
  await page.waitForFunction(async()=>{
    const status=await (await fetch('/api/local-model')).json();
    return status.settings.provider.model==='qwen3.6-27b-mtp';
  });
  const filing=page.locator('[data-lm=model-order]');await filing.waitFor();
  await filing.locator('[data-provider=local] [data-slot=switch]').click();
  const firstSave=page.waitForResponse(response=>response.url().endsWith('/api/model-chain')&&response.request().method()==='POST');
  await filing.locator('#model-order-save').click();
  await (await firstSave).finished();
  await page.waitForFunction(()=>{
    const button=document.querySelector('#model-order-save');
    return button?.disabled&&button.textContent==='Save filing models';
  });
  await page.waitForFunction(async()=>!(await (await fetch('/api/model-chain')).json()).config.order.includes('local'));
  await filing.locator('[data-provider=local] [data-slot=switch]').click();
  await filing.locator('#model-order-save').click();
  await page.waitForFunction(async()=>(await (await fetch('/api/model-chain')).json()).config.order.includes('local'));
  const card=page.locator('[data-lm=sanity-check]');await card.waitFor();
  mkdirSync('.reader/web-dev',{recursive:true});
  await page.screenshot({path:'.reader/web-dev/voices-local-llm.png',fullPage:true});
  await page.locator('[data-lm=server][data-server-state=off]').waitFor();
  await card.getByLabel('Message',{exact:true}).fill('Hello');
  await card.getByRole('button',{name:'Send to selected LLM'}).click();
  await card.locator('[data-slot=message]').filter({hasText:'Hello.'}).waitFor({timeout:30000});
  assert.match(await card.locator('[data-lm=sanity-output]').textContent(),/Starting the local model/);
  assert.match(await card.locator('[data-lm=sanity-output]').textContent(),/Response:\s*Hello\./);
  await card.getByLabel('Message',{exact:true}).fill('Second question');
  await card.getByRole('button',{name:'Send to selected LLM'}).click();
  await card.locator('[data-slot=message]').filter({hasText:'Second question.'}).waitFor();
  assert.equal(await card.locator('[data-slot=message]').count(),4);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  mkdirSync('.reader/web-dev',{recursive:true});await card.screenshot({path:'.reader/web-dev/llm-check-phone.png'});
  await card.getByRole('button',{name:'New chat'}).click();
  assert.equal(await card.locator('[data-slot=message]').count(),0);
  await page.goto(url+'#admin/models');
  await page.waitForFunction(()=>document.querySelector('#lm-model')?.value==='qwen3.6-27b-mtp');
  await page.locator('[data-lm=sanity-check]').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Voices passed: provider save shared with Models, local fallback off/on, automatic startup, two chat turns, output, reset and phone width.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
