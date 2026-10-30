/* Reader Admin (RW-45): routed sections in a sidebar layout instead of the long Behind the scenes page. Covers the entry
   points and legacy route, Settings opening at its top without scrollIntoView, Back/Forward and direct reloads, Back to
   Library restoring the document's saved place (and a split layout) without new reading progress, no reading chrome or
   smoother in Admin, unavailable backends, a read-only Overview, focus and keyboard use, and phone width (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const shots=process.env.READER_SHOTS||'.reader/web-dev';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--maintenance','--inbox'],{stdio:['ignore','pipe','inherit']});let browser;
 const errors=[],external=[];
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync(shots,{recursive:true});
  /** A context whose pages count scrollIntoView calls and remember every admin section that was ever mounted. */
  const open=async(prefs={},{viewport={width:1300,height:860},motion='reduce'}={})=>{
    const context=await browser.newContext({viewport,reducedMotion:motion});
    await context.addInitScript(value=>{
      try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',value);}catch{}
      window.__scrollIntoView=[];const original=Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView=function(...args){window.__scrollIntoView.push(this.id||this.className||this.tagName);return original.apply(this,args);};
      window.__sections=[];new MutationObserver(()=>{const el=document.getElementById('admin-content');const id=el?.dataset.adminSection;if(id&&window.__sections.at(-1)!==id)window.__sections.push(id);}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-admin-section']});
    },JSON.stringify({smooth:false,theme:'paper',nextReads:false,backlinks:false,...prefs}));
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/status of 50[03]/.test(m.text()))errors.push(m.text());});
    page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
    return {page,context};
  };
  const hash=page=>page.evaluate(()=>decodeURIComponent(location.hash));
  const heading=page=>page.evaluate(()=>({focused:document.activeElement?.id==='admin-title',text:document.querySelector('#admin-title')?.textContent,top:document.querySelector('#admin-title')?.getBoundingClientRect().top,scrollY}));
  const atSection=(page,id,title)=>page.waitForFunction(([id,title])=>document.querySelector('#admin-content')?.dataset.adminSection===id&&document.activeElement?.id==='admin-title'&&document.activeElement.textContent===title,[id,title],{timeout:8000});
  const settled=page=>page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending')&&!document.querySelector('[data-skeleton]'));
  const command=async(page,text)=>{await page.locator('#main').focus();await page.keyboard.press(':');await page.keyboard.type(text);await page.keyboard.press('Enter');};
  const leader=async(page,key)=>{await page.keyboard.press('Space');await page.keyboard.press(key);};
  // Each acceptance check runs on its own context and reports separately, so one failure does not hide the others.
  const failures=[];
  const check=async(name,body)=>{try{await body();console.log('ok   '+name);}catch(error){failures.push(name);console.log('FAIL '+name+': '+String(error?.message||error).split('\n')[0].slice(0,300));}finally{for(const c of browser.contexts())await c.close().catch(()=>{});}};

  // 1. The footer's Backstage, :backstage and the legacy #backstage open Overview, its heading focused at the top.
  await check('entry',async()=>{const {page,context}=await open();
   const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
   await page.goto(url);await page.locator('#home-title').waitFor();await page.waitForTimeout(500);posts.length=0;
   await page.locator('#settings-open').click();await atSection(page,'overview','Overview');
   assert.equal(await hash(page),'#admin');let h=await heading(page);assert.equal(h.scrollY,0);assert.ok(h.top>=0&&h.top<200,'Overview heading at the top: '+h.top);
   assert.equal(await page.locator('#vim-mode').textContent(),'ADMIN');
   assert.equal(await page.locator('#status-location [aria-current=page]').textContent(),'Reader Admin');
   assert.equal(await page.locator('[data-admin-breadcrumb] [aria-current=page]').textContent(),'Overview');
   assert.equal(await page.locator('[data-admin-nav=overview]').getAttribute('aria-current'),'page');
   // Overview is read-only: real tiles from the polled status, and nothing started (no POST at all).
   for(const tile of ['active','inbox','attention','indexes'])await page.locator(`[data-overview=${tile}][data-state=ready]`).waitFor({timeout:8000});
   assert.match(await page.locator('[data-overview=inbox]').textContent(),/3 arrivals waiting/);
   assert.match(await page.locator('[data-overview=indexes]').textContent(),/Not checked yet/,'no check has run, and none is started');
   await page.waitForTimeout(1500);assert.deepEqual(posts,[],'opening Overview writes nothing and starts nothing');
   await page.screenshot({path:shots+'/admin-overview.png'});
   await page.goto(url+'/?fresh=1');await page.locator('#home-title').waitFor();
   await command(page,'backstage');await atSection(page,'overview','Overview');assert.equal(await hash(page),'#admin');
   await page.goto(url+'/?fresh=2#backstage');await atSection(page,'overview','Overview');
   assert.equal(await hash(page),'#admin','the legacy route shows its new address');
   assert.deepEqual(await page.evaluate(()=>window.__sections),['overview']);
   assert.deepEqual(await page.evaluate(()=>window.__scrollIntoView),[],'no scrollIntoView on the way in');
   await context.close();});

  // 2. Space p, :settings and a bare :set open Settings at its own top, never part-way down a page.
  await check('settings',async()=>{const {page,context}=await open();
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await settled(page);
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight/2));await page.waitForTimeout(200);
   await page.locator('#main').focus();await leader(page,'p');await atSection(page,'settings','Settings');
   assert.equal(await hash(page),'#admin/settings');let h=await heading(page);assert.equal(h.scrollY,0,'Settings starts at the top');assert.ok(h.top>=0&&h.top<200);
   assert.notEqual(await page.locator('#vim-mode').textContent(),'INSERT','the heading has focus, not a field');
   // From a long admin page scrolled down, :set and :settings return to Settings' top.
   await page.locator('[data-admin-nav=library]').click();await atSection(page,'library','Library');await page.locator('#backstage-library .statistics-grid').waitFor();
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>scrollY)>0,'Library scrolls natively');
   await command(page,'set');await atSection(page,'settings','Settings');h=await heading(page);assert.equal(h.scrollY,0);
   await page.evaluate(()=>scrollTo(0,400));await command(page,'settings');await page.waitForFunction(()=>scrollY===0&&document.activeElement?.id==='admin-title');
   assert.equal(await hash(page),'#admin/settings');
   assert.deepEqual(await page.evaluate(()=>window.__scrollIntoView),[],'Settings is its own page: no scrollIntoView');
   // Typing in a settings field stays in the field: no reader keys, no navigation.
   const field=page.locator('#profile-name');await field.click();await field.press('End');await page.keyboard.type(' jkhp');
   assert.match(await field.inputValue(),/ jkhp$/);assert.equal(await hash(page),'#admin/settings');
   // Space on a focused control activates it (the Theme Editor button), instead of starting the leader.
   await page.locator('#theme-editor-open').focus();await page.keyboard.press('Space');await page.locator('#theme-editor').waitFor();await page.keyboard.press('F10');await page.locator('#theme-editor').waitFor({state:'hidden'});
   await context.close();});

  // 3. Back/Forward and direct reloads keep the right page and heading; a reload never mounts Overview first.
  await check('history',async()=>{const {page,context}=await open();
   await page.goto(url+'#admin');await atSection(page,'overview','Overview');
   await page.locator('[data-admin-nav=inbox]').click();await atSection(page,'inbox','Inbox');assert.equal(await hash(page),'#admin/inbox');
   await page.locator('#inbox [data-arrival]').first().waitFor();
   await page.locator('[data-admin-nav=indexes]').click();await atSection(page,'indexes','Indexes');
   await page.goBack();await atSection(page,'inbox','Inbox');await page.goBack();await atSection(page,'overview','Overview');
   await page.goForward();await atSection(page,'inbox','Inbox');assert.equal((await heading(page)).scrollY,0);
   await page.goto(url+'/?fresh=3#admin/indexes');await atSection(page,'indexes','Indexes');
   assert.deepEqual(await page.evaluate(()=>window.__sections),['indexes'],'a direct load opens the section itself');
   await page.reload();await atSection(page,'indexes','Indexes');assert.deepEqual(await page.evaluate(()=>window.__sections),['indexes']);
   await page.goto(url+'/?fresh=4#admin/no-such-page');await page.locator('#admin-not-found').waitFor();assert.equal(await page.locator('#admin-title').textContent(),'Section not found');
   assert.equal(await page.locator('#vim-mode').textContent(),'ADMIN');
   await context.close();});

  // 4. Back to Library: the document's saved place returns, Admin creates no reading progress, and Admin has no
  //    reading chrome, pagination or smoother (two-page reading, motion allowed so the smoother would run).
  await check('return-scroll',async()=>{const {page,context}=await open({layout:'scroll',smooth:true},{motion:'no-preference'});
   const marks=[];page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/bookmark')marks.push(JSON.parse(r.postData()));});
   // A fake page clock makes the smoother's glides and the save timers deterministic: once the document has settled the
   // clock is paused, and every glide, save and render below runs for an explicit stretch of page time.
   // Every block is laid out (no content-visibility estimates), so heights do not depend on which blocks Chrome
   // happened to render during a glide; web_content_visibility.cjs covers that layout.
   await context.clock.install();
   await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');
     style.textContent='#article>*{content-visibility:visible!important;contain-intrinsic-size:none!important}';document.head.append(style);}));
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await settled(page);
   assert.ok(await page.evaluate(()=>!!window.ScrollSmoother?.get()),'reading uses the smoother here');
   await page.clock.pauseAt(await page.evaluate(()=>Date.now())+100);
   const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
   /** Advance page time in 50 ms steps until `cond` holds (real time passes too, for the server and the network). */
   const advance=async(cond,arg,limit=200)=>{for(let i=0;i<limit;i++){if(await page.evaluate(cond,arg))return;await page.clock.runFor(50);await pause(10);}throw new Error('page time ran out waiting for '+cond);};
   const posted=async count=>{for(let i=0;i<300&&marks.length<count;i++){await page.clock.runFor(50);await pause(10);}};
   const onBlock=()=>page.evaluate(()=>{const line=innerHeight*.22;return [...document.querySelectorAll('#article [data-source-start]')].some(el=>{const r=el.getBoundingClientRect();return r.top<=line&&r.bottom>line;});});
   await page.locator('#main').focus();for(let i=0;i<40;i++)await page.keyboard.press('j');
   await page.clock.runFor(3000);await posted(1);
   // A place on a block (not between two), so the check below can find that block again.
   for(let i=0;i<12&&!await onBlock();i++){await page.keyboard.press('j');await page.clock.runFor(2000);}
   const settledMarks=marks.length;await page.clock.runFor(2000);await posted(settledMarks+1);
   assert.ok(await onBlock()&&marks.at(-1)?.source_offset!=null,'reading saved a place on a block');
   const place=await page.locator('#status-position').textContent();assert.notEqual(place,'0%','a place part-way down');
   // Leaving the document saves its own place, as any navigation does; that is the place Back to Library restores.
   const leaving=marks.length;
   await page.locator('#settings-open').click();
   await advance(()=>document.querySelector('#admin-content')?.dataset.adminSection==='overview'&&document.activeElement?.id==='admin-title');
   await posted(leaving+1);
   const saved=marks.at(-1),before=marks.length;
   assert.ok(saved.source_offset!=null,'leaving saved a place on a block: '+JSON.stringify([saved.source_offset,saved.block_fraction]));
   const chrome=await page.evaluate(()=>({smoother:!!window.ScrollSmoother?.get(),twoPage:document.body.classList.contains('two-page'),progress:document.querySelector('#reading-progress').hidden,pages:document.querySelector('#pagination-slot').children.length,footer:!!document.querySelector('.document-footer'),article:!!document.querySelector('#article'),transform:document.querySelector('#smooth-content')?.style.transform||''}));
   assert.deepEqual(chrome,{smoother:false,twoPage:false,progress:true,pages:0,footer:false,article:false,transform:''},'no reading chrome or smoother in Admin');
   assert.equal(await page.locator('#status-position').textContent(),'','no reading position in the status line');
   for(const id of ['library','indexes','settings']){await page.locator(`[data-admin-nav=${id}]`).click();await advance(id=>document.querySelector('#admin-content')?.dataset.adminSection===id,id);await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.clock.runFor(300);}
   await page.clock.runFor(2000);await pause(300);assert.equal(marks.length,before,'Admin never saves a reading position');
   await page.locator('#admin-back').click();
   await advance(()=>document.querySelector('.document-footer')&&!document.querySelector('.resume-pending')&&!document.querySelector('[data-skeleton]'));
   assert.equal(await hash(page),'#read=library/thought.md');
   await page.clock.runFor(3000);await pause(300);
   // Native scroll events can arrive before the smooth renderer has caught up. Hold its ticker to model a
   // delayed frame, briefly move the native offset, then restore it without changing the visible passage.
   // An autosave during that gap must not replace the bookmark with an intermediate visual position.
   const beforeLag=marks.length;
   const gap=await page.evaluate(()=>{
     window.__resumeWake=gsap.ticker.wake;window.__resumeY=scrollY;
     gsap.ticker.sleep();gsap.ticker.wake=()=>{};
     scrollTo(0,scrollY+60);
     return Math.abs(scrollY+document.querySelector('#smooth-content').getBoundingClientRect().top);
   });
   assert.ok(gap>30,'the native and visible scroll positions differ during the delayed frame: '+gap);
   await page.clock.runFor(1000);await pause(100);
   assert.equal(marks.length,beforeLag,'no automatic bookmark is saved while the smooth renderer lags');
   await page.evaluate(()=>{scrollTo(0,window.__resumeY);gsap.ticker.wake=window.__resumeWake;delete window.__resumeWake;gsap.ticker.wake();});
   await page.clock.runFor(3000);await pause(100);
   // The saved block is back at the reading line, at the depth it was saved (the percentage is an estimate while far
   // blocks settle their heights, so it is not compared).
   const back=await page.evaluate(offset=>{const el=document.querySelector(`#article [data-source-start="${offset}"]`);const r=el?.getBoundingClientRect();return r?{top:Math.round(r.top),bottom:Math.round(r.bottom),line:Math.round(innerHeight*.22),fraction:(innerHeight*.22-r.top)/r.height}:null;},saved.source_offset);
   assert.ok(back&&Math.abs(back.fraction-saved.block_fraction)<0.05,'the saved block is back at its line: '+JSON.stringify({back,saved:saved.block_fraction}));
   const same=m=>m.source_offset===saved.source_offset&&Math.abs(m.block_fraction-saved.block_fraction)<0.05;
   assert.ok(marks.slice(before).every(same),'returning does not move the bookmark: '+JSON.stringify({saved:[saved.source_offset,saved.block_fraction],after:marks.slice(before).map(m=>[m.source_offset,m.block_fraction])}));
   // A genuinely new place must be saved after the delayed renderer catches up, without another scroll event.
   const beforeResume=marks.length;
   await page.evaluate(offset=>{
     const r=document.querySelector(`#article [data-source-start="${offset}"]`).getBoundingClientRect();
     const fraction=(innerHeight*.22-r.top)/r.height;
     window.__resumeWake=gsap.ticker.wake;gsap.ticker.sleep();gsap.ticker.wake=()=>{};
     scrollTo(0,scrollY+r.height*(fraction>.5?-.25:.25));
   },saved.source_offset);
   await page.clock.runFor(1000);await pause(100);
   assert.equal(marks.length,beforeResume,'the second delayed frame also defers saving');
   await page.evaluate(()=>{gsap.ticker.wake=window.__resumeWake;delete window.__resumeWake;gsap.ticker.wake();});
   await advance(()=>Math.abs(scrollY+document.querySelector('#smooth-content').getBoundingClientRect().top)<1);
   await posted(beforeResume+1);
   assert.ok(marks.length>beforeResume,'a new bookmark is posted after the renderer settles');
   const resumed=marks.at(-1),visible=await page.evaluate(offset=>{const r=document.querySelector(`#article [data-source-start="${offset}"]`)?.getBoundingClientRect();return r?(innerHeight*.22-r.top)/r.height:null;},saved.source_offset);
   assert.equal(resumed.source_offset,saved.source_offset,'the new position is within the same source block');
   assert.ok(visible!==null&&Math.abs(resumed.block_fraction-visible)<.05&&Math.abs(resumed.block_fraction-saved.block_fraction)>.15,'the saved fraction matches the new settled place');
   assert.ok(await page.evaluate(()=>!!window.ScrollSmoother?.get()),'reading has its smoother again');
   await context.close();});
  await check('return-spread',async()=>{const {page,context}=await open({layout:'spread'});
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
   await page.locator('#main').focus();await page.keyboard.press('j');await page.keyboard.press('j');await page.waitForTimeout(1200);
   const spread=await page.locator('#pagination-slot [aria-current=page]').textContent();assert.notEqual(spread,'1');
   await leader(page,'p');await atSection(page,'settings','Settings');
   const paged=()=>page.evaluate(()=>({twoPage:document.body.classList.contains('two-page'),book:!!document.querySelector('.book-viewport'),pages:document.querySelector('#pagination-slot').children.length}));
   await page.waitForFunction(()=>!document.body.classList.contains('two-page')&&!document.querySelector('.book-viewport')&&!document.querySelector('#pagination-slot').children.length,null,{timeout:3000}).catch(()=>{});
   assert.deepEqual(await paged(),{twoPage:false,book:false,pages:0},'no pagination in Admin');
   await page.locator('#admin-back').click();await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));await page.waitForTimeout(500);
   assert.equal(await page.locator('#pagination-slot [aria-current=page]').textContent(),spread,'the same spread');
   await context.close();});

  // 5. Split view: Admin replaces the layout (never a pane's column); Back to Library and browser Back restore both panes.
  await check('split',async()=>{const {page,context}=await open();
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await settled(page);await page.locator('#main').focus();
   await page.keyboard.press('Control+w');await page.keyboard.press('v');await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   await page.waitForTimeout(800);await page.keyboard.press('Escape');await page.waitForTimeout(300);
   const layout=await hash(page);assert.match(layout,/^#split=/);
   const pane=await (await page.locator('iframe[title^="Pane 2 of"]').elementHandle()).contentFrame();await settled(pane);
   await pane.locator('#main').focus();await pane.press('#main','Space');await pane.press('#main','p');
   await atSection(page,'settings','Settings');assert.equal(await page.locator('.split-pane').count(),0,'the panes close; Admin is the whole window');
   assert.equal(await page.locator('#reader-admin').count(),1);
   await page.locator('#admin-back').click();await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   assert.equal(await hash(page),layout,'the same layout');assert.match(await page.locator('#split-indicator').textContent(),/^2\/2/,'the same focused pane');
   await page.locator('#settings-open').click();await atSection(page,'overview','Overview');
   await page.goBack();await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   await context.close();});

  // 6. A backend failure is unavailable, never an empty healthy dashboard.
  await check('unavailable',async()=>{const {page,context}=await open();
   await page.route('**/api/maintenance',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic maintenance outage'})}));
   await page.route('**/api/inbox',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic inbox outage'})}));
   await page.goto(url+'#admin');await atSection(page,'overview','Overview');
   for(const tile of ['active','inbox','attention','indexes'])await page.locator(`[data-overview=${tile}][data-state=unavailable]`).waitFor({timeout:8000});
   const text=await page.locator('#admin-overview').textContent();
   assert.match(text,/Synthetic maintenance outage/);assert.match(text,/Synthetic inbox outage/);
   assert.doesNotMatch(text,/Nothing is running|No arrivals|Nothing needs attention|Not checked yet/,'no healthy or empty claims');
   await page.locator('[data-admin-nav=indexes]').click();await atSection(page,'indexes','Indexes');await page.locator('#indexes-unavailable').waitFor();
   assert.equal(await page.locator('[data-index=search][data-state=unavailable]').count(),1);
   await page.locator('[data-admin-nav=inbox]').click();await page.locator('#inbox-unavailable').waitFor();assert.ok(await page.locator('#inbox-mail').isDisabled());
   await context.close();});

  // 7. Keyboard: the collapsed sidebar leaves the Tab order; at phone width the sections are a sheet that returns focus to the page heading.
  await check('keyboard',async()=>{const {page,context}=await open();
   await page.goto(url+'#admin/inbox');await atSection(page,'inbox','Inbox');
   await page.locator('[data-sidebar=trigger]').click();await page.waitForFunction(()=>document.querySelector('[data-slot=sidebar-container]')?.inert===true);
   assert.equal(await page.locator('[data-sidebar=trigger]').getAttribute('aria-expanded'),'false');
   await page.locator('[data-sidebar=trigger]').click();await page.waitForFunction(()=>document.querySelector('[data-slot=sidebar-container]')?.inert===false);
   await page.locator('[data-admin-nav=settings]').focus();await page.keyboard.press('Enter');await atSection(page,'settings','Settings');
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
   await page.locator('[data-sidebar=trigger]').click();const sheet=page.getByRole('dialog',{name:'Admin sections'});await sheet.waitFor();
   await sheet.locator('[data-admin-nav=indexes]').click();await sheet.waitFor({state:'hidden'});await atSection(page,'indexes','Indexes');
   await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>document.activeElement?.id),'admin-title','the heading keeps focus after the sheet closes');
   await page.screenshot({path:shots+'/admin-phone.png'});
   await context.close();});

  assert.deepEqual(failures,[],'failed checks');assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Admin passed: Backstage, :backstage and #backstage open Overview at its top; Space p, :set and :settings open Settings at its top without scrollIntoView; Back/Forward and reloads; Back to Library keeps the saved place (scroll and two-page) and split layout with no admin progress; no reading chrome or smoother; unavailable backends; read-only Overview; keyboard and phone sheet.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
