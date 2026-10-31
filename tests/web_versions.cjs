/* Version explorer: the chip and its status twin, the Space v timeline, read-only historical versions, any-to-any comparison, phone sheet. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const essay='library/essays/tidal/';
const shots=process.env.READER_SHOTS||'.reader/web-dev';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--editions','--versions'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync(shots,{recursive:true});
  const errors=[],external=[],writes=[];
  const open=async(prefs,viewport={width:1300,height:900})=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',nextReads:false,...prefs}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+(m.location()?.url||''));});
    page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());else if(r.method()==='POST')writes.push(new URL(r.url()).pathname);});return {page,context};};
  const ready=page=>page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
  const leader=async(page,key)=>{await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press(key);};
  const focused=page=>page.evaluate(()=>document.activeElement?.dataset?.ref||document.activeElement?.textContent?.trim());
  const receipt=page=>page.evaluate(async()=>(await (await fetch('/api/library?participant=Browser%20tester')).json()).works.find(w=>w.primary==='library/essays/tidal/tidal.md'));
  {const {page,context}=await open({layout:'scroll'});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await page.getByRole('heading',{name:'The tidal archive',exact:true}).waitFor();await ready(page);
   // One chip, its twin, and nothing duplicated.
   const line=page.locator('#article > .version-line');await line.waitFor();
   assert.ok(await line.evaluate(el=>el.hasAttribute('data-reader-decoration')));
   assert.equal((await line.locator('[data-version-chip]').textContent()).trim(),'v1 of 3');
   assert.match(await line.textContent(),/v1 of 3Newer v3 available Open v3Compare v1 → v3/);
   assert.equal(await page.locator('.edition-line,.edition-callout').count(),0,'the RW-05 line and callout are replaced by the chip');
   const twin=page.locator('#status-version');assert.equal(await twin.isVisible(),true);assert.equal(await twin.locator('span').textContent(),'v1/3');
   assert.ok(await twin.evaluate(el=>el.classList.contains('newer')),'the twin is accent-coloured when a newer version exists');
   const first=await receipt(page);assert.equal(first.read,true,'the current v1 is marked read on open');
   await page.reload();await ready(page);
   assert.match(await page.locator('.version-line .version-read').textContent(),/^You read this on [A-Z][a-z]{2} \d+$/);
   await page.screenshot({path:shots+'/versions-chip.png'});
   // Space v opens the timeline with editions and history.
   await leader(page,'v');const panel=page.locator('#versions-panel');await panel.waitFor();
   assert.equal(await page.locator('#vim-mode').textContent(),'VERSIONS');
   assert.equal(await focused(page),essay+'tidal.md','focus starts on the version you are reading');
   assert.deepEqual(await panel.locator('[data-vt-item=file] [data-vt-name]').allTextContents(),['v1','v2','Reading copy of v2','v3']);
   assert.deepEqual(await panel.locator('[data-vt-item=file] [data-vt-mark]').allTextContents(),['●','○','○','★']);
   const history=panel.locator('[data-vt-edition]').first().locator('[data-vt-item=commit]');
   assert.deepEqual(await history.locator('[data-vt-subject]').allTextContents(),['Revise v1; add v2, v3 and a reading copy','File The tidal archive']);
   assert.deepEqual(await history.locator('[data-vt-when]').allTextContents(),['Oct 15','Oct 12']);
   await panel.locator('[data-vt-item=commit] [data-vt-reader=own]').first().waitFor();   // Hashes arrive: your read lands on the matching commit.
   assert.match(await panel.locator('[data-vt-item=file]').first().textContent(),/reading/);
   await page.screenshot({path:shots+'/versions-panel.png'});
   // j/k move; Enter on the older commit opens it read-only.
   await page.keyboard.press('j');assert.equal(await focused(page),'History · 2 revisions');
   await page.keyboard.press('j');await page.keyboard.press('j');
   const older=await focused(page);assert.match(older,new RegExp('^'+essay+'tidal\\.md@[0-9a-f]{40}$'));
   const before=await receipt(page);
   await page.keyboard.press('Enter');
   const banner=page.locator('#article > .historical-banner');await banner.waitFor();await ready(page);
   const writesBefore=writes.length;   // Leaving v1 may save v1's place; nothing after that.
   assert.match(await banner.textContent(),/Historical version · Oct 12 · commit [0-9a-f]{7} · File The tidal archive.*Return to current/);
   assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read='+older,'historical versions are linkable');
   assert.match(await page.locator('#article').textContent(),/kept an early thought/);
   assert.equal(await page.locator('.version-line').count(),0);
   assert.match(await twin.locator('span').textContent(),/^@[0-9a-f]{7}$/);
   await panel.waitFor();assert.equal(await focused(page),older,'the explorer stays open on the version you opened');
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   await page.mouse.wheel(0,900);await page.waitForTimeout(700);
   assert.deepEqual(writes.slice(writesBefore),[],'no receipt, bookmark or annotation is written for a historical version');
   assert.deepEqual(await receipt(page),before);
   // Selecting text offers no annotation tools.
   await page.locator('#article p').nth(2).click({clickCount:3});await page.waitForTimeout(200);assert.equal(await page.locator('#selection-tools').isVisible(),false);
   // The reading log stays (it describes the current file) but never adds you; no Linked from or Send to AI-TTS;
  // chat and speech refuse clearly rather than acting on the current file.
  await page.waitForFunction(()=>!!document.querySelector('#main .reading-log')?.dataset.ready);
  // Only the server's record of you appears (from reading the current file); nothing is added for this view.
  const served=await page.evaluate(async path=>(await (await fetch('/api/readers?path='+encodeURIComponent(path)+'&participant=Browser%20tester')).json()).readers.filter(r=>r.group==='you').length,older.split('@')[0]);
  assert.equal(await page.locator('#main .reading-log [data-group=you]').count(),served,'no optimistic "You just now" on a historical version');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#main .linked-from-list, #main .linked-from-note').count(),0,'no Linked from on a historical version');
  assert.equal(await page.locator('#speak-article').count(),0);
  await page.keyboard.press('Escape');await page.locator('#main').focus();
  await page.keyboard.press(' ');await page.keyboard.press('s');
  await page.locator('[data-sonner-toast]').filter({hasText:'Send to AI-TTS reads the current file'}).waitFor();
  await page.keyboard.press(' ');await page.keyboard.press('m');
  await page.locator('[data-sonner-toast]').filter({hasText:'Chats are about the current file'}).waitFor();
  assert.equal(await page.locator('#chat-panel:not([hidden])').count(),0);
  await page.screenshot({path:shots+'/versions-historical.png'});
   // Reloading the link reopens the same historical version.
   await page.reload();await banner.waitFor();await ready(page);assert.match(await page.locator('#article').textContent(),/kept an early thought/);
   // Compare v1 with v3: c on each.
   await leader(page,'v');await panel.waitFor();
   await panel.locator(`[data-vt-item=file][data-ref="${essay}tidal.md"]`).focus();await page.keyboard.press('c');
   assert.match(await panel.locator('[data-versions-hint]').textContent(),/Comparing from v1/);
   await panel.locator(`[data-vt-item=file][data-ref="${essay}tidal.v3.md"]`).focus();await page.keyboard.press('c');
   const changes=page.locator('#changes-panel');await changes.waitFor();
   assert.equal(await changes.locator('[data-slot=sheet-title]').textContent(),'v1 → v3');
   assert.ok(await changes.locator('[data-op=replace]').count()>=1);
   await page.screenshot({path:shots+'/versions-compare.png'});
   await page.keyboard.press('Escape');await changes.waitFor({state:'hidden'});
   // The other direction, from the newer to the historical one, and Compare with current.
   await leader(page,'v');await panel.waitFor();
   await panel.locator(`[data-vt-item=file][data-ref="${essay}tidal.v3.md"] + [data-compare-ref]`).click();
   await panel.locator(`[data-vt-item=commit][data-ref="${older}"] + [data-compare-ref]`).click();
   await changes.waitFor();assert.match(await changes.locator('[data-slot=sheet-title]').textContent(),/^v3 → v1 @ Oct 12$/);
   await page.keyboard.press('Escape');await changes.waitFor({state:'hidden'});
   await leader(page,'v');await panel.waitFor();await panel.locator('[data-compare-current]').click();
   await changes.waitFor();assert.match(await changes.locator('[data-slot=sheet-title]').textContent(),/^v1 @ Oct 12 → v1$/);
   await page.keyboard.press('Escape');await changes.waitFor({state:'hidden'});
   // Return to current.
   await banner.locator('a').click();await page.locator('#article > .version-line').waitFor();await ready(page);
   assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read='+essay+'tidal.md');
   // "Edition N" from frontmatter no longer duplicates the chip.
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.v2.md'));await page.getByRole('heading',{name:'The tidal archive (v2)',exact:true}).waitFor();await ready(page);
   assert.equal((await page.locator('[data-version-chip]').textContent()).trim(),'v2 of 3');
   assert.doesNotMatch(await page.locator('.document-meta').textContent(),/Edition/);
   // A reading copy says what it copies; the chip opens the explorer.
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.v2.reading.md'));await page.getByRole('heading',{name:'The tidal archive (v2) — reading copy'}).waitFor();await ready(page);
   assert.equal((await page.locator('[data-version-chip]').textContent()).trim(),'Reading copy of v2');assert.equal(await twin.locator('span').textContent(),'copy');
   await page.locator('[data-version-chip]').click();await panel.waitFor();
   assert.equal(await focused(page),essay+'tidal.v2.reading.md');
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   // A document with no family and one commit shows neither chip nor twin, and Space v says so.
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await page.getByRole('heading',{name:'A quiet thought',exact:true}).waitFor();await ready(page);
   assert.equal(await page.locator('.version-line').count(),0);assert.equal(await twin.isVisible(),false);
   await leader(page,'v');await page.locator('[data-sonner-toast]').filter({hasText:'one version'}).waitFor();assert.equal(await panel.isVisible(),false);
   await context.close();}
  // Two pages: once the chip is placed (first layout, or late when the timeline is slow; see web_versions_late), nothing shifts.
  {const {page,context}=await open({layout:'spread'});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
   await page.locator('#article > .version-line').waitFor();
   const measure=()=>page.evaluate(()=>{const l=document.querySelector('.version-line').getBoundingClientRect();return {top:Math.round(l.top),pages:document.querySelectorAll('#pagination-slot a').length};});
   const first=await measure();await page.waitForTimeout(900);assert.deepEqual(await measure(),first,'no layout shift after the first measurement');
   await page.screenshot({path:shots+'/versions-spread.png'});
   await context.close();}
  // Phone width: the explorer is a bottom sheet and nothing scrolls sideways.
  {const {page,context}=await open({layout:'scroll'},{width:390,height:844});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await ready(page);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
   await page.screenshot({path:shots+'/versions-phone-chip.png'});
   await page.locator('#status-version').click();const panel=page.locator('#versions-panel');await panel.waitFor();
   const box=await panel.boundingBox();assert.ok(box.x<=1&&box.width>=388&&box.y>100&&box.y+box.height>=844-40,'a bottom sheet across the width');
   assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'timeline items wrap');
   await page.waitForTimeout(300);await page.screenshot({path:shots+'/versions-phone-sheet.png'});
   await context.close();}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Versions passed: chip "v1 of 3 · newer v3 available" and v1/3 twin, no duplicate Edition N, Space v timeline with editions, history and read markers, j/k and Enter into a linkable read-only historical version with no writes (reading log kept, no Linked from, chat and speech refuse), c-to-c and either-direction comparisons, Compare with current, return to current, reading copy chip, two-page stability, phone bottom sheet, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
