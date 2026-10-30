/* `reader demo`: the real CLI builds a disposable demo vault in a temp folder and serves it; the magazine, a document with margins, and chat with the scripted demo voices and the manual voice's paste label. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,mkdtempSync,rmSync,existsSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const dir=path.join(mkdtempSync(path.join(tmpdir(),'reader-demo-test-')),'Reader Demo');
 const server=spawn(process.env.READER_PYTHON||'.venv/bin/python',['-m','reader_mcp.cli','demo','--dir',dir,'--port','0'],{stdio:['ignore','pipe','inherit'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});let browser;
 const lines=[];
 try{
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('demo did not start: '+lines.join('\n'))),120000);
    createInterface({input:server.stdout}).on('line',line=>{lines.push(line);const found=line.match(/^Reader demo: (http:\/\/127\.0\.0\.1:\d+\/)/);if(found){clearTimeout(timer);resolve(found[1]);}});
    server.once('exit',code=>{clearTimeout(timer);reject(new Error('demo exited '+code+': '+lines.join('\n')));});});
  assert.ok(existsSync(path.join(dir,'.reader-demo-vault')),'the vault carries the demo marker');
  assert.ok(lines.some(l=>/Search: keyword and fuzzy|Search: keyword, fuzzy and semantic/.test(l)),'reports which search modes are on');
  assert.ok(lines.some(l=>/scripted demo voices \(no AI\)/.test(l)),'explains the scripted voices');
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  // The magazine: this week's issue, with a cover story and the newsletter in the rail.
  await page.goto(url);await page.locator('#home-title').waitFor();await page.locator('.issue-cover').waitFor();
  assert.equal(await page.locator('.cover-title').textContent(),'Modern Fiction','the newsletter pick is the cover story');
  assert.match(await page.locator('.issue-letter-title').textContent(),/The Weekly/);
  assert.ok((await page.locator('.feature-title').count())>=3,'features from several projects');
  await page.screenshot({path:'.reader/web-dev/demo-magazine.png'});
  // A document with margins: highlights from several readers, a reply thread and a warning.
  await page.goto(url+'#read='+encodeURIComponent('library/walden/thoreau/where-i-lived.md'));
  await page.locator('#article h1').filter({hasText:'Where I Lived'}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('#article [data-thread]').length>=3);
  assert.match(await page.locator('#article').textContent(),/I went to the woods because I wished to live deliberately/);
  await page.screenshot({path:'.reader/web-dev/demo-document.png'});
  // The sync design v2 has a finished chat; scripted voices answer a new message without any AI installed.
  await page.goto(url+'#read='+encodeURIComponent('library/lantern/design/sync-design.v2.md'));await page.locator('#article h1').filter({hasText:'Lantern sync'}).waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');
  await page.locator('#chat-panel:not([hidden])').waitFor();
  const seeded=page.locator('[data-chat-message][data-author=Architect]').first();await seeded.waitFor();
  assert.match(await seeded.locator('[data-chat-runtime]').textContent(),/demo-voice 1\.0 \(scripted replies\)/);
  assert.equal(await page.locator('#chat-paste-toggle').textContent(),'Paste Wren’s reply','the manual voice comes from voices.json');
  await page.locator('#chat-input').fill('@plain what do you make of this design?');await page.keyboard.press('Enter');
  const answer=page.locator('[data-chat-message][data-author="Plain Reader"]').first();await answer.waitFor({timeout:30000});
  assert.match(await answer.textContent(),/Opinion first/);
  assert.match(await answer.locator('[data-chat-runtime]').textContent(),/scripted/);
  await page.locator('#chat-paste-toggle').click();
  assert.equal(await page.getByRole('button',{name:'Save as Wren'}).count(),1);
  assert.match(await page.locator('label[for=chat-paste-body]').textContent(),/^Wren’s reply/);
  await page.screenshot({path:'.reader/web-dev/demo-chat.png'});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Demo passed: reader demo built and served a marked vault, the magazine cover and newsletter, a document with highlights, the seeded chat, a scripted voice reply and the manual voice paste label.');
 }finally{
  if(browser)await browser.close();
  server.kill('SIGINT');await new Promise(r=>{if(server.exitCode!==null)return r();const t=setTimeout(()=>{server.kill('SIGKILL');r();},5000);server.once('exit',()=>{clearTimeout(t);r();});});
  rmSync(path.dirname(dir),{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exit(1);});
