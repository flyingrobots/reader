/* How this art was made (#146): hovering expanded art (article hero, Focus or Space g),
   focusing its Prompt button or long-pressing it shows a card with the Artist's note, the producer, prompt versions
   and date, and each stage's archived prompt: instructions first, the quoted article and the scene-language
   reference collapsed, with Copy. A version without a run log says the prompt was not recorded; handcrafted art
   says so. Synthetic fixture and a fake voice only; never a real model. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {pinDate}=require('./web_clock.cjs');  // the fixture's pinned clock (#131)
(async()=>{
 let browser,fixture;
 try{
  fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--art','--art-delay','0.02'],{stdio:['ignore','pipe','inherit']});
  const {url,now}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async({prefs={},viewport={width:1300,height:900},touch=false}={})=>{
    const context=await browser.newContext({viewport,reducedMotion:'reduce',hasTouch:touch});await pinDate(context,now);
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:url});
    await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',...prefs}));
    const page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
    return {context,page,errors,external};
  };
  const shown=(page,path)=>page.waitForFunction(p=>document.querySelector('.document-footer')?.textContent.startsWith(p)&&!document.querySelector('.resume-pending'),path);
  const read=async(page,path)=>{await page.goto(url+'#read='+encodeURIComponent(path));await shown(page,path);};
  const settled=(page,selector)=>page.waitForFunction(s=>['live','still','image','unavailable','error'].includes(document.querySelector(s)?.dataset.state),selector,{timeout:20000});
  const card=page=>page.locator('#art-prompt-card');
  const ready=page=>page.waitForFunction(()=>['recorded','unrecorded','handcrafted'].includes(document.querySelector('#art-prompt-card:not([hidden])')?.dataset.state),null,{timeout:10000});
  const away=async page=>{await page.mouse.move(20,page.viewportSize().height-110);await page.waitForFunction(()=>document.querySelector('#art-prompt-card')?.hidden,null,{timeout:5000});};

  // A version made with a run log: commission one for a piece without art (the fake voice), then hover its hero.
  {const {context,page,errors,external}=await open();
   await page.goto(url);await page.locator('.issue-cover').waitFor();
   const job=await page.evaluate(async()=>{const {token}=await (await fetch('/api/library')).json();
     const r=await fetch('/api/art',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Token':token},body:JSON.stringify({action:'generate',path:'library/issue/edict.md',producer:'voice:Painter'})});return (await r.json()).job.id;});
   for(let tries=0;;tries++){const state=await page.evaluate(id=>fetch('/api/art/jobs').then(r=>r.json()).then(s=>s.jobs.find(j=>j.id===id)?.state),job);
     if(state==='done')break;assert.ok(tries<200&&['queued','waiting','running'].includes(state),`the commission finishes (${state})`);await page.waitForTimeout(300);}
   await page.goto('about:blank');await read(page,'library/issue/edict.md');  // a fresh page: the issue cached "no art yet"
   await settled(page,'#article .art-hero');
   assert.equal(await card(page).count(),0,'no card until asked');
   await page.locator('#article .art-hero .art-surface').hover({position:{x:300,y:200}});await ready(page);
   assert.equal(await card(page).getAttribute('data-state'),'recorded');
   const text=await card(page).textContent();
   assert.match(text,/How this art was made/);assert.match(text,/A synthetic artwork/);assert.match(text,/Made by Painter \(fake-model-1\)/);
   assert.match(text,/prompts brief\.v1 · scene\.v1 · dsl\.v1/);assert.match(text,/Artist’s note/);assert.match(text,/Two slow forms circle a quiet center/);
   assert.deepEqual(await page.locator('#art-prompt-card .art-prompt-stage h4').allTextContents(),['Brief prompt','Scene prompt']);
   assert.match(await page.locator('#art-prompt-card [data-stage=brief] > pre').first().textContent(),/Reader art brief \(prompt brief\.v1\)/,'the instructions show first');
   const quoted=page.locator('#art-prompt-card [data-stage=brief] details[data-part=article]');
   assert.equal(await quoted.count(),1);assert.equal(await quoted.evaluate(d=>d.open),false,'the article is collapsed');
   assert.match(await quoted.locator('summary').textContent(),/The article, as quoted [\d,]+ characters/);
   assert.equal(await page.locator('#art-prompt-card [data-stage=scene] details[data-part=reference]').count(),1,'the scene language reference is collapsed');
   const box=await card(page).boundingBox();assert.ok(box.y>=0&&box.y+box.height<=900&&box.x>=0&&box.x+box.width<=1300,'the card stays on screen');
   assert.equal(await card(page).evaluate(el=>el.closest('#article')===null&&el.hasAttribute('data-reader-decoration')),true,'outside the article, decoration');
   // Moving into the card keeps it; Copy copies the stage's whole prompt as sent.
   await card(page).hover();await page.waitForTimeout(400);assert.equal(await card(page).isVisible(),true);
   await page.locator('#art-prompt-card [data-stage=brief] [data-copy]').click();
   await page.waitForFunction(()=>document.querySelector('#art-prompt-card [data-stage=brief] [data-copy]')?.textContent==='Copied');
   const copied=await page.evaluate(()=>navigator.clipboard.readText());
   assert.match(copied,/Reader art brief \(prompt brief\.v1\)/);assert.match(copied,/<<<READER-ARTICLE [0-9a-f]+>>>/);assert.match(copied,/Collections of rules, revisited/);
   await page.screenshot({path:'.reader/web-dev/art-prompt-card.png'});
   await away(page);
   // Keyboard: the caption's Prompt button opens the card and focuses it; Esc closes it and returns to the button.
   const button=page.locator('#article .art-hero .art-prompt-toggle');
   assert.equal(await button.getAttribute('aria-haspopup'),'dialog');
   await button.focus();await page.keyboard.press('Enter');await ready(page);
   assert.equal(await button.getAttribute('aria-expanded'),'true');
   assert.equal(await page.evaluate(()=>document.activeElement?.id),'art-prompt-card');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#art-prompt-card').hidden);
   assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('art-prompt-toggle')),true,'focus returns to the button');
   assert.equal(await button.getAttribute('aria-expanded'),'false');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Cover/thumbnail previews stay quiet; the cover's Prompt button and expanded Focus view still work.
  {const {context,page,errors}=await open();
   await page.goto(url);await page.locator('.issue-cover').waitFor();await settled(page,'.cover-art');
   const hidden=()=>page.locator('#art-prompt-card:visible').count();
   let promptReads=0;page.on('request',request=>{if(request.url().includes('/api/art/prompt?'))promptReads++;});
   await page.locator('.cover-art .art-surface').hover();await page.waitForTimeout(600);
   assert.equal(await hidden(),0,'cover preview hover does not open a card');assert.equal(promptReads,0,'preview hover does not fetch a prompt');
   const button=page.locator('.cover-art .art-prompt-toggle');await button.click();await ready(page);
   assert.equal(await card(page).getAttribute('data-state'),'unrecorded');
   assert.match(await card(page).textContent(),/Notes at the back[\s\S]*Prompt not recorded for this version\./);
   await page.keyboard.press('Escape');assert.equal(await button.getAttribute('aria-expanded'),'false');
   await page.locator('.cover-art .art-focus-toggle').click();
   await settled(page,'.art-focus');await page.locator('.art-focus-stage').hover();await ready(page);
   assert.match(await card(page).textContent(),/Notes at the back/,'expanded cover hover opens its prompt');
   await page.keyboard.press('Escape');assert.ok(await page.locator('.art-focus').isVisible(),'first Escape closes only the prompt');
   assert.ok(await page.evaluate(()=>document.querySelector('.art-focus').contains(document.activeElement)),'dismissing a hover card keeps keyboard focus inside Focus');
   await page.keyboard.press('Escape');await page.locator('.art-focus').waitFor({state:'detached'});await settled(page,'.cover-art');
   await page.locator('.cover-art .art-surface').hover();await page.waitForTimeout(600);
   assert.equal(await hidden(),0,'closing Focus leaves cover preview hover disabled');
   // A theme repaint replaces the surface. Its new listeners must keep the same preview rule.
   await page.evaluate(()=>{window.oldCoverSurface=document.querySelector('.cover-art .art-surface');});
   await page.locator('#main').focus();await page.keyboard.press(':');await page.locator('#command-input').fill('theme ink');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('.cover-art .art-surface')!==window.oldCoverSurface);await settled(page,'.cover-art');
   await page.locator('.cover-art .art-surface').hover();await page.waitForTimeout(600);
   assert.equal(await hidden(),0,'repainted cover preview still does not open a card');
   await page.locator('.cover-art .art-surface').dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});await page.waitForTimeout(700);
   await page.locator('.cover-art .art-surface').dispatchEvent('pointerup',{pointerType:'touch',bubbles:true});
   assert.equal(await hidden(),0,'cover preview long-press stays quiet');
   const thumb=page.locator('[data-art-thumb="library/issue/keep.md"]');await page.waitForFunction(()=>document.querySelector('[data-art-thumb="library/issue/keep.md"][data-state=still]'));
   await thumb.scrollIntoViewIfNeeded();await thumb.hover();await page.waitForTimeout(600);
   assert.equal(await hidden(),0,'feature thumbnail hover does not open a card');
   await thumb.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});await page.waitForTimeout(700);await thumb.dispatchEvent('pointerup',{pointerType:'touch',bubbles:true});
   assert.equal(await hidden(),0,'feature thumbnail long-press stays quiet');
   assert.deepEqual(errors,[]);await context.close();}

  // The Space g view (hero off), and handcrafted art (the demo's) says so instead of showing a prompt.
  {const {context,page,errors}=await open({prefs:{artHero:false}});
   await page.route(/\/api\/art\/prompt\?path=library%2Fissue%2Fkeep\.md/,async route=>{const response=await route.fetch();const data=await response.json();
     await route.fulfill({response,json:{...data,handcrafted:true,recorded:false,stages:[],message:'Handcrafted for the Reader demo; no model was run.'}});});
   await read(page,'library/issue/keep.md');await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');await settled(page,'#article .article-art');
   await page.locator('#article .article-art .art-surface').hover();await ready(page);
   assert.equal(await card(page).getAttribute('data-state'),'handcrafted');
   assert.match(await card(page).textContent(),/Handcrafted for the Reader demo; no model was run\./);
   assert.equal(await page.locator('#art-prompt-card .art-prompt-stage').count(),0);
   assert.deepEqual(errors,[]);await context.close();}

  // Touch: a long press opens the card; phone width keeps it on screen.
  {const {context,page,errors}=await open({viewport:{width:390,height:844},touch:true});
   await read(page,'library/issue/edict.md');await settled(page,'#article .art-hero');
   await page.evaluate(()=>{const s=document.querySelector('#article .art-hero .art-surface'),r=s.getBoundingClientRect();s.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',bubbles:true,clientX:r.left+50,clientY:r.top+50}));});
   await page.waitForTimeout(800);await ready(page);
   const box=await card(page).boundingBox();assert.ok(box.x>=15&&box.x+box.width<=375,`inside the gutters (${JSON.stringify(box)})`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scroll');
   await page.screenshot({path:'.reader/web-dev/art-prompt-phone.png'});
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Art prompt card passed: hero prompts and Copy, keyboard and Esc, quiet cover/thumbnail hover and long-press, cover Prompt button, expanded Focus hover, quiet preview after Focus and theme repaint, Space g, handcrafted art, touch at 390px.');
 }finally{await browser?.close();if(fixture&&fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
