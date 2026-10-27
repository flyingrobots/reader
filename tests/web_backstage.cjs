/* Reader Admin's Indexes and Settings pages: index cards, job toasts, settings, and Read next at the end of a document. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {sanitizerReport}=require('./web_wait.cjs');  // #151
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--maintenance'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const open=async(prefs,viewport={width:1300,height:900})=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',backlinks:false,...prefs}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!sanitizerReport(m))errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});return {page,context};};
  const toast=(page,text)=>page.locator('[data-sonner-toast]').filter({hasText:text});
  // The page, its index cards and the job toasts.
  {const {page,context}=await open({});
   await page.goto(url);await page.locator('#home-title').waitFor();
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('p');
   await page.locator('#reader-admin').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='admin-title'&&document.activeElement.textContent==='Settings');
   assert.equal(new URL(page.url()).hash,'#admin/settings');await page.waitForFunction(()=>document.querySelector('#vim-mode').textContent==='ADMIN');
   assert.equal(await page.locator('#status-location [aria-current=page]').textContent(),'Reader Admin');
   await page.locator('[data-admin-nav=indexes]').click();await page.waitForFunction(()=>document.activeElement?.textContent==='Indexes');await page.locator('#main').focus();
   for(const [index,state] of [['search','missing'],['browse','unconfigured'],['catalog','missing']])await page.locator(`[data-index=${index}][data-state=${state}]`).waitFor();
   await page.locator('[data-job=search]').click();
   await toast(page,'Search index (with embeddings) running…').waitFor();assert.equal(await toast(page,'running…').getAttribute('data-type'),'loading');
   await page.locator('[data-index=search][data-state=running]').waitFor();assert.ok(await page.locator('[data-job=catalog]').isDisabled(),'one job at a time');
   await page.screenshot({path:'.reader/web-dev/backstage-running.png'});
   await toast(page,'Search index (with embeddings) finished').waitFor({timeout:8000});assert.match(await toast(page,'finished').textContent(),/3 changed, 0 removed, 3 documents indexed/);
   await page.locator('[data-job=catalog]:not([disabled])').waitFor();await page.locator('[data-job=catalog]').click();
   await toast(page,'Synthetic catalog failure').waitFor({timeout:8000});assert.equal(await toast(page,'Catalog SQL mirror failed').getAttribute('data-type'),'error');
   await page.locator('[data-job="search-keyword"]:not([disabled])').waitFor();await page.locator('[data-job="search-keyword"]').click();
   await toast(page,'Search index (keywords only) finished').waitFor({timeout:60000});
   await page.locator('[data-index=search][data-state=partial]').waitFor({timeout:15000});
   assert.equal(await page.locator('.backstage-jobs li[data-job-state=failed]').count(),1);
   assert.ok(await page.locator('.backstage-jobs').textContent().then(t=>t.includes('Synthetic catalog failure')));
   await page.screenshot({path:'.reader/web-dev/backstage.png',fullPage:true});
   // Settings have their own page.
   await page.locator('[data-admin-nav=settings]').click();await page.locator('#preferences-form').waitFor();
   await page.locator('#theme-choice').click();await page.getByRole('option',{name:'Orchid · Dark',exact:true}).click();await page.locator('[data-slot=select-content][data-open]').waitFor({state:'hidden'});
   await page.locator('#preferences-form button[type=submit]').click();await toast(page,'Preferences saved.').waitFor();
   assert.equal(await page.locator('html').getAttribute('data-theme'),'orchid-dark');assert.ok(await page.locator('#backstage-settings').isVisible(),'saving stays on the page');
   await page.locator('#settings-open').click();await page.waitForFunction(()=>document.activeElement?.id==='admin-title'&&location.hash==='#admin');
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
   await context.close();}
  // Read next: continuous layout, after the article.
  {const {page,context}=await open({layout:'scroll'});
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await page.locator('.next-reads').waitFor();
   const titles=await page.locator('.next-read-title').allTextContents();
   assert.deepEqual(titles,['Another thought','A newer observation','Notes on careful reading'],'related works, unread first then latest');
   assert.ok(await page.evaluate(()=>document.querySelector('#article + .next-reads + .document-footer')!==null),'between the article and its footer');
   assert.ok(await page.locator('.next-reads').evaluate(el=>el.hasAttribute('data-reader-decoration')));
   await page.locator('.next-read').first().click();await page.getByRole('heading',{name:'Another thought'}).waitFor();assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read=library/other.md');
   await context.close();}
  // Two pages: only when it fits the last spread.
  {const {page,context}=await open({layout:'spread'});
   await page.goto(url+'#read='+encodeURIComponent('library/other.md'));await page.locator('#article .next-reads').waitFor();
   assert.equal(await page.locator('#pagination-slot [aria-current=page]').textContent(),'1','a one-page document shows Read next on its facing page');
   const box=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect(),r=document.querySelector('.next-reads').getBoundingClientRect();return {half:v.left+v.width/2,left:r.left,right:r.right,vright:v.right};});
   assert.ok(box.right<=box.vright+1,'inside the spread');await page.waitForTimeout(300);await page.screenshot({path:'.reader/web-dev/next-reads-spread.png'});
   await context.close();
   const lastSpread=async nextReads=>{const {page,context}=await open({layout:'spread',nextReads});await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));await page.waitForTimeout(700);
     const result={label:await page.locator('#pagination-slot [aria-label^="Pages "]').last().textContent(),shown:await page.locator('.next-reads').count()};await context.close();return result;};
   const without=await lastSpread(false),withReads=await lastSpread(true);
   assert.equal(without.shown,0);assert.equal(withReads.label,without.label,'Read next never adds a spread');}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Backstage passed: Space p Settings page and focus, Indexes page, index states, loading/success/error toasts, real keyword rebuild, one job at a time, settings save, phone width, Read next order and placement in scroll and two-page layouts, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
