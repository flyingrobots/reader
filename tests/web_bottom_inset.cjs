/* The shared bottom inset (#222): Find, the queue sheet and the chat sheet sit above the status line and the reading progress
   at phone and desktop widths, in every shipped theme; the safe area counts once; progress counts only while it is shown; and
   the end of the article stays reachable above an open Find bar. 195x422 stands in for 200% zoom of a 390x844 phone. Compares rendered rectangles, not a clickable centre. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const GAP=12;
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--queue','--chat'],{stdio:['ignore','pipe','inherit']});let browser;
 const errors=[];
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const doc=url+'#read='+encodeURIComponent('library/field-notes.md');
  const open=async viewport=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});
   await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(doc);await page.locator('#article h1').waitFor();await page.locator('#reading-progress').waitFor();return {page,context};};
  // The top of the chrome: the progress rail while it is shown, else the status line.
  const chrome=page=>page.evaluate(()=>{const s=document.querySelector('#statusline').getBoundingClientRect(),p=document.querySelector('#reading-progress');
   const shown=p&&!p.hidden&&getComputedStyle(p).display!=='none';const q=shown?p.getBoundingClientRect():s;
   return {status:s.top,statusHeight:s.height,top:Math.min(s.top,q.top),left:Math.min(s.left,q.left),right:Math.max(s.right,q.right)};});
  const rect=(page,sel)=>page.locator(sel).evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,width:r.width};});
  const leader=async(page,key)=>{await page.evaluate(()=>document.querySelector('#main').focus({preventScroll:true}));await page.keyboard.press('Space');await page.keyboard.press(key);};
  const openFind=async page=>{await page.evaluate(()=>document.querySelector('#main').focus({preventScroll:true}));await page.keyboard.press('/');await page.locator('#find-query').waitFor({state:'visible'});await page.waitForTimeout(50);};
  const findBox='#find-bar>div';
  const checkFind=async(page,label)=>{const c=await chrome(page),f=await rect(page,findBox);
   assert.ok(f.bottom<=c.top-GAP+.5,`${label}: Find bottom ${f.bottom} must sit ${GAP}px above the chrome top ${c.top}`);return {c,f};};
  const themes=await (await open({width:390,height:844})).page.evaluate(async()=>(await import('/assets/themes.mjs')).THEMES);
  assert.ok(themes.length>=2,'shipped themes load');

  for(const viewport of [{width:195,height:422,zoom:'200% of 390x844'},{width:320,height:640},{width:390,height:844},{width:844,height:390},{width:1300,height:900}]){
   const phone=viewport.width<=700,label=`${viewport.width}x${viewport.height}`;
   const {page,context}=await open({width:viewport.width,height:viewport.height});
   // Find, in every shipped theme.
   await openFind(page);
   for(const theme of themes){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(30);
    await checkFind(page,`${label} ${theme}`);
    if(viewport.width===390||viewport.width===1300)await page.screenshot({path:`.reader/web-dev/bottom-inset-find-${label}-${theme}.png`});}
   await page.evaluate(()=>document.documentElement.dataset.theme='paper');
   if(phone)for(const id of ['#find-query','#find-prev','#find-next','#find-close']){const r=await rect(page,id);assert.ok(r.height>=44-.5,`${label}: ${id} is a 44px target (${r.height})`);
    if(id!=='#find-query')assert.ok(r.width>=44-.5,`${label}: ${id} is 44px wide (${r.width})`);}
   // The safe area counts once: the status line and Find both rise by exactly the inset.
   const before=await checkFind(page,`${label} no safe area`);
   // Chrome's DevTools safe-area override stands in for a notched phone; env(safe-area-inset-bottom) reads it.
   const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:34}});await page.waitForTimeout(30);
   const after=await checkFind(page,`${label} safe area`);
   assert.ok(Math.abs((before.f.bottom-after.f.bottom)-34)<1,`${label}: Find rises by the safe area once (${before.f.bottom}->${after.f.bottom})`);
   assert.ok(Math.abs((after.c.statusHeight-before.c.statusHeight)-34)<1,`${label}: the status line pads the safe area once`);
   await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{}});await page.waitForTimeout(30);
   // Progress counts only while shown.
   const shown=await checkFind(page,`${label} progress shown`);
   await page.evaluate(()=>document.querySelector('#reading-progress').hidden=true);await page.waitForTimeout(30);
   const hidden=await checkFind(page,`${label} progress hidden`);
   assert.ok(hidden.f.bottom>shown.f.bottom+5,`${label}: without progress Find drops to the status line (${shown.f.bottom}->${hidden.f.bottom})`);
   await page.evaluate(()=>document.querySelector('#reading-progress').hidden=false);
   // The last article text clears the open Find bar at the end of the document.
   await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(80);
   const last=await page.evaluate(()=>{const ps=document.querySelectorAll('#article p');return ps[ps.length-1].getBoundingClientRect().bottom;});
   const f=await rect(page,findBox);assert.ok(last<=f.top,`${label}: last text ${last} is above the Find bar ${f.top}`);
   // Keyboard resizing: a shorter viewport keeps the contract.
   await page.setViewportSize({width:viewport.width,height:Math.round(viewport.height*.6)});await page.waitForTimeout(50);await checkFind(page,`${label} keyboard`);
   await page.setViewportSize({width:viewport.width,height:viewport.height});
   await page.keyboard.press('Escape');await page.locator('#find-bar').waitFor({state:'hidden'});
   // The queue and chat sheets end at the top of the chrome.
   for(const [key,sel] of [['r','#queue-panel'],['m','#chat-panel']]){
    await leader(page,key);await page.locator(`${sel}:not([hidden])`).waitFor();await page.waitForTimeout(250);
    const c=await chrome(page),p=await rect(page,sel);
    // A docked column beside a shortened status line does not intersect it either.
    assert.ok(p.bottom<=c.top+.5||p.left>=c.right-.5||p.right<=c.left+.5,`${label}: ${sel} ${JSON.stringify(p)} must not intersect the chrome ${JSON.stringify(c)}`);
    if(viewport.width===390)await page.screenshot({path:`.reader/web-dev/bottom-inset-${sel.slice(1)}-${label}.png`});
    await page.keyboard.press('Escape');await page.locator(sel).waitFor({state:'hidden'});}
   await context.close();}
  assert.deepEqual(errors,[]);
  console.log('Bottom inset passed');
 }finally{await browser?.close();fixture.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
