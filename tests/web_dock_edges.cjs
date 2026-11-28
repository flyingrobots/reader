/* Mobile dock integration: explorer chrome and Chat in a narrowed desktop split. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--prose','--chat','--editions','--versions'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking']});
  const failures=[];
  for(const scenario of ['explorer','split-chat','keyboard-resize','mode-live','suggestions-live','versions','colors-race']){
   const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
   await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,proseColors:'off',theme:'paper'})));
   const page=await context.newPage();
   let releaseProbe,probeStarted;const probeGate=new Promise(resolve=>{releaseProbe=resolve;}),started=new Promise(resolve=>{probeStarted=resolve;});
   if(scenario==='colors-race')await page.route('**/api/prose',async route=>{if(route.request().method()==='GET'){probeStarted();await probeGate;}await route.continue();});
   try{
    await page.goto(url+'#read=library/prose.md');await page.locator('#article').waitFor();await page.locator('#main').focus();
    if(scenario==='explorer'){
     await page.setViewportSize({width:390,height:844});await page.keyboard.press(':');await page.locator('#command-input').fill('files');await page.keyboard.press('Enter');await page.locator('.file-explorer').waitFor();
     const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:34}});
     await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('#statusline')).paddingBottom)===34&&parseFloat(getComputedStyle(document.querySelector('.file-explorer')).bottom)===149);
     const explorer=await page.locator('.file-explorer').boundingBox(),footer=await page.locator('#statusline').boundingBox();
     assert.ok(explorer.y+explorer.height<=footer.y,'File Explorer clears the mobile footer including its safe area: '+JSON.stringify({explorer,footer}));
    }else if(scenario==='keyboard-resize'){
     await page.keyboard.press('j');await page.setViewportSize({width:390,height:844});await page.keyboard.press('k');await page.setViewportSize({width:1300,height:900});
     assert.equal(await page.locator('#key-feedback kbd').first().textContent(),'k','desktop feedback reflects the latest recognized key after resizing');
    }else if(scenario==='mode-live'){
     await page.setViewportSize({width:390,height:844});assert.notEqual(await page.locator('#mode-live').evaluate(el=>getComputedStyle(el).display),'none','mobile retains its screen-reader mode announcement');
    }else if(scenario==='suggestions-live'){
     assert.equal(await page.locator('#key-suggestions-live[aria-live=polite]').count(),1,'suggestion live region exists before a chord starts');
     await page.keyboard.press('Space');assert.match(await page.locator('#key-suggestions-live').textContent(),/chat/);
    }else if(scenario==='versions'){
     await page.goto(url+'#read=library/essays/tidal/tidal.md');await page.locator('[data-version-chip]').waitFor();await page.setViewportSize({width:568,height:320});
     await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('v');await page.locator('#versions-panel').waitFor();
     const box=await page.locator('#versions-panel').boundingBox();assert.ok(box.y>=0,'Versions header stays within a landscape phone viewport');
    }else if(scenario==='colors-race'){
     await page.setViewportSize({width:390,height:844});const colors=page.locator('#mobile-dock').getByRole('button',{name:'Colorful Language'});
     await colors.click();await page.getByRole('menuitemradio',{name:'Subtle',exact:true}).focus();await page.keyboard.press('Enter');await started;
     await colors.click();await page.getByRole('menuitemradio',{name:'Off',exact:true}).focus();await page.keyboard.press('Space');
     const response=page.waitForResponse(r=>r.url().endsWith('/api/prose')&&r.request().method()==='GET');releaseProbe();await (await response).finished();
     await page.waitForFunction(()=>!document.querySelector('[data-slot=dropdown-menu-content]'));
     assert.ok(await page.evaluate(()=>!/prose-(subtle|clear|vivid)/.test(document.body.className)),'Off remains selected after an older enable probe resolves');
    }else{
     await page.keyboard.press('Control+w');await page.keyboard.press('v');await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
     const two=await (await page.locator('iframe[title^="Pane 2 of"]').elementHandle()).contentFrame();await two.locator('#article').waitFor();await two.locator('#picker').waitFor();await page.keyboard.press('Escape');await two.locator('#picker').waitFor({state:'hidden'});
     await page.setViewportSize({width:390,height:844});await page.locator('#mobile-dock').waitFor();
     assert.ok(await page.locator('[data-dock-tool=chat]').isEnabled(),'Chat stays enabled for a current document in the focused split pane');
     await page.locator('[data-dock-tool=chat]').click();await page.locator('#chat-input').waitFor();assert.match(await page.locator('#chat-title').textContent(),/Colored prose/);
    }
   }catch(error){failures.push(scenario+': '+error.message);}finally{releaseProbe();await context.close();}
  }
  assert.deepEqual(failures,[]);console.log('Dock edges passed: safe-area explorer, split Chat, resize feedback, live regions, landscape Versions and late color probes.');
 }finally{await browser?.close();if(fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
