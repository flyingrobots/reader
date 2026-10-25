/* Two-page margin pins appear only on the spread that shows their highlight, beside its line and column (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const DOC='library/thought.md';
// Runs in the page: for every thread, where its highlight is and where (and whether) its pin is drawn.
function survey(){
 const article=document.querySelector('#article'),viewport=document.querySelector('.book-viewport'),box=viewport?.getBoundingClientRect();
 const style=getComputedStyle(article),gap=viewport?parseFloat(style.columnGap)||0:0,columns=viewport?parseInt(style.columnCount)||1:1,width=viewport?(box.width-gap*(columns-1))/columns:0;
 const texts=[];const walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.annotation-pin,[data-reader-decoration]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
 for(let node;(node=walker.nextNode());)texts.push(node);
 return window.__threads.map(({id,quote,comment})=>{
  const node=texts.find(n=>n.data.includes(quote)),range=document.createRange();const at=node.data.indexOf(quote);range.setStart(node,at);range.setEnd(node,at+quote.length);
  const rects=[...range.getClientRects()].filter(r=>r.width>0);
  const shown=box?rects.filter(r=>r.right>box.left+1&&r.left<box.right-1&&r.bottom>box.top&&r.top<box.bottom):rects.filter(r=>r.bottom>0&&r.top<innerHeight);
  const pin=article.querySelector(`.annotation-pin[data-thread="${CSS.escape(id)}"]`),p=pin?.getBoundingClientRect();
  const drawn=!!pin&&!pin.hidden&&pin.checkVisibility()&&p.width>0&&p.right>0&&p.left<innerWidth&&p.bottom>0&&p.top<innerHeight;
  const hit=drawn&&(()=>{const el=document.elementFromPoint(p.left+p.width/2,p.top+p.height/2);return !!el&&(el===pin||pin.contains(el));})();
  const line=shown[0],column=line&&box?Math.max(0,Math.min(columns-1,Math.floor((line.left-box.left+gap/2)/(width+gap)))):0;
  const columnRight=box?box.left+column*(width+gap)+width:article.getBoundingClientRect().right;
  return {comment,onSpread:shown.length>0,drawn,hit,column,columns,columnRight,room:box?(column<columns-1?columnRight+gap:innerWidth):innerWidth,
   line:line?{top:line.top,bottom:line.bottom,mid:line.top+line.height/2}:null,pin:drawn?{left:p.left,right:p.right,mid:p.top+p.height/2}:null};
 });
}
function check(rows,label,{continuous=false}={}){
 const visible=rows.filter(r=>r.onSpread);assert.ok(visible.length>0,label+': some highlights are on screen');
 for(const r of rows){
  const where=`${label}: ${r.comment} `+JSON.stringify(r);
  if(!r.onSpread){if(!continuous){assert.equal(r.drawn,false,'off-spread pin is not drawn '+where);assert.equal(r.hit,false,'off-spread pin is not clickable '+where);}continue;}
  assert.ok(r.drawn&&r.hit,'on-spread pin is drawn and hit-testable '+where);
  if(continuous){assert.ok(r.pin.mid>=r.line.top-4&&r.pin.mid<=r.line.bottom+4,'pin beside its line '+where);assert.ok(r.pin.left>=r.columnRight-1,'pin right of the text '+where);continue;}
  assert.ok(Math.abs(r.pin.mid-r.line.mid)<=4,'pin level with its line '+where);
  assert.ok(r.pin.left>=r.columnRight-1&&r.pin.right<=r.room+1,`pin in the margin right of column ${r.column} `+where);
 }
 return visible.length;
}
const spreadIndex=page=>page.evaluate(()=>{const v=document.querySelector('.book-viewport');return {left:v.scrollLeft,stride:v.clientWidth+(parseFloat(getComputedStyle(document.querySelector('#article')).columnGap)||0)};});
async function settle(page){await page.waitForFunction(()=>{const v=document.querySelector('.book-viewport'),s=v.clientWidth+(parseFloat(getComputedStyle(document.querySelector('#article')).columnGap)||0);return Math.abs(v.scrollLeft/s-Math.round(v.scrollLeft/s))<.002&&!document.querySelector('.page-turn-canvas:not([hidden])');});await page.waitForTimeout(120);}
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--spread-pins'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const errors=[];
  async function open(viewport,prefs,motion='reduce'){
   const context=await browser.newContext({viewport,reducedMotion:motion});await context.addInitScript(p=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify(p));}catch{}},prefs);
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(url+'/#read='+encodeURIComponent(DOC));await page.locator('.annotation-pin').first().waitFor({state:'attached'});
   await page.evaluate(async doc=>{const data=await (await fetch('/api/discussion?path='+encodeURIComponent(doc)+'&participant=Tester')).json();window.__threads=data.threads.map(t=>({id:t.id,quote:t.anchor.quote,comment:t.comments[0]?.body||''}));},DOC);
   await page.waitForTimeout(400);return {context,page};
  }
  const counts=[];
  // Each spread shows exactly its own pins: turn with j to the end, then back with k.
  for(const viewport of [{width:2000,height:1125},{width:1300,height:900},{width:1000,height:760}]){
   const {context,page}=await open(viewport,{layout:'spread',pageTurn:'slide'});
   await page.locator('.book-viewport').focus();let spreads=0,seen=new Set();
   for(;;){await settle(page);const rows=await page.evaluate(survey);counts.push(check(rows,`${viewport.width} spread ${spreads}`));rows.filter(r=>r.onSpread).forEach(r=>seen.add(r.comment));
    const before=await spreadIndex(page);await page.keyboard.press('j');await settle(page);if(Math.abs((await spreadIndex(page)).left-before.left)<1)break;spreads++;if(spreads>60)throw new Error('no end');}
   assert.ok(spreads>=1,`${viewport.width}: at least two spreads (four pages)`);
   assert.equal(seen.size,45,`${viewport.width}: every thread was shown on some spread`);
   for(let i=spreads;i>0;i--){await page.keyboard.press('k');await settle(page);check(await page.evaluate(survey),`${viewport.width} back to spread ${i-1}`);}
   // Clicking a pin on the first spread opens its own thread.
   const first=(await page.evaluate(survey)).find(r=>r.onSpread&&r.comment.startsWith('Margin note'));
   await page.mouse.click((first.pin.left+first.pin.right)/2,first.pin.mid);await page.locator('#thread-panel:not([hidden])').waitFor();
   assert.match(await page.locator('#thread-body').innerText(),new RegExp(first.comment.replace('.','\\.')));
   await context.close();
  }
  // The reported case: wide window, then a resize, on the second spread.
  {
   const {context,page}=await open({width:2000,height:1125},{layout:'spread',pageTurn:'slide'});
   await page.locator('.book-viewport').focus();for(let i=0;i<4;i++){await page.keyboard.press('k');await settle(page);}
   // The next spread's first column lies (clipped) in the wide window's right margin: hovering there names no passage.
   const spots=await page.evaluate(()=>{const box=document.querySelector('.book-viewport').getBoundingClientRect(),out={off:null,on:null};
    for(const {quote} of window.__threads){const w=document.createTreeWalker(document.querySelector('#article'),NodeFilter.SHOW_TEXT);for(let n;(n=w.nextNode());){const at=n.data.indexOf(quote);if(at<0)continue;const r=document.createRange();r.setStart(n,at);r.setEnd(n,at+quote.length);
     for(const c of r.getClientRects()){const spot={x:c.left+Math.min(8,c.width/2),y:c.top+c.height/2};if(c.left>box.right+1&&spot.x<innerWidth-2)out.off??=spot;else if(c.left>box.left&&c.right<box.right)out.on??=spot;}}}return out;});
   assert.ok(spots.off&&spots.on,'fixture places a clipped highlight in the margin '+JSON.stringify(spots));
   await page.mouse.move(spots.on.x,spots.on.y);await page.waitForTimeout(150);assert.equal(await page.locator('#passage-tooltip.visible').count(),1,'hovering a shown highlight names it');
   await page.mouse.move(spots.off.x,spots.off.y);await page.waitForTimeout(150);assert.equal(await page.locator('#passage-tooltip.visible').count(),0,'hovering the margin names no off-spread passage');
   await page.keyboard.press('j');await settle(page);check(await page.evaluate(survey),'2000 spread 1');
   for(const size of [{width:1700,height:1000},{width:1200,height:820},{width:2000,height:1125}]){await page.setViewportSize(size);await page.waitForTimeout(500);await settle(page);check(await page.evaluate(survey),`resized to ${size.width}`);}
   await context.close();
  }
  // Mid-animation: a sliding turn never draws a pin for a highlight outside the book viewport; then the 3D turn (or its fallback).
  for(const pageTurn of ['slide','curl']){
   const {context,page}=await open({width:2000,height:1125},{layout:'spread',pageTurn},'no-preference');
   await page.locator('.book-viewport').focus();
   for(const key of ['j','j','k']){
    await page.keyboard.press(key);
    for(let i=0;i<6;i++){await page.waitForTimeout(60);const rows=await page.evaluate(survey);for(const r of rows)if(r.drawn)assert.ok(r.onSpread,`${pageTurn} turn ${key}: drawn pin belongs to a visible highlight `+JSON.stringify(r));}
    await settle(page);await page.waitForTimeout(300);check(await page.evaluate(survey),`${pageTurn} after ${key}`);
   }
   await context.close();
  }
  // Control: continuous reading draws every pin beside its line.
  {
   const {context,page}=await open({width:2000,height:1125},{layout:'scroll'});
   for(const y of [0,4000,9000]){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(300);check(await page.evaluate(survey),`scroll ${y}`,{continuous:true});}
   await context.close();
  }
  assert.deepEqual(errors,[]);console.log(`Spread pin pages passed: ${counts.length} spreads checked; each shows only its own pins, level with their lines and beside their columns.`);
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
