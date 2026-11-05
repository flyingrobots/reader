/* Reader Admin · Publish: "This machine only", through the real pinned git-cas in a throwaway home. Installs it once. */
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {createInterface}=require('node:readline');
const {existsSync,mkdtempSync,readdirSync,readFileSync,rmSync,statSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const MARKER='ZQXMARKER4471PLAINTEXT',TITLE='SECRETTITLE5582',PASSPHRASE='a long enough browser passphrase';
const everything=dir=>{let all=Buffer.alloc(0);for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){if(e.name!=='node_modules'&&e.name!=='tools')all=Buffer.concat([all,everything(p)]);}else if(e.isFile())all=Buffer.concat([all,readFileSync(p)]);}return all;};
(async()=>{
 const home=mkdtempSync(join(tmpdir(),'reader-private-'));
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--inbox'],{stdio:['ignore','pipe','inherit'],env:{...process.env,READER_HOME:home}});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu']});
  const context=await browser.newContext({viewport:{width:1300,height:1100},reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const inbox=()=>readdirSync(join(root,'inbox')).sort();const before=inbox();
  await page.goto(url+'#admin/publish');
  const state=value=>page.locator(`[data-private-state=${value}]`).waitFor({timeout:60000});
  await page.locator('[data-private]').waitFor();
  await page.locator('#private-install').click();
  await page.locator('#private-new').waitFor({timeout:120000});
  // The warning stands between you and a passphrase you might lose.
  await page.locator('#private-new').fill(PASSPHRASE);await page.locator('#private-again').fill(PASSPHRASE);
  assert.equal(await page.locator('#private-setup').isDisabled(),true,'needs the acknowledgement');
  assert.match(await page.locator('#private-warning').textContent(),/no way to recover/);
  await page.locator('label[for=private-understood]').click();
  await page.locator('#private-setup:not([disabled])').click();
  await state('unlocked');
  assert.equal(statSync(join(home,'private.git')).mode&0o777,0o700);
  assert.equal(await page.evaluate(()=>document.cookie.includes('reader_private')),false,'scripts cannot read the session cookie');
  // Upload: nothing is added to the vault, and nothing readable lands on disk.
  await page.locator('#publish-files').setInputFiles({name:'secret-file-name.md',mimeType:'text/markdown',buffer:Buffer.from(`# Heading\n\n${MARKER}\n`)});
  await page.locator('#publish-title').fill(TITLE);
  await page.locator('[data-publish-level=machine-only] [data-slot=radio-group-item]').click();
  await page.locator('#publish-submit:not([disabled])').click();
  await page.locator('#backstage-publish[data-publish-stage=encrypted]').waitFor({timeout:60000});
  assert.deepEqual(inbox(),before,'the inbox is unchanged');
  const objects=spawnSync('git',['--git-dir',join(home,'private.git'),'cat-file','--batch-all-objects','--batch'],{maxBuffer:64*1024*1024}).stdout;
  for(const secret of [MARKER,TITLE,'secret-file-name']){
    assert.equal(objects.includes(secret),false,secret+' in objects');
    assert.equal(everything(home).includes(secret),false,secret+' in the home');
    assert.equal(everything(root).includes(secret),false,secret+' in the vault');
  }
  // A delivery already waiting in the inbox can move in instead of being filed.
  const waiting=page.locator('[data-private-waiting]');await waiting.first().waitFor({timeout:15000});
  const ids=await waiting.evaluateAll(rows=>rows.map(row=>row.dataset.privateWaiting));assert.ok(ids.length>=2,'two deliveries are waiting');
  const moved=ids[0],encrypt=page.locator('#private-encrypt-selected'),confirmEncrypt=()=>page.getByRole('alertdialog').getByRole('button',{name:'Encrypt'}).click();
  assert.equal(await encrypt.isDisabled(),true,'nothing is selected yet');
  await page.locator('[data-private-select-all]').click();assert.match(await encrypt.textContent(),new RegExp(`Encrypt selected \\(${ids.length}\\)`));
  await page.locator('[data-private-select-all]').click();assert.equal(await encrypt.isDisabled(),true);
  await page.locator(`[data-private-waiting="${ids[0]}"] [data-private-select]`).click();await page.locator(`[data-private-waiting="${ids[1]}"] [data-private-select]`).click();
  assert.match(await encrypt.textContent(),/Encrypt selected \(2\)/);
  await page.locator('#private-waiting').screenshot({path:'.reader/web-dev/private-waiting.png'});assert.match(await page.locator('#private-selection-note').textContent(),/2 of \d+ selected/);
  // A failure stops the batch, says where, and leaves the selection to retry.
  await page.route('**/api/private',route=>route.request().method()==='POST'?route.fulfill({status:500,json:{error:'Synthetic failure'}}):route.fallback());
  await encrypt.click();await confirmEncrypt();
  await page.locator('#private-batch-error').filter({hasText:/Stopped at .*Synthetic failure/}).waitFor();
  await page.unroute('**/api/private');
  for(const id of ids.slice(0,2))assert.equal(existsSync(join(root,'inbox',id)),true,'nothing moved');
  await page.locator(`[data-private-waiting="${ids[1]}"]`).waitFor();assert.match(await encrypt.textContent(),/Encrypt selected \(2\)/);
  await encrypt.click();await confirmEncrypt();
  for(const id of ids.slice(0,2))await page.locator(`[data-private-item="${id}"]`).waitFor({timeout:60000});
  for(const id of ids.slice(0,2))assert.equal(existsSync(join(root,'inbox',id)),false,'the inbox copy is gone');
  // It opens through the session, and locks.
  const row=page.locator('[data-private-item]').filter({hasText:TITLE});await row.waitFor();
  await row.locator('[data-private-open]').click();
  // It opens in the regular reader. The URL carries only an ID, and nothing about it is saved.
  await page.locator('.document-kicker').filter({hasText:'Encrypted'}).waitFor();
  await page.locator('#article').filter({hasText:MARKER}).waitFor();
  for(const secret of [TITLE,'secret-file-name'])assert.equal(page.url().includes(secret),false,secret+' in the URL');
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('MARKER')),false);
  for(const secret of [MARKER,TITLE,'secret-file-name'])assert.equal(everything(root).includes(secret),false,secret+' reached the vault while reading');
  await page.goBack();
  // It also has its own page.
  await page.goto(url+'#admin/encrypted');await page.locator('#backstage-encrypted [data-private-item]').first().waitFor();
  await page.locator('#private-lock').click();await state('locked');
  assert.equal(await page.locator('[data-private-item]').count(),0);
  const denied=await page.evaluate(async()=>{const list=await (await fetch('/api/private')).json();return list;});
  assert.equal(denied.unlocked,false);assert.deepEqual(denied.items,[]);
  const refused=await page.evaluate(async id=>(await fetch('/api/document?path=private/'+id)).status,moved);assert.notEqual(refused,200,'a locked store opens nothing');
  // A wrong passphrase gets nothing; the right one reopens it.
  await page.locator('#private-passphrase').fill('not the right passphrase');await page.locator('#private-unlock').click();
  await page.locator('#private-error').filter({hasText:'doesn’t match'}).waitFor({timeout:30000});
  await page.locator('#private-passphrase').fill(PASSPHRASE);await page.locator('#private-unlock').click();
  await state('unlocked');await page.locator('[data-private-item]').filter({hasText:TITLE}).waitFor();
  // Delete.
  await page.locator('[data-private-item]').filter({hasText:TITLE}).getByRole('button',{name:'Delete'}).click();
  await page.locator('[data-confirm]').click();
  await page.locator('[data-private-item]').filter({hasText:TITLE}).waitFor({state:'detached',timeout:30000});
  assert.deepEqual(errors,[]);
  console.log('Private passed: install, warned setup, encrypted upload with no plaintext on disk, encrypt a waiting delivery, open, lock, wrong passphrase, unlock, delete.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null)fixture.kill('SIGTERM');rmSync(home,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
