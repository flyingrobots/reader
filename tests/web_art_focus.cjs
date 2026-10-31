/* The art focus view and Regenerate this (#147): the caption's Focus button, a double click and Space G open an
   article's art full screen (live with drag and arrow-key orbit and zoom where motion is allowed, else the still);
   Esc or Close returns to the same place in both layouts with focus restored. Regenerate this opens the Prompt
   Input prefilled with the version's direction (or its Artist's note), with the Art made by menu; submitting queues
   a new version with the edited direction (a fake voice), and the note then counts two versions. Synthetic only. */
// suite: exclusive (drives the live 3D scene, which the art kill switch turns into a still on a starved machine; run_browser_suites.py runs it on a quiet machine)
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 let browser,fixture;
 try{
  fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--art','--art-long','--art-delay','0.02'],{stdio:['ignore','pipe','inherit']});
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async({prefs={},viewport={width:1300,height:900},motion='reduce'}={})=>{
    const context=await browser.newContext({viewport,reducedMotion:motion});
    await context.addInitScript(value=>{try{if(!sessionStorage.getItem('focus-test')){localStorage.setItem('reader.preferences.v1',value);sessionStorage.setItem('focus-test','1');}}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',...prefs}));
    const page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
    return {context,page,errors,external};
  };
  const shown=(page,path)=>page.waitForFunction(p=>document.querySelector('.document-footer')?.textContent.startsWith(p)&&!document.querySelector('.resume-pending'),path);
  const read=async(page,path)=>{await page.goto(url+'#read='+encodeURIComponent(path));await shown(page,path);};
  const settled=(page,selector='#article .art-hero')=>page.waitForFunction(s=>['live','still','image','unavailable','error'].includes(document.querySelector(s)?.dataset.state),selector,{timeout:20000});
  const focusView=page=>page.locator('.art-focus');
  const opened=async page=>{
   await page.waitForFunction(()=>['live','still','image','unavailable'].includes(document.querySelector('.art-focus')?.dataset.state),null,{timeout:15000});
   // These cases exercise the view and its controls. Hover-card/Escape layering is covered by web_art_prompt.cjs.
   await page.locator('.art-focus-heading').hover();
   await page.waitForFunction(()=>!document.querySelector('#art-prompt-card')||document.querySelector('#art-prompt-card').hidden);
  };
  const closed=page=>page.waitForFunction(()=>!document.querySelector('.art-focus'));

  // Continuous reading: Focus, Esc back to the same place; a double click and Close; Space G; the page's keys stay put.
  {const {context,page,errors,external}=await open();
   await read(page,'library/issue/long-art.md');await settled(page);
   await page.evaluate(()=>scrollTo(0,300));await page.waitForTimeout(200);const before=await page.evaluate(()=>scrollY);
   await page.locator('#article .art-hero .art-focus-toggle').click();await opened(page);
   const dialog=await focusView(page).evaluate(el=>({role:el.getAttribute('role'),modal:el.getAttribute('aria-modal'),label:el.getAttribute('aria-label'),box:el.getBoundingClientRect().toJSON(),inside:el.contains(document.activeElement),decoration:el.hasAttribute('data-reader-decoration')}));
   assert.deepEqual([dialog.role,dialog.modal,dialog.label,dialog.inside,dialog.decoration],['dialog','true','Art: A luminous halo',true,true]);
   assert.ok(dialog.box.width>=1299&&dialog.box.height>=899,'full screen');
   assert.equal(await focusView(page).getAttribute('data-state'),'still','reduced motion: the still');
   await page.keyboard.press('j');await page.keyboard.press('G');await page.waitForTimeout(200);
   assert.equal(await page.evaluate(()=>scrollY),before,'the reader’s keys stay with the page behind');
   await page.keyboard.press('Escape');await closed(page);
   assert.equal(await page.evaluate(()=>scrollY),before,'Esc returns to the same place');
   assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('art-focus-toggle')),true,'focus returns to the Focus button');
   await settled(page);
   await page.locator('#article .art-hero .art-surface').dblclick({position:{x:400,y:120}});await opened(page);
   await page.locator('.art-focus [data-focus-close]').click();await closed(page);
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('Shift+G');await opened(page);
   await page.locator('.art-focus [data-focus-note]').click();assert.match(await page.locator('.art-focus-note').textContent(),/Artist’s note\S+ \S+ \S+/);
   await page.keyboard.press('Escape');await closed(page);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Two-page reading: from a later spread, Space G and Esc leave the reader on the same spread.
  {const {context,page,errors}=await open({prefs:{layout:'spread'}});
   await read(page,'library/issue/long-art.md');await settled(page);
   await page.evaluate(()=>{document.querySelector('.book-viewport').scrollLeft=0;});await page.locator('#main').focus();
   await page.keyboard.press('j');await page.waitForTimeout(700);await page.keyboard.press('j');await page.waitForTimeout(700);
   const spread=()=>page.evaluate(()=>{const v=document.querySelector('.book-viewport');return Math.round(v.scrollLeft/(v.clientWidth+(parseFloat(getComputedStyle(document.querySelector('#article')).columnGap)||0)));});
   const at=await spread();assert.ok(at>=2,at);
   await page.keyboard.press('Space');await page.keyboard.press('Shift+G');await opened(page);
   await page.keyboard.press('Escape');await closed(page);await page.waitForTimeout(300);
   assert.equal(await spread(),at,'the same spread');
   assert.deepEqual(errors,[]);await context.close();}

  // Motion allowed: a live scene that drags and arrow-keys around, and the hero is live again after closing.
  {const {context,page,errors}=await open({motion:'no-preference'});
   await read(page,'library/issue/keep.md');await settled(page);
   await page.locator('#article .art-hero .art-focus-toggle').click();await opened(page);
   const state=await focusView(page).getAttribute('data-state');
   if(state==='live'){
     const yaw=()=>page.evaluate(()=>document.querySelector('.art-focus').artView?.view?.yaw);
     assert.equal(await yaw(),0);
     await page.evaluate(()=>{window.__drag=[];const canvas=document.querySelector('.art-focus canvas');for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])canvas?.addEventListener(type,e=>window.__drag.push(type[7]+Math.round(e.clientX)+(e.target===canvas?'':'!')));});
     await page.mouse.move(650,450);await page.mouse.down();await page.mouse.move(520,430,{steps:6});await page.mouse.up();
     // Playwright returns once the input is sent; on a busy machine the page handles it later. Read the turn once the
     // canvas has seen the release.
     await page.waitForFunction(()=>window.__drag.some(entry=>entry.startsWith('u')),null,{timeout:10000}).catch(()=>{});
     const dragged=await yaw();assert.ok(Math.abs(dragged)>.2,`dragging turns the view (${dragged}); canvas saw ${await page.evaluate(()=>window.__drag.join(' '))}; card ${await page.evaluate(()=>!document.querySelector('#art-prompt-card')?.hidden)}`);
     assert.equal(await page.locator('#art-prompt-card:visible').count(),0,'dragging the artwork does not open a hover card');
     await page.locator('.art-focus-stage').focus();await page.keyboard.press('ArrowLeft');assert.ok(await yaw()>dragged,'arrow keys turn it');
     await page.keyboard.press('-');assert.ok(await page.evaluate(()=>document.querySelector('.art-focus').artView.view.zoom)>1,'− zooms out');
     await page.keyboard.press('0');assert.equal(await yaw(),0,'0 resets');
     assert.equal(await page.locator('canvas.art-canvas').count(),1,'one live canvas: the focus view’s');
   }else assert.equal(state,'still','a slow renderer drops to the still');
   await page.screenshot({path:'.reader/web-dev/art-focus.png'});
   await page.keyboard.press('Escape');await closed(page);await settled(page);
   assert.ok(['live','still'].includes(await page.locator('#article .art-hero').getAttribute('data-state')),'the hero is painted again');
   assert.deepEqual(errors,[]);await context.close();}

  // Regenerate this: prefilled with the version's Artist's note (it had no direction), Art made by, the edited
  // direction queues a new version, which then counts as version 1 of 2.
  {const {context,page,errors,external}=await open();
   const posts=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/art'))posts.push(JSON.parse(r.postData()));});
   await read(page,'library/issue/keep.md');await settled(page);
   const brief=await page.evaluate(()=>fetch('/api/art?path=library%2Fissue%2Fkeep.md').then(r=>r.json()).then(d=>d.art.brief));
   await page.locator('#article .art-hero .art-focus-toggle').click();await opened(page);
   await page.locator('.art-focus [data-focus-regenerate]').click();
   const area=page.locator('#art-direction');await area.waitFor();
   assert.equal(await area.inputValue(),brief,'prefilled with the Artist’s note');
   assert.match(await page.locator('.art-regenerate [data-slot=field-description]').textContent(),/had no direction; its Artist’s note is a starting point/);
   assert.equal(await page.evaluate(()=>document.activeElement?.id),'art-direction','the direction has focus');
   assert.match(await page.locator('.art-regenerate [aria-label^="Art made by"]').textContent(),/Painter · fake-model-1/);
   await page.screenshot({path:'.reader/web-dev/art-regenerate.png'});
   await area.fill('A night version: slower, with one bright accent.');await page.keyboard.press('Shift+Enter');await page.keyboard.type('Keep the threads.');
   assert.equal(await area.inputValue(),'A night version: slower, with one bright accent.\nKeep the threads.','Shift+Enter adds a line');
   await page.keyboard.press('Enter');
   await page.waitForFunction(()=>/Queued: Painter is making a new version/.test(document.querySelector('.art-focus-status')?.textContent||''));
   assert.equal(posts.length,1);assert.deepEqual(posts[0],{action:'generate',path:'library/issue/keep.md',producer:'voice:Painter',direction:'A night version: slower, with one bright accent.\nKeep the threads.'});
   for(let tries=0;;tries++){const done=await page.evaluate(()=>fetch('/api/art/jobs').then(r=>r.json()).then(s=>s.jobs.filter(j=>j.path==='library/issue/keep.md').map(j=>j.state)));
     if(done.includes('done'))break;assert.ok(tries<200,JSON.stringify(done));await page.waitForTimeout(300);}
   const data=await page.evaluate(()=>fetch('/api/art?path=library%2Fissue%2Fkeep.md').then(r=>r.json()));
   assert.equal(data.count,2,'a new version beside the old one');assert.equal(data.art.provenance.direction,'A night version: slower, with one bright accent.\nKeep the threads.');
   await page.keyboard.press('Escape');await closed(page);
   await page.waitForFunction(()=>document.querySelector('#article .art-hero .art-provenance')?.textContent.includes('version 1 of 2'),null,{timeout:20000});
   // The new version's Regenerate starts from its direction.
   await page.locator('#article .art-hero .art-focus-toggle').click();await opened(page);await page.locator('.art-focus [data-focus-regenerate]').click();
   await page.locator('#art-direction').waitFor();assert.equal(await page.locator('#art-direction').inputValue(),'A night version: slower, with one bright accent.\nKeep the threads.');
   assert.match(await page.locator('.art-regenerate [data-slot=field-description]').textContent(),/the direction the version on screen was made with/);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#art-direction'));
   assert.equal(await focusView(page).count(),1,'Esc closes the form first, then the view');
   await page.keyboard.press('Escape');await closed(page);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Phone width and a dark theme: the view and the form fit.
  {const {context,page,errors}=await open({viewport:{width:390,height:844},prefs:{theme:'user-reader-test-dark'}});
   await read(page,'library/issue/keep.md');await settled(page);
   await page.locator('#article .art-hero .art-focus-toggle').click();await opened(page);
   await page.locator('.art-focus [data-focus-regenerate]').click();await page.locator('#art-direction').waitFor();
   const box=await page.locator('.art-focus-regenerate').boundingBox();assert.ok(box.x>=11&&box.x+box.width<=379,JSON.stringify(box));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scroll');
   await page.screenshot({path:'.reader/web-dev/art-regenerate-phone.png'});
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Art focus passed: Focus, double click and Space G open the art full screen; Esc and Close return to the same place and focus in both layouts; live orbit and zoom by drag and keys; Regenerate this prefilled from the note or the direction, Art made by, Enter queues a new version with the edited direction, version 1 of 2; 390px dark.');
 }finally{await browser?.close();if(fixture&&fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
