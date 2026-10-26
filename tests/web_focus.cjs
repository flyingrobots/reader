/* Focus after Space p (Reader Admin's Settings page), saving Settings and closing the Theme Editor (synthetic data). */
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
  const active=()=>page.evaluate(()=>document.activeElement?.id||document.activeElement?.tagName);
  // #42: Space p focuses the Settings heading in NORMAL mode; the next leader key acts instead of typing.
  await page.goto(url);await page.locator('#home-title').waitFor();await page.locator('#main').focus();
  await page.keyboard.press('Space');await page.keyboard.press('p');await page.locator('#backstage-settings').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='admin-title');
  assert.notEqual(await page.locator('#vim-mode').textContent(),'INSERT');const name=await page.locator('#profile-name').inputValue();
  await page.keyboard.press('Space');await page.keyboard.press('e');await page.locator('#picker[open]').waitFor();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#profile-name').inputValue(),name,'the participant field is untouched');
  // #59: saving Settings keeps focus on the form, not <body>.
  await page.locator('#preferences-form button[type=submit]').click();await page.locator('[data-sonner-toast]').filter({hasText:'Preferences saved.'}).waitFor();await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('#preferences-form')!==null),true,'focus stays in Settings: '+await active());
  // #59: the Theme Editor returns focus to its opener when F10 closes it.
  await page.locator('#theme-editor-open').click();await page.locator('#theme-editor').waitFor();await page.keyboard.press('F10');await page.locator('#theme-editor').waitFor({state:'hidden'});await page.waitForTimeout(200);
  assert.equal(await active(),'theme-editor-open','back on the Theme Editor button');
  const seen=page.waitForResponse(response=>response.url().endsWith('/api/seen')&&response.request().method()==='POST');
  await page.goto(url+'/#read='+encodeURIComponent('library/thought.md'));await seen;await page.locator('#main').focus();
  await page.keyboard.press('F10');await page.locator('#theme-editor').waitFor();await page.keyboard.press('F10');await page.locator('#theme-editor').waitFor({state:'hidden'});await page.waitForTimeout(200);
  assert.equal(await active(),'main','F10 from the page returns to the page');
  const before=await page.evaluate(()=>scrollY);await page.keyboard.press('j');await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>scrollY)>before,'j scrolls right away');
  assert.deepEqual(errors,[]);console.log('Focus passed: Space p heading focus, Settings save focus, Theme Editor focus return.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
