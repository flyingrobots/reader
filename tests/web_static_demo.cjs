/* The static demo (RW-42): `reader demo --export-static` writes a site that a plain static file server
   serves under /reader/. The magazine, documents, outline, editions and What changed, Read next, the link
   graph, keyword search, themes, a PDF, an image, article art and a local-only highlight all work, no request reaches
   /api/* on the server or leaves the origin, and the shim is inert on a page without the flag. */
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const http=require('node:http');
const {mkdirSync,mkdtempSync,rmSync,readFileSync,statSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png',
  '.woff2':'font/woff2','.pdf':'application/pdf','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf'};
(async()=>{
 const scratch=mkdtempSync(path.join(tmpdir(),'reader-static-test-')),site=path.join(scratch,'site'),out=path.join(site,'reader');
 let browser,server;const requests=[];
 try{
  const run=spawnSync(process.env.READER_PYTHON||'.venv/bin/python',['-m','reader_mcp.cli','demo','--export-static',out,'--base-path','/reader/'],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1'},timeout:180000});
  assert.equal(run.status,0,run.stderr+run.stdout);
  assert.match(run.stdout,/Static demo: \d+ files, [\d.]+ MiB, \d+ recorded routes, base path \/reader\//);
  // A plain static server: files only, no /api routes, every request logged.
  server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://x').pathname);requests.push(pathname);
    let file=path.join(site,pathname);if(!file.startsWith(site+path.sep)){res.writeHead(403).end();return;}
    try{if(statSync(file).isDirectory())file=path.join(file,'index.html');const body=readFileSync(file);res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});res.end(body);}
    catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/reader/';
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external.push(route.request().url());return route.abort();});
  await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const ready=async()=>{await page.locator('#article').waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));};
  const open=async(doc,heading)=>{await page.goto(url+'#read='+encodeURIComponent(doc));await page.locator('#article h1').filter({hasText:heading}).first().waitFor();await ready();};
  // The magazine and the note that explains the demo.
  await page.goto(url);await page.locator('#home-title').waitFor();await page.locator('.issue-cover').waitFor();
  assert.equal(await page.locator('.cover-title').textContent(),'Modern Fiction','the newsletter pick is the cover story');
  assert.ok((await page.locator('.feature-title').count())>=3,'features from several projects');
  assert.match(await page.locator('#static-demo-note').textContent(),/stay only in this browser/);
  assert.ok(await page.locator('#static-demo-note').evaluate(el=>el.hasAttribute('data-reader-decoration')));
  await page.screenshot({path:'.reader/web-dev/static-demo-magazine.png'});
  // Bespoke art (RW-43): the cover's exported scene and its Artist's note, with no still image or job route.
  const cover=page.locator('.cover-art[data-art]');await cover.waitFor();
  await page.waitForFunction(()=>['still','image','unavailable','live'].includes(document.querySelector('.cover-art')?.dataset.state));
  assert.match(await cover.locator('.art-note').textContent(),/\S{3}/,'the Artist’s note travels with the export');
  // A document with margins, its outline rail, Read next and the link graph.
  await open('library/walden/thoreau/where-i-lived.md','Where I Lived');
  await page.waitForFunction(()=>document.querySelectorAll('#article [data-thread]').length>=3);
  assert.match(await page.locator('#article').textContent(),/I went to the woods because I wished to live deliberately/);
  await page.locator('.next-reads .next-read').first().waitFor();
  await open('library/essayists/montaigne/of-books.md','Of Books');
  await page.locator('.linked-from[data-state=ready]').waitFor();
  assert.ok(Number(await page.locator('.linked-from-count').textContent())>=1,'the link graph lists who links here');
  // A piece without art: Generate art says it needs Reader running locally, and nothing is sent anywhere.
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');
  const make=page.locator('.article-art .art-placeholder [data-art-generate]');await make.waitFor();
  assert.equal(await make.textContent(),'Generate art (run Reader locally)');
  await make.click();
  await page.waitForFunction(()=>document.querySelector('[data-sonner-toaster]')?.textContent.includes('Making art needs Reader on your computer.'));
  await page.keyboard.press('Space');await page.keyboard.press('g');await page.locator('.article-art').waitFor({state:'detached'});
  await open('library/lantern/research/spaced-rereading.md','Spaced re-reading');
  await page.locator('#outline-rail:not([hidden]) a').nth(2).waitFor();
  // Editions and What changed.
  await open('library/lantern/design/sync-design.v2.md','Lantern sync');
  const chip=page.locator('[data-version-chip]').first();await chip.waitFor();assert.match(await chip.textContent(),/v2 of 2/);
  await chip.click();const panel=page.locator('#versions-panel');await panel.waitFor();await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  await open('library/lantern/journal/week-43.md','Week');
  await page.locator('#article > .change-banner').waitFor();await page.locator('[data-compare=mine]').click();
  const sheet=page.locator('#changes-panel');await sheet.waitFor();assert.ok(await sheet.locator('.change-hunk').count()>=1,'What changed lists hunks');
  await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});
  // The image and the PDF load from the exported files under the base path.
  await open('library/natural-history/darwin/the-only-figure.md','figure');
  await page.waitForFunction(()=>{const img=document.querySelector('#article img');return img&&img.complete&&img.naturalWidth>0;},null,{timeout:15000});
  await page.goto(url+'#read='+encodeURIComponent('library/lantern/reports/lantern-0.9-field-report.pdf'));
  await page.locator('#article canvas, #article .pdf-page').first().waitFor({timeout:30000});
  // Keyword search on the search page and the fuzzy picker, both in the browser.
  await page.goto(url+'#search='+encodeURIComponent('q=solitude&mode=words'));
  await page.locator('#search-meta').filter({hasText:/works?/}).waitFor({timeout:15000});
  assert.ok(await page.locator('.search-works > li').count()>=2,'several works match');
  await page.goto(url);await page.locator('#home-title').waitFor();
  const results=await page.evaluate(async()=>(await (await fetch('/api/search?q=montaigne&mode=fuzzy&participant=You')).json()).results.map(r=>r.path));
  assert.ok(results.some(p=>p.includes('montaigne')),'fuzzy search finds titles and paths');
  const keyword=await page.evaluate(async()=>(await (await fetch('/api/search?q=deliberately&mode=keyword')).json()).results.map(r=>r.path));
  assert.ok(keyword.includes('library/walden/thoreau/where-i-lived.md'),'keyword search finds passages');
  // Themes: a preview theme from the URL applies.
  await page.goto(url+'?theme=ink');await page.locator('#home-title').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'ink');
  // A local-only highlight survives a reload and stays in this browser's storage.
  await open('library/walden/thoreau/reading.md','Reading');
  const before=await page.locator('#article [data-thread]').count();
  await page.locator('#article p').nth(6).evaluate(el=>{el.scrollIntoView({block:'center'});const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#selection-tools').waitFor();await page.locator('[data-annotate=comment]').evaluate(b=>b.click());await page.locator('#annotation-body').fill('A note kept in this browser.');
  await page.locator('#annotation-form button[type=submit], #annotation-form button').last().click();await page.locator('#thread-reply').waitFor();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.static-demo.v1')));
  assert.equal(Object.values(stored.threads).length,1);assert.equal(Object.values(stored.threads)[0].comments[0].body,'A note kept in this browser.');
  await page.reload();await ready();await page.waitForFunction(n=>document.querySelectorAll('#article [data-thread]').length>n,before);
  // Server-only features say so instead of failing.
  const chat=await page.evaluate(async()=>{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"create"}'});return [r.status,(await r.json()).error];});
  assert.equal(chat[0],501);assert.match(chat[1],/your computer/);
  await page.goto(url+'#backstage');await page.locator('#main').getByText(/Behind the scenes/i).first().waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({path:'.reader/web-dev/static-demo-backstage.png'});
  // The shim is inert without the flag: a plain page keeps the browser's fetch.
  const plain=await context.newPage();await plain.goto(url+'robots.txt');
  await plain.addScriptTag({url:url+'assets/static-demo.js'});
  assert.equal(await plain.evaluate(()=>[typeof window.readerStaticDemo,/\[native code\]/.test(String(window.fetch))].join()),'undefined,true');
  await plain.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  assert.deepEqual(requests.filter(p=>p.startsWith('/api/')),[],'no request reaches /api/* on the server');
  assert.deepEqual(requests.filter(p=>!p.startsWith('/reader/')),[],'every request stays under the base path');
  const missing=requests.filter((p,i,all)=>all.indexOf(p)===i).filter(p=>{try{statSync(path.join(site,p));return false;}catch{return true;}});
  assert.deepEqual(missing,[],'every requested file exists in the export');
  console.log(`Static demo passed: exported under /reader/, ${requests.length} static requests, none to /api/* or off-origin; magazine, margins, Read next, link graph, editions, image, PDF, keyword and fuzzy search, themes, a local-only highlight across reload, server-only features labelled, and an inert shim without the flag.`);
 }finally{
  if(browser)await browser.close();
  if(server)server.close();
  rmSync(scratch,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exit(1);});
