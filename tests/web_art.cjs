/* Bespoke article art (RW-43): cover art and thumbnails, the Artist's note, Space g with Generate art (a fake
   voice, a background job, toasts), versions and a favorite, live motion at most 30 fps and paused off-screen,
   frame time, reduced motion, the WebGL-less still, client-side validation, themes, settings, the Art studio
   card, automatic commissions and phone width. Synthetic fixture only; never a real model. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {pinDate}=require('./web_clock.cjs');  // the fixture's pinned clock (#131)
const start=async args=>{
  const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--art',...args],{stdio:['ignore','pipe','inherit']});
  const {url,now}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  return {fixture,url,now};
};
const stop=async fixture=>{if(fixture&&fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}};
const median=values=>{const s=[...values].sort((a,b)=>a-b);return s.length?s[s.length>>1]:NaN;};
(async()=>{
 let browser,fixture,auto;
 try{
  const first=await start([]);fixture=first.fixture;const url=first.url,now=first.now;
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async({motion='reduce',prefs={},viewport={width:1300,height:900},webgl=true,base=url}={})=>{
    const context=await browser.newContext({viewport,reducedMotion:motion});await pinDate(context,now);
    await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',...prefs}));
    if(!webgl)await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...rest){return /webgl/.test(kind)?null:original.call(this,kind,...rest);};});
    const page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(base))external.push(r.url());});
    return {context,page,errors,external};
  };
  const home=async(page,base=url)=>{await page.goto(base);await page.locator('.issue-cover').waitFor();};
  const cover=page=>page.locator('.cover-art');
  const settled=(page,selector='.cover-art')=>page.waitForFunction(s=>['live','still','image','unavailable','error','placeholder','working'].includes(document.querySelector(s)?.dataset.state),selector,{timeout:20000});
  const shown=(page,path)=>page.waitForFunction(p=>document.querySelector('.document-footer')?.textContent.startsWith(p)&&!document.querySelector('.resume-pending'),path);
  const read=async(page,path)=>{await page.evaluate(p=>{location.hash='#read='+encodeURIComponent(p);},path);await shown(page,path);await page.locator('#main').focus();};
  const art=(page,path)=>page.evaluate(p=>fetch('/api/art?path='+encodeURIComponent(p)).then(r=>r.json()),path);

  // Reduced motion: the cover's art is one still image drawn from the stored scene, above the kicker, with its
  // brief as the text alternative; features with art get thumbnails; pieces without art show nothing special.
  {const {context,page,errors,external}=await open();
   await home(page);await settled(page);
   assert.equal(await cover(page).getAttribute('data-state'),'still');
   assert.equal(await page.locator('.cover-art canvas').count(),0,'no live canvas under reduced motion');
   assert.match(await page.locator('.cover-art img.art-still').getAttribute('src'),/^data:image\/png;base64,/);
   await page.waitForTimeout(600);assert.equal(await cover(page).getAttribute('data-frames'),'1','a single still frame');
   await page.waitForFunction(()=>document.querySelector('.feature-art[data-state=still] img'));
   assert.equal(await page.locator('[data-art-thumb="library/issue/keep.md"]').count(),1);
   assert.equal(await page.locator('.feature-art').count(),1,'only pieces with art get a thumbnail');
   assert.equal(await page.locator('.cover-shape,.feature-shape').count(),0,'the RW-20 helix is no longer the cover art');
   const order=await page.evaluate(()=>{const f=document.querySelector('.cover-art'),k=document.querySelector('.issue-cover .issue-kicker');return {above:f.getBoundingClientRect().bottom<=k.getBoundingClientRect().top+1,decoration:!!f.closest('[data-reader-decoration]')};});
   assert.deepEqual(order,{above:true,decoration:true});
   const label=await page.locator('.cover-art .art-surface').getAttribute('aria-label');assert.equal(label,'Art: Notes at the back');
   const described=await page.evaluate(()=>document.getElementById(document.querySelector('.cover-art .art-surface').getAttribute('aria-describedby')).textContent);
   assert.match(described,/stack of books/);assert.match(described,/Made by Painter \(fake-model-1\) · for this edition · .* · 2 min 11 s · 26k tokens · \$0\.31/);
   assert.equal(await page.locator('.cover-art .art-note').isVisible(),false);
   await page.click('.cover-art .art-note-toggle');assert.equal(await page.locator('.cover-art .art-note').isVisible(),true);
   assert.equal(await page.locator('.cover-art .art-note-toggle').getAttribute('aria-expanded'),'true');
   await page.screenshot({path:'.reader/web-dev/art-cover-still.png'});
   // The first browser to draw a version gives the server a still image for browsers without WebGL.
   await page.waitForFunction(()=>fetch('/api/art?path=library%2Fissue%2Fcover.md').then(r=>r.json()).then(d=>d.art.still),null,{timeout:15000,polling:500});
   const theme=await page.locator('.cover-art img.art-still').getAttribute('src');
   await page.evaluate(()=>{document.documentElement.dataset.theme='ink';});
   await page.waitForFunction(old=>{const src=document.querySelector('.cover-art img.art-still')?.getAttribute('src');return src&&src!==old;},theme,{timeout:15000});
   await page.screenshot({path:'.reader/web-dev/art-cover-ink.png'});
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Motion: one live canvas, at most 30 fps, paused off-screen, frame time within budget (or the kill switch made it a still).
  {const {context,page,errors,external}=await open({motion:'no-preference'});
   await home(page);await settled(page);const state=await cover(page).getAttribute('data-state');
   if(state==='live'){
     assert.equal(await page.locator('canvas.art-canvas').count(),1,'one WebGL canvas per page');
     const a=+await cover(page).getAttribute('data-frames');await page.waitForTimeout(1000);const b=+await cover(page).getAttribute('data-frames');
     assert.ok(b>a,'it moves');assert.ok(b-a<=33,`capped at 30 fps (${b-a} frames in a second)`);
     await page.waitForTimeout(1500);
     const {cpu,interval}=await page.evaluate(()=>document.querySelector('.cover-art').artFrameTimes());
     const m=median(cpu),p95=[...cpu].sort((x,y)=>x-y)[Math.floor(cpu.length*.95)],gap=median(interval);
     console.log(`live cover: ${b-a} frames in one second; update+submit median ${m.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms; frame interval median ${gap.toFixed(1)} ms over ${interval.length} frames (SwiftShader)`);
     assert.ok(m<34,'median update+submit time within the 34 ms budget');assert.ok(gap<125,'the page keeps at least 8 fps');
     await page.screenshot({path:'.reader/web-dev/art-cover-live.png'});
     await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(400);
     const c=+await cover(page).getAttribute('data-frames');await page.waitForTimeout(600);assert.equal(+await cover(page).getAttribute('data-frames'),c,'paused off-screen');
     await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(500);assert.ok(+await cover(page).getAttribute('data-frames')>c,'resumes in view');
   }else{assert.equal(state,'still','a slow renderer drops to a still image');console.log('live cover: frame budget exceeded on this renderer; still image');}
   // A scene at the edges of every budget (about 384k triangles in 4,800 instances, 24k swirling particles) stays bounded:
   // it either keeps moving or the kill switch turns it into a still, without errors.
   const heavy=await page.evaluate(async()=>{
     const {validate}=await import('/assets/art-scene.mjs'),{artPalette}=await import('/assets/art.mjs'),stage=(await import('/assets/controls/art.js')).artStage();
     const scene=validate({reader_scene:1,seed:3,objects:[{type:'instances',geometry:{type:'icosahedron',radius:.04,detail:1},count:4800,layout:{kind:'sphere',radius:2,jitter:1},each:{kind:'pulse',amplitude:.2,period:4,stagger:1}},
       {type:'particles',count:24000,shape:'shell',radius:3,pointSize:.02,motion:{kind:'swirl',speed:.3}}]}).scene;
     const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:960px;height:480px;z-index:5';document.body.append(host);
     document.querySelector('.cover-art').artView?.destroy();
     let still=null;const began=performance.now(),view=stage.mount(host,scene,artPalette(),{onStill:(_,reason)=>{still=reason;}});const built=performance.now()-began;
     await new Promise(r=>setTimeout(r,3000));const result={built,still,frames:view.frames,cpu:view.frameTimes(),interval:view.intervals()};view.destroy();host.remove();return result;});
   console.log(`budget-edge scene: built in ${heavy.built.toFixed(0)} ms; ${heavy.still?'kill switch: still image ('+heavy.still+')':`${heavy.frames} frames in 3 s, update+submit median ${median(heavy.cpu).toFixed(1)} ms, frame interval median ${median(heavy.interval).toFixed(1)} ms`}`);
   assert.ok(heavy.still||median(heavy.interval)<125,'a heavy scene keeps 8 fps or becomes a still');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Without WebGL: the stored still image; an article whose art has no still yet says so and opens its note.
  {const {context,page,errors}=await open({webgl:false,prefs:{artHero:false}});  // Space g's view; tests/web_hero.cjs covers the hero.
   await home(page);await settled(page);
   assert.equal(await cover(page).getAttribute('data-state'),'image');
   assert.match(await page.locator('.cover-art img.art-still').getAttribute('src'),/^\/api\/art\/still\?path=library%2Fissue%2Fcover\.md/);
   assert.ok(await page.evaluate(()=>document.querySelector('.cover-art img.art-still').decode().then(()=>document.querySelector('.cover-art img.art-still').naturalWidth)),'the still image loads');
   assert.equal(await page.locator('.feature-art').count(),0,'a thumbnail without a still or WebGL is left out');
   await read(page,'library/issue/keep.md');await page.keyboard.press('Space');await page.keyboard.press('g');await settled(page,'.article-art');
   assert.equal(await page.locator('.article-art').getAttribute('data-state'),'unavailable');
   await page.waitForFunction(()=>document.querySelector('.article-art .art-note')?.checkVisibility({visibilityProperty:true}),null,{timeout:5000});assert.match(await page.locator('.article-art .art-message').textContent(),/cannot draw 3D art here/);assert.equal(await page.locator('.article-art .art-note').isVisible(),true);
   await page.screenshot({path:'.reader/web-dev/art-no-webgl.png'});
   assert.deepEqual(errors,[]);await context.close();}

  // A scene that reached the page some other way is validated again before anything is built from it.
  {const {context,page,errors}=await open();
   await page.route('**/api/art?path=library%2Fissue%2Fcover.md*',async route=>{const response=await route.fetch();const data=await response.json();data.art.scene.objects[0].geometry={type:'teapot'};await route.fulfill({response,json:data});});
   await home(page);await settled(page);
   assert.equal(await cover(page).getAttribute('data-state'),'image','the stored still stands in for a scene the page refuses');
   assert.equal(await page.locator('.cover-art canvas').count(),0);
   assert.deepEqual(errors,[]);await context.close();}

  // Space g on an article without art: a calm placeholder, Generate art, a background job with toasts, then the art.
  {const {context,page,errors,external}=await open();
   await home(page);await read(page,'library/issue/edict.md');
   await page.keyboard.press('Space');await page.keyboard.press('g');await settled(page,'.article-art');
   assert.equal(await page.locator('.article-art').getAttribute('data-state'),'placeholder');
   assert.match(await page.locator('.article-art .art-placeholder').textContent(),/No art for this piece yet\.Painter would read it, write an art brief, then compose a scene/);
   assert.equal(await page.evaluate(()=>document.querySelector('#article').firstElementChild.classList.contains('article-art')),true,'above the kicker');
   await page.screenshot({path:'.reader/web-dev/art-placeholder.png'});
   await page.click('.article-art [data-art-generate]');
   await page.waitForFunction(()=>document.querySelector('.article-art')?.dataset.state==='working');
   await page.waitForFunction(()=>document.querySelector('[data-sonner-toaster]')?.textContent.includes('Making art for ‘Collections of rules, revisited’'));
   assert.equal(await page.locator('.article-art [data-art-cancel]').count(),1);
   await page.waitForFunction(()=>document.querySelector('[data-sonner-toaster]')?.textContent.includes('Art ready for ‘Collections of rules, revisited’'),null,{timeout:30000});
   await page.waitForFunction(()=>document.querySelector('.article-art')?.dataset.state==='still',null,{timeout:15000});
   let data=await art(page,'library/issue/edict.md');
   assert.equal(data.count,1);assert.equal(data.art.title,'A synthetic artwork');assert.equal(data.art.provenance.producer.label,'Painter');
   assert.match(data.art.folder,/^art\/issue\/edict\.md\/[0-9a-f]{64}\/\d{8}T\d{6}Z-[0-9a-f]{4}$/);
   await page.click('.article-art .art-note-toggle');assert.match(await page.locator('.article-art .art-note').textContent(),/Two slow forms circle a quiet center/);
   await page.screenshot({path:'.reader/web-dev/art-article.png'});
   // :generate-art makes a second version beside the first; the note walks versions and keeps a favorite.
   await page.locator('#main').focus();await page.keyboard.press(':');await page.keyboard.type('generate-art');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>fetch('/api/art?path=library%2Fissue%2Fedict.md').then(r=>r.json()).then(d=>d.count===2),null,{timeout:30000,polling:500});
   await page.waitForFunction(()=>document.querySelector('.article-art .art-provenance')?.textContent.includes('version 1 of 2'),null,{timeout:15000});
   data=await art(page,'library/issue/edict.md');const newest=data.art.generation,older=data.versions[1].generation;
   if(!(await page.locator('.article-art .art-note').isVisible()))await page.click('.article-art .art-note-toggle');
   await page.getByRole('button',{name:'Older ›'}).click();
   await page.waitForFunction(g=>document.querySelector('.article-art')?.dataset.generation===g,older);
   await page.click('.article-art .art-note-toggle');await page.getByRole('button',{name:'Keep this one'}).click();
   await page.waitForFunction(()=>document.querySelector('[data-sonner-toaster]')?.textContent.includes('This version is the one shown from now on.'));
   data=await art(page,'library/issue/edict.md');assert.equal(data.favorite.generation,older);assert.equal(data.art.generation,older);assert.notEqual(newest,older);
   // Space g again hides it.
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('g');assert.equal(await page.locator('.article-art').count(),0);
   // :shape is the RW-20 data view, separate from the art.
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // No voice or local model can make art: the placeholder says so calmly and points at Companions.
  {const {context,page,errors}=await open();
   await context.route('**/api/art/jobs',route=>route.fulfill({json:{jobs:[],active:0,producers:[],default:null,error:null}}));
   await context.route(/\/api\/art\?path=/,route=>route.fulfill({json:{path:'library/issue/edict.md',sha256:'',art:null,versions:[],count:0,favorite:null,job:null}}));
   await home(page);await read(page,'library/issue/edict.md');
   await page.keyboard.press('Space');await page.keyboard.press('g');await settled(page,'.article-art');
   assert.match(await page.locator('.article-art .art-placeholder').textContent(),/No voice or local model can make art here yet\./);
   assert.equal(await page.locator('.article-art [data-art-generate]').count(),0);
   await page.click('.article-art [data-art-setup]');
   await page.locator('#companions').waitFor();assert.match(await page.evaluate(()=>location.hash),/^#backstage/);
   assert.deepEqual(errors,[]);await context.close();}

  // Behind the scenes: the Art studio card lists the commissions with time and cost; Settings chooses who makes art.
  {const {context,page,errors}=await open();
   await page.goto(url+'#backstage');await page.locator('#backstage-art').waitFor();
   await page.waitForFunction(()=>document.querySelectorAll('#backstage-art [data-art-job]').length>=2);
   const card=await page.locator('#backstage-art').textContent();
   assert.match(card,/Art can be made by Painter \(fake-model-1\)/);assert.match(card,/Ready/);assert.match(card,/4,000 tokens · \$0\.02/);assert.match(card,/logs\/llm\/art\//);
   assert.equal(await page.locator('#art-by').count(),1);assert.equal(await page.locator('#art-auto').count(),1);assert.equal(await page.locator('#setting-art').count(),1);
   assert.equal(await page.locator('#setting-shapes').count(),0,'the shapes experiment setting is gone');
   await page.locator('#backstage-art').screenshot({path:'.reader/web-dev/art-studio.png'});
   assert.deepEqual(errors,[]);await context.close();}

  // Phone width keeps the page inside 390px.
  {const {context,page,errors}=await open({viewport:{width:390,height:844}});
   await home(page);await settled(page);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal scroll at 390px');
   const box=await cover(page).boundingBox();assert.ok(box.x>=15&&box.x+box.width<=375,'inside the 16px gutters');
   await page.screenshot({path:'.reader/web-dev/art-phone.png'});
   assert.deepEqual(errors,[]);await context.close();}

  // Make art automatically for the cover and features: one commission per piece without art, once per session.
  await stop(fixture);fixture=null;
  auto=await start(['--art-none','--art-delay','0.02']);
  {const {context,page,errors}=await open({base:auto.url,prefs:{artAuto:'issue'}});
   const posts=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/art'))posts.push(JSON.parse(r.postData()));});
   await home(page,auto.url);
   assert.equal(await page.locator('.cover-art').count(),0,'no art yet: nothing special on the cover');
   await page.waitForFunction(()=>document.querySelector('[data-sonner-toaster]')?.textContent.includes('Making art for'),null,{timeout:15000});
   assert.equal(posts.length,1);assert.equal(posts[0].action,'commission');assert.ok(posts[0].paths.length>=2&&posts[0].paths.includes('library/issue/cover.md'));
   await page.waitForFunction(()=>fetch('/api/art/jobs').then(r=>r.json()).then(s=>s.jobs.length>=2&&!s.active),null,{timeout:60000,polling:500});
   await page.waitForFunction(()=>document.querySelector('.cover-art')?.dataset.state==='still',null,{timeout:20000});
   const count=await page.evaluate(()=>fetch('/api/art/jobs').then(r=>r.json()).then(s=>s.jobs.length));
   await page.reload();await page.locator('.issue-cover').waitFor();await page.waitForTimeout(1500);
   assert.equal(await page.evaluate(()=>fetch('/api/art/jobs').then(r=>r.json()).then(s=>s.jobs.length)),count,'pieces with art for their edition (or a recent failure) are not commissioned again');
   console.log(`automatic art: ${count} commissions for the cover and features`);
   assert.deepEqual(errors,[]);await context.close();}
  {const {context,page,errors}=await open({base:auto.url,prefs:{art:false}});
   await home(page,auto.url);await page.waitForTimeout(500);assert.equal(await page.locator('.cover-art,.feature-art,[data-art-generate]').count(),0,'the setting turns art off');
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Article art passed: no-producer placeholder pointing at Companions, still cover and thumbnail under reduced motion with the brief as its text alternative, Artist’s note and provenance, still captured for later, theme repaint, live canvas at most 30 fps within the frame budget and paused off-screen, stored still without WebGL, client-side validation, placeholder → Generate art → job toasts → art, versions and a favorite, Art studio and settings, automatic commissions once, art off, 390px, local-only requests.');
 }finally{await browser?.close();await stop(fixture);await stop(auto?.fixture);}
})().catch(error=>{console.error(error);process.exitCode=1;});
