/* Reading log under the title: marks and order, expanded groups, folded agents, your own read, find exclusion, phone width, two pages, PDFs, errors and every theme. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const THEMES=['ink','paper','orchid','orchid-dark','harvest','harvest-dark',...require('../src/reader_mcp/web_ui/famous-themes.json').themes.flatMap(t=>[t.id,t.id+'-dark'])];
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--reading-log'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const open=async(prefs,viewport={width:1300,height:900},collect=true)=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',nextReads:false,...prefs}));
    const page=await context.newPage();if(collect){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});return {page,context};};
  const doc=path=>url+'#read='+encodeURIComponent(path);
  const entries=page=>page.locator('.reading-log-entry').evaluateAll(els=>els.map(el=>el.textContent.replace(/\s+/g,' ').trim()));
  // Marks and order, then the expanded log by keyboard.
  {const {page,context}=await open({layout:'scroll'});
   const readers=page.waitForResponse(r=>r.url().includes('/api/readers?'));
   await page.goto(doc('library/thought.md'));await readers;
   await page.locator('.reading-log-entry',{hasText:'You just now'}).waitFor();
   const line=await entries(page);
   assert.deepEqual(line.map(t=>t.replace(/ (today|just now|\d+ min ago)$/,'')),['◉ Builder','◐ Archivist (earlier edition)','◉ You','2 task agents'],JSON.stringify(line));
   assert.equal(await page.locator('.reading-log-more').count(),0,'four entries fit without +N more');
   assert.match(await page.locator('.reading-log-entry').first().getAttribute('title'),/^Read this edition · Builder · [A-Z][a-z]{2} \d+, \d{4}, \d+:\d\d\s[AP]M \S+$/);
   assert.ok(await page.evaluate(()=>{const log=document.querySelector('.reading-log');return log.hasAttribute('data-reader-decoration')&&log.previousElementSibling.classList.contains('document-meta')&&log.closest('#article')!==null;}),'decoration directly under the meta, inside the article');
   await page.locator('.reading-log-details>summary').focus();await page.keyboard.press('Enter');
   await page.locator('.reading-log-body').waitFor();
   const groups=await page.locator('.reading-log-group').evaluateAll(els=>els.map(g=>[g.dataset.groupState,[...g.querySelectorAll('.reading-log-name')].map(n=>n.textContent)]));
   assert.deepEqual(groups,[['current',['You','Builder']],['earlier',['Archivist']]],'newest first in each group');
   assert.equal(await page.locator('.reading-log-group[data-group-state=earlier] [data-against]').count(),1);
   await page.locator('.reading-log-agents>summary').click();
   assert.deepEqual((await page.locator('.reading-log-agents .reading-log-name').allTextContents()).sort(),['task-agent-one','task-agent-two']);
   await page.screenshot({path:'.reader/web-dev/reading-log.png'});
   // Thread link opens that participant's threads.
   await page.locator('[data-reader-threads="Builder"]').click();await page.locator('#thread-panel:not([hidden])').waitFor();
   assert.equal(await page.locator('#thread-title').textContent(),'In the margins · Builder');assert.equal(await page.locator('.thread-list-item').count(),1);
   await page.keyboard.press('Escape');
   // Find never matches the log.
   await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').fill('task-agent-one');await page.waitForTimeout(250);
   assert.equal(await page.locator('#find-count').textContent(),'0 / 0');await page.locator('#find-query').fill('distinct observation for chapter 3 ');await page.waitForFunction(()=>document.querySelector('#find-count').textContent!=='0 / 0');
   await page.keyboard.press('Escape');
   // Phone width: wraps, no horizontal scroll, expanded log within the viewport.
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at 390 px');
   const box=await page.locator('.reading-log').boundingBox();assert.ok(box.x>=16-1&&box.x+box.width<=390-16+1,JSON.stringify(box));
   await page.screenshot({path:'.reader/web-dev/reading-log-phone.png'});
   // Every theme: the log's text keeps contrast against the page.
   const contrast=await page.evaluate(themes=>{
     const freeze=document.head.appendChild(document.createElement('style'));freeze.textContent='*,*::before,*::after{transition:none!important}';
     const html=document.documentElement,original=html.dataset.theme,canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{willReadFrequently:true});
     const rgb=v=>{context.clearRect(0,0,1,1);context.fillStyle=v;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].slice(0,3);};
     const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
     const ratio=(a,b)=>{const [lo,hi]=[lum(rgb(a)),lum(rgb(b))].sort((x,y)=>x-y);return (hi+.05)/(lo+.05);};
     const rows=[];for(const theme of themes){html.dataset.theme=theme;const bg=getComputedStyle(html).getPropertyValue('--bg');
       const text=['.reading-log-entry','.reading-log-name','.reading-log-row time','.reading-log-agents summary'].map(s=>ratio(getComputedStyle(document.querySelector(s)).color,bg));
       const mark=ratio(getComputedStyle(document.querySelector('[data-state=current] .reading-log-mark')).color,bg);
       rows.push({theme,text:Math.min(...text),mark,height:document.querySelector('.reading-log').getBoundingClientRect().height});}
     html.dataset.theme=original;freeze.remove();return rows;},THEMES);
   assert.equal(contrast.length,6+2*require('../src/reader_mcp/web_ui/famous-themes.json').themes.length);
   for(const row of contrast){assert.ok(row.text>=4.5&&row.mark>=3&&row.height>0,JSON.stringify(row));}
   await context.close();}
  // Empty state before your receipt lands, on a PDF, then "You just now" without a reload.
  {const {page,context}=await open({layout:'scroll'});let release;const gate=new Promise(resolve=>release=resolve);
   await page.route('**/api/seen',async route=>{await gate;await route.continue();});
   await page.goto(doc('library/pages.pdf'));
   await page.locator('.reading-log-empty',{hasText:'Not yet read by anyone. You’ll be first.'}).waitFor();
   release();await page.locator('.reading-log-entry',{hasText:'You just now'}).waitFor();
   assert.deepEqual(await entries(page),['◉ You just now']);
   assert.ok(await page.locator('.reading-log').evaluate(el=>el.hasAttribute('data-reader-decoration')));
   await context.close();}
  // Two pages: in the first column under the title, on one line.
  {const {page,context}=await open({layout:'spread'});
   await page.goto(doc('library/thought.md'));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
   await page.locator('.reading-log[data-ready=true]').waitFor();
   const r=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect(),log=document.querySelector('.reading-log').getBoundingClientRect(),title=document.querySelector('#article .document-title').getBoundingClientRect(),line=document.querySelector('.reading-log-details>summary').getBoundingClientRect();return {half:v.left+v.width/2,left:log.left,right:log.right,top:log.top,titleBottom:title.bottom,line:line.height,visible:log.width>0&&log.height>0};});
   assert.ok(r.visible&&r.right<=r.half+1&&r.top>=r.titleBottom-1&&r.line<30,JSON.stringify(r));
   await page.waitForTimeout(400);await page.screenshot({path:'.reader/web-dev/reading-log-spread.png'});
   await context.close();}
  // An unavailable log never blocks the document.
  {const {page,context}=await open({layout:'scroll'},undefined,false);
   await page.route('**/api/readers?*',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Invalid read receipt identity/schema'})}));
   await page.goto(doc('library/other.md'));await page.getByRole('heading',{name:'Another thought'}).waitFor();
   await page.locator('.reading-log-empty',{hasText:'Reading log unavailable'}).waitFor();
   // A secondary failure toasts quietly (not as an error) and keeps the article.
   const logToast=page.locator('[data-sonner-toast]',{hasText:'Reading log unavailable'});await logToast.waitFor();
   assert.notEqual(await logToast.getAttribute('data-type'),'error');assert.equal(await page.locator('text=Document unavailable').count(),0);
   await context.close();}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Reading log passed: exact/earlier marks and voice-you-agent order, keyboard expansion with newest-first groups, folded task agents, thread filter link, find exclusion, 390 px fit, contrast in 22 themes, PDF empty state then "You just now", two-page first column, unavailable state with a quiet toast, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
