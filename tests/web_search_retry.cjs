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
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // The server answers the first two content searches as busy, then with a result.
  let busy=2,calls=0;
  await page.route(/\/api\/search\?.*mode=keyword/,route=>{calls++;
    if(busy-->0)return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({error:'Another content search is still running; try again shortly'})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({results:[{path:'library/thought.md',primary:'library/thought.md',title:'A quiet thought',authors:['Ada'],matched_by:['keyword']}],mode:'keyword',indexed_at:'2026-10-23',warnings:[]})});});
  await page.goto(url);await page.locator('#home-title').waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('e');await page.keyboard.press('/');
  await page.locator('[data-mode=keyword]').click();await page.locator('#file-query').fill('precise passage');
  await page.waitForFunction(()=>document.querySelector('#search-label').textContent==='Another search is running; retrying…');
  assert.equal(await page.locator('#file-results .empty-note').count(),0,'no empty state while retrying');
  await page.locator('#file-results').getByText('A quiet thought').waitFor({timeout:8000});
  assert.equal(calls,3,'two refusals, then the retried search');
  assert.match(await page.locator('#search-label').textContent(),/^1 result /);
  // A server that stays busy: after the retries, say the search did not run rather than "try another phrase".
  busy=99;calls=0;
  await page.locator('#file-query').fill('another phrase');
  await page.waitForFunction(()=>document.querySelector('#search-label').textContent==='Search unavailable',null,{timeout:25000});
  assert.equal(calls,6,'the first try and five retries');
  assert.match(await page.locator('#file-results').textContent(),/The search didn’t run/);
  assert.doesNotMatch(await page.locator('#file-results').textContent(),/Try another phrase/);
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
  await page.locator('#search-query').fill('another observation');
  await page.locator('[data-search-results] [data-state=error]').waitFor({timeout:25000});
  assert.equal(pageCalls,6,'the first try and five retries');
  const said=await page.locator('[data-search-results]').textContent();
  assert.match(said,/Search couldn’t finish/);assert.doesNotMatch(said,/Nothing matched|another phrase/i);
  assert.deepEqual(errors,[]);
  console.log('Search retry passed: a 429 retries with backoff and shows results, without an empty state, in the picker and on the search page; persistent contention ends in an honest note.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
