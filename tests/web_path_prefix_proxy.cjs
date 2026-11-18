/* Reader behind a real reverse proxy at a path prefix (#106). The proxy forwards /reader/* to the server UNCHANGED:
   same path, the browser's Host and Origin, plus X-Forwarded-For/-Host/-Proto, as nginx or Caddy would. The server
   is configured with trusted_proxy "reverse", the proxy's name in allowed_hosts and allowed_origins, and base_path
   /reader/. Every request the page makes is harvested; any same-origin request outside /reader/ fails (deny by
   default), and the page must open a document and record it seen. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const PREFIX='/reader/';
(async()=>{
 let browser,proxy,fixture,upstream;const outside=[];
 try{
  proxy=http.createServer((req,res)=>{
   if(!req.url.startsWith(PREFIX)||!upstream){outside.push(req.method+' '+req.url);res.writeHead(404).end();return;}
   const headers={...req.headers,'x-forwarded-for':'127.0.0.1','x-forwarded-host':req.headers.host,'x-forwarded-proto':'http'};
   const forward=http.request({host:upstream.hostname,port:upstream.port,method:req.method,path:req.url,headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
   forward.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(forward);});
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+proxy.address().port;
  const env={...process.env,READER_WEB_TRUSTED_PROXY:'reverse',READER_WEB_ALLOWED_HOSTS:new URL(origin).host,READER_WEB_ALLOWED_ORIGINS:origin,READER_WEB_BASE_PATH:PREFIX};
  fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit'],env});
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  upstream=new URL(url);
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const page=await browser.newPage({viewport:{width:1300,height:900},reducedMotion:'reduce'});const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const target=new URL(request.url());if(target.origin===origin)requests.push(target.pathname);});
  assert.equal((await page.goto(origin+PREFIX)).status(),200,'the page is served through the proxy, not refused');
  await page.waitForSelector('#library-home-sections a, #works a, .work',{timeout:15000}).catch(()=>{});
  const seen=page.waitForResponse(response=>response.url().startsWith(origin+PREFIX+'api/seen')&&response.request().method()==='POST',{timeout:15000});
  await page.goto(origin+PREFIX+'#read='+encodeURIComponent('library/thought.md'));await page.reload();
  const opened=await seen.then(()=>page.waitForSelector('#article h1',{timeout:5000})).then(()=>true,()=>false);
  const escaped=requests.filter(path=>!path.startsWith(PREFIX));
  assert.deepEqual([...new Set(escaped)],[],'every request the page makes stays under '+PREFIX);
  assert.deepEqual(outside,[],'the proxy saw no request outside '+PREFIX);
  assert.ok(opened,'the document opens and is marked seen under the prefix');
  assert.ok(requests.some(path=>path.startsWith(PREFIX+'api/')),'witness: the page called the API under the prefix');
  assert.ok(requests.some(path=>path.startsWith(PREFIX+'assets/')),'witness: the page loaded assets under the prefix');
  assert.deepEqual(errors,[]);
  console.log(`Reverse proxy at a prefix passed: ${requests.length} requests, all under ${PREFIX}; the document opened.`);
 }finally{await browser?.close();proxy?.closeAllConnections?.();proxy?.close();if(fixture&&fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
