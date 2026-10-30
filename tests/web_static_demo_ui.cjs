/* The static demo knows it is static (#107): with no server behind the page, visiting Reader Admin starts no
   job and raises no error; every control that needs a running Reader is disabled and says "Needs Reader on your
   computer" (a tooltip the pointer can reach), or is left out where a disabled card would be pointless; keyboard
   paths to the same writes explain instead of failing; nothing logs an error. A normal server is covered by the
   existing Reader Admin, queue, chat, theme and art suites. */
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const http=require('node:http');
const {mkdirSync,mkdtempSync,rmSync,readFileSync,statSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png',
  '.woff2':'font/woff2','.pdf':'application/pdf','.webmanifest':'application/manifest+json','.ttf':'font/ttf'};
const NEEDS=/^Needs Reader on your computer/;
(async()=>{
 const scratch=mkdtempSync(path.join(tmpdir(),'reader-static-ui-')),site=path.join(scratch,'site'),out=path.join(site,'reader');
 let browser,server;
 try{
  const run=spawnSync(process.env.READER_PYTHON||'.venv/bin/python',['-m','reader_mcp.cli','demo','--export-static',out,'--base-path','/reader/'],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1'},timeout:180000});
  assert.equal(run.status,0,run.stderr+run.stdout);
  server=http.createServer((req,res)=>{let file=path.join(site,decodeURIComponent(new URL(req.url,'http://x').pathname));if(!file.startsWith(site+path.sep)){res.writeHead(403).end();return;}
    try{if(statSync(file).isDirectory())file=path.join(file,'index.html');const body=readFileSync(file);res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});res.end(body);}
    catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/reader/';
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(url);await page.locator('#home-title').waitFor();
  // Every write the app asks of the shim, recorded from here on (the shim answers /api/* in the page).
  await page.evaluate(()=>{const real=window.fetch;window.__writes=[];window.fetch=function(input,init={}){const method=(init.method||'GET').toUpperCase();
    if(method!=='GET')window.__writes.push([String(input),init.body?JSON.parse(init.body).action||JSON.parse(init.body).operation||null:null]);return real.apply(this,arguments);};});
  // Writes the shim keeps in this browser (margins, reading positions, an art still) are fine; the rest need a server.
  const local=w=>w==='/api/art:still'||/^\/api\/(annotations|seen|bookmark|history)(:|$)/.test(w);
  const writes=()=>page.evaluate(()=>window.__writes.map(([p,a])=>p.split('?')[0]+(a?':'+a:''))).then(all=>all.filter(w=>!local(w)));
  const toasts=()=>page.evaluate(()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>[t.dataset.type||'',t.textContent.trim()]));
  /** Disabled, labelled, and the pointer reaches it so the tooltip shows. */
  async function needsReader(locator,name){
    await locator.waitFor();
    const facts=await locator.evaluate(el=>{el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {disabled:el.disabled===true||el.getAttribute('aria-disabled')==='true',title:el.getAttribute('title')||'',reachable:!!hit&&(hit===el||el.contains(hit))};});
    assert.ok(facts.disabled,name+' is disabled');assert.match(facts.title,NEEDS,name+' says it needs Reader on your computer');assert.ok(facts.reachable,name+' keeps its tooltip under the pointer');
  }

  // The magazine's own queue and art buttons wait for a server too.
  const offered=await page.locator('.issue [data-queue-add], .issue [data-art-generate]').all();
  assert.ok(offered.length>=1,'the issue offers queue or art buttons');
  for(const button of offered)await needsReader(button,'An issue button');
  // Reader Admin: no automatic check, no job, no error toast, no card stuck on "Checking…".
  await page.evaluate(()=>{location.hash='#backstage';});await page.locator('#admin-overview').waitFor();
  await page.locator('[data-admin-nav=indexes]').click();await page.locator('#backstage-indexes').waitFor();
  await page.waitForTimeout(1500);
  assert.deepEqual(await writes(),[],'visiting Reader Admin asks nothing of a server');
  assert.deepEqual((await toasts()).filter(([type])=>type==='error'),[],'no error toast');
  assert.deepEqual(await toasts(),[],'no toast at all');
  assert.equal(await page.locator('[data-index] [data-slot=card-action] [data-slot=badge]').filter({hasText:/Checking/}).count(),0,'no index card waits on a check that never runs');
  assert.match(await page.locator('[data-toolbar]').first().textContent(),/Reader on your computer/);
  await needsReader(page.locator('#maintenance-check'),'Check again');
  for(const kind of ['search','search-keyword','browse','catalog','links'])await needsReader(page.locator(`[data-job="${kind}"]`),kind+' rebuild');
  mkdirSync('.reader/web-dev',{recursive:true});await page.locator('#maintenance-check').hover();await page.screenshot({path:'.reader/web-dev/static-demo-ui-backstage.png'});
  await page.locator('[data-admin-nav=inbox]').click();await needsReader(page.locator('#inbox-mail'),'You got mail');
  // Pages that only describe this machine show where they live instead of empty controls.
  for(const section of ['service','voices','models']){
    await page.locator(`[data-admin-nav=${section}]`).click();await page.locator('#backstage-local-only').waitFor();
    assert.match(await page.locator('#backstage-local-only').textContent(),/on your computer/i);
    for(const id of ['#backstage-server','#local-model','#companions','#companion-cli'])assert.equal(await page.locator(id).count(),0,id+' is left out of the web demo');
  }
  assert.deepEqual(await writes(),[],'no Admin page asks anything of a server');
  await page.locator('[data-admin-nav=settings]').click();await page.locator('#preferences-form').waitFor();
  // Settings save on this device and keep working; the Theme Editor previews here but cannot save themes.
  assert.equal(await page.locator('#preferences-form button[type=submit]').isDisabled(),false,'reading preferences still save in this browser');
  await page.locator('#theme-editor-open').click();await page.locator('.theme-editor-form').waitFor();
  for(const name of ['Save as new theme','Save and use'])await needsReader(page.getByRole('button',{name,exact:true}),name);
  await page.keyboard.press('Escape');await page.locator('.theme-editor-form').waitFor({state:'detached'});
  // A clicked disabled control does nothing.
  await page.locator('[data-admin-nav=indexes]').click();await page.locator('#maintenance-check').click({force:true});
  await page.locator('[data-admin-nav=inbox]').click();await page.locator('#inbox-mail').click({force:true});await page.waitForTimeout(300);
  assert.deepEqual(await writes(),[]);assert.deepEqual(await toasts(),[]);

  // A document: Generate art, the reading queue and the chat panel.
  await page.evaluate(()=>{location.hash='#read='+encodeURIComponent('library/essayists/montaigne/of-books.md');});
  await page.locator('#article h1').filter({hasText:'Of Books'}).first().waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');
  await needsReader(page.locator('.article-art .art-placeholder [data-art-generate]'),'Generate art');
  await page.keyboard.press('Space');await page.keyboard.press('g');await page.locator('.article-art').waitFor({state:'detached'});
  // q explains instead of failing, and the queue panel's write buttons are disabled.
  const lead=page.locator('.next-reads .next-read[data-path]').first();await lead.waitFor();await lead.focus();await page.keyboard.press('q');
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(t=>/Reader on your computer/.test(t.textContent)));
  assert.deepEqual((await toasts()).filter(([type])=>type==='error'),[],'q is not an error');
  await page.keyboard.press('Space');await page.keyboard.press('r');await page.locator('#queue-panel:not([hidden]) [data-queue-row]').first().waitFor();
  const actions=page.locator('#queue-panel [data-queue-action]');
  assert.ok(await actions.count()>=1,'the demo queue offers suggestions');
  await needsReader(actions.first(),'Queue row action');
  await page.keyboard.press('Escape');await page.locator('#queue-panel').waitFor({state:'hidden'});
  // Chat: the shim answers it with the demo's scripted voices (#108; tests/web_static_chat.cjs), so the composer is on.
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');await page.locator('#chat-input').waitFor();
  assert.equal(await page.locator('#chat-input').isDisabled(),false,'the composer is enabled');
  assert.match(await page.locator('#chat-input').getAttribute('placeholder'),/scripted voices/);
  assert.equal(await page.locator('#chat-send[data-needs-reader]').count(),0,'Send does not need Reader');
  assert.equal(await page.locator('#chat-chime-ins').isDisabled(),true,'chime-ins run only on a Reader: the scripted voices answer when addressed');
  assert.match(await page.locator('#chat-chime-ins').getAttribute('title'),NEEDS);
  assert.equal(await page.locator('#chat-paste-toggle').count(),1,'a manual voice’s reply can be pasted');
  await page.screenshot({path:'.reader/web-dev/static-demo-ui-chat.png'});

  assert.deepEqual(await writes(),[],'no server-only write was attempted');
  assert.deepEqual((await toasts()).filter(([type])=>type==='error'),[],'no error toast anywhere');
  assert.deepEqual(errors,[],'nothing logged an error');
  console.log('Static demo UI passed: Reader Admin starts no job and raises no toast; Check again, rebuilds, You got mail, theme saves, Generate art, queue writes and chat chime-ins are disabled with “Needs Reader on your computer” (the composer is on: scripted voices answer); service, companions and local model are left out with one note; q explains; no console errors.');
 }finally{
  if(browser)await browser.close();
  if(server)server.close();
  rmSync(scratch,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exit(1);});
