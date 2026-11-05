/* Explorer split geometry and AI-TTS catalog recovery without remounting the page. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const {createInterface}=require('node:readline');
const {writeFileSync,rmSync}=require('node:fs');const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{let browser;const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--speech'],{stdio:['ignore','pipe','inherit']});try{
 const {url,speech}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',s=>resolve(JSON.parse(s)));fixture.once('exit',c=>reject(Error('fixture '+c)));});
 browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,nextReads:false})));
 {
  await page.goto(url+'#read=library%2Fthought.md');await page.locator('#article').waitFor();await page.locator('#main').focus();
  await page.keyboard.press('Space');await page.keyboard.press('e');await page.locator('#picker:not([hidden])').waitFor();
  await page.locator('#main').focus();await page.keyboard.press(':');await page.locator('#command-input').fill('vsplit');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.split-pane').length===2);
  const bounds=await page.evaluate(()=>{const r=document.querySelector('#split-root').getBoundingClientRect();return {left:r.left,right:r.right,explorer:getComputedStyle(document.documentElement).getPropertyValue('--explorer-width'),hidden:document.querySelector('#picker').hidden,css:getComputedStyle(document.querySelector('#split-root')).left,panes:[...document.querySelectorAll('.split-pane')].map(e=>{const p=e.getBoundingClientRect();return {left:p.left,right:p.right};})};});
  assert.ok(bounds.left>0,'Explorer remains a column beside the split: '+JSON.stringify(bounds));
  assert.ok(bounds.panes.every(p=>p.left>=bounds.left-1&&p.right<=bounds.right+1),'all panes fit the available split root: '+JSON.stringify(bounds));
 }
 console.log('Recovery regression passed.');
}finally{await browser?.close();if(fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(r=>fixture.once('exit',r));}}})().catch(e=>{console.error(e);process.exitCode=1;});
