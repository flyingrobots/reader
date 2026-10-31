/* The browser suites' frozen test theme (tests/test_theme_fixture.py): the default from the first paint, explicit themes
   still win, and the frozen stylesheet still matches what the app builds from the frozen JSON. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {readFileSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const start=args=>{const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py',...args],{stdio:['ignore','pipe','inherit']});
  return {fixture,ready:new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line).url));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));})};};
(async()=>{
 const runs=[start([]),start(['--product-theme'])];let browser;
 try{
  const [url,product]=await Promise.all(runs.map(run=>run.ready));
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu']});
  const page=async(context,address)=>{const tab=await context.newPage();await tab.goto(address);await tab.waitForLoadState('domcontentloaded');return tab;};
  const theme=tab=>tab.evaluate(()=>document.documentElement.dataset.theme);
  // The default, from the first paint, and the stylesheet the app then builds from the JSON matches the frozen one.
  {const context=await browser.newContext();const answered=new Promise(resolve=>context.on('response',response=>{if(new URL(response.url()).pathname==='/api/themes')resolve();}));
   const tab=await page(context,url+'/');assert.equal(await theme(tab),'user-reader-test-dark','the test theme before the app loads its themes');
   await answered;await tab.waitForTimeout(300);
   const built=await tab.evaluate(()=>JSON.parse(localStorage.getItem('reader.themes.v1')).css);
   assert.equal(built,readFileSync('tests/fixtures/reader-test-theme.css','utf8'),'the app builds a different stylesheet: run node tests/fixtures/make_test_theme.cjs');
   assert.equal(await theme(tab),'user-reader-test-dark');
   assert.equal(await tab.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()),JSON.parse(readFileSync('tests/fixtures/reader-test-theme.json','utf8')).dark.bg);
   await context.close();}
  // A suite that names a theme keeps it: in the URL, or in its preferences.
  {const context=await browser.newContext();const tab=await page(context,url+'/?theme=paper');assert.equal(await theme(tab),'paper');await context.close();}
  {const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({theme:'orchid'})));
   const tab=await page(context,url+'/');assert.equal(await theme(tab),'orchid');await context.close();}
  // --product-theme leaves the app's own default.
  {const context=await browser.newContext();const tab=await page(context,product+'/');assert.equal(await theme(tab),'ink');await context.close();}
  console.log('Test theme passed: default from the first paint, frozen stylesheet matches the app, URL and preference themes win, --product-theme opts out.');
 }finally{await browser?.close();for(const {fixture} of runs)if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
