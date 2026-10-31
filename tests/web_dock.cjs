/* Right-hand panels dock beside the page on wide screens: the page gives up the panel's width, nothing is covered,
   no backdrop or shadow, and the reader's line stays put; narrow windows keep the overlay. Synthetic data, fake voices. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const shots=process.env.READER_SHOTS||'.reader/web-dev';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--chat','--changes','--editions','--versions','--queue'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync(shots,{recursive:true});
  const errors=[];
  const open=async(viewport,prefs={},reducedMotion='reduce')=>{const context=await browser.newContext({viewport,reducedMotion});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',layout:'scroll',nextReads:false,...prefs}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});return {page,context};};
  const read=async(page,path)=>{await page.goto(url+'#read='+encodeURIComponent(path));await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));await page.waitForTimeout(300);};
  const leader=async(page,key)=>{await page.locator('#main').focus({preventScroll:true});await page.keyboard.press('Space');await page.keyboard.press(key);};
  // What covers what: the panel's left edge against the page's right-hand parts.
  const layout=(page,selector)=>page.evaluate(selector=>{
    // The margins, Versions and Lists panels sit in a Sheet (panel-sheet.tsx), which carries the surface and its shadow.
    const found=document.querySelector(selector),panel=found.closest('[data-panel-sheet]')||found,box=panel.getBoundingClientRect(),style=getComputedStyle(panel),right=el=>el?el.getBoundingClientRect().right:-Infinity;
    const pins=[...document.querySelectorAll('#article .annotation-pin')].filter(pin=>!pin.hidden&&pin.getClientRects().length).map(pin=>pin.getBoundingClientRect().right);
    const overlay=[...document.querySelectorAll('[data-slot=sheet-overlay]')].some(el=>getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0);
    const book=document.querySelector('.book-viewport');
    return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,shadow:style.boxShadow,dock:document.documentElement.dataset.dock||null,width:innerWidth,height:innerHeight,
      article:right(document.querySelector('#article')),shell:right(document.querySelector('#main')),status:right(document.querySelector('#statusline')),summon:right(document.querySelector('#summon')),
      book:book?book.getBoundingClientRect().right:null,pins:pins.length?Math.max(...pins):-Infinity,overlay};
  },selector);
  const docked=(at,name)=>{
    assert.ok(Math.abs(at.right-at.width)<1,name+': the panel sits at the right edge');
    for(const part of ['article','shell','status','summon','pins'])assert.ok(at[part]<=at.left+1,`${name}: the ${part} ends at ${at[part]}, left of the panel at ${at.left}`);
    if(at.book!==null)assert.ok(at.book<=at.left+1,`${name}: the two-page spread ends at ${at.book}, left of the panel at ${at.left}`);
    assert.equal(at.overlay,false,name+': no backdrop');assert.equal(at.shadow,'none',name+': no shadow over the page');
    assert.ok(at.top<=1&&at.bottom>=at.height-1,name+': the column runs the full height');
    assert.equal(at.dock,'right',name+': the root says a panel is docked');
  };
  const undocked=async(page,name)=>{const at=await page.evaluate(()=>({dock:document.documentElement.dataset.dock||null,margin:getComputedStyle(document.body).marginRight,status:document.querySelector('#statusline').getBoundingClientRect().right,width:innerWidth}));
    assert.equal(at.dock,null,name+': closing undocks');assert.equal(at.margin,'0px',name+': the page takes the full width again');assert.ok(Math.abs(at.status-at.width)<1,name+': the status line spans the window again');};
  // The block at the reading line (22% down) and how far into it the line falls.
  const blocks=()=>[...document.querySelector('#article').children].filter(el=>!el.classList.contains('annotation-pin'));
  const line=page=>page.evaluate(blocks=>{const y=innerHeight*.22,list=eval(blocks)(),index=list.findIndex(el=>el.getBoundingClientRect().bottom>y);
    return index<0?null:{index,text:list[index].textContent.slice(0,60),y};},String(blocks));
  const sameLine=async(page,before,name)=>{const at=await page.evaluate(({blocks,index,y})=>{const r=eval(blocks)()[index].getBoundingClientRect();return {top:r.top,bottom:r.bottom};},{blocks:String(blocks),...before});
    assert.ok(at.top<=before.y+2&&at.bottom>=before.y-2,`${name}: block ${before.index} ("${before.text}") is still at the reading line (${at.top}..${at.bottom} around ${before.y})`);};
  const wide={width:1440,height:900};
  // Margins: before and after, continuous reading, with the reader's line kept.
  {const {page,context}=await open(wide);await read(page,'library/thought.md');
   await page.evaluate(()=>{const p=[...document.querySelectorAll('#article > p')];p[Math.floor(p.length/2)].scrollIntoView({block:'start'});scrollBy(0,-innerHeight*.15);});await page.waitForTimeout(300);
   const before=await line(page);assert.ok(before,'a block at the reading line');
   await page.screenshot({path:shots+'/dock-before.png'});
   await leader(page,'t');await page.locator('#thread-panel').waitFor();await page.waitForTimeout(400);
   const at=await layout(page,'#thread-panel');docked(at,'margins');await sameLine(page,before,'margins');
   await page.screenshot({path:shots+'/dock-after-margins.png'});
   // The page beneath stays interactive: the article scrolls with the panel open.
   const y=await page.evaluate(()=>scrollY);await page.mouse.move(300,400);await page.mouse.wheel(0,400);await page.waitForTimeout(300);
   assert.ok(await page.evaluate(()=>scrollY)>y,'the page scrolls while the panel is docked');
   assert.ok(await page.locator('#thread-panel').isVisible(),'scrolling the page leaves the panel open');
   await page.keyboard.press('Escape');await page.locator('#thread-panel').waitFor({state:'hidden'});await undocked(page,'margins');
   // Chat docks too, and shares the column with the margins it opens from.
   await leader(page,'m');await page.locator('#chat-panel:not([hidden])').waitFor();await page.waitForTimeout(300);
   docked(await layout(page,'#chat-panel'),'chat');await page.screenshot({path:shots+'/dock-after-chat.png'});
   await page.keyboard.press('Escape');await page.locator('#chat-panel').waitFor({state:'hidden'});await undocked(page,'chat');
   await context.close();}
  // Smooth scrolling: the fixed wrapper narrows too, and the reading line holds.
  {const {page,context}=await open(wide,{smooth:true},'no-preference');await read(page,'library/thought.md');
   await page.evaluate(()=>{const p=[...document.querySelectorAll('#article > p')];window.scrollTo(0,p[Math.floor(p.length/3)].getBoundingClientRect().top+scrollY);});await page.waitForTimeout(1500);
   const before=await line(page);await leader(page,'t');await page.locator('#thread-panel').waitFor();await page.waitForTimeout(1200);
   docked(await layout(page,'#thread-panel'),'smooth margins');await sameLine(page,before,'smooth margins');
   assert.ok(await page.evaluate(()=>document.querySelector('#smooth-wrapper').getBoundingClientRect().right<=document.querySelector('#thread-panel').getBoundingClientRect().left+1),'smooth: the wrapper ends at the panel');
   await context.close();}
  // Two-page reading lays out again beside the dock.
  {const {page,context}=await open(wide,{layout:'spread'});await read(page,'library/thought.md');await page.waitForTimeout(300);
   // The first block that starts on this spread must still be on the spread after it reflows.
   const first=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect();return [...document.querySelectorAll('#article > p')].findIndex(p=>{const r=p.getClientRects()[0];return r&&r.left>=v.left-1&&r.left<v.right;});});
   assert.ok(first>=0,'a paragraph starts on this spread');
   await leader(page,'t');await page.locator('#thread-panel').waitFor();await page.waitForTimeout(700);
   const at=await layout(page,'#thread-panel');docked(at,'two-page margins');
   assert.ok(await page.evaluate(text=>{const v=document.querySelector('.book-viewport').getBoundingClientRect(),p=document.querySelectorAll('#article > p')[text];return !!p&&[...p.getClientRects()].some(r=>r.width>0&&r.left>=v.left-1&&r.right<=v.right+1);},first),'two-page: the spread still shows the text it showed before');
   assert.ok(await page.evaluate(()=>{const v=document.querySelector('.book-viewport');return Math.abs(v.scrollLeft%Math.max(1,v.clientWidth+parseFloat(getComputedStyle(document.querySelector('#article')).columnGap||0)))<2||v.scrollLeft===0;}),'the spread is aligned after the reflow');
   await page.screenshot({path:shots+'/dock-after-two-page.png'});
   await page.keyboard.press('Escape');await page.locator('#thread-panel').waitFor({state:'hidden'});await page.waitForTimeout(400);
   assert.ok(await page.evaluate(()=>document.querySelector('.book-viewport').getBoundingClientRect().right>innerWidth-80),'the spread widens again after closing');
   await context.close();}
  // The reading queue, Versions and What changed.
  {const {page,context}=await open(wide);await read(page,'library/essays/tidal/tidal.md');
   await leader(page,'r');await page.locator('#queue-panel:not([hidden])').waitFor();await page.waitForTimeout(300);docked(await layout(page,'#queue-panel'),'queue');
   await page.keyboard.press('Escape');await page.locator('#queue-panel').waitFor({state:'hidden'});await undocked(page,'queue');
   await leader(page,'v');await page.locator('#versions-panel').waitFor();await page.waitForTimeout(300);docked(await layout(page,'#versions-panel'),'versions');
   await page.keyboard.press('Escape');await page.locator('#versions-panel').waitFor({state:'hidden'});await undocked(page,'versions');
   await read(page,'library/changing.md');await page.locator('.change-banner').waitFor();
   await leader(page,'d');const changes=page.locator('#changes-panel');await changes.waitFor();await page.waitForTimeout(400);
   docked(await layout(page,'#changes-panel'),'what changed');await page.screenshot({path:shots+'/dock-after-changes.png'});
   await page.mouse.click(200,500);await page.waitForTimeout(300);assert.ok(await changes.isVisible(),'clicking the page beside a docked What changed leaves it open');
   await page.keyboard.press('Escape');await changes.waitFor({state:'hidden'});await page.waitForTimeout(300);await undocked(page,'what changed');
   await context.close();}
  // At 1100 px the 410 px margins panel still docks and leaves at least a 610 px column.
  {const {page,context}=await open({width:1100,height:800});await read(page,'library/thought.md');
   await leader(page,'t');await page.locator('#thread-panel').waitFor();await page.waitForTimeout(300);
   const at=await layout(page,'#thread-panel');docked(at,'1100 px margins');
   assert.ok(await page.evaluate(()=>document.querySelector('#article').getBoundingClientRect().width)>=600,'1100 px: the column keeps at least 600 px');
   await context.close();}
  // Narrow windows keep the overlay.
  {const {page,context}=await open({width:900,height:800});await read(page,'library/thought.md');
   const shell=await page.evaluate(()=>document.querySelector('#main').getBoundingClientRect().right);
   await leader(page,'t');await page.locator('#thread-panel').waitFor();await page.waitForTimeout(300);
   const at=await layout(page,'#thread-panel');assert.equal(at.dock,null,'narrow: no dock');
   assert.ok(Math.abs(at.shell-shell)<1,'narrow: the page keeps its width under the panel');assert.notEqual(at.shadow,'none','narrow: the overlay keeps its shadow');
   await context.close();}
  assert.deepEqual(errors,[]);
  console.log('Dock passed: margins, chat, queue, versions and What changed dock beside continuous and two-page reading at 1440 px without covering the page; the reading line holds; 1100 px still docks the margins with a 610 px column; 900 px keeps the overlay.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
