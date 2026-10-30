/* What changed: banner after a post-receipt edit, the changes Sheet, seeking, caught up, another reader, the newer version. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const doc='#read='+encodeURIComponent('library/changing.md');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--changes','--editions'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const open=async(prefs,viewport={width:1300,height:900})=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',nextReads:false,...prefs}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});return {page,context};};
  const ready=page=>page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
  const library=page=>page.evaluate(async()=>(await (await fetch('/api/library?participant=Browser%20tester')).json()).works.find(w=>w.primary==='library/changing.md'));
  // Phone width first, while the receipt still names the old edition: the panel is a bottom sheet.
  {const {page,context}=await open({layout:'scroll'},{width:390,height:844});
   await page.goto(url+doc);await ready(page);await page.locator('.change-banner').waitFor();
   await page.locator('[data-compare=mine]').click();const sheet=page.locator('#changes-panel');await sheet.waitFor();
   assert.equal(await sheet.getAttribute('data-side'),'bottom');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
   await page.waitForTimeout(400);await page.screenshot({path:'.reader/web-dev/changes-sheet.png'});
   await page.locator('.change-hunk').first().click();await sheet.waitFor({state:'hidden'});
   await context.close();}
  // Continuous: banner, panel, seeking, highlight summary, caught up.
  {const {page,context}=await open({layout:'scroll'});
   await page.goto(url+doc);await ready(page);
   const banner=page.locator('#article > .change-banner');await banner.waitFor();
   assert.ok(await banner.evaluate(el=>el.hasAttribute('data-reader-decoration')));
   assert.match(await banner.textContent(),/Changed since you read it on [A-Z][a-z]{2} \d+.*3 sections changed.*Show changes.*Mark as caught up.*Compare with what Agy read/);
   assert.equal((await library(page)).read,false,'opening a changed edition does not mark it read');
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('d');
   const panel=page.locator('#changes-panel');await panel.waitFor();assert.equal(await panel.getAttribute('data-side'),'right');
   assert.deepEqual(await panel.locator('[data-changes-hunks] > [data-op]').evaluateAll(items=>items.map(li=>li.dataset.op)),['equal','replace','equal','delete','equal','insert','equal']);
   assert.match(await panel.locator('[data-changes-annotations] [data-slot=alert-description]').textContent(),/Your highlight: relocated\. Agy’s warning: its passage was removed\./);
   assert.match(await panel.locator('[data-op=replace]').textContent(),/longshort.*patientrestless/);
   assert.equal(await panel.locator('[data-op=replace] del').first().textContent(),'long');
   assert.match(await panel.textContent(),/1 paragraph reworded · 1 added · 1 removed · 39 unchanged/);
   await page.screenshot({path:'.reader/web-dev/changes-panel.png'});
   await panel.locator('button[data-op=insert]').click();
   const target=page.locator('#article .change-target');await target.waitFor();
   assert.match(await target.textContent(),/A new gate, added after the receipt/);
   assert.ok(await target.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'the added block is scrolled into view');
   await panel.locator('#changes-caught-up').click();await panel.waitFor({state:'hidden'});
   await page.locator('[data-sonner-toast]').filter({hasText:'Marked as caught up'}).waitFor();
   assert.equal(await page.locator('.change-banner').count(),0,'the banner goes away');
   assert.equal((await library(page)).read,true,'the work shows as read');
   // Reopened: only the other reader's earlier edition remains to compare.
   await page.reload();await ready(page);const quiet=page.locator('.change-banner.quiet');await quiet.waitFor();
   assert.match(await quiet.textContent(),/Another reader saw an earlier edition.*Compare with what Agy read/);
   await quiet.locator('[data-against=Agy]').click();await panel.waitFor();
   assert.equal(await panel.locator('[data-slot=sheet-title]').textContent(),'Since Agy read it');assert.equal(await panel.locator('#changes-caught-up').count(),0);
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>document.activeElement?.id),'main','closing What changed returns focus to the page, not the reading log (#59)');
   await context.close();}
  // Metadata-only edit: no invitation to compare with another reader, and a quiet note instead of a diff.
  {const {page,context}=await open({layout:'scroll'});
   await page.goto(url+'#read='+encodeURIComponent('library/retagged.md'));await ready(page);
   const note=page.locator('#article > .change-banner');await note.waitFor();
   assert.match(await note.textContent(),/Edited since you read it.*the text reads the same.*Mark as caught up/);
   assert.equal(await note.evaluate(el=>el.classList.contains('quiet')),true);
   assert.equal(await page.locator('.change-banner [data-compare]').count(),0,'neither Show changes nor Compare with what Agy read');
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('d');await page.waitForTimeout(200);
   assert.equal(await page.locator('#changes-panel').count(),0,'Space d opens no empty comparison');
   await note.locator('[data-caught-up]').click();await page.locator('[data-sonner-toast]').filter({hasText:'Marked as caught up'}).waitFor();
   await page.reload();await ready(page);await page.waitForTimeout(300);
   assert.equal(await page.locator('.change-banner').count(),0,'no “Another reader saw an earlier edition” banner when their edition reads the same');
   await context.close();}
  // The version successor: Compare v2 → v3 from the version chip line.
  {const {page,context}=await open({layout:'spread'});
   await page.goto(url+'#read='+encodeURIComponent('library/essays/tidal/tidal.v2.md'));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
   const compare=page.locator('.version-line [data-compare=successor]');assert.equal(await compare.textContent(),'Compare v2 → v3');
   await compare.click();const panel=page.locator('#changes-panel');await panel.waitFor();
   assert.equal(await panel.locator('[data-slot=sheet-title]').textContent(),'v2 → v3');assert.ok(await panel.locator('[data-op=replace]').count()>=1);
   await page.screenshot({path:'.reader/web-dev/changes-successor.png'});
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   await context.close();}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Changes passed: banner after a post-receipt edit, no silent read mark, Space d panel with ordered hunks and word changes, highlight summary, seek to block, caught up and read status, another reader’s edition, phone sheet, successor compare in two-page mode, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
