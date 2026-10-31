/* A second Reader server on a vault whose chat another server owns (#20, #72): chat stays readable, the composer says why
   it cannot send, a send answers 409, and the owner's state.json bytes never change. Fake voices only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,readFileSync}=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const OWNED='Another Reader server owns chat for this vault';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--chat','--chat-owned'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  const stateFile=path.join(root,'.reader/voice-runner/state.json'),before=readFileSync(stateFile);
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const errors=[],posts=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'user-reader-test',layout:'scroll'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.request().method()==='POST'&&r.url().endsWith('/api/chat'))posts.push(r.status());});
  await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await page.locator('#article h1').waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');
  await page.locator('#chat-panel:not([hidden])').waitFor();
  // Opening the panel already says chat is read-only here.
  const note=page.locator('[data-chat-read-only]');await note.waitFor();
  assert.match(await note.textContent(),new RegExp('^'+OWNED+'; chat is read-only here'));
  // Sending anyway is refused with 409; the composer keeps the draft and shows the server's message.
  await page.locator('#chat-input').fill('@claude are you there?');await page.keyboard.press('Enter');
  await page.locator('[data-sonner-toast]').filter({hasText:OWNED}).waitFor();
  assert.deepEqual(posts,[409]);
  assert.match(await note.textContent(),new RegExp('^'+OWNED+'; chat is read-only here\\. Use the server that owns it'));
  assert.equal(await page.locator('#chat-input').inputValue(),'@claude are you there?','the draft is kept');
  assert.equal(await page.locator('[data-chat-message]').count(),0,'nothing was posted');
  mkdirSync('.reader/web-dev',{recursive:true});await page.screenshot({path:'.reader/web-dev/chat-owned.png'});
  assert.ok(readFileSync(stateFile).equals(before),'the owner state.json bytes are unchanged');
  assert.deepEqual(errors,[]);
  console.log('web_chat_owner: ok');
 }finally{if(browser)await browser.close();fixture.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
