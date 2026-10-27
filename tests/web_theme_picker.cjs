/* Quick theme changes against a disposable synthetic vault, without opening Settings. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.locator('#home-title').waitFor();
  const trigger=page.getByRole('combobox',{name:'Switch theme',exact:true});
  const popup=page.locator('[data-slot=select-content][data-open]');
  await trigger.click();await page.getByRole('option',{name:'Orchid · Dark',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='orchid-dark');
  assert.equal(new URL(page.url()).hash,'','theme changes keep the current page');
  assert.equal(await page.locator('#reader-admin').count(),0,'no Settings or Admin navigation');
  await page.waitForFunction(()=>document.activeElement.id==='quick-theme');
  assert.match(await trigger.textContent(),/Orchid · Dark/);
  await page.reload();await page.locator('#home-title').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'orchid-dark','selection survives reload');
  await page.getByRole('switch',{name:'Dark mode',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='orchid');
  await page.waitForFunction(()=>document.querySelector('#quick-theme').textContent.includes('Orchid · Light'));
  // Reader's leader shortcut opens the menu; its keys do not scroll or navigate the page below it.
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('Shift+T');await popup.waitFor();
  const before=await page.evaluate(()=>({hash:location.hash,y:scrollY}));
  await page.keyboard.press('s');await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>({hash:location.hash,y:scrollY})),before);
  assert.equal(await page.locator('html').getAttribute('data-theme'),'orchid','Escape leaves the selection unchanged');
  await page.waitForFunction(()=>document.activeElement.id==='quick-theme');
  await trigger.press('ArrowDown');await popup.waitFor();
  await page.getByRole('option',{name:'Solarized · Dark',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='solarized-dark');
  // On a narrow screen the picker stays visible, including with an article breadcrumb and progress controls.
  await page.goto(url+'#read=library/thought.md');await page.locator('#article').waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await trigger.waitFor({state:'visible'});
   await trigger.click();await page.getByRole('option',{name:'Harvest · Light',exact:true}).click();
   await page.waitForFunction(()=>document.documentElement.dataset.theme==='harvest');
   assert.equal(new URL(page.url()).hash,'#read=library/thought.md');
   await page.waitForTimeout(100);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'footer fits '+width+'px');
   assert.ok(await trigger.isVisible(),'picker remains visible at '+width+'px');
  }
  const shots=process.env.READER_SHOTS||'.reader/web-dev';mkdirSync(shots,{recursive:true});
  await trigger.click();await popup.waitFor();await page.screenshot({path:shots+'/quick-theme-phone.png'});
  await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});await trigger.click();await popup.waitFor();
  await page.screenshot({path:shots+'/quick-theme-desktop.png'});
  assert.deepEqual(errors,[]);console.log('Quick themes passed: footer, immediate saved choice, paired Dark switch, leader/Select keyboard and Escape focus, famous palettes, article stays open, 390/320px layout.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
