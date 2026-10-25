/* Search page: hand-typed #search=<words> links and Escape from page controls (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--search-page'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const page=await browser.newPage({viewport:{width:1300,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // #43: #search=<words>, plain or %20-escaped, runs that query; a malformed escape doesn't break the page.
  for(const [route,query] of [['#search=observation','observation'],['#search=distinct%20observation','distinct observation'],['#search=50%25%zz','50%25%zz']]){
   const searched=query.includes('zz')?null:page.waitForResponse(response=>response.url().includes('/api/search'),{timeout:10000}).catch(()=>null);
   await page.goto(url+'/?fresh='+Math.random()+route);await page.locator('.search-page').waitFor();
   assert.equal(await page.locator('#search-query').inputValue(),query,route);
   if(searched){assert.ok(await searched,'the query runs: '+route);await page.locator('.search-work').first().waitFor();}
  }
  // #59: Escape on a mode button returns to the results; a second Escape (from the results) leaves Search.
  await page.goto(url+'/?fresh=2');await page.locator('#home-title').waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('/');await page.locator('.search-page').waitFor();
  await page.keyboard.type('observation');await page.locator('.search-work').first().waitFor();
  await page.locator('.search-modes button').nth(1).click();await page.locator('.search-work').first().waitFor();await page.waitForTimeout(200);
  await page.keyboard.press('Escape');await page.waitForTimeout(150);
  assert.ok(await page.locator('.search-page').isVisible(),'Escape on a mode button stays on Search');
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-passage]')!==null),true,'focus moves to the results');
  await page.keyboard.press('Escape');await page.locator('.search-page').waitFor({state:'detached'});
  assert.deepEqual(errors,[]);console.log('Search fixes passed: #search=<words> links, malformed escapes, Escape from page controls returns to results.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
