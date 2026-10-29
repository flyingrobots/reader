/* Reading queue (Space r): q from Read next, reorder across reload, Now reading, Space n, History, themes and phone width. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {sanitizerReport}=require('./web_wait.cjs');  // #151
(async()=>{
 const errors=[],external=[];
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--queue'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!sanitizerReport(m))errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  const toast=text=>page.locator('[data-sonner-toast]').filter({hasText:text});
  const leader=async key=>{await page.evaluate(()=>{if(!document.querySelector('#queue-panel').contains(document.activeElement))document.querySelector('#main').focus({preventScroll:true});});await page.keyboard.press('Space');await page.keyboard.press(key);};
  const panel=page.locator('#queue-panel');
  const titles=section=>panel.locator(`[data-section=${section}] .queue-title`).allTextContents();
  const openPanel=async()=>{await leader('r');await panel.waitFor();await panel.locator('[data-section=queued]').waitFor();await page.locator('#queue-panel:not([aria-busy])').waitFor();};
  const read=async path=>{await page.goto(url+'#read='+encodeURIComponent(path));await page.locator('.next-reads .next-read').first().waitFor({state:'visible'});};

  // Empty states, and Space r opens the panel in its own mode.
  await page.goto(url);await page.locator('#home-title').waitFor();
  await openPanel();
  assert.equal(await page.locator('#vim-mode').textContent(),'QUEUE');
  assert.match(await panel.locator('[data-section=queued]').textContent(),/Nothing queued yet\. Press q on anything to add it\./);
  assert.ok(await panel.locator('[data-section=suggested] .queue-row').count()>0,'new unread works are suggested before any history');
  await page.keyboard.press('Tab');await panel.locator('#queue-list-history').waitFor({state:'attached'});
  await panel.getByText('No reading history yet.').waitFor();
  await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});

  // q on a Read next item, and the + Queue button.
  await read('library/thought.md');
  const nextTitles=await page.locator('.next-reads li .next-read-title').allTextContents();
  assert.deepEqual(nextTitles,['Another thought','A newer observation','Notes on careful reading']);
  await page.locator('.next-reads li .next-read').first().press('q');
  await toast('Added to your queue · 1st').waitFor();
  await page.locator('.next-reads li').nth(1).getByRole('button',{name:'Add A newer observation to your queue'}).click();
  await toast('Added to your queue · 2nd').waitFor();
  await page.locator('.next-reads li .next-read').first().press('q');
  await toast('Already in your queue · 1st').waitFor();
  await page.mouse.move(5,5);  // Rows under the pointer become active, as in the file picker.
  // Focusing Read next scrolled to the end; read back to half-way so the saved position is mid-article.
  const halfway=page.waitForRequest(r=>r.url().endsWith('/api/bookmark')&&Math.abs(JSON.parse(r.postData()).progress-.5)<.1);
  await page.evaluate(()=>window.scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*.5));await (await halfway).response();
  // Space r: Now reading, then your queue in your order.
  await openPanel();
  assert.deepEqual(await titles('now'),['A quiet thought']);
  assert.match(await panel.locator('[data-section=now] .queue-time').textContent(),/^\d+% · \d+ min left$/);
  assert.deepEqual(await titles('queued'),['Another thought','A newer observation']);
  const suggested=await titles('suggested');
  assert.ok(!suggested.includes('Another thought')&&!suggested.includes('A quiet thought'),'queued and open documents are not suggested');
  assert.ok(await panel.locator('[data-section=suggested] .queue-reason').filter({hasText:/^From another project/}).count()===1,'one cross-project suggestion');
  assert.ok(await panel.locator('[data-section=suggested] .queue-reason').filter({hasText:'Because you read A quiet thought'}).count()>=1);
  for(const theme of ['paper','ink','gruvbox-dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(150);await page.screenshot({path:`.reader/web-dev/queue-${theme}.png`});}
  await page.evaluate(()=>document.documentElement.dataset.theme='paper');
  // Readable in every theme: rendered text against the panel.
  const contrast=await page.evaluate(async()=>{
    const {THEMES}=await import('/assets/themes.mjs');
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d',{willReadFrequently:true});
    const rgb=color=>{c.clearRect(0,0,1,1);c.fillStyle=color;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].slice(0,3);};
    const lum=v=>v.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{const [lo,hi]=[lum(a),lum(b)].sort((x,y)=>x-y);return (hi+.05)/(lo+.05);};
    const panel=document.querySelector('#queue-panel');
    return THEMES.map(theme=>{document.documentElement.dataset.theme=theme;const bg=rgb(getComputedStyle(panel).backgroundColor);
      const rows=['.queue-title','.queue-byline','.queue-reason','.queue-time','.queue-section-head .eyebrow','[data-slot=tabs-trigger][data-active]'].map(selector=>{const el=panel.querySelector(selector);return [selector,ratio(rgb(getComputedStyle(el).color),bg)];});
      return {theme,minimum:Math.min(...rows.map(r=>r[1])),worst:rows.sort((a,b)=>a[1]-b[1])[0][0]};});
  });
  await page.evaluate(()=>document.documentElement.dataset.theme='paper');
  assert.equal(contrast.length,6+2*require('../src/reader_mcp/web_ui/famous-themes.json').themes.length);
  for(const row of contrast)assert.ok(row.minimum>=4.5,JSON.stringify(row));
  // J/K reorder, persisted across reload.
  assert.equal(await page.evaluate(()=>document.activeElement.id),'queue-list-next','the list has focus');
  await page.keyboard.press('j');await page.keyboard.press('j');
  assert.equal(await panel.locator('[role=option][aria-selected=true] .queue-title').textContent(),'A newer observation');
  await page.keyboard.press('K');await page.waitForFunction(()=>document.querySelector('#queue-panel [data-section=queued] .queue-title')?.textContent==='A newer observation');
  assert.equal(await panel.locator('[role=option][aria-selected=true] .queue-title').textContent(),'A newer observation','the selection follows the moved item');
  await page.reload();await page.locator('.next-reads').waitFor();
  assert.equal(await page.locator('.next-in-queue .next-read-title').textContent(),'A newer observation','Read next leads with the queue');
  await openPanel();
  assert.deepEqual(await titles('queued'),['A newer observation','Another thought']);
  // Enter opens the item and makes it Now reading.
  await page.keyboard.press('j');await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'A newer observation'}).waitFor();await panel.waitFor({state:'hidden'});
  await openPanel();
  assert.deepEqual(await titles('now'),['A newer observation']);
  assert.deepEqual(await titles('queued'),['Another thought'],'opening takes it out of Up next');
  await page.keyboard.press('Escape');
  // Space n opens the next queued item from anywhere.
  await page.goto(url);await page.locator('#home-title').waitFor();
  await leader('n');await page.locator('h1.document-title',{hasText:'Another thought'}).waitFor();
  assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read=library/other.md');
  await page.locator('.document-shell:not(.resume-pending)').waitFor();await page.waitForTimeout(300);
  await leader('n');await toast('Your queue is empty. Press q on anything to add it.').waitFor();
  // Pin a suggestion with p.
  await openPanel();
  await page.waitForFunction(()=>document.querySelectorAll('#queue-panel [data-section=suggested] .queue-row').length>0);
  const pinned=await panel.locator('[data-section=suggested] .queue-title').first().textContent();
  const firstSuggestion=await panel.locator('[data-section=suggested] [role=option]').first().getAttribute('id');
  const index=+firstSuggestion.split('-').at(-1);for(let i=0;i<index;i++)await page.keyboard.press('j');
  await page.keyboard.press('p');await toast('Added to your queue · 1st').waitFor();
  assert.deepEqual(await titles('queued'),[pinned]);
  // c clears, after a confirmation.
  await page.keyboard.press('c');await panel.locator('.queue-confirm').waitFor();
  assert.match(await panel.locator('.queue-confirm').textContent(),/Clear 1 queued document\?/);
  await page.keyboard.press('Enter');await toast('Your queue is clear.').waitFor();
  assert.deepEqual(await titles('queued'),[]);
  // History: today's opens with progress; Enter resumes at the saved position.
  await page.keyboard.press('2');await panel.locator('#queue-list-history').waitFor();
  assert.equal(await panel.locator('#queue-list-history .eyebrow').first().textContent(),'Today');
  const history=await panel.locator('#queue-list-history .queue-title').allTextContents();
  assert.deepEqual(history.slice(0,3),['Another thought','A newer observation','A quiet thought']);
  const thoughtRow=panel.locator('#queue-list-history [role=option]').filter({hasText:'A quiet thought'});
  assert.match(await thoughtRow.locator('.queue-time').textContent(),/^(4\d|5\d)% · \d+ min left$/);
  assert.match(await thoughtRow.locator('.queue-when').textContent(),/\d{1,2}:\d{2}/);
  assert.equal(await panel.locator('[data-slot=tabs-trigger][data-active]').textContent(),'History','the History tab is selected');
  await page.screenshot({path:'.reader/web-dev/queue-history.png'});
  await page.keyboard.press('j');await page.keyboard.press('j');await page.keyboard.press('Enter');
  await page.locator('h1.document-title',{hasText:'A quiet thought'}).waitFor();await page.locator('.document-shell:not(.resume-pending)').waitFor();
  const resumed=await page.evaluate(()=>scrollY/(document.documentElement.scrollHeight-innerHeight));
  assert.ok(resumed>.4&&resumed<.6,'resumed near the saved half-way point: '+resumed);
  // Finished filter, then removing a history row keeps the receipt.
  await openPanel();await page.keyboard.press('Tab');await panel.locator('#queue-list-history .queue-row').first().waitFor();
  await page.keyboard.press('f');await panel.getByText('Nothing finished yet.').waitFor();await page.keyboard.press('f');
  await panel.locator('#queue-list-history .queue-row').first().waitFor();
  const before=await panel.locator('#queue-list-history .queue-title').allTextContents();
  const target=before.indexOf('Another thought');for(let i=0;i<target;i++)await page.keyboard.press('j');
  await page.keyboard.press('x');await panel.locator('.queue-confirm').waitFor();
  assert.match(await panel.locator('.queue-confirm').textContent(),/Your read receipt and reading position stay\./);
  await page.keyboard.press('Enter');await toast('Removed from history').waitFor();
  await page.waitForFunction(()=>![...document.querySelectorAll('#queue-list-history .queue-title')].some(el=>el.textContent==='Another thought'));
  const library=await page.evaluate(()=>fetch('/api/library').then(r=>r.json()));
  assert.equal(library.works.find(w=>w.primary==='library/other.md').read,true,'the read receipt stays');
  // Phone width: a bottom sheet with 16px gutters and no horizontal scroll.
  await page.setViewportSize({width:390,height:844});await page.keyboard.press('1');await page.waitForTimeout(250);
  const sheet=await page.evaluate(()=>{const p=document.querySelector('#queue-panel').getBoundingClientRect(),lead=document.querySelector('#queue-panel .queue-row .queue-lead').getBoundingClientRect(),side=document.querySelector('#queue-panel .queue-row .queue-side').getBoundingClientRect();return {left:p.left,right:p.right,top:p.top,rowLeft:lead.left,rowRight:side.right,scroll:document.documentElement.scrollWidth,width:innerWidth};});
  assert.ok(sheet.left===0&&sheet.right===390&&sheet.top>100,'bottom sheet: '+JSON.stringify(sheet));
  assert.ok(sheet.rowLeft>=16&&sheet.rowRight<=390-16+0.5,'16px gutters: '+JSON.stringify(sheet));
  assert.ok(sheet.scroll<=sheet.width+1,'no horizontal scroll');
  await page.screenshot({path:'.reader/web-dev/queue-phone.png'});
  // A one-screen document never scrolls: once its end has been in view for a short dwell, it counts as finished.
  for(const layout of ['scroll','spread']){
    const shortContext=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
    await shortContext.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',layout,nextReads:false}));
    const short=await shortContext.newPage();short.on('pageerror',e=>errors.push(e.message));
    const saves=[];short.on('request',r=>{if(r.url().endsWith('/api/bookmark'))saves.push(JSON.parse(r.postData()).progress);});
    const path=layout==='scroll'?'library/related-2.md':'library/related-1.md',started=Date.now();
    const finished=short.waitForRequest(r=>r.url().endsWith('/api/bookmark')&&JSON.parse(r.postData()).progress===1,{timeout:15000});
    await short.goto(url+'#read='+encodeURIComponent(path));await (await finished).response();
    assert.ok(Date.now()-started>=2500,layout+': finished only after a dwell, not on open');assert.ok(!saves.slice(0,-1).includes(1),layout+': earlier saves were not finished');
    const history=await short.evaluate(()=>fetch('/api/history?participant=Browser%20tester&filter=finished').then(r=>r.json()));
    assert.ok(JSON.stringify(history).includes(path),layout+': the one-screen document is in Finished history');
    await shortContext.close();}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Reading queue passed: Space r panel and mode, empty states, q and + Queue from Read next with ordinal toasts, Now reading, suggestions with one cross-project item, 22-theme contrast (min '+Math.min(...contrast.map(r=>r.minimum)).toFixed(2)+'), J/K reorder across reload, Next in your queue lead, Enter makes Now reading, Space n, p pin, c clear with confirmation, History today with progress and resume, finished filter, x hides a row and keeps the receipt, phone bottom sheet, local-only requests.');
 }catch(error){console.error('Page errors:',errors);throw error;}finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
