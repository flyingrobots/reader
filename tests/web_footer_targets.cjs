/* Phone footer targets (#226), using only a disposable synthetic vault: at 700 px and narrower the status line is a 112 px
   footer with two rows, the context (logo, breadcrumb, customization, Admin) above 44 px action targets, with 12 px context
   text. Wider, it stays one compact 48 px row with 36 px controls. The conditional version, speech and split states keep
   their controls through the existing priority pass; nothing spills into a third row or off screen; the safe area counts
   once; every shipped theme and 200% zoom (195x422) keep the contract. Accessible names do not change. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const PHONE={height:112,target:44,caption:12},DESK={height:48,target:36};
const CONTEXT=['reader-home','dock-configure','settings-open','status-location'];
const NAMES=['Back to library','Document outline','Switch to Pages layout','Switch theme','Open Reader Admin'];
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--editions','--versions','--breadcrumbs','--speech'],{stdio:['ignore','pipe','inherit']});let browser;
 const errors=[];
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const essay='library/essays/tidal/tidal.md',deep='library/research/causal/notes/source.md';
  const open=async(viewport,path=essay)=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});
   await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll',nextReads:false}));}catch{}});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url+'#read='+encodeURIComponent(path));await page.locator('#article p').first().waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));await page.waitForTimeout(400);return {page,context};};
  // The rendered footer: its box, each shown child, and each shown control, with the safe area reported separately.
  const measure=page=>page.evaluate(()=>{const line=document.querySelector('#statusline'),box=e=>e.getBoundingClientRect(),l=box(line);
   const pad=parseFloat(getComputedStyle(line).paddingBottom)||0;
   const shown=e=>getComputedStyle(e).display!=='none'&&box(e).width>0&&box(e).height>0;
   const flow=[...line.children].filter(e=>shown(e)&&!['absolute','fixed'].includes(getComputedStyle(e).position)).map(e=>{const r=box(e);return {id:e.id,top:r.top,bottom:r.bottom,left:r.left,right:r.right};});
   const controls=[...line.querySelectorAll('button,[role=button],a[href],select')].filter(e=>shown(e)&&!e.closest('[data-status-hidden]')&&box(e).width>2)
    .map(e=>{const r=box(e);return {id:e.id||e.getAttribute('aria-label')||e.textContent.trim().slice(0,20),name:e.getAttribute('aria-label')||e.textContent.trim(),context:!!e.closest('#status-location'),width:r.width,height:r.height};});
   const font=sel=>{const e=line.querySelector(sel);return e&&shown(e)?parseFloat(getComputedStyle(e).fontSize):null;};
   return {top:l.top,bottom:l.bottom,height:l.height-pad,pad,flow,controls,scroll:document.documentElement.scrollWidth<=innerWidth+1,
    fonts:{mode:font('#vim-mode'),crumb:font('#status-location [aria-current]'),position:font('#status-position'),section:font('#status-section')},
    all:[...line.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label'))};});
  const check=async(page,label,phone,essentials=['reader-home','status-location','settings-open'])=>{const m=await measure(page),want=phone?PHONE:DESK;
   assert.ok(Math.abs(m.height-want.height)<1.5,`${label}: the footer is ${want.height}px without the safe area (${m.height}; ${JSON.stringify(m.flow)})`);
   assert.ok(m.scroll,`${label}: no horizontal page scroll`);
   for(const id of essentials)assert.ok(m.flow.some(f=>f.id===id),`${label}: ${id} stays shown (${m.flow.map(f=>f.id)})`);
   for(const f of m.flow)assert.ok(f.top>=m.top-.5&&f.bottom<=m.bottom-m.pad+.5&&f.left>=-.5&&f.right<=viewportWidth+.5,`${label}: ${f.id} ${JSON.stringify(f)} stays inside the footer`);
   if(phone){
    const context=m.flow.filter(f=>CONTEXT.includes(f.id)),actions=m.flow.filter(f=>!CONTEXT.includes(f.id));
    const contextBottom=Math.max(...context.map(f=>f.bottom)),actionTop=Math.min(...actions.map(f=>f.top));
    assert.ok(contextBottom<=actionTop+.5,`${label}: the context row ${JSON.stringify(context)} sits above the action row ${JSON.stringify(actions)}`);
    for(const c of m.controls.filter(c=>!c.context))assert.ok(c.height>=want.target-.5&&c.width>=want.target-.5,`${label}: ${c.id} is a ${want.target}px target (${c.width}x${c.height})`);
    for(const [key,size] of Object.entries(m.fonts))if(size!==null)assert.ok(size>=want.caption,`${label}: the ${key} caption is at least ${want.caption}px (${size})`);
   }else{
    const mid=(m.top+m.bottom-m.pad)/2;
    for(const f of m.flow)assert.ok(f.top<=mid&&f.bottom>=mid,`${label}: ${f.id} sits on the one compact row`);
    for(const c of m.controls.filter(c=>!c.context))assert.ok(c.height>=want.target-.5,`${label}: ${c.id} is ${want.target}px tall (${c.height})`);
   }
   return m;};
  let viewportWidth=0;
  const themes=await (async()=>{const {page,context}=await open({width:390,height:844});const t=await page.evaluate(async()=>(await import('/assets/themes.mjs')).THEMES);await context.close();return t;})();
  assert.ok(themes.length>=2,'shipped themes load');

  for(const [viewport,path] of [[{width:195,height:422},essay],[{width:320,height:640},essay],[{width:320,height:640},deep],[{width:390,height:844},essay],[{width:390,height:844},deep],[{width:834,height:1112},essay],[{width:1440,height:900},essay],[{width:1440,height:900},deep]]){
   viewportWidth=viewport.width;const phone=viewport.width<=700,label=`${viewport.width}x${viewport.height} ${path.split('/').pop()}`;
   const {page,context}=await open(viewport,path);
   const m=await check(page,label,phone);
   // Accessible names do not change, and the version chip stays available (shown, or given way by priority).
   for(const name of NAMES)assert.ok(m.all.includes(name),`${label}: the footer still names "${name}"`);
   if(path===essay)assert.equal(await page.locator('#status-version').count(),1,`${label}: the version control stays in the footer`);
   if(viewport.width===390||viewport.width===1440){
    for(const theme of themes){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(30);await check(page,`${label} ${theme}`,phone);
     if(path===essay)await page.screenshot({path:`.reader/web-dev/footer-targets-${viewport.width}-${theme}.png`,clip:{x:0,y:viewport.height-140,width:viewport.width,height:140}});}
    await page.evaluate(()=>document.documentElement.dataset.theme='paper');}
   // The safe area counts once: the footer grows by exactly the inset.
   const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:34}});await page.waitForTimeout(60);
   const safe=await check(page,`${label} safe area`,phone);assert.ok(Math.abs(safe.pad-34)<1,`${label}: the footer pads the safe area once (${safe.pad})`);
   await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{}});await context.close();}

  // Split view puts its pane indicator on the context row. Splitting is refused at 390 px, so a desktop split narrows to it.
  for(const width of [390,1440]){viewportWidth=width;const {page,context}=await open({width:1440,height:844});
   await page.locator('#main').focus();await page.keyboard.press('Control+w');await page.waitForTimeout(100);await page.keyboard.press('v');
   await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);await page.keyboard.press('Escape');
   await page.locator('#split-indicator').waitFor();await page.setViewportSize({width,height:844});await page.waitForTimeout(400);
   // The new pane's picker leaves it without a document, so it has no breadcrumb.
   const m=await check(page,`${width} split view`,width<=700,width<=700?['reader-home','mobile-dock','settings-open']:['reader-home','split-indicator','settings-open']);
   assert.ok(m.flow.some(f=>f.id===(width<=700?'mobile-dock':'split-indicator')),`${width}: the appropriate controls are shown`);await context.close();}

  // Speech: the transport joins the action row with the same targets.
  for(const width of [390,1440]){viewportWidth=width;const {page,context}=await open({width,height:844});
   await page.evaluate(()=>{const Native=window.Audio;window.Audio=function(src){const a=src===undefined?new Native():new Native(src);a.loop=true;return a;};window.Audio.prototype=Native.prototype;});
   await page.locator('#speak-article').click();if(width<=700){await page.locator('[data-dock-tool=speak]').click();await page.getByRole('heading',{name:'Playback',exact:true}).waitFor();await page.locator('[data-slot=popover-content] [data-speech-control]').waitFor({timeout:15000});await page.keyboard.press('Escape');}else await page.locator('#speech-slot [data-speech-control]').waitFor({timeout:15000});await page.waitForTimeout(300);
   const m=await check(page,`${width} speech`,width<=700);
   assert.ok(m.flow.some(f=>f.id==='speech-slot')||width<=700,`${width}: the speech control is shown`);
   if(width===390)await page.screenshot({path:'.reader/web-dev/footer-targets-390-speech.png',clip:{x:0,y:844-140,width,height:140}});
   await context.close();}
  assert.deepEqual(errors,[]);
  console.log('Footer targets passed: 112px two-row phone footer with 44px actions and 12px context, 48px desktop row with 36px controls, version, split and speech states, every theme, 200% zoom, safe area once.');
 }finally{await browser?.close();fixture.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
