/* Continuous reading skips layout of offscreen blocks (content-visibility:auto). On the ~2 MB synthetic document
   the document is shown sooner, and nothing a reader can see moves: source coordinates, pins beside their
   passages, find, heading and outline jumps, the bookmark and the reading cursor land as they do with every
   block laid out. Smooth scrolling keeps the place while blocks above the window settle. Two-page reading is
   unaffected. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {sanitizerReport,waitFor,settled}=require('./web_wait.cjs');  // #151
// Lays every block out, as before the rule: the baseline each check compares against.
const LAID_OUT='#article>*{content-visibility:visible!important;contain-intrinsic-size:none!important}';
const PATH='library/large.md';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--perf'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking']});
  const open=async(prefs,{laidOut=false,path=PATH,suffix=''}={})=>{
    const context=await browser.newContext({viewport:{width:1300,height:820}});
    await context.addInitScript(([value,laidOut,css])=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}
      if(laidOut)document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);});},[JSON.stringify(prefs),laidOut,LAID_OUT]);
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!sanitizerReport(m))errors.push(m.text());});
    await page.goto(url+'#read='+encodeURIComponent(path)+suffix);
    await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'),null,{timeout:60000,polling:50});
    return {context,page,errors};
  };
  // A position is read once it holds still across three readings 400 ms apart, each after two rendered frames
  // (smooth scrolling glides, late blocks settle, and a busy machine may skip frames).
  const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const steady=async(page,fn,arg)=>{const seen=[];for(let i=0;i<80;i++){await frames(page);seen.push(JSON.stringify(await page.evaluate(fn,arg)));const last=seen.slice(-3);if(last.length===3&&last[0]!=='null'&&last.every(v=>v===last[0]))return JSON.parse(last[0]);await page.waitForTimeout(400);}throw new Error('never settled: '+seen.at(-1));};
  const heading=title=>{const h=[...document.querySelectorAll('#article h2')].find(h=>h.textContent===title);return h?Math.round(h.getBoundingClientRect().top):null;};
  const find=async(page,query)=>{await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').fill(query);
    await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='1 / 1',null,{timeout:10000});await page.keyboard.press('Enter');};

  // Scope: continuous reading only; margin pins stay visible; two-page columns lay out every block.
  {const {context,page,errors}=await open({layout:'scroll',smooth:false});
   await page.waitForFunction(()=>document.querySelectorAll('.annotation-pin').length===1,null,{timeout:10000});
   const scope=await page.evaluate(()=>({block:getComputedStyle(document.querySelector('#article > p[data-source-start]')).contentVisibility,pin:getComputedStyle(document.querySelector('.annotation-pin')).contentVisibility}));
   // Warm opens inside the app, alternating with and without the rule: the document is shown at least 20% sooner.
   const show=(laidOut,path)=>page.evaluate(async([laidOut,path,css])=>{
     let style=document.getElementById('laid-out');if(laidOut&&!style){style=document.createElement('style');style.id='laid-out';style.textContent=css;document.head.append(style);}if(!laidOut)style?.remove();
     const old=document.querySelector('.document-shell'),started=performance.now();location.hash='#read='+encodeURIComponent(path);
     await new Promise(resolve=>{const tick=()=>{const shell=document.querySelector('.document-shell');if(shell&&shell!==old&&!shell.classList.contains('resume-pending'))resolve();else requestAnimationFrame(tick);};tick();});
     return performance.now()-started;},[laidOut,path,LAID_OUT]);
   const times={skipped:[],laidOut:[]};
   for(let round=0;round<3;round++)for(const laidOut of [false,true]){await show(laidOut,'library/other.md');await page.waitForTimeout(300);times[laidOut?'laidOut':'skipped'].push(await show(laidOut,PATH));await page.waitForTimeout(1200);}
   const median=list=>[...list].sort((a,b)=>a-b)[1];
   const skipped=Math.round(median(times.skipped)),laidOut=Math.round(median(times.laidOut));
   console.log(`Warm open of the 2 MB document: shown after ${skipped} ms with offscreen blocks skipped, ${laidOut} ms with every block laid out (${JSON.stringify(times)})`);
   assert.ok(skipped<=laidOut*.8,`time to visible improves by at least 20%: ${skipped} ms vs ${laidOut} ms`);
   assert.deepEqual(scope,{block:'auto',pin:'visible'},'scroll-mode blocks skip offscreen layout; pins never do');
   assert.deepEqual(errors,[]);await context.close();}
  {const {context,page,errors}=await open({layout:'spread',smooth:false,pageTurn:'slide'});
   assert.ok(await page.evaluate(()=>document.body.classList.contains('two-page')));
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#article > p[data-source-start]')).contentVisibility),'visible','two-page reading lays out every block');
   assert.deepEqual(errors,[]);await context.close();}

  // Spacing is unchanged: blocks whose children's margins collapse through them (quotes, lists, embeds, figures,
  // wrappers) are never contained, and every block keeps its top and height once laid out.
  {const {context,page,errors}=await open({layout:'scroll',smooth:false});
   const rows=await page.evaluate(async css=>{
     const article=document.querySelector('#article'),t=document.createElement('template');
     t.innerHTML='<blockquote><p>Quoted one.</p><p>Quoted two.</p></blockquote><ul><li><p>Loose one.</p></li><li><p>Loose two.</p></li></ul><ul><li>Tight <ul><li>nested</li></ul></li></ul><ol><li>One</li></ol><table><tr><td>a</td></tr></table><hr><details><summary>More</summary><p>Inside</p></details><div class="document-embed"><h1>Embedded</h1><p>Para</p></div><figure><figcaption>Caption</figcaption></figure><div><p>Wrapped</p></div><h2>Heading</h2><p>Paragraph</p><pre>code</pre>';
     article.prepend(...t.content.children);
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     const measure=()=>[...article.children].filter(el=>!el.classList.contains('annotation-pin')).slice(0,40).map(el=>{const r=el.getBoundingClientRect();return el.tagName+' '+r.top.toFixed(1)+' '+r.height.toFixed(1);});
     const skipped=measure(),style=document.createElement('style');style.textContent=css;document.head.append(style);return {skipped,laidOut:measure()};},LAID_OUT);
   // Compare the blocks in the window, which are laid out; the rest wait at an estimated height until they near it.
   const shown=rows.skipped.findIndex(row=>+row.split(' ')[1]>=820);
   assert.ok(shown>=9,'the synthetic blocks are laid out: '+shown);
   assert.deepEqual(rows.skipped.slice(0,shown),rows.laidOut.slice(0,shown),'blocks near the window have the same top and height with and without the rule');
   assert.deepEqual(errors,[]);await context.close();}
  // Smooth scrolling shows the page a little behind its scroll position while it glides (#156). A jump made then
  // measures what is shown, so it lands at its line however far the glide still has to go. GSAP's ticker is put
  // to sleep to hold the glide still: the shown page stays where it is while the scroll position moves 3000 px.
  {const {context,page,errors}=await open({layout:'scroll',smooth:true});
   await page.waitForFunction(()=>document.querySelectorAll('.annotation-pin').length===1,null,{timeout:10000});
   const hit=()=>{const current=CSS.highlights.get('reader-current');return current?.size?Math.round([...current][0].getBoundingClientRect().top):null;};
   await find(page,'distinct observation for section 390');await steady(page,hit);
   // Start at rest: the shown page has caught up with the scroll position, and late layout has settled.
   const caughtUp=()=>{const content=document.querySelector('#smooth-content').getBoundingClientRect();return {shown:Math.abs(content.top+scrollY)<1,_y:scrollY,_shown:-content.top,_content:content.height,_page:document.documentElement.scrollHeight,_window:innerHeight};};
   await waitFor(page,'the glide has arrived',caughtUp);await settled(page,'find hit settled');await waitFor(page,'still arrived',caughtUp);const line=await page.evaluate(hit);
   const lag=await page.evaluate(()=>{const content=document.querySelector('#smooth-content'),shown=()=>-content.getBoundingClientRect().top;
     gsap.ticker.sleep();const before=shown();scrollTo(0,scrollY-3000);return Math.round(scrollY-before);});
   assert.ok(Math.abs(lag+3000)<=2,'the shown page lags the scroll position by 3000 px: '+lag);
   await page.locator('#main').focus();await page.keyboard.press('n');await page.evaluate(()=>gsap.ticker.wake());
   const landed=await steady(page,hit);
   assert.ok(Math.abs(landed-line)<=8,`smooth scrolling: the next find hit, taken mid-glide, lands at ${landed}, not its line ${line}`);
   assert.deepEqual(errors,[]);await context.close();}
  // ScrollSmoother maps the scroll position onto the page height it last measured, and measures again only once the
  // article stops changing height. Here the article grows by 30000 px and keeps changing for 2.5 s after G, as far
  // blocks do while they are laid out during a long glide, so the smoother measures again only after its glide has
  // ended. The page must still arrive where it is scrolled to, not wait at the old end (#156).
  {const {context,page,errors}=await open({layout:'scroll',smooth:true},{path:'library/other.md'});
   const caughtUp=()=>{const content=document.querySelector('#smooth-content').getBoundingClientRect();return {shown:Math.abs(content.top+scrollY)<1,_y:scrollY,_shown:-content.top,_page:document.documentElement.scrollHeight,_window:innerHeight};};
   await waitFor(page,'the smoother is at rest',caughtUp);await settled(page,'opened');
   await page.evaluate(()=>{const tall=document.createElement('div');tall.id='late-growth';tall.style.height='30000px';document.querySelector('#article').append(tall);
     const until=performance.now()+2500;const wobble=()=>{tall.style.height=(tall.style.height==='30000px'?30001:30000)+'px';if(performance.now()<until)requestAnimationFrame(wobble);else tall.dataset.done='';};requestAnimationFrame(wobble);});
   await page.locator('#main').focus();await page.keyboard.press('G');
   await page.locator('#late-growth[data-done]').waitFor({state:'attached'});
   await waitFor(page,'the page arrives at the end it was sent to',()=>{const content=document.querySelector('#smooth-content').getBoundingClientRect(),end=document.documentElement.scrollHeight-innerHeight;
     return {end:Math.abs(scrollY-end)<2,shown:Math.abs(content.top+scrollY)<1,_y:scrollY,_shown:-content.top,_end:end};},{timeout:10000});
   assert.deepEqual(errors,[]);await context.close();}
  // What the reader sees, with the rule and with every block laid out, in native and smooth scrolling.
  const facts=async(smooth,laidOut)=>{
    const {context,page,errors}=await open({layout:'scroll',smooth},{laidOut});const out={};
    await page.waitForFunction(()=>document.querySelectorAll('.annotation-pin').length===1,null,{timeout:10000});
    out.sources=await page.evaluate(()=>[...document.querySelectorAll('#article [data-source-start]')].map(el=>el.tagName+':'+el.dataset.sourceStart+'-'+el.dataset.sourceEnd).join('|'));
    out.pins=await page.locator('.annotation-pin').count();
    out.cursor=await page.evaluate(async()=>{const {textModel}=await import('/assets/cursor.mjs');const model=textModel(document.querySelector('#article'));return {length:model.text.length,tail:model.text.slice(-80)};});
    // Find a passage in a block that was skipped: it scrolls to the find line, and its pin sits beside it.
    await find(page,'distinct observation for section 390');
    out.find=await steady(page,()=>{const current=CSS.highlights.get('reader-current'),other=CSS.highlights.get('reader-other');if(!current?.size||!other?.size)return null;const hit=[...current][0].getBoundingClientRect(),own=[...other][0],line=[...own.getClientRects()].at(-1),pin=document.querySelector('.annotation-pin').getBoundingClientRect();
      return {top:Math.round(hit.top),pin:Math.round(pin.top+pin.height/2-line.bottom),pinX:Math.round(pin.left-line.right)>0};});
    await page.keyboard.press('Escape');
    // A heading link and the outline's next heading.
    await page.evaluate(path=>{window.__old=document.querySelector('.document-shell');location.hash='#read='+encodeURIComponent(path)+'&h=section-120';},PATH);
    await page.waitForFunction(()=>{const shell=document.querySelector('.document-shell');return shell&&shell!==window.__old&&!shell.classList.contains('resume-pending');},null,{timeout:60000});
    out.heading=await steady(page,heading,'Section 120');
    await page.locator('#main').focus();await page.keyboard.press(']');await page.keyboard.press(']');
    out.next=await steady(page,title=>({section:document.querySelector('#status-section')?.textContent,top:(()=>{const h=[...document.querySelectorAll('#article h2')].find(h=>h.textContent===title);return Math.round(h.getBoundingClientRect().top);})()}),'Section 121');
    // Smooth scrolling has no browser scroll anchoring: scrolling up past blocks that were never laid out keeps the text still.
    if(smooth){
      out.up=[];
      for(let step=0;step<6;step++){
        const before=await page.evaluate(()=>{const blocks=[...document.querySelectorAll('#article > [data-source-start]')];const i=blocks.findIndex(el=>{const r=el.getBoundingClientRect();return r.top>40&&r.top<500;});window.__probe=blocks[i];return i>=0?Math.round(blocks[i].getBoundingClientRect().top):null;});
        await page.mouse.move(650,400);await page.mouse.wheel(0,-600);
        if(before===null){await page.waitForTimeout(1500);continue;}
        out.up.push(await steady(page,()=>Math.round(window.__probe.getBoundingClientRect().top))-before);
      }
    }
    // The bookmark: a late place saved, then restored on reopening with its block at the same reading line.
    const marks=[];page.on('request',r=>{if(r.url().includes('/api/bookmark')&&r.method()==='POST')marks.push(r.postDataJSON());});
    await page.evaluate(()=>{const h=[...document.querySelectorAll('#article h2')].find(h=>h.textContent==='Section 300');const content=document.querySelector('#smooth-content').getBoundingClientRect().top;scrollTo(0,h.getBoundingClientRect().top-content-innerHeight*.22+4);});
    await page.waitForTimeout(2000);
    // A reading line between two blocks saves no block; move a little until it falls inside one.
    for(let nudge=0;nudge<6&&marks.at(-1)?.source_offset==null;nudge++){await page.evaluate(()=>scrollBy(0,12));await page.waitForTimeout(1200);}
    const mark=marks.at(-1);assert.ok(mark?.source_offset>1e6,'a late place was saved: '+JSON.stringify(mark));
    // Reopen without the heading link, which would win over the bookmark.
    await page.evaluate(path=>history.replaceState(null,'','#read='+encodeURIComponent(path)),PATH);await page.reload();await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'),null,{timeout:60000});
    out.bookmark=await steady(page,mark=>{const block=[...document.querySelectorAll('#article [data-source-start]')].filter(el=>+el.dataset.sourceStart===mark.source_offset).sort((a,b)=>(+a.dataset.sourceEnd-a.dataset.sourceStart)-(+b.dataset.sourceEnd-b.dataset.sourceStart))[0];
      if(!block)return null;const r=block.getBoundingClientRect();return Math.round(r.top+r.height*mark.block_fraction-innerHeight*.22);},mark);
    out.errors=errors;await context.close();return out;
  };
  // The reference: native scrolling with every block laid out (smooth scrolling glides, so it gets a little slack).
  const reference=await facts(false,true);
  for(const smooth of [false,true]){
    const label=smooth?'smooth scrolling':'native scrolling',skipped=await facts(smooth,false),slack=smooth?8:2;
    console.log(label,JSON.stringify({skipped:{...skipped,sources:skipped.sources.length},reference:{...reference,sources:reference.sources.length}}));
    assert.equal(skipped.sources,reference.sources,label+': the data-source-* sequence is unchanged');
    assert.equal(skipped.pins,1);assert.equal(reference.pins,1);
    assert.deepEqual(skipped.cursor,reference.cursor,label+': the reading cursor reads the same text');
    const near=(a,b,what,within=slack)=>assert.ok(Math.abs(a-b)<=within,`${label}: ${what} ${a} vs ${b} with every block laid out`);
    near(skipped.find.top,reference.find.top,'a find hit in a skipped block lands at');
    near(skipped.find.pin,reference.find.pin,'the pin sits beside its passage at',1);assert.ok(skipped.find.pinX,'the pin is in the margin');
    near(skipped.heading,reference.heading,'a heading link lands at');
    assert.equal(skipped.next.section,reference.next.section);near(skipped.next.top,reference.next.top,'the next heading lands at');
    near(skipped.bookmark,reference.bookmark,'the bookmark restores its reading line, off by',3);near(reference.bookmark,0,'(reference) the bookmark restores its reading line, off by',3);
    if(smooth)for(const moved of skipped.up)near(moved,600,'scrolling up 600 px moves the text by',3);
    assert.deepEqual(skipped.errors,[]);
  }
  assert.deepEqual(reference.errors,[]);
  console.log('Content visibility passed: shown sooner, same source coordinates, pins, find, heading and outline jumps, bookmark and reading cursor; smooth scrolling keeps its place; two-page unaffected.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
