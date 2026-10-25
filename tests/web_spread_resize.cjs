/* Two-page resize keeps the reading position and re-checks Read next placement (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
// The text at the top of the first visible column, and where that same text is now.
const anchor=page=>page.evaluate(()=>{const box=document.querySelector('.book-viewport').getBoundingClientRect();const caret=document.caretRangeFromPoint(box.left+6,box.top+8),node=caret.startContainer,offset=caret.startOffset+node.data.slice(caret.startOffset).search(/\S/u);window.__anchor={node,offset};return node.data.slice(offset,offset+40);});
const anchorVisible=page=>page.evaluate(()=>{const box=document.querySelector('.book-viewport').getBoundingClientRect(),range=document.createRange();range.setStart(window.__anchor.node,window.__anchor.offset);range.setEnd(window.__anchor.node,window.__anchor.offset+1);const rect=range.getClientRects()[0];return {left:rect.left,right:rect.right,box:{left:box.left,right:box.right},visible:rect.left>=box.left-2&&rect.left<box.right};});
// Read next is either absent or shares the last spread with the article's last text.
const nextState=page=>page.evaluate(()=>{const viewport=document.querySelector('.book-viewport'),box=viewport.getBoundingClientRect(),next=document.querySelector('#article .next-reads');
  const stride=box.width+(parseFloat(getComputedStyle(document.querySelector('#article')).columnGap)||40),spread=rect=>Math.floor((rect.left-box.left+viewport.scrollLeft+2)/stride);
  const texts=[...document.querySelectorAll('#article [data-source-start]')],last=[...texts.at(-1).getClientRects()].at(-1);
  return {placed:!!next,nextSpread:next?spread(next.getClientRects()[0]):null,textSpread:spread(last)};});
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--maintenance'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({layout:'spread',smooth:false,pageTurn:'slide'}));}catch{}});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/#read='+encodeURIComponent('library/thought.md'));await page.locator('.book-viewport').waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  await page.locator('#main').focus();for(let i=0;i<12;i++)await page.keyboard.press('j');await page.waitForTimeout(300);
  const before=await anchor(page);
  for(const size of [{width:1000,height:800},{width:900,height:700},{width:1300,height:900}]){
   await page.setViewportSize(size);await page.waitForTimeout(500);
   const now=await anchorVisible(page);assert.ok(now.visible,`text "${before}" stays on screen at ${size.width}×${size.height}: `+JSON.stringify(now));
  }
  // Read next: wait for it at the end, then resize through sizes and check it never adds a spread of its own.
  await page.keyboard.press('G');await page.waitForTimeout(300);const placedAtStart=(await nextState(page)).placed;
  const seen=[placedAtStart];
  for(const size of [{width:1000,height:800},{width:1180,height:760},{width:900,height:700},{width:1300,height:900}]){
   await page.setViewportSize(size);await page.waitForTimeout(500);const state=await nextState(page);seen.push(state.placed);
   if(state.placed)assert.equal(state.nextSpread,state.textSpread,`Read next shares the last text spread at ${size.width}×${size.height}`);
  }
  assert.equal(seen.at(-1),placedAtStart,'returning to the first size restores the first placement: '+JSON.stringify(seen));
  assert.ok(!placedAtStart&&seen.includes(true),'Read next, first left out, is placed once a resize makes room: '+JSON.stringify(seen));
  assert.deepEqual(errors,[]);console.log('Spread resize passed: first visible text kept across reflows, Read next re-placed on resize.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
