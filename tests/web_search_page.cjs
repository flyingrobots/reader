/* The search page: Space /, passages with custom-highlighted terms, facets in the URL, keys, open-at-passage in both layouts, phone width. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--search-page'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});};
  const start=async(prefs,viewport={width:1300,height:900})=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(p=>{try{if(!sessionStorage.getItem('seeded')){localStorage.setItem('reader.preferences.v1',JSON.stringify(p));sessionStorage.setItem('seeded','1');}}catch{}},{smooth:false,theme:'paper',...prefs});const page=await context.newPage();watch(page);return {context,page};};
  const highlighted=(page,name)=>page.evaluate(n=>[...(CSS.highlights.get(n)||[])].map(r=>r.toString()),name);
  const currentMatch=page=>page.evaluate(()=>{const r=[...(CSS.highlights.get('reader-current')||[])][0];if(!r)return null;const b=r.getBoundingClientRect();return {text:r.toString(),top:b.top,left:b.left,right:b.right,bottom:b.bottom,width:innerWidth,height:innerHeight};});

  // Continuous layout.
  let {context,page}=await start({});
  await page.goto(url);await page.locator('#home-title').waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('/');
  await page.locator('.search-page').waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='search-query');
  assert.equal(await page.locator('#vim-mode').textContent(),'SEARCH');
  assert.ok(await page.locator('.search-empty').isVisible(),'empty query shows the quiet start state');
  await page.keyboard.type('observation');
  await page.locator('.search-work').first().waitFor();
  await page.waitForFunction(()=>(CSS.highlights.get('reader-search-term')?.size||0)+(CSS.highlights.get('reader-search-active')?.size||0)>0);
  const terms=[...await highlighted(page,'reader-search-term'),...await highlighted(page,'reader-search-active')];
  assert.ok(terms.length>3&&terms.every(t=>t.toLowerCase()==='observation'),'terms are highlighted by range: '+terms.slice(0,5));
  assert.equal(await page.locator('.search-excerpt mark, .search-excerpt b').count(),0,'excerpts are text, never markup');
  assert.match(decodeURIComponent(new URL(page.url()).hash),/^#search=q=observation/);
  assert.match(await page.locator('#search-meta').textContent(),/\d+ works · \d+ passages shown · indexed/);
  const titles=async()=>page.locator('.search-work-title').allTextContents();
  assert.ok((await titles()).includes('Keepers of the harbor'));
  assert.equal((await titles()).filter(t=>t==='Keepers of the harbor').length,1,'a reading copy and its original are one work');
  assert.equal(await page.locator('.search-work[data-work="library/reports/ledger/ledger-report.md"] .search-passage').count(),1,'the bundle groups as one work; the receipt stays out');
  await page.screenshot({path:'.reader/web-dev/search-paper.png',fullPage:true});

  // A facet narrows the results and the URL; clearing restores.
  await page.locator('[data-facet=project] label').filter({hasText:'Ledger'}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.search-work-title')].map(e=>e.textContent).join('|')==='Ledger report');
  assert.match(decodeURIComponent(new URL(page.url()).hash),/project=Ledger/);
  assert.equal(await page.locator('[data-facet=project] label').filter({hasText:'Harbor'}).locator('.search-facet-count').textContent(),'1','a facet keeps its other values choosable');
  await page.locator('.search-rail .search-clear').click();
  await page.waitForFunction(()=>document.querySelectorAll('.search-work').length>1);
  await page.locator('[data-read-filter=read]').click();
  await page.locator('.search-empty[data-state=none]').waitFor();
  assert.ok(await page.getByRole('button',{name:'Search by meaning'}).isVisible(),'no results suggests another mode');
  await page.locator('[data-read-filter=all]').click();await page.locator('.search-work').first().waitFor();

  // j/k between passages, J/K between works.
  await page.locator('[data-search-mode=words]').click();
  await page.locator('#search-query').fill('distinct observation chapter 37');
  await page.waitForFunction(()=>document.querySelector('.search-work-title')?.textContent==='A quiet thought'&&/chapter 3\d/.test(document.querySelector('.search-excerpt')?.textContent||''));
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.activeElement?.dataset.passage==='0');
  assert.match(await page.locator('#status-keys').textContent(),/passages/);
  await page.keyboard.press('j');await page.waitForFunction(()=>document.activeElement?.dataset.passage==='1');
  await page.keyboard.press('k');await page.waitForFunction(()=>document.activeElement?.dataset.passage==='0');
  await page.keyboard.press('Shift+J');
  await page.waitForFunction(()=>document.activeElement?.closest('.search-work')!==document.querySelector('.search-work'));
  await page.keyboard.press('Shift+K');await page.waitForFunction(()=>document.activeElement?.dataset.passage==='0');
  const label=await page.locator('[data-passage="0"] .search-passage-label').textContent();
  const line=+label.match(/Line (\d+)/)[1];assert.ok(line>200,'the passage is deep in the document: '+label);
  // q queues the active passage's work (RW-30), and each work has a + Queue button.
  const activeWork=await page.evaluate(()=>document.activeElement.closest('.search-work').dataset.work);
  await page.keyboard.press('q');await page.locator('[data-sonner-toast]').filter({hasText:'Added to your queue'}).first().waitFor();
  const otherWork=page.locator('.search-work').nth(1);const otherPath=await otherWork.getAttribute('data-work');
  await otherWork.locator('[data-queue-add]').click();
  await page.waitForFunction(async([a,b])=>{const q=(await (await fetch('/api/queue?participant=Browser%20tester')).json()).queued.map(r=>r.path);return q.includes(a)&&q.includes(b);},[activeWork,otherPath]);
  assert.ok(await page.locator('.search-page').isVisible(),'queueing keeps you on Search');
  await page.locator('[data-passage="0"]').focus();await page.waitForFunction(()=>document.activeElement?.dataset.passage==='0');
  // o opens the passage in a new tab and keeps you on Search.
  const [tab]=await Promise.all([context.waitForEvent('page'),page.keyboard.press('o')]);
  await tab.waitForLoadState();assert.match(decodeURIComponent(tab.url()),/#read=library\/thought\.md&at=/);await tab.close();
  assert.ok(await page.locator('.search-page').isVisible());
  // Enter opens at the passage with the terms highlighted.
  await page.keyboard.press('Enter');
  await page.locator('#article').waitFor();await page.waitForFunction(()=>!document.getElementById('search-chip').hidden);
  assert.match(await page.locator('#search-chip').textContent(),/^From search: distinct observation chapter 37 · \d+ of \d+ · Esc to clear$/);
  let match=await currentMatch(page);
  assert.ok(match&&/^(distinct|observation|chapter|37)$/i.test(match.text),'current match is a query word: '+match?.text);
  assert.ok(match.top>=0&&match.bottom<=match.height,'the passage is on screen in continuous layout: '+JSON.stringify(match));
  assert.ok(await page.evaluate(()=>scrollY>2000),'the page scrolled to the passage');
  assert.ok((await highlighted(page,'reader-find')).length>20,'every occurrence of the terms is highlighted');
  const before=(await page.locator('#search-chip').textContent()).match(/· (\d+) of/)[1];
  await page.keyboard.press('n');
  await page.waitForFunction(b=>!document.getElementById('search-chip').textContent.includes('· '+b+' of'),before);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('search-chip').hidden);
  assert.equal((await highlighted(page,'reader-find')).length,0,'Esc clears the search highlights');
  // Returning to Search keeps the query; Esc returns to where you were.
  await page.locator('#main').focus();await page.keyboard.press('h');
  await page.locator('.search-work').first().waitFor();
  assert.equal(await page.locator('#search-query').inputValue(),'distinct observation chapter 37');
  await page.locator('[data-passage="0"]').focus();await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.search-page'));
  assert.ok(!(await page.evaluate(()=>location.hash)).startsWith('#search'));

  // Meaning: related passages without literal matches are labelled.
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('/');
  await page.locator('[data-search-mode=meaning]').click();
  await page.locator('#search-query').fill('somewhere volumes are kept');
  await page.locator('.search-work-title',{hasText:'Rooms of shelves'}).waitFor();
  assert.ok(await page.locator('.search-work').filter({hasText:'Rooms of shelves'}).locator('.search-related').isVisible());
  for(const theme of ['ink','gruvbox-dark']){
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(80);
    const readable=await page.locator('.search-excerpt').first().evaluate(el=>getComputedStyle(el).color!==getComputedStyle(document.body).backgroundColor);
    assert.ok(readable,'excerpts stay readable in '+theme);
    await page.screenshot({path:`.reader/web-dev/search-${theme}.png`,fullPage:true});
  }
  await context.close();

  // Two-page layout, from a linkable #search= URL.
  ({context,page}=await start({layout:'spread'}));
  await page.goto(url+'#search='+encodeURIComponent('q=distinct observation chapter 37&mode=words'));
  await page.waitForFunction(()=>document.querySelector('.search-work-title')?.textContent==='A quiet thought'&&/chapter 3\d/.test(document.querySelector('.search-excerpt')?.textContent||''));
  assert.equal(await page.locator('[data-search-mode=words]').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.dataset.passage==='0');
  await page.keyboard.press('Enter');
  await page.locator('body.two-page .book-viewport').waitFor();await page.waitForFunction(()=>!document.getElementById('search-chip').hidden);
  await page.waitForTimeout(150);
  match=await currentMatch(page);
  assert.ok(match&&match.left>=0&&match.right<=match.width,'the match is on the visible spread: '+JSON.stringify(match));
  assert.ok(await page.evaluate(()=>document.querySelector('.book-viewport').scrollLeft>0),'turned to a later spread');
  await page.keyboard.press('n');await page.waitForTimeout(100);
  match=await currentMatch(page);assert.ok(match.left>=0&&match.right<=match.width,'n turns to the next match');
  await context.close();

  // Phone width: one column, filters in a sheet, no horizontal scroll.
  ({context,page}=await start({theme:'paper'},{width:390,height:844}));
  await page.goto(url+'#search='+encodeURIComponent('q=observation'));
  await page.locator('.search-work').first().waitFor();
  assert.match(await page.locator('.search-work[data-work="library/reports/ledger/ledger-report.md"] .search-excerpt').textContent(),/[0-9a-f]{200}/,'an excerpt holds a long unbroken token');
  assert.deepEqual(await page.evaluate(()=>({scroll:document.documentElement.scrollWidth<=innerWidth+1,wide:[...document.querySelectorAll('.search-work, .search-work *')].filter(el=>el.getBoundingClientRect().right>innerWidth-15.5).map(el=>el.className)})),{scroll:true,wide:[]},'no horizontal scroll at phone width; every result stays inside the 16 px gutter');
  assert.ok(!(await page.locator('.search-rail').isVisible()));
  const gutter=await page.locator('.search-head').evaluate(el=>el.getBoundingClientRect().left);assert.equal(Math.round(gutter),16);
  await page.screenshot({path:'.reader/web-dev/search-phone.png',fullPage:true});
  await page.locator('.search-filter-toggle').click();
  await page.locator('.search-sheet [data-facet=project]').waitFor();
  await page.waitForFunction(()=>{const el=document.querySelector('.search-sheet');return el&&getComputedStyle(el).opacity==='1'&&!el.hasAttribute('data-starting-style');});await page.waitForTimeout(250);
  await page.screenshot({path:'.reader/web-dev/search-phone-filters.png'});
  await page.locator('.search-sheet [data-facet=project] label').filter({hasText:'Harbor'}).click();
  await page.waitForFunction(()=>decodeURIComponent(location.hash).includes('project=Harbor'));
  await page.keyboard.press('Escape');await page.locator('.search-sheet').waitFor({state:'detached'});
  assert.ok(await page.locator('.search-page').isVisible(),'Esc closes the sheet, not the page');
  await context.close();

  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Search page passed: Space / focus, highlighted passages, facets in the URL, read filter, j/k/J/K, q and + Queue, o in a new tab, open at passage in continuous and two-page layouts with n stepping, Esc clearing and returning, meaning notes, three themes, phone sheet, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
