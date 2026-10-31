/* Focused-pane status must use reading state even when embedded footers are hidden. */
const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{let browser;const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine'],{stdio:['ignore','pipe','inherit']});try{
 const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(Error('fixture '+code)));});
 browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,nextReads:false})));
 await page.goto(url+'#read=library%2Fthought.md');await page.locator('#article').waitFor();await page.locator('#main').focus();await page.keyboard.press('Control+w');await page.keyboard.press('v');
 await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
 const frame=await (await page.locator('iframe[title^="Pane 2 of"]').elementHandle()).contentFrame();await frame.locator('#picker:not([hidden])').waitFor();await page.keyboard.press('Escape');await frame.waitForFunction(()=>document.querySelector('#picker').hidden&&!!document.querySelector('#article')&&!document.querySelector('.resume-pending'));
 await page.waitForFunction(()=>document.querySelector('#status-location').textContent.includes('thought.md'));
 assert.match(await page.locator('#status-position').textContent(),/^\d+%$/,'focused article reports progress in the visible outer footer');
 const before=Number((await page.locator('#status-position').textContent()).replace('%',''));for(let i=0;i<8;i++)await page.keyboard.press('j');await frame.waitForFunction(()=>scrollY>300);
 await page.waitForFunction(before=>Number(document.querySelector('#status-position').textContent.replace('%',''))>before,before);
 await page.keyboard.press('Control+w');await page.keyboard.press('h');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent==='1/2');assert.equal(await page.locator('#status-position').textContent(),'0%','focused-pane switch restores its own progress');
 assert.deepEqual(errors,[]);console.log('Split status passed: visible model-based progress updates and follows focused pane.');
}finally{await browser?.close();if(fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}})().catch(error=>{console.error(error);process.exitCode=1;});
