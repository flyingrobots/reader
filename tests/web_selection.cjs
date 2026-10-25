/* Touch, keyboard and repeated-phrase selections reach the annotation toolbar (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
// Select text inside the `which`-th paragraph that contains `marker`, starting at its `nth` repeat of `quote`.
const select=(page,marker,quote,nth,which=0)=>page.evaluate(({marker,quote,nth,which})=>{
  const block=[...document.querySelectorAll('#article p')].filter(p=>p.textContent.includes(marker))[which],node=block.firstChild;let at=-1;block.scrollIntoView({block:"center"});
  for(let i=0;i<=nth;i++)at=node.data.indexOf(quote,at+1);
  const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+quote.length);getSelection().removeAllRanges();getSelection().addRange(range);
},{marker,quote,nth,which});
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const errors=[];const open=async options=>{const context=await browser.newContext({reducedMotion:'reduce',...options});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   const seen=page.waitForResponse(response=>response.url().endsWith('/api/seen')&&response.request().method()==='POST');await page.goto(url+'/#read='+encodeURIComponent('library/thought.md'));await seen;await page.waitForFunction(()=>!document.querySelector('.resume-pending')&&getComputedStyle(document.querySelector('#article p')).visibility==='visible');return page;};
  // Touch: the selection settles and touchend fires, with no mouseup.
  let page=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await select(page,'chapter 1 waits','The distinct observation for chapter 1 waits here.',0);
  await page.locator('#article p',{hasText:'chapter 1 waits'}).dispatchEvent('touchend');
  await page.locator('#selection-tools').waitFor({timeout:3000});
  const placement=await page.evaluate(()=>{const tools=document.querySelector('#selection-tools').getBoundingClientRect(),range=getSelection().getRangeAt(0).getBoundingClientRect();return {toolsTop:tools.top,selectionBottom:range.bottom,width:document.documentElement.scrollWidth,inner:innerWidth};});
  assert.ok(placement.toolsTop>=placement.selectionBottom,'on touch the toolbar sits below the native selection menu: '+JSON.stringify(placement));
  await page.evaluate(()=>getSelection().removeAllRanges());await page.locator('#selection-tools').waitFor({state:'hidden'});
  // A selection extended without any touch or mouse event (handles, assistive tech) still settles into the toolbar.
  await select(page,'chapter 2 waits','The distinct observation for chapter 2 waits here.',0);await page.locator('#selection-tools').waitFor({timeout:3000});
  await page.context().close();
  // Keyboard: with a selection in the article, `a` shows the toolbar and focuses it.
  page=await open({viewport:{width:1440,height:900}});await page.locator('#main').focus();
  await select(page,'chapter 3 waits','The distinct observation for chapter 3 waits here.',0);await page.keyboard.press('a');
  await page.locator('#selection-tools').waitFor({timeout:1000});assert.equal(await page.evaluate(()=>document.activeElement?.dataset.annotate),'highlight');
  await page.keyboard.press('Escape');await page.locator('#selection-tools').waitFor({state:'hidden'});
  // A phrase repeated nine times in one paragraph: the second repeat anchors at the second source occurrence.
  await select(page,'A quiet library','A quiet library holds ro',1,3);await page.locator('#article p',{hasText:'A quiet library'}).nth(3).dispatchEvent('mouseup');
  await page.locator('#selection-tools').waitFor({timeout:3000});
  const created=page.waitForResponse(response=>response.url().endsWith('/api/annotations')&&response.request().method()==='POST');
  await page.locator('[data-annotate=highlight]').click();const thread=await (await created).json();
  const source=await page.evaluate(()=>fetch('/api/file?path='+encodeURIComponent('library/thought.md')).then(r=>r.text()));
  const chapter=source.indexOf('## Chapter 4\n'),first=source.indexOf('A quiet library holds ro',chapter),second=source.indexOf('A quiet library holds ro',first+1);
  const cp=offset=>Array.from(source.slice(0,offset)).length;
  assert.equal(thread.anchor?.start ?? thread.location?.start ?? thread.start,cp(second),'anchored at the selected repeat: '+JSON.stringify(thread).slice(0,300));
  assert.deepEqual(errors,[]);console.log('Selection passed: touch toolbar below the native menu, settled selectionchange, keyboard `a`, repeated phrase anchored by position.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
