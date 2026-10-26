/* A second Reader server on a vault whose art another server owns (#138): the Art studio shows the owner's commissions
   read-only and says why, Generate art answers 409 with that message, and the owner's jobs.json bytes never change.
   Synthetic fixture and fake voice only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,readFileSync}=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {pinDate}=require('./web_clock.cjs');  // the fixture's pinned clock (#131)
const OWNED='Another Reader server owns art for this vault';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--art','--art-owned'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,root,now}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  const jobsFile=path.join(root,'.reader/art/jobs.json'),before=readFileSync(jobsFile);
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const errors=[],posts=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});await pinDate(context,now);
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/art')posts.push(r.status());});
  // Behind the scenes: the owner's commissions are listed read-only, with no Cancel, and the card says why.
  await page.goto(url+'#backstage');await page.locator('#backstage-art').waitFor();
  const note=page.locator('#backstage-art [data-art-read-only]');await note.waitFor();
  assert.match(await note.textContent(),new RegExp('^'+OWNED+'; art is read-only here\\.'));
  assert.equal(await page.locator('#backstage-art [data-art-job=art-ownedrun0000]').getAttribute('data-job-state'),'running');
  assert.equal(await page.locator('#backstage-art [data-art-job=art-ownedwait000]').getAttribute('data-job-state'),'queued');
  assert.equal(await page.locator('#backstage-art [data-art-job] button',{hasText:'Cancel'}).count(),0,'another server\'s jobs cannot be cancelled here');
  await page.locator('#backstage-art').screenshot({path:(mkdirSync('.reader/web-dev',{recursive:true}),'.reader/web-dev/art-owned.png')});
  // Generate art on an article without art is refused with 409 and the server's message.
  await page.goto(url+'#read='+encodeURIComponent('library/issue/edict.md'));await page.locator('#article h1').waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');
  await page.locator('.article-art [data-art-generate]').waitFor();
  await page.click('.article-art [data-art-generate]');
  await page.locator('[data-sonner-toast]').filter({hasText:OWNED}).waitFor();
  assert.deepEqual(posts,[409]);
  assert.ok(readFileSync(jobsFile).equals(before),'the owner jobs.json bytes are unchanged');
  assert.deepEqual(errors,[]);
  console.log('web_art_owner: ok');
 }finally{if(browser)await browser.close();fixture.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
