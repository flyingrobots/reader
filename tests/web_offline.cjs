/* An unreachable server: one coalesced "Reader isn't reachable" toast instead of several bare "Failed to fetch", cleared by a probe when Reader answers again. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--maintenance'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const toasts=()=>page.locator('[data-sonner-toast]').allTextContents();
  await page.goto(url+'#read=library%2Fthought.md');await page.locator('#article h1').waitFor();
  // The server goes away: every request fails at the network level, like a stopped process.
  let down=true;
  await context.route(()=>true,route=>down?route.abort('connectionrefused'):route.continue());
  await page.mouse.move(600,400);await page.mouse.wheel(0,600);await page.waitForTimeout(1500);
  await page.evaluate(()=>{location.hash='#admin/indexes';});await page.locator('[data-job=search]').waitFor();
  await page.locator('[data-job=search]').click();
  await page.locator('[data-job=catalog]').click();
  await page.waitForTimeout(1500);
  const shown=await toasts();
  assert.equal(shown.filter(t=>t.includes('Reader isn’t reachable')).length,1,'one coalesced toast: '+JSON.stringify(shown));
  assert.ok(shown.some(t=>t.includes('Your last change wasn’t saved.')),'a failed write says so');
  assert.ok(!shown.some(t=>/Failed to fetch|Couldn’t start that job/.test(t)),'no bare network errors: '+JSON.stringify(shown));
  // Reader answers again: the probe replaces the toast.
  down=false;
  await page.locator('[data-sonner-toast]').filter({hasText:'Reader is reachable again.'}).waitFor({timeout:12000});
  assert.equal((await toasts()).filter(t=>t.includes('Reader isn’t reachable')).length,0,'the unreachable toast is replaced');
  assert.deepEqual(errors,[]);
  console.log('Offline passed: one coalesced unreachable toast with an unsaved-change note, no bare Failed to fetch, cleared by the reachability probe.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
