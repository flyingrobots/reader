/* Article art as a hero (#145): an article with art opens on its art, full width in continuous reading and filling the
   whole first spread in two-page reading, with the text from the next spread on; the Artist's note is reachable and a
   button leads into the text. Spread math, page-turn rasterization, bookmarks, heading jumps and find stay correct.
   Articles without art are unchanged, and a setting turns the hero off. Synthetic fixture only; never a real model. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 let browser,fixture;
 try{
  fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--art','--art-long'],{stdio:['ignore','pipe','inherit']});
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async({motion='reduce',prefs={},viewport={width:1300,height:900}}={})=>{
    const context=await browser.newContext({viewport,reducedMotion:motion});
    await context.addInitScript(value=>{try{if(!sessionStorage.getItem('hero-test')){localStorage.setItem('reader.preferences.v1',value);sessionStorage.setItem('hero-test','1');}}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',...prefs}));
    const page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
    return {context,page,errors,external};
  };
  const shown=(page,path)=>page.waitForFunction(p=>document.querySelector('.document-footer')?.textContent.startsWith(p)&&!document.querySelector('.resume-pending'),path);
  const read=async(page,path,hash='')=>{await page.goto(url+'#read='+encodeURIComponent(path)+hash);await shown(page,path);};
  const settled=page=>page.waitForFunction(()=>['live','still','image','unavailable','error'].includes(document.querySelector('#article .art-hero')?.dataset.state),null,{timeout:20000});
  const spread=page=>page.evaluate(()=>{const v=document.querySelector('.book-viewport');return Math.round(v.scrollLeft/(v.clientWidth+(parseFloat(getComputedStyle(document.querySelector('#article')).columnGap)||0)));});

  // Continuous reading: the art comes first, full width at a sensible height, the title right below it; the hero is
  // decoration, its Artist's note opens, and Begin reading brings the text to the top.
  {const {context,page,errors,external}=await open();
   await read(page,'library/issue/keep.md');await settled(page);
   const layout=await page.evaluate(()=>{const hero=document.querySelector('#article .art-hero'),title=document.querySelector('#article .document-title'),r=hero.getBoundingClientRect();
     return {first:document.querySelector('#article').firstElementChild===hero,decoration:hero.matches('[data-reader-decoration]'),top:r.top,width:r.width,height:r.height,below:title.getBoundingClientRect().top>=r.bottom-1,inner:innerWidth,client:document.documentElement.clientWidth,vh:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal(layout.first,true,'the hero is the first thing in the article');assert.equal(layout.decoration,true);
   assert.ok(layout.top<=1,`the hero starts at the top of the page (${layout.top})`);
   assert.ok(layout.width>=layout.client-1,`full width (${layout.width} of ${layout.client})`);
   assert.ok(layout.height>=layout.vh*.45&&layout.height<=layout.vh*.8+1,`a sensible height (${layout.height} of ${layout.vh})`);
   assert.equal(layout.below,true,'the title follows the art');assert.equal(layout.overflow,false,'no horizontal scroll');
   assert.equal(await page.locator('#article .art-hero .art-surface').getAttribute('aria-label'),'Art: Algebraic patterns');
   assert.equal(await page.locator('#article .art-hero .art-note').isVisible(),false);
   await page.click('#article .art-hero .art-note-toggle');assert.equal(await page.locator('#article .art-hero .art-note').isVisible(),true,'the Artist’s note is reachable');
   await page.click('#article .art-hero .art-note-toggle');
   await page.screenshot({path:'.reader/web-dev/hero-scroll.png'});
   await page.click('#article .art-hero-continue');
   await page.waitForFunction(()=>Math.abs(document.querySelector('#article .document-kicker').getBoundingClientRect().top)<120,null,{timeout:5000});
   // Space g hides the art for this session; again shows it.
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');
   assert.equal(await page.locator('#article .article-art').count(),0,'Space g hides the hero');
   await page.keyboard.press('Space');await page.keyboard.press('g');await page.locator('#article .article-art').waitFor();
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // A late block is restored to its place under the hero, and a heading link lands on its heading.
  {const {context,page,errors}=await open();
   await read(page,'library/issue/long-art.md');await settled(page);
   // Blocks far from the window have estimated heights (content-visibility), which settle once the scroll arrives; scroll again until it holds.
   await page.evaluate(async()=>{const block=[...document.querySelectorAll('#article p')].find(p=>p.textContent.includes('distinct remark for part 30'));for(let i=0;i<5;i++){scrollTo(0,scrollY+block.getBoundingClientRect().top-innerHeight*.22+2);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,100))));if(Math.abs(block.getBoundingClientRect().top-(innerHeight*.22-2))<2)break;}});
   await page.waitForTimeout(1200);
   await page.reload();await shown(page,'library/issue/long-art.md');await page.waitForTimeout(400);
   const restored=await page.evaluate(()=>{const block=[...document.querySelectorAll('#article p')].find(p=>p.textContent.includes('distinct remark for part 30')),r=block.getBoundingClientRect();return {top:r.top,bottom:r.bottom,line:innerHeight*.22,hero:!!document.querySelector('#article .art-hero')};});
   assert.equal(restored.hero,true);assert.ok(restored.top<=restored.line+2&&restored.bottom>=restored.line-2,`the late block is back at the reading line (${JSON.stringify(restored)})`);
   await read(page,'library/issue/edict.md');await read(page,'library/issue/long-art.md','&h=part-20');
   await page.waitForFunction(()=>{const top=document.querySelector('#part-20')?.getBoundingClientRect().top;return top>=0&&top<200;},null,{timeout:5000}).catch(()=>{});
   const heading=await page.evaluate(()=>document.querySelector('#part-20').getBoundingClientRect().top);
   assert.ok(heading>=0&&heading<200,`the heading link lands on its heading (${heading})`);
   assert.deepEqual(errors,[]);await context.close();}

  // Two-page reading: the hero fills the whole first spread (both pages), the text begins on the next spread, turning
  // there and back works, and the page turn rasterizes the hero.
  {const {context,page,errors,external}=await open({prefs:{layout:'spread'}});
   await read(page,'library/issue/keep.md');await settled(page);
   const geometry=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect(),h=document.querySelector('#article .art-hero').getBoundingClientRect(),
     first=[...document.querySelectorAll('#article [data-source-start]')].find(el=>!el.closest('[data-reader-decoration]')).getBoundingClientRect();
     return {v:{left:v.left,right:v.right,top:v.top,bottom:v.bottom},h:{left:h.left,right:h.right,top:h.top,bottom:h.bottom},first:first.left,columns:getComputedStyle(document.querySelector('#article')).columnCount};});
   assert.equal(geometry.columns,'2');
   assert.ok(Math.abs(geometry.h.left-geometry.v.left)<=2&&Math.abs(geometry.h.right-geometry.v.right)<=2,`the hero spans both pages (${JSON.stringify(geometry)})`);
   assert.ok(Math.abs(geometry.h.top-geometry.v.top)<=2&&Math.abs(geometry.h.bottom-geometry.v.bottom)<=2,'and their full height');
   assert.ok(geometry.first>=geometry.v.right-1,`the text starts on the next spread (${geometry.first} ≥ ${geometry.v.right})`);
   assert.equal(await spread(page),0,'the reader opens on the art');
   assert.match(await page.locator('#article .art-hero-title').textContent(),/A ledger that remembers the tide/);
   assert.equal(await page.locator('#article .art-hero-opener').getAttribute('aria-hidden'),'true','the opener repeats the title for the eye only');
   // The page turn paints the hero from its image: the left page's raster changes without the image.
   // (Two frames first: under reduced motion every style change is a 0.01 ms transition, so a fresh image is visible from the next frame.)
   await page.evaluate(()=>document.querySelector('#article .art-hero img').decode().then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
   const painted=await page.evaluate(async()=>{const {rasterize}=await import('/assets/controls/page-turn.js');const article=document.querySelector('#article'),v=document.querySelector('.book-viewport').getBoundingClientRect(),img=document.querySelector('#article .art-hero img');
     const raster=()=>rasterize(article,{x:v.left,y:v.top,w:v.width/2,h:v.height},0,'rgb(255,0,255)',1).getContext('2d').getImageData(0,0,Math.floor(v.width/2),Math.floor(v.height)).data;
     const shown=raster(),parent=img.parentElement,next=img.nextSibling;img.remove();const hidden=raster();parent.insertBefore(img,next);
     let differ=0,n=0;for(let i=0;i<shown.length;i+=4*53,n++)if(Math.abs(shown[i]-hidden[i])+Math.abs(shown[i+1]-hidden[i+1])+Math.abs(shown[i+2]-hidden[i+2])>24)differ++;
     const r=img.getBoundingClientRect();return {fraction:differ/n,complete:img.complete,width:img.naturalWidth,rect:[r.left,r.top,r.width,r.height],connected:img.isConnected,scroll:document.querySelector('.book-viewport').scrollLeft};});
   assert.ok(painted.fraction>.1,`the page turn rasterizes the hero's image (${JSON.stringify(painted)})`);
   await page.screenshot({path:'.reader/web-dev/hero-spread.png'});
   await page.locator('#main').focus();await page.keyboard.press('j');await page.waitForFunction(()=>{const v=document.querySelector('.book-viewport');return v.scrollLeft>v.clientWidth/2;});await page.waitForTimeout(700);
   assert.equal(await spread(page),1);
   const title=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect(),t=document.querySelector('#article .document-title').getBoundingClientRect();return t.left>=v.left-1&&t.right<=v.right+1;});
   assert.equal(title,true,'the title opens the text on the next spread');
   await page.screenshot({path:'.reader/web-dev/hero-spread-next.png'});
   await page.keyboard.press('k');await page.waitForFunction(()=>document.querySelector('.book-viewport').scrollLeft<2);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Two-page reading of a long piece: a bookmark on a later spread comes back there, a heading link turns to it, and
  // find counts only the text (not the hero's repeated title).
  {const {context,page,errors}=await open({prefs:{layout:'spread'}});
   await read(page,'library/issue/long-art.md');await settled(page);
   // The bookmark from continuous reading (part 30) restored a later spread; three turns on from there.
   const began=await spread(page);assert.ok(began>1,`restored past the hero (${began})`);
   await page.locator('#main').focus();for(let i=0;i<3;i++){await page.keyboard.press('j');await page.waitForTimeout(650);}
   assert.equal(await spread(page),began+3);await page.waitForTimeout(900);
   await page.reload();await shown(page,'library/issue/long-art.md');await page.waitForTimeout(300);
   assert.equal(await spread(page),began+3,'the bookmark restores the same spread');
   await read(page,'library/issue/edict.md');await read(page,'library/issue/long-art.md','&h=part-25');await page.waitForTimeout(500);
   const at=await page.evaluate(()=>{const v=document.querySelector('.book-viewport').getBoundingClientRect(),h=document.querySelector('#part-25').getBoundingClientRect();return h.left>=v.left-1&&h.right<=v.right+1;});
   assert.equal(at,true,'a heading link turns to the heading’s spread');
   const count=async()=>{await page.locator('#main').focus();await page.keyboard.press('/');await page.keyboard.type('long piece with');await page.keyboard.press('Enter');
     await page.waitForFunction(()=>/\d+ \/ \d+/.test(document.querySelector('#find-count').textContent));const text=await page.locator('#find-count').textContent();await page.keyboard.press('Escape');return +text.split('/')[1];};
   assert.equal(await count(),1,'find matches the title once: the hero’s opener is not searched');
   assert.deepEqual(errors,[]);await context.close();}

  // Articles without art are unchanged in both layouts; the setting turns the hero off.
  for(const layout of ['scroll','spread']){
   const {context,page,errors}=await open({prefs:{layout}});
   await read(page,'library/issue/edict.md');await page.waitForTimeout(1600);
   assert.equal(await page.locator('#article .article-art, #article .art-hero, #article .art-hero-spacer').count(),0,`no hero without art (${layout})`);
   assert.equal(await page.evaluate(()=>document.querySelector('#article').firstElementChild.classList.contains('document-kicker')),true,'the kicker still opens the article');
   assert.deepEqual(errors,[]);await context.close();}
  {const {context,page,errors}=await open({prefs:{artHero:false}});
   await read(page,'library/issue/keep.md');await page.waitForTimeout(1600);
   assert.equal(await page.locator('#article .article-art').count(),0,'Open articles with their art: off');
   await page.locator('#settings-open').click();await page.locator('[data-admin-nav=settings]').click();await page.locator('#setting-art-hero').waitFor();
   assert.equal(await page.locator('#setting-art-hero').evaluate(el=>el.getAttribute('aria-checked')??String(el.checked??el.dataset.checked!==undefined)),'false');
   assert.deepEqual(errors,[]);await context.close();}

  // Without WebGL: the stored still image (the first browser to draw it kept one), else the note in its place.
  {const {context,page,errors}=await open();
   await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...rest){return /webgl/.test(kind)?null:original.call(this,kind,...rest);};});
   await read(page,'library/issue/keep.md');await settled(page);
   const state=await page.locator('#article .art-hero').getAttribute('data-state');assert.ok(['image','unavailable'].includes(state),state);
   if(state==='unavailable')assert.equal(await page.locator('#article .art-hero .art-note').isVisible(),true);
   else assert.match(await page.locator('#article .art-hero img.art-still').getAttribute('src'),/^\/api\/art\/still\?/);
   assert.deepEqual(errors,[]);await context.close();}

  // Motion allowed: a live scene in continuous reading; phone width keeps the hero inside the page.
  {const {context,page,errors}=await open({motion:'no-preference'});
   await read(page,'library/issue/keep.md');await settled(page);
   assert.ok(['live','still'].includes(await page.locator('#article .art-hero').getAttribute('data-state')));
   assert.deepEqual(errors,[]);await context.close();}
  {const {context,page,errors}=await open({viewport:{width:390,height:844}});
   await read(page,'library/issue/keep.md');await settled(page);
   const phone=await page.evaluate(()=>{const r=document.querySelector('#article .art-hero').getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal(phone.overflow,false,'no horizontal scroll at 390px');assert.ok(phone.left>=-1&&phone.right<=391&&phone.height>=200,JSON.stringify(phone));
   await page.screenshot({path:'.reader/web-dev/hero-phone.png'});
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Article hero passed: art first at full width in continuous reading with the title below, note and Begin reading, Space g, late-block restore and heading links under the hero; in two-page reading the hero fills the first spread, text from the next, turns, rasterized for the page turn, bookmarks, heading jumps and find; no-art articles unchanged; setting off; live; 390px.');
 }finally{await browser?.close();if(fixture&&fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
