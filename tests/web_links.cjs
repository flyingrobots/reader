/* Link previews on hover and focus, the Linked from list, its two-page placement, and the Link graph card. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {sanitizerReport}=require('./web_wait.cjs');  // #151
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--links'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const open=async(prefs,viewport={width:1300,height:900})=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',nextReads:false,...prefs}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/status of 400/.test(m.text())&&!sanitizerReport(m))errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});return {page,context};};
  const doc=path=>url+'#read='+encodeURIComponent(path);
  const preview=page=>page.locator('#link-preview');
  // The first document opened builds the graph quietly; Linked from says so, then fills in.
  {const {page,context}=await open({});
   await page.goto(doc('library/thought.md'));
   await page.locator('.linked-from[data-state=building]').waitFor();
   assert.match(await page.locator('.linked-from').textContent(),/Building the link graph…/);
   await page.locator('.linked-from[data-state=ready]').waitFor({timeout:20000});
   assert.equal(await page.locator('[data-sonner-toast]').filter({hasText:'Link graph'}).count(),0,'the first build is quiet');
   // Read next and the learning card may sit alongside; Linked from comes right after the article and before its footer.
   assert.ok(await page.evaluate(()=>{const kids=[...document.querySelector('#article').parentElement.children],at=el=>kids.indexOf(document.querySelector(el));return at('.linked-from')===at('#article')+1&&at('.linked-from')<at('.document-footer');}),'between the article and its footer');
   assert.ok(await page.locator('.linked-from').evaluate(el=>el.hasAttribute('data-reader-decoration')));
   assert.equal(await page.locator('.linked-from-count').textContent(),'14');
   assert.equal(await page.locator('.linked-from-row').count(),12);
   const first=page.locator('.linked-from-row').first();
   assert.equal(await first.locator('.linked-from-title').textContent(),'Citer 00');
   assert.equal(await first.locator('.linked-from-meta').textContent(),'3 links · § Why it matters');
   await page.locator('.linked-from-more').click();assert.equal(await page.locator('.linked-from-row').count(),14);
   assert.ok(await page.locator('.linked-from-row').allTextContents().then(rows=>rows.some(r=>r.startsWith('Link sampler'))));
   await page.screenshot({path:'.reader/web-dev/linked-from.png'});
   // A row opens the citing document at the heading the link sits under.
   await page.locator('.linked-from-row').first().click();
   await page.getByRole('heading',{name:'Citer 00'}).waitFor();
   assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read=library/linked/citer-00.md&h=why-it-matters','the route keeps the heading (#56)');
   await page.waitForFunction(()=>{const h=document.querySelector('[data-heading-slug=why-it-matters]');if(!h)return false;const r=h.getBoundingClientRect();return r.top>=-2&&r.top<innerHeight*.5;});
   assert.ok(await page.evaluate(()=>scrollY>400),'scrolled to the fragment');
   await page.locator('.linked-from[data-state=ready]').waitFor();
   assert.match(await page.locator('.linked-from').textContent(),/No other library document links here yet\./);
   await context.close();}
  // Previews: hover after a short pause, focus at once, Escape closes; external and missing links.
  {const {page,context}=await open({});
   await page.goto(doc('library/linked/source.md'));await page.locator('.linked-from[data-state=ready]').waitFor({timeout:20000});
   const link=page.locator('#article a',{hasText:'a quiet thought'});
   await link.hover();await page.waitForTimeout(150);assert.ok(await preview(page).isHidden(),'no preview before the pause');
   await preview(page).waitFor({state:'visible'});
   assert.match(await preview(page).locator('[data-link-preview-title]').textContent(),/^A quiet thought/);
   assert.equal(await preview(page).locator('[data-unread]').count(),0,'read earlier in this run');
   assert.equal(await preview(page).locator('[data-link-preview-heading]').textContent(),'§ Chapter 2');
   const excerpt=await preview(page).locator('[data-link-preview-excerpt]').textContent();
   assert.match(excerpt,/^A quiet library holds room for careful thought/);assert.ok(excerpt.length<=330);
   assert.equal(await link.getAttribute('aria-describedby'),'link-preview');
   await page.screenshot({path:'.reader/web-dev/link-preview.png'});
   await page.keyboard.press('Escape');await preview(page).waitFor({state:'hidden'});
   await page.mouse.move(5,5);
   await page.locator('#article a',{hasText:'other'}).first().focus();
   await preview(page).waitFor({state:'visible',timeout:1500});assert.match(await preview(page).locator('[data-link-preview-title]').textContent(),/^Another thought/);assert.equal(await preview(page).locator('[data-unread]').count(),1,'an unread edition');
   await page.keyboard.press('Escape');await preview(page).waitFor({state:'hidden'});
   await page.locator('#article a',{hasText:'external page'}).focus();await preview(page).waitFor({state:'visible'});
   assert.equal(await preview(page).locator('[data-link-preview-host]').textContent(),'example.com');
   await page.locator('#article a',{hasText:'missing note'}).focus();await page.waitForFunction(()=>document.querySelector('#link-preview [data-link-preview-kicker]')?.textContent==='Not in the library');
   await page.locator('#main').focus();await preview(page).waitFor({state:'hidden'});
   // No preview while a selection is active.
   await page.evaluate(()=>{const p=document.querySelector('#article p');const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);});
   await link.hover();await page.waitForTimeout(600);assert.ok(await preview(page).isHidden(),'no preview during a selection');
   await page.evaluate(()=>getSelection().removeAllRanges());
   // Phone width: a bottom sheet, no horizontal scroll.
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
   await link.focus();await preview(page).waitFor({state:'visible'});
   // The HoverCard positions itself within a frame of opening.
   await page.waitForFunction(()=>document.querySelector('#link-preview')?.getBoundingClientRect().left>=15,null,{timeout:1000});
   const sheet=await preview(page).evaluate(el=>{const r=el.getBoundingClientRect();return {sheet:el.hasAttribute('data-sheet'),left:r.left,right:r.right,bottom:r.bottom};});
   assert.ok(sheet.sheet&&sheet.left>=15&&sheet.right<=375+1&&sheet.bottom<=844,'a bottom sheet inside 16 px gutters: '+JSON.stringify(sheet));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
   await page.screenshot({path:'.reader/web-dev/link-preview-phone.png'});
   await context.close();}
  // Two pages: Linked from is placed only when the spread count does not grow.
  {const {page,context}=await open({layout:'spread'});
   await page.goto(doc('library/other.md'));await page.locator('#article .linked-from[data-state=ready]').waitFor({timeout:20000});
   assert.equal(await page.locator('#pagination-slot [aria-current=page]').textContent(),'1','a one-page document shows Linked from on its facing page');
   const box=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect(),r=document.querySelector('.linked-from').getBoundingClientRect();return {right:r.right,vright:v.right};});
   assert.ok(box.right<=box.vright+1,'inside the spread');
   await context.close();
   const lastSpread=async backlinks=>{const {page,context}=await open({layout:'spread',backlinks});await page.goto(doc('library/thought.md'));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
     if(backlinks)await page.waitForFunction(()=>document.querySelector('.linked-from[data-state=ready],.linked-from-compact'),null,{timeout:20000});else await page.waitForTimeout(900);
     await page.waitForTimeout(300);
     const result={label:await page.locator('#pagination-slot [aria-label^="Pages "]').last().textContent(),section:await page.locator('.linked-from').count(),compact:await page.locator('.linked-from-compact').count()};
     if(result.compact){await page.locator('.linked-from-compact button').click();await page.locator('#thread-panel:not([hidden]) .linked-from-row').first().waitFor();result.panelRows=await page.locator('#thread-panel .linked-from-row').count();assert.equal(await page.locator('#thread-title').textContent(),'Linked from');}
     await context.close();return result;};
   const without=await lastSpread(false),withLinks=await lastSpread(true);
   assert.equal(without.section+without.compact,0);assert.equal(withLinks.section+withLinks.compact,1,'either the section or its one-line control');
   assert.equal(withLinks.label,without.label,'Linked from never adds a spread');
   if(withLinks.compact)assert.equal(withLinks.panelRows,14);
   console.log(`Two-page thought.md: ${withLinks.compact?'one-line control (list in the side panel)':'section on the last spread'}; spreads ${withLinks.label}.`);}
  // With Read next on, Linked from comes first, whichever answers first.
  {const {page,context}=await open({nextReads:true});
   await page.goto(doc('library/thought.md'));await page.locator('.next-reads').waitFor();await page.locator('.linked-from[data-state=ready]').waitFor();
   assert.ok(await page.evaluate(()=>{const kids=[...document.querySelector('#article').parentElement.children],at=el=>kids.indexOf(document.querySelector(el));return at('.linked-from')===at('#article')+1&&at('.next-reads')===at('.linked-from')+1&&at('.next-reads')<at('.document-footer');}),'article, Linked from, Read next, footer');
   await context.close();}
  // Link graph anchors are the renderer's heading slugs: setext paragraphs, HTML headings, repeats; indented code has no links.
  {const {page,context}=await open({});
   await page.goto(doc('library/linked/source.md'));await page.locator('.linked-from[data-state=ready]').waitFor({timeout:20000});
   const rows=(await page.evaluate(()=>fetch('/api/links?path=library/linked/source.md').then(r=>r.json()))).inbound.filter(r=>r.source.includes('/heading-'));
   assert.deepEqual(rows.map(r=>r.source).sort(),['library/linked/heading-code.md','library/linked/heading-html.md','library/linked/heading-setext.md']);
   for(const row of rows){
     await page.evaluate(()=>{const a=document.querySelector('#article');if(a)a.dataset.stale='';});
     await page.goto(doc(row.source));await page.locator('#article:not([data-stale]) [data-heading-slug]').first().waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
     const slugs=await page.locator('#article:not([data-stale]) [data-heading-slug]').evaluateAll(hs=>hs.map(h=>[h.dataset.headingSlug,h.textContent.trim()]));
     const hit=slugs.find(([slug])=>slug===row.fragment);
     assert.ok(hit,`${row.source}: anchor ${row.fragment} is a rendered heading slug of ${JSON.stringify(slugs)}`);
     assert.equal(hit[0],slugs.at(-1)[0],`${row.source}: the link sits under the last heading`);}
   await context.close();}
  // Reader Admin, Indexes: the Link graph card and a refresh with toasts.
  {const {page,context}=await open({});
   await page.goto(url+'#admin/indexes');await page.locator('[data-index=links][data-state=current]').waitFor({timeout:20000});
   assert.match(await page.locator('[data-index=links]').textContent(),/Links20/);
   await page.locator('[data-job=links]').click();
   await page.locator('[data-sonner-toast]').filter({hasText:'Link graph finished'}).waitFor({timeout:15000});
   assert.match(await page.locator('[data-sonner-toast]').filter({hasText:'Link graph finished'}).textContent(),/0 documents read, 20 links, 1 unresolved/);
   await context.close();}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Links passed: quiet first build, Linked from order, counts, Show all and fragment navigation, hover/focus/Escape previews (document, external, missing), no preview during selection, phone bottom sheet, two-page placement without extra spreads, Link graph card and refresh toast, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
