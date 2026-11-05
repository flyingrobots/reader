/* The footer's article width slider: only for articles, only in continuous reading, never on a phone. Dragging rewraps
   live, saves once on release, keeps the reading line, and leaves the reading keys working. Synthetic fixture only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const PATH='library/thought.md',THUMB='.article-width input[type=range]';
(async()=>{
 let browser,fixture;
 try{
  fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const open=async(prefs={},viewport={width:1600,height:900},reducedMotion='reduce')=>{
    const context=await browser.newContext({viewport,reducedMotion});
    await context.addInitScript(value=>{if(!sessionStorage.getItem('slider-test')){localStorage.setItem('reader.preferences.v1',value);sessionStorage.setItem('slider-test','1');}},JSON.stringify({smooth:false,art:false,shapes:false,...prefs}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(url+'#read='+encodeURIComponent(PATH));
    await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
    return {context,page,errors};
  };
  const shown=page=>page.locator('.article-width').count();
  const settled=page=>page.waitForFunction(()=>document.querySelector('#article'));
  const width=page=>page.evaluate(()=>document.querySelector('#article').getBoundingClientRect().width);
  const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).articleWidth);
  const still=page=>page.evaluate(()=>new Promise(done=>{let last,same=0;const frame=()=>{const now=document.documentElement.scrollHeight+':'+scrollY;same=now===last?same+1:0;last=now;if(same>=10)done();else requestAnimationFrame(frame);};frame();}));
  /** Mouse to a share of the slider's track; the thumb's input carries the values. */
  const track=page=>page.locator('.article-width [data-slot=slider]').boundingBox();
  const at=(box,share)=>[box.x+box.width*share,box.y+box.height/2];

  // Shown: an article in continuous reading, on a desktop window and on a tablet.
  for(const viewport of [{width:1600,height:900},{width:1024,height:768}]){
   const {context,page,errors}=await open({},viewport);
   await page.waitForSelector('.article-width');
   const footer=await page.evaluate(()=>{const s=document.querySelector('#statusline').getBoundingClientRect();return [...document.querySelectorAll('#statusline>*')].every(e=>e.getBoundingClientRect().right<=s.right+1);});
   assert.ok(footer,`the footer still fits at ${viewport.width}`);
   assert.deepEqual(errors,[]);await context.close();}

  // Not shown: phones in either orientation, two-page reading, or a window with no room to widen.
  for(const [prefs,viewport,name] of [[{},{width:390,height:844},'phone'],[{},{width:844,height:390},'landscape phone'],[{layout:'spread'},{width:1600,height:900},'two-page'],[{},{width:720,height:900},'tight window']]){
   const {context,page}=await open(prefs,viewport);
   await still(page);
   assert.equal(await shown(page),0,`${name}: no slider`);
   await context.close();}

  // Not shown away from an article, and back when one reopens or the layout swaps.
  {const {context,page,errors}=await open();
   await page.waitForSelector('.article-width');
   await page.locator('#settings-open').click();await page.waitForFunction(()=>!document.querySelector('.article-width'));
   await page.goto(url+'#read='+encodeURIComponent(PATH));await page.waitForSelector('.article-width');
   await page.locator('#reader-home').click();await page.waitForFunction(()=>!document.querySelector('.article-width'));
   await page.goto(url+'#read='+encodeURIComponent(PATH));await page.waitForSelector('.article-width');
   await page.locator('#layout-swap').click();await page.waitForFunction(()=>!document.querySelector('.article-width'));
   await page.locator('#layout-swap').click();await page.waitForSelector('.article-width');
   assert.deepEqual(errors,[]);await context.close();}

  // A drag rewraps live and saves once, on release. A custom width survives a reload and reads as Custom in Settings.
  {const {context,page,errors}=await open();
   await page.waitForSelector('.article-width');
   const before=await width(page),box=await track(page);
   await page.mouse.move(...at(box,.2));await page.mouse.down();
   await page.mouse.move(...at(box,.5),{steps:6});
   await page.waitForFunction(was=>Math.abs(document.querySelector('#article').getBoundingClientRect().width-was)>20,before);
   await page.waitForSelector('.article-width-readout');
   // Dragging leaves the footer as it was, so the slider stays under the pointer.
   assert.equal((await track(page)).x,box.x,'the slider did not move');
   assert.equal(await page.locator('#vim-mode').textContent(),'NORMAL');
   assert.equal(await saved(page),undefined,'nothing is saved while dragging');
   await page.mouse.up();
   const value=await saved(page);
   assert.match(value,/^\d+$/,`a custom width is saved: ${value}`);
   await page.waitForFunction(()=>!document.querySelector('.article-width-readout'));
   assert.ok(Math.abs(await width(page)-Number(value))<1,'the column is the saved width');
   assert.equal(Number(await page.locator(THUMB).getAttribute('aria-valuenow')||await page.locator(THUMB).inputValue()),Number(value));
   // The reading keys work straight after a drag.
   assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'BODY');
   const top=await page.evaluate(()=>scrollY);await page.keyboard.press('j');await page.waitForFunction(was=>scrollY>was,top);
   await page.reload();await settled(page);await page.waitForSelector('.article-width');
   assert.ok(Math.abs(await width(page)-Number(value))<1,'it survives a reload');
   await page.locator('#settings-open').click();await page.locator('[data-admin-nav=settings]').click();
   assert.match(await page.locator('#article-width').innerText(),new RegExp('Custom: '+value+' px'));
   assert.deepEqual(errors,[]);await context.close();}

  // The far right end is Full window; the keyboard steps away from both Standard and Full, and back to Standard.
  {const {context,page,errors}=await open();
   await page.waitForSelector('.article-width');
   const start=await width(page);
   assert.ok(Math.abs(Number(await page.locator(THUMB).getAttribute('aria-valuenow'))-start)<1,'the thumb starts at the real Standard width');
   await page.locator(THUMB).focus();
   await page.keyboard.press('ArrowRight');
   await page.waitForFunction(()=>/^\d+$/.test(JSON.parse(localStorage.getItem('reader.preferences.v1')).articleWidth||''));
   assert.ok(await width(page)>start,'right widens');
   await page.keyboard.press('ArrowLeft');
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).articleWidth==='standard');
   assert.ok(Math.abs(await width(page)-start)<1,'left returns to Standard exactly');
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.articleWidth),'standard');
   await page.keyboard.press('ArrowLeft');
   await page.waitForFunction(()=>/^\d+$/.test(JSON.parse(localStorage.getItem('reader.preferences.v1')).articleWidth||''));
   assert.ok(await width(page)<start,'left of Standard narrows');
   await page.keyboard.press('End');
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).articleWidth==='full');
   assert.ok(Math.abs(await width(page)-(1600-80))<1,'the end is the whole window');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=0);
   assert.deepEqual(errors,[]);await context.close();}

  // Dragging keeps the reader's line, with reduced motion on or off.
  for(const motion of ['reduce','no-preference']){const {context,page,errors}=await open({},{width:1600,height:600},motion);
   await page.waitForSelector('.article-width');
   const blocks=()=>[...document.querySelector('#article').children].filter(el=>!el.classList.contains('annotation-pin'));
   await page.evaluate(blocks=>{const list=eval(blocks)(),target=list[Math.floor(list.length/2)];scrollTo(0,target.getBoundingClientRect().top+scrollY-innerHeight*.22+2);},String(blocks));
   await still(page);
   const index=await page.evaluate(blocks=>{const y=innerHeight*.22;return eval(blocks)().findIndex(el=>el.getBoundingClientRect().bottom>y);},String(blocks));
   assert.ok(index>0,'scrolled into the article');
   const box=await track(page);
   await page.mouse.move(...at(box,.2));await page.mouse.down();await page.mouse.move(...at(box,.9),{steps:8});await page.mouse.up();
   await still(page);
   const line=await page.evaluate(({blocks,index})=>{const r=eval(blocks)()[index].getBoundingClientRect();return {top:r.top,bottom:r.bottom,y:innerHeight*.22};},{blocks:String(blocks),index});
   assert.ok(line.top<=line.y+2&&line.bottom>=line.y-2,`block ${index} stays at the reading line (${line.top}..${line.bottom} around ${line.y})`);
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Article width slider passed: where it shows, live rewrap, one save, reload, keyboard, the reading keys and the reading line.');
 }finally{await browser?.close();fixture?.kill();}
})().catch(error=>{console.error(error);process.exit(1);});
