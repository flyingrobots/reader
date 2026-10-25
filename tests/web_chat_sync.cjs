/* Chat panels stay in sync: two tabs share one chat and see each other's messages and turns; a dead or stalled server shows Lost connection. Fake voices only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 // A short heartbeat keeps the stall checks quick; the watchdog scales with it.
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--chat','--chat-heartbeat','0.5'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const errors=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const doc=url+'#read='+encodeURIComponent('library/thought.md');
  const tab=async()=>{const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(doc);await page.locator('#article h1').waitFor();
    await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');
    await page.locator('#chat-panel:not([hidden])').waitFor();return page;};
  const toast=(page,text)=>page.locator('[data-sonner-toast]').filter({hasText:text});
  const say=async(page,text)=>{await page.locator('#chat-input').fill(text);await page.keyboard.press('Enter');};
  const bodies=page=>page.locator('[data-chat-message] .chat-markdown').allTextContents().then(list=>list.map(t=>t.trim()));
  const a=await tab(),b=await tab();
  // Case 1: both tabs start the document's first chat; they share one chat instead of creating two.
  await say(b,'@librarian from tab B');
  await b.locator('[data-chat-message][data-author="Reader librarian"]').waitFor({timeout:15000});
  await say(a,'@claude from tab A');
  await a.locator('[data-chat-message][data-author=Claude]').waitFor({timeout:15000});
  assert.deepEqual((await bodies(a)).slice(0,2),['@librarian from tab B','The librarian notes the provenance.'],'tab A joined the chat tab B started');
  const listing=await a.evaluate(()=>fetch('/api/chats?path=library%2Fthought.md').then(r=>r.json()));
  assert.equal(listing.chats.length,1,'one chat for the document, not one per tab');
  // Case 2: tab B shows tab A's message (not only Claude's reply to it).
  await b.locator('[data-chat-message][data-author=Claude]').waitFor({timeout:15000});
  assert.ok((await bodies(b)).includes('@claude from tab A'),'the other tab’s user message appears');
  // Case 3: cancel, Retry and cancel again in A while B queues behind; B ends with no stale turns.
  await say(a,'@sloth take your time');
  await a.locator('[data-chat-turn][data-author=Sloth][data-turn-state=running]').waitFor({timeout:10000});
  await say(b,'@librarian from B, queued');
  await b.locator('[data-chat-turn][data-author="Reader librarian"]').waitFor();
  await a.locator('[data-chat-turn][data-author=Sloth] [data-chat-cancel]').click();
  await a.locator('[data-chat-message][data-author=Sloth][data-chat-state=cancelled] [data-chat-retry]').click();
  await a.locator('[data-chat-turn][data-author=Sloth][data-turn-state=running]').waitFor({timeout:15000});
  await a.locator('[data-chat-turn][data-author=Sloth] [data-chat-cancel]').click();
  await b.waitForFunction(()=>document.querySelectorAll('[data-chat-message][data-author=Sloth][data-chat-state=cancelled]').length===2,null,{timeout:20000});
  await b.waitForFunction(()=>[...document.querySelectorAll('[data-chat-message][data-author="Reader librarian"]')].length===2,null,{timeout:20000});
  await b.waitForFunction(()=>!document.querySelector('[data-chat-turn]'),null,{timeout:5000});
  assert.deepEqual(await bodies(a),await bodies(b),'both tabs show the same chat');
  await b.close();
  // A stalled server: the running turn shows Lost connection with Retry, and its timer stops; it recovers when the server resumes.
  await say(a,'@sloth stall with me');
  const sloth=a.locator('[data-chat-turn][data-author=Sloth][data-turn-state=running]');await sloth.waitFor({timeout:10000});
  await sloth.locator('[data-chat-elapsed]').waitFor();
  process.kill(fixture.pid,'SIGSTOP');
  try{
   await sloth.locator('[data-chat-lost]').waitFor({timeout:8000});
   assert.equal(await sloth.locator('[data-chat-lost]').textContent(),'Lost connection to Reader');
   assert.equal(await sloth.locator('[data-chat-elapsed]').count(),0,'no running clock while the connection is lost');
   assert.equal(await sloth.locator('[data-chat-reconnect]').count(),1);
   await toast(a,'Lost connection to Reader').waitFor();
   assert.equal(await toast(a,'Lost connection to Reader').count(),1,'one toast per lost connection');
  }finally{process.kill(fixture.pid,'SIGCONT');}
  await toast(a,'Reconnected to Reader').waitFor({timeout:10000});
  await sloth.locator('[data-chat-elapsed]').waitFor();
  assert.equal(await sloth.locator('[data-chat-lost]').count(),0);
  await sloth.locator('[data-chat-cancel]').click();
  await a.waitForFunction(()=>!document.querySelector('[data-chat-turn]'),null,{timeout:10000});
  // A dead server: the stream errors and does not reopen, so the panel says so.
  const before=await toast(a,'Lost connection to Reader').count();
  process.kill(fixture.pid,'SIGKILL');await new Promise(resolve=>fixture.exitCode!==null||fixture.signalCode!==null?resolve():fixture.once('exit',resolve));
  await a.waitForFunction(n=>[...document.querySelectorAll('[data-sonner-toast]')].filter(t=>t.textContent.includes('Lost connection to Reader')).length>n,before,{timeout:10000});
  assert.deepEqual(errors,[]);
  console.log('Chat sync passed: two tabs share one first chat, see each other’s messages and the final state of retried and queued turns; a stalled stream shows Lost connection with Retry, stops the clock, toasts once and recovers; a dead server is reported.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGCONT');fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
