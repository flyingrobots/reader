/* Two-page annotation pins sit in the gutter, clear of the text (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const errors=[];
  for(const viewport of [{width:1300,height:900},{width:1000,height:760},{width:800,height:900}]){
   const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({layout:'spread',pageTurn:'slide'}));}catch{}});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   const seen=page.waitForResponse(response=>response.url().endsWith('/api/seen')&&response.request().method()==='POST');
   await page.goto(url+'/#read='+encodeURIComponent('library/thought.md'));await seen;await page.locator('.annotation-pin').first().waitFor();await page.waitForTimeout(300);
   const result=await page.evaluate(()=>{
    const pin=document.querySelector('.annotation-pin').getBoundingClientRect(),hits=[];
    const walker=document.createTreeWalker(document.querySelector('#article'),NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.annotation-pin')||!n.data.trim()?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
    for(let node;(node=walker.nextNode());){const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width&&r.left<pin.right&&r.right>pin.left&&r.top<pin.bottom&&r.bottom>pin.top)hits.push(node.data.slice(0,30));}
    return {pin:{left:pin.left,right:pin.right,top:pin.top},hits,width:innerWidth,scroll:document.documentElement.scrollWidth};});
   assert.deepEqual(result.hits,[],`pin overlaps no text at ${viewport.width}: `+JSON.stringify(result));
   assert.ok(result.pin.right<=result.width&&result.scroll<=result.width+1,'pin stays on screen: '+JSON.stringify(result));
   await context.close();
  }
  assert.deepEqual(errors,[]);console.log('Spread pins passed: pins sit beside the text in two-page and one-page spreads.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
