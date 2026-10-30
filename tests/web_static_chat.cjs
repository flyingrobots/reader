/* Scripted chat in the static demo (#108): on a /reader/ export with no server, sending a message appends it and a
   keyword-picked reply from the demo's scripted voices, streamed through the chat panel's real EventSource path
   (started, delta, posted, done); a manual voice's reply can be pasted; Cancel and Retry work; everything is labelled "only in this browser",
   survives a reload (localStorage) and is cleared by Reset this demo; and the page makes no request but GETs of the
   exported static files. */
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const http=require('node:http');
const {mkdirSync,mkdtempSync,rmSync,readFileSync,statSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png',
  '.woff2':'font/woff2','.pdf':'application/pdf','.webmanifest':'application/manifest+json','.ttf':'font/ttf'};
const replies=JSON.parse(readFileSync(path.join(__dirname,'../src/reader_mcp/demo/content/voice/replies.json'),'utf8')).replies;
const scripted=(voice,word)=>replies[voice].find(o=>(o.match||[]).some(g=>g.split('|').includes(word))).reply;
const opening=text=>new RegExp(text.replace(/\*\*/g,'').split(/\s+/).slice(0,4).join(' ').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
(async()=>{
 const scratch=mkdtempSync(path.join(tmpdir(),'reader-static-chat-')),site=path.join(scratch,'site'),out=path.join(site,'reader');
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
  // Everything the page asks of the network: only GETs of exported files under /reader/ may leave the page.
  const requests=[];context.on('request',r=>requests.push([r.method(),r.url(),r.resourceType()]));
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  // An unaddressed message goes to a voice chosen at random: a fixed seed makes that choice the same on every run.
  await context.addInitScript(()=>{let seed=0x2f6e2b1;Math.random=()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};});
  // The chat panel's stream events as the page's EventSource dispatches them, in order.
  await context.addInitScript(()=>{window.__events=[];addEventListener('DOMContentLoaded',()=>{const ES=window.EventSource,real=EventTarget.prototype.dispatchEvent;
    ES.prototype.dispatchEvent=function(event){if(event.type!=='ping')window.__events.push([event.type,event.data?JSON.parse(event.data):null]);return real.call(this,event);};});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const toasts=()=>page.evaluate(()=>[...document.querySelectorAll('[data-sonner-toast]')].map(t=>[t.dataset.type||'',t.textContent.trim()]));
  const open=async(doc,title)=>{await page.evaluate(doc=>{location.hash='#read='+encodeURIComponent(doc);},doc);
    await page.locator('#article h1').filter({hasText:title}).first().waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
    await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');await page.locator('#chat-input').waitFor();};
  const voiceMessages=author=>page.locator(`#chat-panel [data-chat-message][data-author="${author}"]`);
  await page.goto(url);await page.locator('#home-title').waitFor();

  // A document with no chat yet: the composer is on, and a mention picks the voice and its keyword reply.
  await open('library/essayists/montaigne/of-books.md','Of Books');
  assert.equal(await page.locator('#chat-input').isDisabled(),false,'the composer is enabled in the web demo');
  assert.equal(await page.locator('#chat-send').getAttribute('data-needs-reader'),null,'Send no longer needs Reader');
  await page.locator('#chat-panel [data-chat-empty]').filter({hasText:'@archivist'}).waitFor();// The empty chat names the scripted voices.
  await page.evaluate(()=>{window.__events.length=0;});
  await page.locator('#chat-input').fill('@plain I have five minutes: which paragraph should I read?');await page.keyboard.press('Enter');
  const mine=page.locator('#chat-panel [data-chat-message][data-author="You"]').last();
  await mine.waitFor();assert.match(await mine.textContent(),/which paragraph should I read/);
  // The reply streams into a running turn before it becomes a message.
  await page.locator('#chat-panel [data-chat-turn][data-author="Plain Reader"]').waitFor();
  const plain=voiceMessages('Plain Reader').last();await plain.waitFor({timeout:10000});
  assert.match(await plain.textContent(),opening(scripted('Plain Reader','five minutes')),'the keyword-picked reply');
  await page.locator('#chat-panel [data-chat-turn]').waitFor({state:'detached'});
  const events=await page.evaluate(()=>window.__events);
  const kinds=events.map(([kind])=>kind);
  // The first message opens the chat's stream (hello, then a state snapshot), as on a real server.
  for(const kind of ['hello','state','started','delta','done'])assert.ok(kinds.includes(kind),kind+' arrives on the stream: '+kinds.join(' '));
  assert.ok(kinds.indexOf('started')<kinds.indexOf('delta')&&kinds.lastIndexOf('delta')<kinds.indexOf('done'),'in server order: '+kinds.join(' '));
  assert.ok(kinds.filter(k=>k==='delta').length>=2,'the reply streams in pieces');
  const deltas=events.filter(([kind])=>kind==='delta').map(([,d])=>d);
  assert.equal(deltas.map(d=>d.text).join(''),scripted('Plain Reader','five minutes'),'the deltas spell the scripted reply');
  assert.ok(deltas.every((d,i)=>d.offset===deltas.slice(0,i).reduce((n,x)=>n+x.text.length,0)),'each delta starts where the last ended');
  // Both messages say where they live, and the voice says it is scripted.
  for(const message of [mine,plain])assert.match(await message.locator('[data-chat-local]').textContent(),/only in this browser/i);
  assert.match(await plain.locator('[data-chat-runtime]').textContent(),/scripted/);
  assert.match(await page.locator('#chat-panel [data-chat-local-note]').textContent(),/nothing is sent anywhere/,'the panel does not claim turns go to a provider');
  assert.ok((await toasts()).some(([,text])=>/Plain Reader is replying/.test(text)),'the started event reaches the toast');

  // Two mentions: both voices answer, in order; no mention picks one voice at random.
  await page.evaluate(()=>{window.__events.length=0;});
  await page.locator('#chat-input').fill('@archivist @architect how is this connected to retention?');await page.keyboard.press('Enter');
  await voiceMessages('Archivist').last().waitFor({timeout:10000});await voiceMessages('Architect').last().waitFor({timeout:10000});
  await page.locator('#chat-panel [data-chat-turn]').waitFor({state:'detached'});
  // On an open stream the visitor's message is posted first; each voice then starts, streams and is done in turn.
  const order=(await page.evaluate(()=>window.__events)).filter(([kind])=>kind!=='state'&&kind!=='delta').map(([kind,data])=>kind+(data.voice?':'+data.voice:data.message?.author?':'+data.message.author:''));
  assert.deepEqual(order,['posted:You','started:Archivist','done:Archivist','started:Architect','done:Architect'],'stream order');
  assert.match(await voiceMessages('Archivist').last().textContent(),opening(scripted('Archivist','connect')));
  assert.match(await voiceMessages('Architect').last().textContent(),/Thirty days is a good/);
  const before=await page.locator('#chat-panel [data-chat-message]').count();
  await page.locator('#chat-input').fill('What would you measure first?');await page.keyboard.press('Enter');
  await page.waitForFunction(n=>document.querySelectorAll('#chat-panel [data-chat-message]').length>=n+2,before,{timeout:10000});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(t=>/was chosen at random to answer/.test(t.textContent)));
  assert.match(await page.locator('#chat-panel [data-chat-message]').last().locator('[data-chat-runtime]').textContent(),/chosen at random/);
  // A manual voice answers by paste, as in the local demo.
  await page.locator('#chat-paste-toggle').click();await page.locator('#chat-paste-body').fill('Wren says: a fictional pasted reply.');
  await page.getByRole('button',{name:'Save as Wren'}).click();
  const wren=voiceMessages('Wren').last();await wren.waitFor();
  assert.match(await wren.textContent(),/pasted by hand/);assert.match(await wren.textContent(),/fictional pasted reply/);
  // Cancel stops a running reply where it is; Retry asks the same voice again.
  await page.locator('#chat-input').fill('@architect what would you measure?');await page.keyboard.press('Enter');
  await page.locator('#chat-panel [data-chat-turn][data-turn-state="running"]').waitFor();
  await page.locator('#chat-panel [data-chat-turn] [data-chat-cancel]').click();
  const cancelled=page.locator('#chat-panel [data-chat-message][data-author="Architect"][data-chat-state="cancelled"]');await cancelled.waitFor();
  await cancelled.locator('[data-chat-retry]').click();
  // The retried reply is the message after the cancelled one (an earlier Architect reply may have the same text).
  await page.waitForFunction(()=>{const all=[...document.querySelectorAll('#chat-panel [data-chat-message]')],at=all.findIndex(m=>m.dataset.author==='Architect'&&m.dataset.chatState==='cancelled');
    const next=all.slice(at+1).find(m=>m.dataset.author==='Architect');return at>=0&&next?.dataset.chatState==='done'&&/re-anchoring hit rate/.test(next.textContent);},null,{timeout:10000});
  // The cancelled message re-renders just after the new reply appears: wait for its Retry to go, then check.
  await cancelled.locator('[data-chat-retry]').waitFor({state:'detached',timeout:5000}).catch(()=>{});
  assert.equal(await cancelled.locator('[data-chat-retry]').count(),0,'a retried reply offers no second retry');
  const count=await page.locator('#chat-panel [data-chat-message]').count();
  await page.locator('#chat-close').click();

  // The seeded chat of another document takes a new message after its history.
  await open('library/lantern/design/sync-design.v2.md','Lantern sync');
  await voiceMessages('Architect').first().waitFor();
  const seeded=await page.locator('#chat-panel [data-chat-message]').count();
  await page.locator('#chat-input').fill('@archivist what about provenance?');await page.keyboard.press('Enter');
  await page.waitForFunction(n=>document.querySelectorAll('#chat-panel [data-chat-message]').length===n+2,seeded,{timeout:10000});
  assert.match(await voiceMessages('Archivist').last().textContent(),/Keep the edition with the note/);
  await page.screenshot({path:(mkdirSync('.reader/web-dev',{recursive:true}),'.reader/web-dev/static-chat.png')});

  // Reload: both chats are still here, in this browser only.
  await page.goto(url);await page.locator('#home-title').waitFor();
  await open('library/essayists/montaigne/of-books.md','Of Books');
  await page.waitForFunction(n=>document.querySelectorAll('#chat-panel [data-chat-message]').length===n,count);
  await page.locator('#chat-close').click();
  await open('library/lantern/design/sync-design.v2.md','Lantern sync');
  await page.waitForFunction(n=>document.querySelectorAll('#chat-panel [data-chat-message]').length===n+2,seeded);
  // Reset this demo forgets them; the seeded chat is as exported.
  await page.locator('[data-static-reset]').click();await page.waitForLoadState('load');await page.locator('#article h1').first().waitFor();
  await open('library/lantern/design/sync-design.v2.md','Lantern sync');
  await page.waitForFunction(n=>document.querySelectorAll('#chat-panel [data-chat-message]').length===n,seeded);
  await page.locator('#chat-close').click();
  await open('library/essayists/montaigne/of-books.md','Of Books');await page.locator('#chat-panel [data-chat-empty]').waitFor();

  // Nothing left the browser: every request was a GET of an exported file, none reached /api/.
  const strays=requests.filter(([method,address])=>method!=='GET'||!address.startsWith(url)||new URL(address).pathname.startsWith('/api/'));
  assert.deepEqual(strays,[],'only static files were fetched');
  assert.deepEqual((await toasts()).filter(([type])=>type==='error'),[],'no error toast');
  assert.deepEqual(errors,[],'nothing logged an error');
  console.log(`Static chat passed: mentions, two voices, a random pick and a pasted reply answer from the script through started/delta/posted/done; cancel and retry work; labelled only in this browser; kept across a reload and cleared by Reset; ${requests.length} requests, all GETs of exported files.`);
 }finally{
  if(browser)await browser.close();
  if(server)server.close();
  rmSync(scratch,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exit(1);});
