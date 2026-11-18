/* Reader served under a path prefix behind a reverse proxy (#106). The proxy forwards /reader/* to the server with
   the prefix stripped and refuses everything else, as a proxy that owns only that prefix would. Every request the page
   makes is harvested; any same-origin request outside /reader/ fails the suite (deny by default), and the page must
   still open the library and a document. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const PREFIX='/reader/';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser,proxy;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  const upstream=new URL(url),outside=[];
  proxy=http.createServer((req,res)=>{
   if(!req.url.startsWith(PREFIX)){outside.push(req.method+' '+req.url);res.writeHead(404).end();return;}
   const forward=http.request({host:upstream.hostname,port:upstream.port,method:req.method,path:req.url.slice(PREFIX.length-1),headers:{...req.headers,host:upstream.host}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
   forward.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(forward);});
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+proxy.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const page=await browser.newPage({viewport:{width:1300,height:900},reducedMotion:'reduce'});const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const target=new URL(request.url());if(target.origin===origin)requests.push(target.pathname);});
  await page.goto(origin+PREFIX);
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
  console.log(`Path prefix passed: ${requests.length} requests, all under ${PREFIX}; the document opened.`);
 }finally{await browser?.close();proxy?.closeAllConnections?.();proxy?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
