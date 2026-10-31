/* Real Chromium touch events: dragging expanded art is not a stationary long press. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {pinDate}=require('./web_clock.cjs');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--art'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,now}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'no-preference'});await pinDate(context,now);
  await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'user-reader-test'})));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  // Open the view with a touch tap, as a phone would: a mouse click would leave a mouse pointer resting over the art, and
  // its desktop hover card would open on its own timer in the middle of the gesture under test.
  await page.goto(url);await page.locator('.cover-art .art-focus-toggle').tap();
  await page.waitForFunction(()=>['live','still','image','unavailable'].includes(document.querySelector('.art-focus')?.dataset.state));
  const input=await context.newCDPSession(page);
  const touch=(type,x,y)=>input.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:0}]});
  // The drag is dispatched in the page as touch pointer events, in order, on Playwright's clock: CDP's touch events reach
  // a loaded renderer late (the first move ~390 ms after the start), so a real drag could legitimately look like a
  // 550 ms stationary press. In-page events and virtual time leave only the app's decision to test. Real time resumes
  // after the gesture.
  await page.clock.install();
  const pointer=(type,x,y)=>page.evaluate(([type,x,y])=>document.querySelector('.art-focus-stage canvas, .art-focus-stage img, .art-focus-stage')
    .dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:7,isPrimary:true,clientX:x,clientY:y})),[type,x,y]);
  await pointer('pointerdown',64,300);
  for(const x of [94,124,154,184]){await page.clock.runFor(170);await pointer('pointermove',x,300);}
  await pointer('pointerup',184,300);await page.clock.runFor(700);
  assert.equal(await page.locator('#art-prompt-card:visible').count(),0,'a continuous touch drag past the long-press delay must not open the card');
  // A fresh stationary gesture, allowing slight finger jitter, still opens the prompt.
  await touch('touchStart',80,300);await touch('touchMove',84,303);await page.clock.runFor(700);
  await page.locator('#art-prompt-card').waitFor({state:'visible'});await touch('touchEnd');
  await page.clock.resume();
  assert.ok(await page.locator('.art-focus').isVisible());
  mkdirSync('.reader/web-dev',{recursive:true});await page.screenshot({path:'.reader/web-dev/art-focus-touch.png'});
  await page.keyboard.press('Escape');await page.locator('#art-prompt-card').waitFor({state:'hidden'});
  await page.keyboard.press('Escape');await page.locator('.art-focus').waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  console.log('Expanded art touch passed: continuous drag does not open a prompt; stationary long press with small jitter does; nested Escape closes card then Focus.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
