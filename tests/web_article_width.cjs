/* Article width: Settings sets the article column in continuous reading. Standard stays exactly as it was, wider
   choices widen the shell with it, margin pins stay on screen, two-page reading ignores it, and another tab's change
   rewraps an open article at the same line. Synthetic fixture only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const PATH='library/thought.md';
(async()=>{
 let browser,fixture;
 try{
  fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const open=async(prefs,viewport={width:1800,height:900})=>{
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    await context.addInitScript(value=>{if(!sessionStorage.getItem('width-test')){localStorage.setItem('reader.preferences.v1',value);sessionStorage.setItem('width-test','1');}},JSON.stringify({smooth:false,art:false,shapes:false,...prefs}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(url+'#read='+encodeURIComponent(PATH));
    await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
    return {context,page,errors};
  };
  const geometry=page=>page.evaluate(()=>{const a=document.querySelector('#article'),s=document.querySelector('.document-shell'),f=document.querySelector('.document-footer');return {article:a.getBoundingClientRect().width,left:a.getBoundingClientRect().left,right:a.getBoundingClientRect().right,measure:getComputedStyle(a).maxWidth,shell:getComputedStyle(s).maxWidth,footer:f.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth-innerWidth};});

  // Standard is what Reader always had, whether or not the preference was ever saved.
  {const {context,page,errors}=await open({});
   const before=await geometry(page);
   assert.equal(before.shell,'980px');assert.ok(Math.abs(before.article-parseFloat(before.measure))<1);
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.articleWidth),'standard');
   const ch=await page.evaluate(()=>{const a=document.querySelector('#article'),probe=document.createElement('span');probe.style.cssText='display:inline-block;width:65ch';a.append(probe);const w=probe.getBoundingClientRect().width;probe.remove();return w;});
   assert.ok(Math.abs(before.article-ch)<1,`standard is 65ch: ${before.article} vs ${ch}`);
   assert.deepEqual(errors,[]);await context.close();}

  // Each choice sets the column, centered, and the footer never sits narrower than it.
  for(const [choice,width] of [['narrow',640],['wide',960],['wider',1200],['full',1800-80]]){
   const {context,page,errors}=await open({articleWidth:choice}),g=await geometry(page);
   assert.ok(Math.abs(g.article-width)<1,`${choice}: ${g.article}`);
   assert.ok(Math.abs(g.left-(1800-g.right))<1,`${choice} is centered`);
   assert.ok(g.footer>=g.article-1,`${choice}: the footer spans the column`);
   assert.ok(g.overflow<=0,`${choice}: no sideways scroll`);
   assert.deepEqual(errors,[]);await context.close();}

  // A window narrower than the choice wins, with room for margin pins in the gutter.
  for(const viewport of [{width:1100,height:800},{width:800,height:800},{width:390,height:800}]){
   const {context,page}=await open({articleWidth:'full'},viewport),g=await geometry(page);
   assert.ok(g.overflow<=0,`full at ${viewport.width}: no sideways scroll (${g.overflow})`);
   assert.ok(viewport.width-g.right>=25,`full at ${viewport.width}: a gutter for pins (${viewport.width-g.right})`);
   await context.close();}

  // Two-page reading ignores the setting.
  {const measure=async articleWidth=>{const {context,page}=await open({layout:'spread',articleWidth});await page.waitForSelector('.book-viewport');const w=await page.evaluate(()=>[document.querySelector('#article').getBoundingClientRect().width,getComputedStyle(document.querySelector('.document-shell')).maxWidth]);await context.close();return w;};
   assert.deepEqual(await measure('narrow'),await measure('standard'));
   assert.deepEqual(await measure('full'),await measure('standard'));}

  // The Settings choice saves, survives a reload and applies to the next article.
  {const {context,page,errors}=await open({});
   await page.locator('#settings-open').click();await page.locator('[data-admin-nav=settings]').click();
   await page.locator('#article-width').click();await page.getByRole('option',{name:/^Wide:/}).click();
   await page.locator('#preferences-form button[type=submit]').click();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).articleWidth==='wide');
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.articleWidth),'wide');
   await page.goto(url+'#read='+encodeURIComponent(PATH));await page.reload();
   await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
   assert.ok(Math.abs((await geometry(page)).article-960)<1);
   assert.deepEqual(errors,[]);await context.close();}

  // Another tab's change rewraps this one at the same line.
  {const {context,page,errors}=await open({},{width:1400,height:500});
   const blocks=()=>[...document.querySelector('#article').children].filter(el=>!el.classList.contains('annotation-pin'));
   // Far blocks settle after they near the window; wait for the page to stop moving, not for a length of time.
   const still=()=>page.evaluate(()=>new Promise(done=>{let last,same=0;const frame=()=>{const now=document.documentElement.scrollHeight+':'+scrollY;same=now===last?same+1:0;last=now;if(same>=10)done();else requestAnimationFrame(frame);};frame();}));
   await page.evaluate(blocks=>{const list=eval(blocks)(),target=list[Math.floor(list.length/2)];scrollTo(0,target.getBoundingClientRect().top+scrollY-innerHeight*.22+2);},String(blocks));
   await still();
   const index=await page.evaluate(blocks=>{const y=innerHeight*.22;return eval(blocks)().findIndex(el=>el.getBoundingClientRect().bottom>y);},String(blocks));
   assert.ok(index>0,'scrolled into the article');
   const other=await context.newPage();await other.goto(url+'#read='+encodeURIComponent(PATH));
   await other.evaluate(()=>{const prefs=JSON.parse(localStorage.getItem('reader.preferences.v1'));localStorage.setItem('reader.preferences.v1',JSON.stringify({...prefs,articleWidth:'narrow'}));});
   await page.bringToFront();
   await page.waitForFunction(()=>Math.abs(document.querySelector('#article').getBoundingClientRect().width-640)<1);
   await still();
   const at=await page.evaluate(({blocks,index})=>{const r=eval(blocks)()[index].getBoundingClientRect();return {top:r.top,bottom:r.bottom,y:innerHeight*.22};},{blocks:String(blocks),index});
   assert.ok(at.top<=at.y+2&&at.bottom>=at.y-2,`block ${index} stays at the reading line (${at.top}..${at.bottom} around ${at.y})`);
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Article width passed: standard unchanged, every choice, narrow windows, two-page unaffected, Settings saves, another tab keeps the line.');
 }finally{await browser?.close();fixture?.kill();}
})().catch(error=>{console.error(error);process.exit(1);});
