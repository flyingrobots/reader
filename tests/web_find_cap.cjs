/* Find reports a capped count as a floor ("2000+") and an exact count otherwise (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const page=await browser.newPage({viewport:{width:1300,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const seen=page.waitForResponse(response=>response.url().endsWith('/api/seen')&&response.request().method()==='POST');
  await page.goto(url+'/#read='+encodeURIComponent('library/thought.md'));await seen;await page.locator('#main').focus();
  await page.keyboard.press('/');await page.locator('#find-query').fill('e');await page.waitForFunction(()=>document.querySelector('#find-count').textContent.includes('/ 2000'));
  assert.equal(await page.locator('#find-count').textContent(),'1 / 2000+','a capped count reads as a floor');
  await page.locator('#find-query').fill('distinct observation');await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='1 / 44');
  assert.deepEqual(errors,[]);console.log('Find cap passed: 2000+ when capped, exact count otherwise.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
