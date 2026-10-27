/* Outline fixes: smooth-scroll section label, last-heading ]], end blocks vs rail, error state (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {waitFor,watch,settled}=require('./web_wait.cjs');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--outline','--maintenance'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const errors=[];
  const open=async({smooth,reducedMotion,abortSeen=false})=>{
   const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({layout:'scroll',smooth}));
   const page=await context.newPage();watch(page);page.on('pageerror',error=>errors.push(error.message));
   if(abortSeen)await page.route('**/api/seen',route=>route.request().method()==='POST'?route.abort():route.continue());
   await page.goto(url+'/#read='+encodeURIComponent('library/thought.md'));
   if(!abortSeen){await page.locator('#outline-rail a').first().waitFor();await waitFor(page,'document resumed',()=>({resumed:!document.querySelector('.resume-pending')}));await page.locator('#main').focus();}
   return page;};
  const label=page=>page.evaluate(()=>[document.querySelector('#status-section').textContent,document.querySelector('#outline-rail [aria-current=location]')?.textContent]);
  // #47: with ScrollSmoother on, G and gg settle on the section actually at the reading line.
  {const page=await open({smooth:true,reducedMotion:'no-preference'});
   const labelIs=(text,why)=>waitFor(page,why,text=>({status:document.querySelector('#status-section').textContent===text,rail:document.querySelector('#outline-rail [aria-current=location]')?.textContent===text,_label:document.querySelector('#status-section').textContent,_y:Math.round(scrollY),_max:document.documentElement.scrollHeight-innerHeight,_ends:document.querySelectorAll('.next-reads,.document-footer').length}),{arg:text,timeout:10000});
   // Start from a complete page, so this checks the labels only; G following late end blocks is checked below (#154).
   await page.locator('.next-reads').waitFor({state:'attached'});await settled(page,'end blocks loaded');
   await page.keyboard.press('G');await labelIs('Chapter 44','after G');
   await page.keyboard.press('g');await page.keyboard.press('g');await labelIs('A quiet thought','after gg');
   await page.mouse.move(700,450);await page.mouse.wheel(0,6000);await page.waitForTimeout(2500);
   const atLine=await page.evaluate(()=>{const line=innerHeight*.22;let title=null;for(const h of document.querySelectorAll('#article h1,#article h2'))if(h.getBoundingClientRect().top<=line+1)title=h.textContent.trim();return title;});
   assert.deepEqual(await label(page),[atLine,atLine],'after wheel scrolling');
   await page.context().close();}
  // #154: G and gg hold the page's end and start while the page settles around them, until the reader moves.
  // The article opens at its last heading, so the blocks above have never been laid out and change height as gg glides
  // over them; Read next is held back until G has landed, so it lengthens the page after the jump.
  {const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({layout:'scroll',smooth:true}));
   const page=await context.newPage();watch(page);page.on('pageerror',error=>errors.push(error.message));
   let release;const late=new Promise(resolve=>{release=resolve;});
   await page.route('**/api/next*',async route=>{await late;await route.continue().catch(()=>{});});
   // Smooth scrolling shows the page behind its scroll position while it glides: at rest, the two agree and hold still.
   const rest=async why=>{await waitFor(page,why,()=>({shown:Math.abs(document.querySelector('#smooth-content').getBoundingClientRect().top+scrollY)<1}));await settled(page,why);await waitFor(page,why,()=>({shown:Math.abs(document.querySelector('#smooth-content').getBoundingClientRect().top+scrollY)<1}));};
   const edge=()=>page.evaluate(()=>({y:Math.round(scrollY),max:document.documentElement.scrollHeight-innerHeight,label:document.querySelector('#status-section').textContent}));
   await page.goto(url+'/#read='+encodeURIComponent('library/thought.md')+'&h=chapter-44');
   await page.locator('#outline-rail a').first().waitFor();await waitFor(page,'document resumed',()=>({resumed:!document.querySelector('.resume-pending')}));
   await rest('opened at the last heading');await page.locator('#main').focus();
   await page.keyboard.press('G');await rest('after G');
   assert.equal(await page.locator('.next-reads').count(),0,'Read next is still on its way');
   release();await page.locator('.next-reads').waitFor({state:'attached'});await rest('Read next arrived');
   const end=await edge();assert.ok(end.max-end.y<=2&&end.label==='Chapter 44','G follows the end as Read next lengthens the page: '+JSON.stringify(end));
   await page.keyboard.press('g');await page.keyboard.press('g');await rest('after gg');
   const top=await edge();assert.deepEqual([top.y,top.label],[0,'A quiet thought'],'gg ends at the top while the blocks above settle: '+JSON.stringify(top));
   await context.close();}
  // #51: ]] in the last section stays put and says so; #48: end-of-document blocks never draw under a visible rail.
  {const page=await open({smooth:false,reducedMotion:'reduce'});
   // #123: the end-of-article blocks finish loading after .next-reads appears and can push the end down a line; wait for
   // the page height and position to hold still, then G again so the check starts from the real end.
   await page.keyboard.press('G');await page.locator('.next-reads').waitFor();await settled(page,'end of article settled');await page.keyboard.press('G');await settled(page,'at the settled end');const before=await page.evaluate(()=>scrollY);
   await page.keyboard.press(']');await page.keyboard.press(']');await page.waitForTimeout(400);
   assert.equal(await page.evaluate(()=>scrollY),before,']] in the last section does not move backwards');
   await page.getByText('This is the last heading.').waitFor();
   for(const width of [1280,1440,1920]){
    await page.setViewportSize({width,height:900});await page.waitForTimeout(400);await page.keyboard.press('G');await page.waitForTimeout(300);
    const overlap=await page.evaluate(()=>{const rail=document.querySelector('#outline-rail'),box=rail.getBoundingClientRect();
      const ends=[...document.querySelectorAll('.next-reads,.document-footer')].map(el=>el.getBoundingClientRect()),vertical=ends.filter(r=>r.top<box.bottom&&r.bottom>box.top);
      return {visible:!rail.hidden,right:box.right,lefts:ends.map(r=>r.left),beside:vertical.length,hits:vertical.filter(r=>r.left<box.right).length};});
    assert.ok(overlap.visible&&overlap.beside>0,`the rail shows beside the end blocks at ${width}: `+JSON.stringify(overlap));
    assert.equal(overlap.hits,0,`rail and end blocks do not overlap at ${width}: `+JSON.stringify(overlap));
   }
   await page.context().close();}
  // #39: a failure after the rail mounted removes the rail with the article.
  // Failures after the article renders are secondary (the article and its rail stay), so fail the next document's load instead.
  {const page=await open({smooth:false,reducedMotion:'reduce'});
   await page.route('**/api/document?*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic failure'})}));
   await page.evaluate(()=>{location.hash='#read='+encodeURIComponent('library/deep.md');});
   await page.getByRole('heading',{name:'Document unavailable'}).waitFor();await page.waitForTimeout(200);
   assert.equal(await page.evaluate(()=>document.querySelector('#outline-rail').hidden),true,'no rail over the error state');
   assert.equal(await page.evaluate(()=>document.querySelector('#status-section').textContent),'');
   await page.context().close();}
  assert.deepEqual(errors,[]);console.log('Outline fixes passed: smooth-scroll section label, last-heading ]], rail clear of end blocks, rail cleared on error.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
