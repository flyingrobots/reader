/* Footer keyboard feedback and a touch-only tool dock against a synthetic vault. */
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
  const page=await browser.newPage({viewport:{width:1300,height:900},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,proseColors:'off',theme:'paper'}));});
  await page.goto(url+'#read=library/prose.md');await page.locator('#article').waitFor();
  assert.equal(await page.locator('#vim-mode[data-slot=badge]').count(),0,'the mode badge is removed');
  assert.ok(!await page.locator('#vim-mode').isVisible(),'mode state takes no footer space');
  await page.locator('#main').focus();await page.keyboard.press('Space');
  await page.locator('#key-suggestions').waitFor();
  assert.match(await page.locator('#key-suggestions').textContent(),/chat|speak/);
  assert.match(await page.locator('#status-pending').textContent(),/Space/);
  const suggestions=await page.locator('#key-suggestions').boundingBox(),progress=await page.locator('#reading-progress').boundingBox();
  assert.ok(suggestions.y+suggestions.height<=progress.y,'suggestions sit above the reading progress controls');
  await page.screenshot({path:'.reader/web-dev/keyboard-feedback.png'});
  await page.keyboard.press('Escape');await page.keyboard.press('j');
  assert.match(await page.locator('#key-feedback').textContent(),/j/);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#mobile-dock').waitFor();
  assert.ok(!await page.locator('#key-feedback').isVisible(),'keyboard feedback is hidden on phones');
  assert.ok(await page.locator('#statusline').evaluate(el=>el.getBoundingClientRect().height>=108));
  assert.equal(await page.locator('[data-dock-slot]').count(),4);
  await page.locator('[data-dock-tool=speak]').click();await page.locator('#speak-menu').waitFor();await page.keyboard.press('Escape');
  await page.locator('[data-dock-tool=chat]').click();await page.locator('#chat-input').waitFor();await page.locator('#chat-close').click();
  await page.locator('[data-dock-tool=search]').click();await page.locator('#search-query').waitFor();await page.goBack();await page.locator('#article').waitFor();
  await page.getByRole('button',{name:'Colorful Language',exact:true}).filter({visible:true}).click();
  await page.getByRole('menuitemradio',{name:'Clear',exact:true}).click();
  await page.waitForFunction(()=>document.body.classList.contains('prose-clear'));
  await page.getByRole('menuitemradio',{name:'Clear',exact:true}).waitFor({state:'detached'});
  await page.getByRole('button',{name:'Colorful Language',exact:true}).filter({visible:true}).click();
  await page.getByRole('menuitemradio',{name:'Off',exact:true}).click();
  await page.waitForFunction(()=>!document.body.classList.contains('prose-clear'));
  await page.getByRole('button',{name:'Customize dock'}).click();
  await page.getByLabel('Slot 1',{exact:true}).click();await page.getByRole('option',{name:'Settings',exact:true}).click();
  await page.getByLabel('Slot 2',{exact:true}).click();await page.getByRole('option',{name:'Empty',exact:true}).click();
  await page.getByRole('button',{name:'Save dock',exact:true}).click();
  await page.reload();await page.locator('[data-dock-tool=settings]').waitFor();
  assert.equal(await page.locator('[data-dock-slot="1"]').getByRole('button',{name:'Choose tool for slot 2'}).count(),1);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).mobileDock),['settings','','search','colors']);
  for(const width of [320,390,700]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));for(const button of await page.locator('#mobile-dock button').all()){const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44,'dock controls have touch targets');}}
  await page.locator('[data-dock-tool=settings]').click();await page.waitForURL(/#admin\/settings/);
  assert.deepEqual(errors,[]);console.log('Mobile dock passed: key feedback, touch colors, four configurable slots, persistence and touch targets.');
 }finally{await browser?.close();if(fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
