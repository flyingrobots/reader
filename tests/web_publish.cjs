/* Reader Admin · Publish: upload, watch filing, and the privacy levels. A fake Codex only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {existsSync,readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--inbox'],{stdio:['ignore','pipe','inherit'],env:{...process.env,READER_INBOX:'.reader/inbox'}});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu']});
  const page=await (await browser.newContext({viewport:{width:1300,height:1000},reducedMotion:'reduce'})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // This suite runs with the default hidden inbox: the fixture's arrivals start in the old folder and get swept in.
  const hidden=join(root,'.reader/inbox');
  const inbox=()=>readdirSync(hidden).filter(name=>/^[0-9a-f-]{36}$/.test(name));
  await page.goto(url+'#admin/publish');await page.locator('#backstage-publish').waitFor();
  await page.evaluate(()=>fetch('/api/inbox').then(r=>r.json()));
  const before=inbox();assert.ok(before.length,'arrivals moved out of the old folder');
  assert.deepEqual(readdirSync(join(root,'inbox')).filter(name=>name!=='README.md'&&name!=='.DS_Store'),[]);
  const stage=value=>page.locator(`#backstage-publish[data-publish-stage=${value}]`).waitFor({timeout:30000});
  const choose=(name,text)=>page.locator('#publish-files').setInputFiles({name,mimeType:'text/markdown',buffer:Buffer.from(text)});
  // Nothing can be sent until a file is chosen. The title comes from its name, and the safe level is already selected.
  assert.equal(await page.locator('#publish-submit').isDisabled(),true);
  await choose('a-private-memo.md','# A private memo\n');
  assert.equal(await page.locator('#publish-title').inputValue(),'a private memo');
  assert.equal(await page.locator('input[name=publish-level]:checked').inputValue(),'no-cloud');
  assert.equal(await page.locator('input[name=publish-level][value=machine-only]').count(),1,'this browser is on the machine');
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
  const receipt=JSON.parse(readFileSync(join(hidden,added[0],'receipt.json'),'utf8'));
  assert.equal(receipt.provenance.privacy,'no-cloud');assert.equal(receipt.provenance.uploaded_by,'browser on this machine');
  assert.ok(existsSync(join(hidden,added[0],'a-private-memo.md')));
  // Everything already waiting stayed where it was.
  for(const name of before)assert.ok(existsSync(join(hidden,name)),name);
  assert.ok(existsSync(join(hidden,'loose-note.md')));
  // Normal, with the fake model answering: filed and committed, and the other uploads are still waiting.
  await choose('a-public-note.md','# A public note\n');
  await page.locator('input[name=publish-level][value=normal]').check();
  await page.locator('#publish-submit').click();
  await stage('filed');
  assert.match(await page.locator('#publish-note').textContent(),/Filed and committed to library\//);
  assert.match(await page.locator('#publish-steps').textContent(),/Asking Codex/);
  assert.ok(existsSync(join(hidden,added[0],'a-private-memo.md')),'the deferred upload stayed');
  // Too large for the page to send.
  await page.locator('#publish-files').setInputFiles({name:'huge.md',mimeType:'text/markdown',buffer:Buffer.alloc(33*1024*1024)});
  await page.locator('#publish-problem').waitFor();
  assert.equal(await page.locator('#publish-submit').isDisabled(),true);
  // Through a tailnet address the private API answers 404: no level or card, and a note says where to go.
  await page.locator('input[name=publish-level][value=machine-only]').waitFor({state:'attached'});assert.equal(await page.locator('#private-elsewhere').count(),0);
  const away=await page.context().newPage();await away.route('**/api/private',route=>route.fulfill({status:404,json:{error:'Not found'}}));
  await away.goto(url+'#admin/publish');await away.locator('#private-elsewhere').waitFor();
  assert.match(await away.locator('#private-elsewhere').textContent(),/127\.0\.0\.1/);
  assert.equal(await away.locator('input[name=publish-level][value=machine-only]').count(),0);assert.equal(await away.locator('[data-private]').count(),0);
  await away.close();
  // A delivery token is shown once, stored only as a hash, and can be revoked.
  await page.locator('#token-name').fill('My laptop');await page.locator('#token-create').click();
  const secret=await page.locator('#token-value').textContent();assert.match(secret,/^rdt_/);
  assert.equal(readFileSync(join(root,'.reader/delivery-tokens.json'),'utf8').includes(secret),false);
  const row=page.locator('[data-token="My laptop"]');await row.waitFor();
  await row.getByRole('button',{name:'Revoke'}).click();await page.locator('[data-confirm]').click();
  await row.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  console.log('Publish passed: upload, safe default, refused level, no-cloud stays queued, others untouched, size refusal, token create and revoke.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null)fixture.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
