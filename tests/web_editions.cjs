/* Editions: the edition line, newer-version callout, Space v menu (Popover / phone Sheet) and Backstage diagnostics. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const essay='library/essays/tidal/';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--editions'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const open=async(prefs,viewport={width:1300,height:900})=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',nextReads:false,...prefs}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});return {page,context};};
  const ready=page=>page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
  const leader=async(page,key)=>{await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press(key);};
  // Continuous layout: the version chip, switching, history, the Space v timeline, find.
  {const {page,context}=await open({layout:'scroll'});
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await ready(page);
   assert.equal(await page.locator('.version-line').count(),0,'no version chip without siblings or history');
   await leader(page,'v');await page.locator('[data-sonner-toast]').filter({hasText:'one version'}).waitFor();
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await page.getByRole('heading',{name:'The tidal archive',exact:true}).waitFor();await ready(page);
   assert.equal((await page.locator('[data-version-chip]').textContent()).trim(),'v1 of 3');
   await page.locator('[data-version-chip]').click();const panel=page.locator('#versions-panel');await panel.waitFor();
   await panel.locator(`.vt-file[data-ref="${essay}tidal.v2.md"]`).click();await page.getByRole('heading',{name:'The tidal archive (v2)',exact:true}).waitFor();await ready(page);
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   const line=page.locator('#article > .version-line');await line.waitFor();
   assert.ok(await line.evaluate(el=>el.hasAttribute('data-reader-decoration')));
   assert.equal((await line.locator('[data-version-chip]').textContent()).trim(),'v2 of 3');
   assert.ok(await page.evaluate(()=>document.querySelector('#article > .document-meta + .reading-log + .version-line')!==null),'the chip follows the title meta and its reading log');
   assert.match(await line.textContent(),/Newer v3 available Open v3/);
   await page.screenshot({path:'.reader/web-dev/editions-line.png'});
   // Find skips the decoration.
   await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').fill('Newer v3');await page.waitForTimeout(150);
   assert.equal(await page.locator('#find-count').textContent(),'0 / 0','the version chip is excluded from find');
   await page.locator('#find-query').fill('Paragraph 3 of');await page.waitForTimeout(150);assert.notEqual(await page.locator('#find-count').textContent(),'0 / 0');
   await page.keyboard.press('Escape');
   // Switching keeps history.
   await line.locator('a',{hasText:'Open v3'}).click();await page.getByRole('heading',{name:'The tidal archive (v3)'}).waitFor();await ready(page);
   assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read='+essay+'tidal.v3.md');
   assert.equal(await page.locator('.version-newer').count(),0,'the newest version offers nothing newer');
   assert.equal((await page.locator('[data-version-chip]').textContent()).trim(),'v3 of 3');
   await page.locator('#main').focus();await page.keyboard.press('h');await page.getByRole('heading',{name:'The tidal archive (v2)',exact:true}).waitFor();await ready(page);
   assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read='+essay+'tidal.v2.md','h returns to the earlier edition');
   // Space v opens the timeline with focus on this edition; arrows move; Escape closes.
   await leader(page,'v');await panel.waitFor();
   await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-current')==='true');
   assert.deepEqual(await panel.locator('.vt-file .vt-name').allTextContents(),['v1','v2','Reading copy of v2','v3']);
   assert.match(await panel.locator('.vt-note').textContent(),/Catalog note.*catalog\/metadata\/essays\/tidal\/tidal\.v2\.md\.md/);
   await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.ref),essay+'tidal.v2.reading.md');
   await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.ref),essay+'tidal.v3.md','the catalog note is not an edition to focus');
   await page.screenshot({path:'.reader/web-dev/editions-menu.png'});
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read='+essay+'tidal.v2.md','Escape changes nothing');
   await leader(page,'v');await panel.waitFor();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
   await page.getByRole('heading',{name:'The tidal archive (v2) — reading copy'}).waitFor();await ready(page);
   assert.equal((await page.locator('[data-version-chip]').textContent()).trim(),'Reading copy of v2');assert.match(await page.locator('.version-line').textContent(),/Open v3/);
   await context.close();}
  // Two pages: the line is part of the first layout, so spreads do not change after it.
  {const {page,context}=await open({layout:'spread'});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.v2.md'));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
   const measure=()=>page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect(),l=document.querySelector('.version-line').getBoundingClientRect(),h=document.querySelector('#article h1').getBoundingClientRect();return {label:document.querySelector('#pagination-slot [aria-label^="Pages "]:last-of-type')?.textContent||document.querySelectorAll('#pagination-slot a').length,top:Math.round(l.top),head:Math.round(h.top),inside:l.left>=v.left-1&&l.right<=v.right+1};});
   const first=await measure();await page.waitForTimeout(900);const later=await measure();
   assert.deepEqual(later,first,'no layout shift after the first measurement');assert.ok(first.inside&&first.top>first.head,'the line sits under the title on the first spread');
   await leader(page,'v');await page.locator('#versions-panel').waitFor();await page.keyboard.press('Escape');
   await page.screenshot({path:'.reader/web-dev/editions-spread.png'});
   await context.close();}
  // Phone width: the line wraps and the menu is a bottom sheet.
  {const {page,context}=await open({layout:'scroll'},{width:390,height:844});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.v2.md'));await ready(page);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
   await leader(page,'v');const sheet=page.locator('#versions-panel');await sheet.waitFor();const box=await sheet.boundingBox();assert.ok(box.x<=1&&box.width>=388,'a bottom sheet');
   await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-current')==='true');
   await page.waitForTimeout(400);await page.screenshot({path:'.reader/web-dev/editions-sheet.png'});
   await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});
   await context.close();}
  // Reader Admin's Indexes page lists edition-link diagnostics.
  {const {page,context}=await open({});
   await page.goto(url+'#admin/indexes');const card=page.locator('#edition-links[data-state=current]');await card.waitFor();
   assert.match(await card.textContent(),/All resolved/);assert.match(await card.textContent(),/Families1/);
   await context.close();}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Editions passed: chip only for families, labels and current edition, newer v3 link, find exclusion, switching with h history, Space v timeline focus/arrows/Escape/Enter, catalog note, two-page stability, phone sheet and width, Backstage diagnostics, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
