/* Margin threads take focus when they open and give it back when they close (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const seen=page.waitForResponse(response=>response.url().endsWith('/api/seen')&&response.request().method()==='POST');
  await page.goto(url+'/#read='+encodeURIComponent('library/thought.md'));await seen;await page.waitForFunction(()=>!document.querySelector('.resume-pending')&&document.querySelector('#progress-pips button'));
  const focused=()=>page.evaluate(()=>{const a=document.activeElement;return a.id||a.className||a.tagName;});
  const inPanel=()=>page.evaluate(()=>document.querySelector('#thread-panel').contains(document.activeElement));
  // Enter on a progress pip opens its thread with focus inside; the reply box is a few Tab stops away; Escape returns to the pip.
  await page.locator('#progress-pips button').first().focus();await page.keyboard.press('Enter');await page.locator('#thread-reply').waitFor();await page.waitForTimeout(400);
  assert.equal(await focused(),'thread-title','focus moves to the thread heading');
  let tabs=0;while(tabs<12&&await focused()!=='reply-body'){await page.keyboard.press('Tab');tabs++;}
  assert.equal(await focused(),'reply-body',`reply box reached in ${tabs} Tab presses`);
  await page.keyboard.press('Escape');await page.locator('#thread-panel').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.closest('#progress-pips')!==null),true,'Escape returns focus to the pip');
  // Space t focuses the first thread in the list; Enter opens it; Escape returns to the page.
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('t');await page.locator('#thread-panel').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('thread-list-item')),true,'Space t focuses the list');
  await page.keyboard.press('j');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('thread-list-item')),true,'j stays in the list');
  await page.keyboard.press('Enter');await page.locator('#thread-reply').waitFor();await page.waitForTimeout(300);assert.equal(await inPanel(),true,'the opened thread keeps focus in the panel');
  await page.keyboard.press('Escape');await page.locator('#thread-panel').waitFor({state:'hidden'});assert.equal(await focused(),'main');
  // After leaving a comment the new thread opens with focus in it, not on <body>.
  await page.locator('#article p',{hasText:'chapter 2 waits'}).evaluate(el=>{el.scrollIntoView({block:'center'});const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#selection-tools').waitFor();await page.locator('[data-annotate=comment]').click();await page.locator('#annotation-body').fill('A synthetic note.');
  await page.locator('#annotation-form button[type=submit], #annotation-form button').last().click();await page.locator('#thread-reply').waitFor();await page.waitForTimeout(400);
  assert.equal(await inPanel(),true,'focus is in the new thread: '+await focused());
  await page.locator('#thread-close').click();assert.equal(await focused(),'main','closing without an opener falls back to the page');
  assert.deepEqual(errors,[]);console.log(`Threads passed: pip Enter focuses the thread (reply in ${tabs} Tabs), Escape returns to the pip, Space t list focus and j, new comment focus.`);
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
