/* Mobile dock integration: explorer chrome and Chat in a narrowed desktop split. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--prose','--chat'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking']});
  const failures=[];
  for(const scenario of ['explorer','split-chat']){
   const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
   await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,proseColors:'off',theme:'paper'})));
   const page=await context.newPage();
   try{
    await page.goto(url+'#read=library/prose.md');await page.locator('#article').waitFor();await page.locator('#main').focus();
    if(scenario==='explorer'){
     await page.setViewportSize({width:390,height:844});await page.keyboard.press(':');await page.locator('#command-input').fill('files');await page.keyboard.press('Enter');await page.locator('.file-explorer').waitFor();
     const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:34}});
     await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('#statusline')).paddingBottom)===34);
     const explorer=await page.locator('.file-explorer').boundingBox(),footer=await page.locator('#statusline').boundingBox();
     assert.ok(explorer.y+explorer.height<=footer.y,'File Explorer clears the mobile footer including its safe area: '+JSON.stringify({explorer,footer}));
    }else{
     await page.keyboard.press('Control+w');await page.keyboard.press('v');await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
     const two=await (await page.locator('iframe[title^="Pane 2 of"]').elementHandle()).contentFrame();await two.locator('#article').waitFor();await two.locator('#picker').waitFor();await page.keyboard.press('Escape');await two.locator('#picker').waitFor({state:'hidden'});
     await page.setViewportSize({width:390,height:844});await page.locator('#mobile-dock').waitFor();
     assert.ok(await page.locator('[data-dock-tool=chat]').isEnabled(),'Chat stays enabled for a current document in the focused split pane');
     await page.locator('[data-dock-tool=chat]').click();await page.locator('#chat-input').waitFor();assert.match(await page.locator('#chat-title').textContent(),/Colored prose/);
    }
   }catch(error){failures.push(scenario+': '+error.message);}finally{await context.close();}
  }
  assert.deepEqual(failures,[]);console.log('Dock edges passed: safe-area File Explorer and focused split-pane Chat.');
 }finally{await browser?.close();if(fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
