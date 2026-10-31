/* Article shapes (RW-20) as the data view (`:shape`): no longer the magazine's art (RW-43). An article's shape
   above its kicker, reduced motion, identical across reloads, two articles differ, keys and hover, a live canvas
   at most 30 fps, SVG without WebGL, short pieces, the term form and phone width. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {pinDate}=require('./web_clock.cjs');  // the fixture's pinned clock (#131)
const start=async args=>{
  const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--shapes',...args],{stdio:['ignore','pipe','inherit']});
  const {url,now}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  return {fixture,url,now};
};
const stop=async fixture=>{if(fixture&&fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}};
(async()=>{
 let browser,fixture,terms;
 try{
  const first=await start([]);fixture=first.fixture;const url=first.url,now=first.now;
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async({motion='reduce',prefs={},viewport={width:1300,height:900},webgl=true,base=url}={})=>{
    const context=await browser.newContext({viewport,reducedMotion:motion});await pinDate(context,now);
    await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',...prefs}));
    if(!webgl)await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...rest){return /webgl/.test(kind)?null:original.call(this,kind,...rest);};});
    const page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(base))external.push(r.url());});
    return {context,page,errors,external};
  };
  const shown=(page,path)=>page.waitForFunction(p=>document.querySelector('.document-footer')?.textContent.startsWith(p)&&!document.querySelector('.resume-pending'),path);
  const read=async(page,path,base=url)=>{if(!page.url().startsWith(base))await page.goto(base);await page.evaluate(p=>{location.hash='#read='+encodeURIComponent(p);},path);await shown(page,path);await page.locator('#main').focus();};
  const command=async(page,name)=>{await page.locator('#main').focus();await page.keyboard.press(':');await page.keyboard.type(name);await page.keyboard.press('Enter');};
  const settled=(page,path)=>page.waitForFunction(p=>document.querySelector(`.article-shape[data-shape="${p}"]`)?.dataset.state,path,{timeout:15000});
  const figure=page=>page.locator('.article-shape');
  const at=async(page,kind,index)=>page.evaluate(([k,i])=>{const f=document.querySelector('.article-shape'),box=f.querySelector('.shape-surface').getBoundingClientRect(),p=f.shapeLayout()[k][i];return {x:box.left+p[0],y:box.top+p[1]};},[kind,index]);

  // The magazine no longer draws shapes: its art is bespoke (RW-43). Space g is the art, :shape the data view.
  {const {context,page,errors}=await open();
   await page.goto(url);await page.locator('.issue-cover').waitFor();await page.waitForTimeout(600);
   assert.equal(await page.locator('.cover-shape,.feature-shape').count(),0);
   assert.deepEqual(errors,[]);await context.close();}

  // Reduced motion: a still image, identical across reloads, above the kicker, described in text; keys walk it.
  let still;
  {const {context,page,errors,external}=await open();
   await read(page,'library/issue/cover.md');await command(page,'shape');await settled(page,'library/issue/cover.md');
   assert.equal(await figure(page).getAttribute('data-state'),'still');
   still=await page.locator('.article-shape img.shape-still').getAttribute('src');assert.match(still,/^data:image\/png;base64,/);
   await page.waitForTimeout(600);assert.equal(await figure(page).getAttribute('data-frames'),'1','a single still frame');
   assert.equal(await page.evaluate(()=>document.querySelector('#article').firstElementChild.classList.contains('article-shape')),true,'above the kicker');
   const description=await page.evaluate(()=>document.getElementById(document.querySelector('.article-shape').getAttribute('aria-describedby'))?.textContent||'');
   assert.match(description,/passages/);assert.match(description,/Key terms: /);assert.match(description,/Nearest works/);
   await page.screenshot({path:'.reader/web-dev/shape-article-still.png'});
   await page.reload();await shown(page,'library/issue/cover.md');await command(page,'shape');await settled(page,'library/issue/cover.md');
   assert.equal(await page.locator('.article-shape img.shape-still').getAttribute('src'),still,'identical pixels across reloads');
   await page.locator('.article-shape').focus();assert.equal(await page.locator('#vim-mode').textContent(),'SHAPE');
   await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
   assert.match(await page.locator('.article-shape [aria-live]').textContent(),/^Passage 2 of /);
   assert.equal(await page.locator('.article-shape .shape-marker').isVisible(),true,'a marker ring on the still image');
   await page.keyboard.press('ArrowDown');assert.match(await page.locator('.article-shape [aria-live]').textContent(),/^Related work: On the /);
   // Hover shows a passage's first line; a click reveals that passage in the article.
   const bead=await at(page,'beads',8);await page.mouse.move(bead.x,bead.y);
   await page.waitForFunction(()=>document.getElementById('shape-tooltip')?.classList.contains('visible'));
   assert.match(await page.locator('#shape-tooltip').textContent(),/^Passage 9 of \d+[A-Z]/);
   await page.mouse.click(bead.x,bead.y);await page.waitForFunction(()=>scrollY>400,null,{timeout:5000});
   // Two articles, two shapes; :shape again hides it.
   await read(page,'library/issue/keep.md');await settled(page,'library/issue/keep.md');
   assert.notEqual(await page.locator('.article-shape img').getAttribute('src'),still,'two articles, two shapes');
   await command(page,'shape');await page.waitForFunction(()=>!document.querySelector('.article-shape'));
   // A short piece has no shape to show.
   await read(page,'library/issue/bijou.md');await command(page,'shape');
   await page.waitForFunction(()=>document.body.textContent.includes('too short to have a shape'));
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Motion: one live canvas in continuous reading, capped at 30 fps.
  {const {context,page,errors,external}=await open({motion:'no-preference'});
   await read(page,'library/issue/cover.md');await command(page,'shape');await settled(page,'library/issue/cover.md');
   const state=await figure(page).getAttribute('data-state');
   if(state==='live'){
     assert.equal(await page.locator('canvas.shape-canvas').count(),1);
     const a=+await figure(page).getAttribute('data-frames');await page.waitForTimeout(1000);const b=+await figure(page).getAttribute('data-frames');
     assert.ok(b>a,'it moves');assert.ok(b-a<=33,`capped at 30 fps (${b-a} frames in a second)`);console.log(`live data view: ${b-a} frames in one second`);
   }else{assert.equal(state,'still');console.log('live data view: GPU budget exceeded on this renderer; still image');}
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Without WebGL: the same projection as an SVG; phone width stays inside 390px.
  {const {context,page,errors}=await open({webgl:false});
   await read(page,'library/issue/cover.md');await command(page,'shape');await settled(page,'library/issue/cover.md');
   assert.equal(await figure(page).getAttribute('data-state'),'svg');assert.ok(await page.locator('.article-shape svg circle').count()>10);
   await page.screenshot({path:'.reader/web-dev/shape-article-svg.png'});
   assert.deepEqual(errors,[]);await context.close();}
  {const {context,page,errors}=await open({viewport:{width:390,height:844}});
   await read(page,'library/issue/cover.md');await command(page,'shape');await settled(page,'library/issue/cover.md');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scroll at 390px');
   assert.deepEqual(errors,[]);await context.close();}

  // Without passage vectors: the honest, simpler term form.
  await stop(fixture);fixture=null;
  terms=await start(['--shapes-terms']);
  {const {context,page,errors}=await open({base:terms.url});
   await read(page,'library/issue/cover.md',terms.url);await command(page,'shape');await settled(page,'library/issue/cover.md');
   assert.equal(await figure(page).getAttribute('data-form'),'terms');
   assert.equal(await figure(page).getAttribute('title'),'Rebuild the search index for the full shape');
   assert.equal(await page.locator('.article-shape .shape-caption').textContent(),'Article shape · terms only');
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Article shapes (data view) passed: not on the magazine, :shape still image identical across reloads, keys, hover and click to a passage, two articles differ, short pieces, live canvas at most 30 fps, SVG without WebGL, 390px, term form, local-only requests.');
 }finally{await browser?.close();await stop(fixture);await stop(terms?.fixture);}
})().catch(error=>{console.error(error);process.exitCode=1;});
