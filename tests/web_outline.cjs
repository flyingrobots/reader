/* Document outline: continuous rail, ]] / [[, Space o, two-page popover, phone sheet, embeds, short documents and PDF outlines. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const THEMES=['ink','paper','orchid','orchid-dark','harvest','harvest-dark',...require('../src/reader_mcp/web_ui/famous-themes.json').themes.flatMap(t=>[t.id,t.id+'-dark'])];
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--outline'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=async(viewport,prefs={})=>{const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});await ctx.addInitScript(value=>{try{if(!sessionStorage.getItem('seeded')){localStorage.setItem('reader.preferences.v1',value);sessionStorage.setItem('seeded','1');}}catch{}},JSON.stringify({smooth:false,theme:'paper',...prefs}));return ctx;};
  const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});return page;};
  const open=async(page,path)=>{await page.evaluate(()=>document.querySelector('#article')?.setAttribute('data-stale','')).catch(()=>{});await page.goto(url+'/#read='+encodeURIComponent(path));await page.waitForFunction(()=>document.querySelector('#article:not([data-stale])')&&!document.querySelector('.resume-pending'));await page.waitForTimeout(150);};
  const activeTitle=()=>{const el=document.querySelector('[aria-label="Document outline"] [aria-current=location]');return el?(el.querySelector('.outline-entry-title')||el).textContent.trim():null;};
  const current=page=>page.evaluate(activeTitle);
  const waitCurrent=(page,text)=>page.waitForFunction(text=>{const el=document.querySelector('[aria-label="Document outline"] [aria-current=location]');return !!el&&(el.querySelector('.outline-entry-title')||el).textContent.trim()===text;},text,{timeout:5000});
  const leader=async(page,key)=>{await page.keyboard.press('Space');await page.keyboard.press(key);};

  // Continuous reading: the rail, active section, ]] / [[ and Space o.
  {const ctx=await context({width:1300,height:820});const page=watch(await ctx.newPage());
   await open(page,'library/thought.md');
   const rail=page.locator('#outline-rail');await rail.waitFor();
   assert.equal(await rail.getAttribute('aria-label'),'Document outline');assert.equal(await rail.evaluate(el=>el.tagName),'NAV');
   assert.equal(await rail.locator('a').count(),45);assert.equal(await rail.locator('li[data-depth="1"] a').count(),44,'44 chapter entries under the title');
   assert.equal(await rail.locator('li[data-depth="0"] a').textContent(),'A quiet thought');
   const ids=await page.evaluate(()=>[...document.querySelectorAll('#article h2')].slice(0,3).map(h=>h.id));assert.deepEqual(ids,['chapter-1','chapter-2','chapter-3'],'headings gain stable slugs');
   const box=await page.evaluate(()=>{const r=document.querySelector('#outline-rail').getBoundingClientRect(),a=document.querySelector('#article').getBoundingClientRect();return {right:r.right,left:r.left,article:a.left};});
   assert.ok(box.left>=16&&box.right<box.article,'rail sits left of the article: '+JSON.stringify(box));
   // Blocks far from the window have estimated heights (content-visibility) until the scroll arrives; scroll again until it holds.
   await page.evaluate(async()=>{const h=document.getElementById('chapter-10');for(let i=0;i<5;i++){h.scrollIntoView({block:'start'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,100))));if(Math.abs(h.getBoundingClientRect().top)<2)break;}});
   await waitCurrent(page,'Chapter 10');assert.equal(await page.locator('#status-section').textContent(),'Chapter 10');
   assert.equal(await page.evaluate(()=>document.querySelector('#outline-rail [aria-current] + .outline-progress')!==null),true,'progress bar under the active entry');
   const progress=await page.evaluate(()=>document.querySelector('.outline-progress>span').style.transform);assert.match(progress,/scaleX\(0\.\d+|scaleX\(0\)/);
   await page.locator('#main').focus();await page.keyboard.press(']');await page.keyboard.press(']');await waitCurrent(page,'Chapter 11');
   const line=await page.evaluate(()=>document.getElementById('chapter-11').getBoundingClientRect().top/innerHeight);assert.ok(line>.15&&line<.25,'heading lands on the reading line: '+line);
   await page.keyboard.press(']');await page.keyboard.press(']');await waitCurrent(page,'Chapter 12');
   await page.keyboard.press('[');await page.keyboard.press('[');await waitCurrent(page,'Chapter 11');
   await page.keyboard.press(']');await page.waitForTimeout(700);await page.keyboard.press(']');await page.waitForTimeout(200);assert.equal(await current(page),'Chapter 11','brackets outside the 650 ms window do nothing');
   // Clicking an entry moves there.
   await rail.locator('a',{hasText:/^Chapter 30$/}).click();await waitCurrent(page,'Chapter 30');
   // Headings at the very end cannot reach the reading line, but a jump still selects them.
   await page.locator('#main').focus();await page.keyboard.press('G');await page.waitForTimeout(200);
   await rail.locator('a',{hasText:/^Chapter 44$/}).click();await waitCurrent(page,'Chapter 44');
   await page.locator('#main').focus();await page.keyboard.press('[');await page.keyboard.press('[');await waitCurrent(page,'Chapter 43');
   assert.equal(await page.evaluate(()=>{const list=document.querySelector('#outline-rail .outline-list'),item=document.querySelector('#outline-rail [aria-current]').parentElement;return item.offsetTop>=list.scrollTop&&item.offsetTop+item.offsetHeight<=list.scrollTop+list.clientHeight;}),true,'active entry stays in view');
   await page.screenshot({path:'.reader/web-dev/outline-rail.png'});
   // Space o hides the rail and remembers it; again shows it and focuses the active entry.
   await page.locator('#main').focus();await leader(page,'o');await rail.waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).outline),false);
   assert.equal(await page.locator('#outline-open').getAttribute('aria-pressed'),'false');
   await page.reload();await page.locator('#outline-open').waitFor();await page.waitForTimeout(200);assert.equal(await rail.isVisible(),false,'hidden preference persists');
   await page.locator('#main').focus();await leader(page,'o');await rail.waitFor();
   assert.equal(await page.evaluate(()=>document.activeElement.closest('#outline-rail')!==null),true,'Space o focuses the rail');
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).outline),true);
   // Embedded documents' headings are excluded.
   await open(page,'library/embed-host.md');await page.locator('.embedded-content h2').waitFor();await rail.waitFor({timeout:5000}).catch(async error=>{throw new Error('embed rail: '+JSON.stringify(await page.evaluate(()=>({hidden:document.querySelector('#outline-rail').hidden,links:document.querySelectorAll('#outline-rail a').length,prefs:localStorage.getItem('reader.preferences.v1'),btn:document.querySelector('#outline-open')?.getAttribute('aria-pressed'),hash:location.hash}))));});
   assert.deepEqual(await rail.locator('a').allTextContents(),['Host document','Host one','Host two','Host two detail']);
   // More than 150 entries: H4–H6 fold behind Show all levels.
   await open(page,'library/deep.md');await rail.waitFor();assert.equal(await rail.locator('a').count(),81,'title + 40 H2 + 40 H3');
   await rail.getByRole('button',{name:'Show all levels'}).click();assert.equal(await rail.locator('a').count(),161);
   await rail.getByRole('button',{name:'Show fewer levels'}).click();assert.equal(await rail.locator('a').count(),81);
   // Two headings and few words: no rail by default, but the Outline button and Space o can pin it.
   await open(page,'library/short.md');await page.locator('#outline-open').waitFor();assert.equal(await rail.isVisible(),false,'short document shows no rail');
   await page.locator('#main').focus();await leader(page,'o');await rail.waitFor();assert.equal(await rail.locator('a').count(),2);
   // The setting appears on the Behind the scenes page.
   await page.locator('#main').focus();await leader(page,'p');const setting=page.getByRole('switch',{name:'Outline beside long documents'});await setting.waitFor();assert.equal(await setting.getAttribute('aria-checked'),'true');
   assert.equal(await rail.isVisible(),false,'no rail outside documents');assert.equal(await page.locator('#outline-open').count(),0);
   // Help and leader hints mention the keys.
   assert.ok((await page.locator('#help').textContent()).includes('Show or hide the document outline'));
   await page.locator('#main').focus();await page.keyboard.press('Space');assert.ok((await page.locator('#status-keys').textContent()).includes('outline'));await page.keyboard.press('Escape');
   // Rail contrast across every theme uses tokens only.
   const contrast=await page.evaluate(themes=>{
    const html=document.documentElement,original=html.dataset.theme,canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');
    const rgb=v=>{c.clearRect(0,0,1,1);c.fillStyle=v;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].slice(0,3);};
    const lum=v=>v.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{const [lo,hi]=[lum(rgb(a)),lum(rgb(b))].sort((x,y)=>x-y);return (hi+.05)/(lo+.05);};
    const rows=themes.map(theme=>{html.dataset.theme=theme;const s=getComputedStyle(html),v=n=>s.getPropertyValue(n).trim();return {theme,muted:ratio(v('--muted'),v('--bg')),ink:ratio(v('--ink'),v('--bg')),accent:ratio(v('--accent'),v('--bg'))};});
    html.dataset.theme=original;return rows;},THEMES);
   assert.equal(contrast.length,22);for(const row of contrast){assert.ok(row.muted>=4.5&&row.ink>=4.5,JSON.stringify(row));assert.ok(row.accent>=3,'active marker: '+JSON.stringify(row));}
   await ctx.close();}

  // Two-page reading: a popover with page labels; choosing an entry turns to its spread.
  {const ctx=await context({width:1300,height:820},{layout:'spread'});const page=watch(await ctx.newPage());
   await open(page,'library/thought.md');await page.waitForFunction(()=>document.body.classList.contains('two-page'));
   assert.equal(await page.locator('#outline-rail').isVisible(),false,'no rail column in two-page mode');
   const before=await page.evaluate(()=>({width:document.querySelector('#article').scrollWidth,spreads:document.querySelectorAll('#pagination-slot [aria-label^=Pages]').length}));
   await page.locator('#main').focus();await leader(page,'o');const popover=page.locator('#outline-popover');await popover.waitFor();
   assert.equal(await popover.locator('[aria-label="Document outline"] button').count(),45);
   const labels=await popover.locator('.outline-entry-page').allTextContents();assert.equal(labels[0],'p. 1–2');assert.ok(labels.every(l=>/^p\. \d+(–\d+)?$/.test(l)),labels.join());
   const entry=popover.locator('button',{hasText:'Chapter 30'}),label=(await entry.locator('.outline-entry-page').textContent()).slice(3);
   assert.notEqual(label,'1–2');
   await page.screenshot({path:'.reader/web-dev/outline-popover.png'});
   assert.equal(await page.evaluate(()=>document.activeElement?.matches('#outline-popover [aria-current=location]')),true,'popover focuses the active entry');
   await entry.click();await popover.waitFor({state:'hidden'});
   await page.waitForFunction(label=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent===label,label,{timeout:5000});
   assert.equal(await page.locator('#status-section').textContent(),'Chapter 30');
   assert.equal(await page.evaluate(()=>document.querySelector('#article').scrollWidth),before.width,'pagination is unchanged');
   // ]] turns forward to the next heading's spread; [[ returns.
   await page.locator('#main').focus();const spread=await page.locator('#pagination-slot [aria-current=page]').textContent();
   for(let i=0;i<4;i++){await page.keyboard.press(']');await page.keyboard.press(']');await page.waitForTimeout(80);}
   await page.waitForFunction(spread=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent!==spread,spread,{timeout:5000});
   for(let i=0;i<4;i++){await page.keyboard.press('[');await page.keyboard.press('[');await page.waitForTimeout(80);}
   await page.waitForFunction(spread=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent===spread,spread,{timeout:5000});
   // Space o toggles the popover; Escape closes it too.
   await leader(page,'o');await popover.waitFor();await page.keyboard.press('Escape');await popover.waitFor({state:'hidden'});
   await ctx.close();}

  // Phone width: no rail; Space o and the status-line button open a bottom sheet.
  {const ctx=await context({width:390,height:844});const page=watch(await ctx.newPage());
   await open(page,'library/thought.md');await page.locator('#outline-open').waitFor();
   assert.equal(await page.locator('#outline-rail').isVisible(),false,'rail hidden at 390 px');
   await page.locator('#main').focus();await leader(page,'o');const sheet=page.locator('#outline-sheet');await sheet.waitFor();
   const rect=await sheet.boundingBox();assert.ok(rect.y+rect.height>=843&&rect.width>=389,'bottom sheet: '+JSON.stringify(rect));
   await page.waitForFunction(()=>document.activeElement?.matches('#outline-sheet [aria-current=location]'),null,{timeout:3000}).catch(async error=>{throw new Error('sheet focus: '+await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,160)));});
   await page.screenshot({path:'.reader/web-dev/outline-sheet.png'});
   await sheet.locator('button',{hasText:'Chapter 5'}).first().click();await sheet.waitFor({state:'hidden'});
   await page.waitForFunction(()=>Math.abs(document.getElementById('chapter-5').getBoundingClientRect().top-innerHeight*.22)<6,null,{timeout:5000});
   await page.locator('#outline-open').click();await sheet.waitFor();await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page scroll');
   await ctx.close();}

  // PDFs: the outline comes from the file; a PDF without one offers no outline.
  {const ctx=await context({width:1300,height:820});const page=watch(await ctx.newPage());
   await open(page,'library/outlined.pdf');const rail=page.locator('#outline-rail');await rail.waitFor();
   assert.deepEqual(await rail.locator('a').allTextContents(),['Part one','Section on page 3','Part two','Closing pages']);
   assert.deepEqual(await rail.locator('li').evaluateAll(items=>items.map(i=>i.dataset.depth)),['0','1','0','0']);
   await rail.locator('a',{hasText:'Closing pages'}).click();await waitCurrent(page,'Closing pages');
   await page.waitForFunction(()=>Math.abs(document.querySelector('[data-pdf-page="7"]').getBoundingClientRect().top-innerHeight*.22)<6,null,{timeout:5000});
   await rail.locator('a',{hasText:'Section on page 3'}).click();
   await page.waitForFunction(()=>Math.abs(document.querySelector('[data-pdf-page="3"]').getBoundingClientRect().top-innerHeight*.22)<6,null,{timeout:5000});await waitCurrent(page,'Section on page 3');
   await open(page,'library/pages.pdf');await page.waitForTimeout(300);
   assert.equal(await rail.isVisible(),false);assert.equal(await page.locator('#outline-open').count(),0,'no outline offered');
   await page.locator('#main').focus();await leader(page,'o');await page.getByText('This PDF has no outline.').waitFor();
   await ctx.close();}
  {const ctx=await context({width:1300,height:820},{layout:'spread'});const page=watch(await ctx.newPage());
   await open(page,'library/outlined.pdf');await page.waitForFunction(()=>document.body.classList.contains('two-page'));
   await page.locator('#main').focus();await leader(page,'o');const popover=page.locator('#outline-popover');await popover.waitFor();
   await popover.locator('button',{hasText:'Closing pages'}).click();
   await page.waitForFunction(()=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent==='7–8',null,{timeout:5000});
   await ctx.close();}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Outline passed: 45-entry rail with slugs and progress, active section on scroll, ]] / [[ with the 650 ms window, end-of-document jumps, Space o persistence and focus, embed exclusion, level folding over 150 entries, short-document default, settings and help, 22-theme rail contrast, two-page popover labels and spread turns, phone bottom sheet, PDF outline jumps in both layouts, no outline for a PDF without one.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
