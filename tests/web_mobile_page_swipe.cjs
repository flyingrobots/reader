/* Medium: synthetic vault and loopback browser; a phone swipe in the Pages layout turns exactly one page. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.evaluate(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({layout:'scroll',mobileLayout:'spread',pageTurn:'slide',theme:'ink'})));
  await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await page.reload();
  await page.getByRole('heading',{name:'A quiet thought',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  await page.waitForFunction(()=>document.body.classList.contains('two-page'));
  const pages=await page.locator('.book-viewport').evaluate(el=>Math.floor(el.scrollWidth/el.clientWidth));
  assert.ok(pages>=4,'the synthetic article spans several phone pages, got '+pages);
  const cdp=await context.newCDPSession(page),box=await page.locator('.book-viewport').boundingBox();
  // A real touch gesture, so the browser's own fling momentum applies, as on a phone.
  const swipe=async(xDistance,speed)=>{await cdp.send('Input.synthesizeScrollGesture',{x:box.x+box.width/2,y:box.y+box.height/2,xDistance,yDistance:0,speed,gestureSourceType:'touch',preventFling:false});};
  const settledPage=async()=>{let last=-1,same=0;for(;;){await page.waitForTimeout(100);const left=await page.locator('.book-viewport').evaluate(el=>el.scrollLeft);if(left===last){if(++same>=5)break;}else same=0;last=left;}return page.locator('.book-viewport').evaluate(el=>el.scrollLeft/(el.clientWidth+(parseFloat(getComputedStyle(el.querySelector('#article')).columnGap)||40)));};
  const start=await settledPage();assert.equal(start,0,'the article opens on its first page');
  await swipe(-160,3000);
  assert.equal(await settledPage(),1,'a fast flick to the left turns one page, not several');
  await swipe(-160,3000);
  assert.equal(await settledPage(),2,'a second flick turns one more page');
  await swipe(160,3000);
  assert.equal(await settledPage(),1,'a flick to the right turns back one page');
  await swipe(-40,200);
  assert.equal(await settledPage(),1,'a short slow drag springs back to the same page');
  assert.deepEqual(errors,[]);
  console.log('Mobile page swipe passed: flicks turn one page each way, a short drag springs back.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
