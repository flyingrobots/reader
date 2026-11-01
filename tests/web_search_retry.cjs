/* A content search refused with 429 (another search running) retries with backoff instead of showing an empty "try another phrase" state. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--search-page'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'user-reader-test',layout:'scroll'}));}catch{}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // The search page (#57): a refused passage search, whatever the 429 says, retries and then shows results.
  let pageBusy=1,pageCalls=0;
  const refuse=route=>route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Reader is busy; try again shortly'})});
  await page.route(/\/api\/search\/page\?/,route=>{pageCalls++;return pageBusy-->0?refuse(route):route.continue();});
  await page.goto(url+'#search='+encodeURIComponent('q=observation&mode=words'));
  await page.locator('[data-work]').first().waitFor({timeout:8000});
  assert.equal(pageCalls,2,'one refusal, then the retried passage search');
  assert.equal(await page.locator('[data-search-empty], [data-search-results] [data-empty]').count(),0,'no empty or error state after the retry');
  // A page server that stays busy: say the search couldn’t finish, never that nothing matched or to try another phrase.
  pageBusy=99;pageCalls=0;
  await page.clock.install();
  await page.locator('#search-query').fill('another observation');
  await until(()=>!!document.querySelector('[data-search-results] [data-state=error]'),'the search page gives up');
  assert.equal(pageCalls,6,'the first try and five retries');
  const said=await page.locator('[data-search-results]').textContent();
  assert.match(said,/Search couldn’t finish/);assert.doesNotMatch(said,/Nothing matched|another phrase/i);
  assert.deepEqual(errors,[]);
  console.log('Search retry passed: a 429 retries with backoff and shows results, without an empty state, on the search page; persistent contention ends in an honest note.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
