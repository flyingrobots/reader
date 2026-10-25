/* Article shapes (RW-20): cover art, thumbnails, Show shape, reduced motion, fallbacks, keys and phone width. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const start=async args=>{
  const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--shapes',...args],{stdio:['ignore','pipe','inherit']});
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  return {fixture,url};
};
const stop=async fixture=>{if(fixture&&fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}};
(async()=>{
 let browser,fixture,terms;
 try{
  const first=await start([]);fixture=first.fixture;const url=first.url;
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async({motion='reduce',prefs={},viewport={width:1300,height:900},webgl=true,base=url}={})=>{
    const context=await browser.newContext({viewport,reducedMotion:motion});
    await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',...prefs}));
    if(!webgl)await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...rest){return /webgl/.test(kind)?null:original.call(this,kind,...rest);};});
    const page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(base))external.push(r.url());});
    return {context,page,errors,external};
  };
  const home=async page=>{await page.goto(url);await page.locator('.issue-cover').waitFor();};
  const cover=page=>page.locator('.cover-shape');
  // Wait until a document route has rendered this path (a hash change keeps the old page until then).
  const shown=(page,path)=>page.waitForFunction(p=>document.querySelector('.document-footer')?.textContent.startsWith(p)&&!document.querySelector('.resume-pending'),path);
  const settled=(page,selector='.cover-shape')=>page.waitForFunction(s=>document.querySelector(s)?.dataset.state,selector,{timeout:15000}).catch(async error=>{console.error('Not drawn:',selector,await page.evaluate(s=>[location.hash,document.activeElement?.className,document.querySelector('[data-sonner-toaster]')?.textContent,document.querySelector(s)?.outerHTML?.slice(0,300),document.querySelector('#vim-mode').textContent],selector));throw error;});
  const at=async(page,kind,index,selector='.cover-shape')=>page.evaluate(([s,k,i])=>{const figure=document.querySelector(s),box=figure.querySelector('.shape-surface').getBoundingClientRect(),p=figure.shapeLayout()[k][i];return {x:box.left+p[0],y:box.top+p[1]};},[selector,kind,index]);

  // Reduced motion: the cover is one still image (no animation frames after it), thumbnails are images,
  // and the same source renders the same pixels across reloads.
  let still;
  {const {context,page,errors,external}=await open();
   await home(page);await settled(page);
   assert.equal(await cover(page).getAttribute('data-state'),'still');
   assert.equal(await page.locator('.cover-shape canvas').count(),0,'no live canvas under reduced motion');
   still=await page.locator('.cover-shape img.shape-still').getAttribute('src');assert.match(still,/^data:image\/png;base64,/);
   await page.waitForTimeout(800);assert.equal(await cover(page).getAttribute('data-frames'),'1','a single still frame');
   await page.waitForFunction(()=>document.querySelectorAll('.feature-shape[data-state]').length>0);
   const thumbs=await page.locator('.feature-shape').count();assert.ok(thumbs>=1,'the tight note has a thumbnail');
   assert.equal(await page.locator('.feature-shape[data-state=still] img').count(),thumbs);
   assert.equal(await page.locator('[data-shape-thumb="library/issue/keep.md"]').count(),1);
   assert.equal(await page.locator('[data-shape-thumb="library/issue/bijou.md"]').count(),0,'pieces shorter than six passages get no shape');
   // The figure follows the title in the document but is drawn above the kicker; its text list describes it.
   const order=await page.evaluate(()=>{const f=document.querySelector('.cover-shape'),k=document.querySelector('.issue-cover .issue-kicker');return {above:f.getBoundingClientRect().bottom<=k.getBoundingClientRect().top+1,after:!!(document.querySelector('.cover-title').compareDocumentPosition(f)&Node.DOCUMENT_POSITION_FOLLOWING)};});
   assert.deepEqual(order,{above:true,after:true});
   const description=await page.evaluate(()=>document.getElementById(document.querySelector('.cover-shape').getAttribute('aria-describedby'))?.textContent||'');
   assert.match(description,/passages/);assert.match(description,/Key terms: /);assert.match(description,/Nearest works/);
   assert.equal(await page.evaluate(()=>!!document.querySelector('.cover-shape').closest('[data-reader-decoration]')),true);
   await page.screenshot({path:'.reader/web-dev/shape-cover-still.png'});
   await page.reload();await page.locator('.issue-cover').waitFor();await settled(page);
   assert.equal(await page.locator('.cover-shape img.shape-still').getAttribute('src'),still,'identical pixels across reloads');
   // Keyboard: g c focuses the cover, Tab reaches the shape, arrows walk passages and related works, Enter opens (a related work: reading it leaves the issue's cover unchanged).
   await page.locator('#main').focus();
   await page.keyboard.press('g');await page.keyboard.press('c');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-cover')),true);
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('cover-shape')),true);
   assert.equal(await page.locator('#vim-mode').textContent(),'SHAPE');
   await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
   assert.match(await page.locator('.cover-shape [aria-live]').textContent(),/^Passage 2 of /);
   assert.equal(await page.locator('.cover-shape .shape-marker').isVisible(),true,'a marker ring on the still image');
   await page.keyboard.press('ArrowDown');const star=await page.locator('.cover-shape [aria-live]').textContent();assert.match(star,/^Related work: On the /);
   await page.keyboard.press('Enter');await page.waitForFunction(()=>location.hash.startsWith('#read=library%2Fnear%2F'));
   await home(page);await settled(page);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Motion: one live WebGL canvas, capped at 30 fps, paused when scrolled out of view.
  {const {context,page,errors,external}=await open({motion:'no-preference'});
   await home(page);await settled(page);const state=await cover(page).getAttribute('data-state');
   if(state==='live'){
     assert.equal(await page.locator('canvas.shape-canvas').count(),1,'one WebGL canvas per page');
     const a=+await cover(page).getAttribute('data-frames');await page.waitForTimeout(1000);const b=+await cover(page).getAttribute('data-frames');
     assert.ok(b>a,'it moves');assert.ok(b-a<=33,`capped at 30 fps (${b-a} frames in a second)`);
     await page.screenshot({path:'.reader/web-dev/shape-cover-live.png'});
     const bead=await at(page,'beads',4);await page.mouse.move(bead.x,bead.y);await page.waitForFunction(()=>document.getElementById('shape-tooltip')?.classList.contains('visible'));
     await page.mouse.move(5,5);
     await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(300);
     const c=+await cover(page).getAttribute('data-frames');await page.waitForTimeout(600);assert.equal(+await cover(page).getAttribute('data-frames'),c,'paused off-screen');
     await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(500);assert.ok(+await cover(page).getAttribute('data-frames')>c,'resumes in view');
     console.log(`live cover: ${b-a} frames in one second`);
   }else{
     assert.equal(state,'still','a slow GPU drops to a still image');console.log('live cover: GPU budget exceeded on this renderer; still image');
   }
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Without WebGL: the same projection as an SVG, still interactive.
  {const {context,page,errors}=await open({webgl:false});
   await home(page);await settled(page);assert.equal(await cover(page).getAttribute('data-state'),'svg');
   assert.ok(await page.locator('.cover-shape svg circle').count()>10);
   const bead=await at(page,'beads',2);await page.mouse.move(bead.x,bead.y);await page.waitForFunction(()=>document.getElementById('shape-tooltip')?.classList.contains('visible'));
   await page.screenshot({path:'.reader/web-dev/shape-cover-svg.png'});
   assert.deepEqual(errors,[]);await context.close();}

  // The setting turns the experiment off; phone width keeps the page inside 390px.
  {const {context,page,errors}=await open({prefs:{shapes:false}});
   await home(page);await page.waitForTimeout(300);assert.equal(await page.locator('.cover-shape,.feature-shape').count(),0);
   assert.deepEqual(errors,[]);await context.close();}
  {const {context,page,errors}=await open({viewport:{width:390,height:844}});
   await home(page);await settled(page);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scroll at 390px');
   const box=await cover(page).boundingBox();assert.ok(box.x>=15&&box.x+box.width<=375,'inside the 16px gutters');
   await page.screenshot({path:'.reader/web-dev/shape-phone.png'});
   assert.deepEqual(errors,[]);await context.close();}

  // Hover shows the passage's first line; clicking a bead opens the article at that passage (which marks the cover
  // read, so this runs after the other cover checks).
  {const {context,page,errors,external}=await open();
   await home(page);await settled(page);
   const bead=await at(page,'beads',8);await page.mouse.move(bead.x,bead.y);
   await page.waitForFunction(()=>document.getElementById('shape-tooltip')?.classList.contains('visible'));
   const tip=await page.locator('#shape-tooltip').textContent();assert.match(tip,/^Passage 9 of \d+[A-Z]/,'the first line of a passage starts a sentence');
   await page.mouse.click(bead.x,bead.y);
   await page.waitForFunction(()=>location.hash.startsWith('#read=library%2Fissue%2Fcover.md&at=')&&!document.querySelector('.resume-pending'));
   const opened=await page.evaluate(()=>JSON.parse(decodeURIComponent(location.hash.split('&at=')[1])));assert.ok(opened.line>20,'a passage deep in the essay');
   await page.waitForFunction(()=>scrollY>400,null,{timeout:5000});
   // Show shape (Space g) on two articles: different pixels for different texts; Space g again hides it.
   await shown(page,'library/issue/cover.md');  // still on the essay the bead opened
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');
   await settled(page,'.article-shape[data-shape="library/issue/cover.md"]');const firstShape=await page.locator('.article-shape img').getAttribute('src');
   assert.equal(await page.evaluate(()=>document.querySelector('#article').firstElementChild.classList.contains('article-shape')),true,'above the kicker');
   const find=await page.evaluate(()=>!!document.querySelector('.article-shape[data-reader-decoration]'));assert.ok(find);
   await page.screenshot({path:'.reader/web-dev/shape-article.png'});
   await page.evaluate(()=>{location.hash='#read='+encodeURIComponent('library/issue/keep.md');});
   await shown(page,'library/issue/keep.md');await settled(page,'.article-shape[data-shape="library/issue/keep.md"]');
   const second=await page.locator('.article-shape img').getAttribute('src');assert.notEqual(second,firstShape,'two articles, two shapes');
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');assert.equal(await page.locator('.article-shape').count(),0);
   // :shape is the same toggle from the command line.
   await page.keyboard.press(':');await page.keyboard.type('shape');await page.keyboard.press('Enter');
   await settled(page,'.article-shape[data-shape="library/issue/keep.md"]');
   await page.keyboard.press(':');await page.keyboard.type('shape');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>!document.querySelector('.article-shape'));
   // A short piece has no shape to show.
   await page.evaluate(()=>{location.hash='#read='+encodeURIComponent('library/issue/bijou.md');});await shown(page,'library/issue/bijou.md');
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');
   await page.waitForFunction(()=>document.body.textContent.includes('too short to have a shape'));
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Without passage vectors: the honest, simpler term form.
  await stop(fixture);fixture=null;
  terms=await start(['--shapes-terms']);
  {const {context,page,errors}=await open({base:terms.url});
   await page.goto(terms.url);await page.locator('.issue-cover').waitFor();await settled(page);
   assert.equal(await cover(page).getAttribute('data-form'),'terms');
   assert.equal(await cover(page).getAttribute('title'),'Rebuild the search index for the full shape');
   assert.equal(await page.locator('.cover-shape .shape-caption').textContent(),'Article shape · terms only');
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Article shapes passed: still cover and thumbnails under reduced motion, identical across reloads, hover and click to a passage, g c Tab arrows and Enter, Show shape on two articles, :shape, short pieces, live canvas at most 30 fps and paused off-screen, SVG without WebGL, setting off, 390px, term form, local-only requests.');
 }finally{await browser?.close();await stop(fixture);await stop(terms?.fixture);}
})().catch(error=>{console.error(error);process.exitCode=1;});
