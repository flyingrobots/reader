/* Reader Admin · Publish: upload, watch filing, and the privacy levels. A fake Codex only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {existsSync,readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--inbox'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu']});
  const page=await (await browser.newContext({viewport:{width:1300,height:1000},reducedMotion:'reduce'})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const inbox=()=>readdirSync(join(root,'inbox')).filter(name=>/^[0-9a-f-]{36}$/.test(name));
  const before=inbox();
  await page.goto(url+'#admin/publish');await page.locator('#backstage-publish').waitFor();
  const stage=value=>page.locator(`#backstage-publish[data-publish-stage=${value}]`).waitFor({timeout:30000});
  const choose=(name,text)=>page.locator('#publish-files').setInputFiles({name,mimeType:'text/markdown',buffer:Buffer.from(text)});
  // Nothing can be sent until a file is chosen. The title comes from its name, and the safe level is already selected.
  assert.equal(await page.locator('#publish-submit').isDisabled(),true);
  await choose('a-private-memo.md','# A private memo\n');
  assert.equal(await page.locator('#publish-title').inputValue(),'a private memo');
  assert.equal(await page.locator('input[name=publish-level]:checked').inputValue(),'no-cloud');
  assert.equal(await page.locator('input[name=publish-level][value=machine-only]').isDisabled(),true);
  assert.match(await page.locator('#publish-summary').textContent(),/1 file/);
  // No cloud models, with only a fake cloud model in the order: it stays in the inbox, and the page says why.
  await page.locator('#publish-submit').click();
  await stage('stopped');
  await page.locator('#publish-note').waitFor();
  assert.match(await page.locator('#publish-steps').textContent(),/Uploaded/);
  assert.match(await page.locator('#publish-steps').textContent(),/No permitted model/);
  assert.match(await page.locator('#publish-note').textContent(),/stays safely in the inbox/);
  const added=inbox().filter(name=>!before.includes(name));
  assert.equal(added.length,1);
  const receipt=JSON.parse(readFileSync(join(root,'inbox',added[0],'receipt.json'),'utf8'));
  assert.equal(receipt.provenance.privacy,'no-cloud');assert.equal(receipt.provenance.uploaded_by,'browser on this machine');
  assert.ok(existsSync(join(root,'inbox',added[0],'a-private-memo.md')));
  // Everything already waiting stayed where it was.
  for(const name of before)assert.ok(existsSync(join(root,'inbox',name)),name);
  assert.ok(existsSync(join(root,'inbox/loose-note.md')));
  // Normal, with the fake model answering: filed and committed, and the other uploads are still waiting.
  await choose('a-public-note.md','# A public note\n');
  await page.locator('input[name=publish-level][value=normal]').check();
  await page.locator('#publish-submit').click();
  await stage('filed');
  assert.match(await page.locator('#publish-note').textContent(),/Filed and committed to library\//);
  assert.match(await page.locator('#publish-steps').textContent(),/Asking Codex/);
  assert.ok(existsSync(join(root,'inbox',added[0],'a-private-memo.md')),'the deferred upload stayed');
  // Too large for the page to send.
  await page.locator('#publish-files').setInputFiles({name:'huge.md',mimeType:'text/markdown',buffer:Buffer.alloc(33*1024*1024)});
  await page.locator('#publish-problem').waitFor();
  assert.equal(await page.locator('#publish-submit').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Publish passed: upload, safe default, refused level, no-cloud stays queued, others untouched, size refusal.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null)fixture.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
