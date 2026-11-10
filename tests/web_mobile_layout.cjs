/* Medium: synthetic vault and loopback browser; mobile layout defaults and explicit choices. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  // A desktop/legacy spread preference must not make the phone turn pages by default.
  await page.evaluate(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({layout:'spread',theme:'ink'})));
  const article=url+'#read='+encodeURIComponent('library/thought.md');
  const settled=async()=>{await page.getByRole('heading',{name:'A quiet thought',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));};
  await page.goto(article);await page.reload();await settled();
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('two-page')),false,'mobile defaults to scrolling despite a legacy spread preference');
  await page.evaluate(()=>scrollTo(0,500));await page.waitForFunction(()=>scrollY>100);
  // The existing alternate layout remains selectable and persists after reopening.
  await page.goto(url+'#admin/settings');await page.locator('#reading-mode').click();
  await page.getByRole('option',{name:'Pages',exact:true}).click();
  await page.locator('#preferences-form button[type=submit]').click();
  await page.locator('[data-sonner-toast]').filter({hasText:'Preferences saved.'}).waitFor();
  await page.goto(article);await page.reload();await settled();
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('two-page')),true,'mobile remembers an explicit Two pages choice');
  await page.goto(url+'#admin/settings');await page.locator('#reading-mode').click();
  await page.getByRole('option',{name:'Scroll',exact:true}).click();
  await page.locator('#preferences-form button[type=submit]').click();
  await page.locator('[data-sonner-toast]').filter({hasText:'Preferences saved.'}).waitFor();
  await page.goto(article);await page.reload();await settled();
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('two-page')),false,'mobile remembers an explicit Continuous choice');
  await page.setViewportSize({width:1440,height:1000});await page.reload();await settled();
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('two-page')),true,'mobile choices preserve the desktop spread preference');
  const layout={t:{d:'row',s:[.5,.5],c:['#read=library/thought.md','#read=library/other.md']},f:0};
  await page.goto(url+'#split='+encodeURIComponent(JSON.stringify(layout)));
  await page.locator('.split-pane iframe').first().waitFor();
  const pane=await (await page.locator('.split-pane iframe').first().elementHandle()).contentFrame();
  await pane.locator('#article').waitFor();await pane.waitForFunction(()=>!document.querySelector('.resume-pending'));
  assert.equal(await pane.locator('body').evaluate(el=>el.classList.contains('two-page')),true,'a narrow desktop split pane uses the desktop layout');
  await pane.locator('#layout-swap').evaluate(el=>el.click());
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).layout==='scroll');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).mobileLayout),'scroll','saving a desktop pane preserves the mobile layout');
  assert.deepEqual(errors,[]);
  console.log('Mobile layout passed: scrolling default, native scrolling, selectable/persistent Two pages and Continuous, desktop preference preserved.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
