/* Search page: hand-typed #search=<words> links and Escape from page controls (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {waitFor,watch}=require('./web_wait.cjs');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--search-page'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const page=await browser.newPage({viewport:{width:1300,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));watch(page);
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
  // The field takes focus a frame after Search renders; typing sooner drops the first letters.
  await waitFor(page,'Search focuses its field',()=>({field:document.activeElement?.id==='search-query'}),{timeout:5000});
  await page.keyboard.type('observation');await page.locator('.search-work').first().waitFor();
  const inResults=label=>waitFor(page,label,()=>({ready:document.querySelector('.search-page')?.dataset.status==='ready',results:document.activeElement?.closest('[data-passage]')!=null}),{timeout:5000});
  await page.locator('.search-modes button').nth(1).click();await waitFor(page,'the new mode’s results',()=>({ready:document.querySelector('.search-page')?.dataset.status==='ready'}),{timeout:10000});
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('.search-page').isVisible(),'Escape on a mode button stays on Search');
  await inResults('focus moves to the results');
  // #84: Escape while the new mode's query is still running lands on the results it brings, not on <body>.
  await page.route('**/api/search/page?*',async route=>{await new Promise(resolve=>setTimeout(resolve,800));await route.continue();});
  await page.locator('.search-modes button').nth(2).focus();await page.keyboard.press('Enter');
  await waitFor(page,'the delayed query is running',()=>({loading:document.querySelector('.search-page')?.dataset.status==='loading'}),{timeout:5000});
  await page.keyboard.press('Escape');
  await inResults('focus on the results after the delayed query renders');
  await page.unroute('**/api/search/page?*');
  await page.keyboard.press('Escape');await page.locator('.search-page').waitFor({state:'detached'});
  assert.deepEqual(errors,[]);console.log('Search fixes passed: #search=<words> links, malformed escapes, Escape from page controls returns to results.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
