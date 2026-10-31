/* Math typeset by KaTeX: display, inline, invalid and currency cases, copying TeX,
   annotations beside math, two-page fit, the page-turn texture and lazy local loading.
   A math-heavy document is shown before its formulas typeset, and keeps the reader's place. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,writeFileSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--math'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async(prefs,path,viewport={width:1300,height:860},suffix='')=>{
    const context=await browser.newContext({viewport});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}
      // The moment the document is shown: how many formulas were still waiting for KaTeX.
      new MutationObserver((_,observer)=>{if(!document.querySelector('#article')||document.querySelector('.resume-pending'))return;observer.disconnect();
        window.__shown={formulas:document.querySelectorAll('.reader-math').length,pending:document.querySelectorAll('.reader-math:not([data-state])').length};}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});},JSON.stringify({smooth:false,theme:'user-reader-test',...prefs}));
    const page=await context.newPage(),errors=[],external=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{requests.push(r.url());if(!r.url().startsWith(url))external.push(r.url());});
    await page.goto(url+'#read='+encodeURIComponent(path)+suffix);await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
    return {page,errors,external,requests,context};};
  const settled=page=>page.waitForFunction(()=>document.querySelectorAll('.reader-math').length>0&&!document.querySelector('.reader-math:not([data-state])'));

  {const {page,errors,external,requests,context}=await open({layout:'scroll'},'library/math.md');
   await settled(page);
   const math=await page.$$eval('.reader-math',list=>list.map(el=>({block:el.classList.contains('reader-math-block'),state:el.dataset.state,tex:el.dataset.tex,katex:!!el.querySelector(':scope > [data-reader-decoration] .katex'),mathml:!!el.querySelector('math annotation[encoding="application/x-tex"]'),title:el.title,text:el.textContent,source:el.hasAttribute('data-source-start')})));
   assert.deepEqual(math.map(m=>[m.block,m.state]),[[false,'ready'],[false,'ready'],[true,'ready'],[true,'ready'],[false,'error'],[true,'error']]);
   for(const m of math.filter(m=>m.state==='ready')){assert.ok(m.katex,'KaTeX HTML for '+m.tex);assert.ok(m.mathml,'MathML for screen readers');}
   assert.deepEqual(math.filter(m=>m.block).map(m=>m.source),[true,true,true],'display blocks keep source coordinates');
   assert.equal(math[4].text,'$\\frac{1}{$');assert.match(math[4].title,/^Couldn’t typeset this formula: /);
   assert.equal(math[5].text,'$$\\undefinedmacro{x}$$');assert.match(math[5].title,/undefinedmacro/);
   assert.ok(await page.evaluate(()=>getComputedStyle(document.querySelectorAll('.reader-math')[4]).textDecorationStyle==='dotted'),'invalid TeX has a dotted underline');
   assert.equal(await page.locator('#article p',{hasText:'Prices stay prices'}).evaluate(p=>p.querySelector('.reader-math')?'math':p.textContent),'Prices stay prices: it costs $20 and $30, or $1,500 in total.');
   assert.equal(await page.locator('#article p',{hasText:'Code stays code'}).locator('code').first().textContent(),'$x^2$');
   assert.ok(requests.some(r=>r.endsWith('/assets/controls/math.js'))&&requests.some(r=>r.endsWith('/assets/controls/katex/katex.css'))&&requests.some(r=>/\/controls\/katex\/fonts\/KaTeX_[\w-]+\.woff2$/.test(r)),'chunk, CSS and woff2 fonts load locally');
   assert.ok(!requests.some(r=>/\.(woff|ttf)$/.test(r)),'only woff2 fonts');
   await page.screenshot({path:'.reader/web-dev/math-scroll.png',fullPage:true});
   // Copying a selection that touches a formula yields its TeX.
   const copied=await page.evaluate(()=>{
     const copy=range=>{getSelection().removeAllRanges();getSelection().addRange(range);const data=new DataTransfer();document.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain');};
     const p=document.querySelector('.reader-math-inline').parentElement,whole=document.createRange();whole.selectNodeContents(p);
     const inside=document.createRange(),glyph=document.querySelector('.reader-math-block .katex-html');inside.selectNodeContents(glyph);
     return {paragraph:copy(whole),block:copy(inside)};});
   assert.equal(copied.paragraph,'Euler wrote $e^{i\\pi} + 1 = 0$ in one line, and $a^2 + b^2 = c^2$ in another.');
   assert.equal(copied.block,'$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$');
   // Find skips typeset glyphs; a highlight beside inline math keeps exact source offsets.
   await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').fill('careful remark');await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='1 / 1');await page.keyboard.press('Escape');
   await page.locator('#article p',{hasText:'Euler wrote'}).evaluate(p=>{const text=p.firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,'Euler wrote'.length);getSelection().removeAllRanges();getSelection().addRange(range);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
   await page.locator('#selection-tools').waitFor();await page.locator('[data-annotate=highlight]').click();
   const offsets=await (await page.waitForFunction(async()=>{const library=await (await fetch('/api/library')).json();const doc=await (await fetch('/api/document?path=library%2Fmath.md')).json();const data=await (await fetch('/api/discussion?path=library%2Fmath.md&participant='+encodeURIComponent(library.participant))).json();const t=data.threads[0];if(!t)return null;const start=[...doc.text.slice(0,doc.text.indexOf('Euler wrote'))].length;return {got:[t.location.start,t.location.end],expected:[start,start+11]};})).jsonValue();
   assert.deepEqual(offsets.got,offsets.expected);await page.waitForFunction(()=>CSS.highlights.get('reader-own')?.size===1);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Two-page reading: blocks fit their column; the page-turn texture draws formulas where the DOM does.
  {const {page,errors,external,context}=await open({layout:'spread'},'library/math.md');
   await settled(page);await page.waitForFunction(()=>document.body.classList.contains('two-page'));await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
   const fit=await page.evaluate(()=>{const a=document.querySelector('#article'),gap=parseFloat(getComputedStyle(a).columnGap),column=(a.clientWidth-gap)/2;return [...document.querySelectorAll('.reader-math-block')].map(el=>({fragments:el.getClientRects().length,width:el.getBoundingClientRect().width,column}));});
   for(const f of fit){assert.equal(f.fragments,1);assert.ok(f.width<=f.column+1);}
   const box=await page.evaluate(async()=>{const m=await import('/assets/controls/page-turn.js'),article=document.querySelector('.book-viewport > .article');await m.warmSvgImages(article,1);
     const v=document.querySelector('.book-viewport').getBoundingClientRect(),half=v.width/2,el=document.querySelector('.reader-math-block'),r=el.getBoundingClientRect();
     const page={x:r.left<v.left+half?v.left:v.left+half,y:v.top,w:half,h:v.height};
     const probe=document.createElement('span');probe.style.color='var(--bg)';document.body.append(probe);const bg=getComputedStyle(probe).color;probe.remove();
     const canvas=m.rasterize(article,page,0,bg,1);window.__mathTexture=canvas.toDataURL('image/png');
     return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),px:Math.round(r.left-page.x),py:Math.round(r.top-page.y)};});
   const dom=await page.screenshot({clip:{x:box.x,y:box.y,width:box.w,height:box.h}});
   const texture=await page.evaluate(()=>window.__mathTexture);writeFileSync('.reader/web-dev/math-texture.png',Buffer.from(texture.split(',')[1],'base64'));
   // Compare ink masks of the live formula and its texture: glyphs land where the browser drew them.
   const overlap=await page.evaluate(async({dom,box})=>{
     const load=src=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.src=src;});
     const [a,b]=await Promise.all([load('data:image/png;base64,'+dom),load(window.__mathTexture)]);
     const mask=(image,sx,sy)=>{const c=document.createElement('canvas');c.width=box.w;c.height=box.h;const ctx=c.getContext('2d');ctx.drawImage(image,sx,sy,box.w,box.h,0,0,box.w,box.h);const d=ctx.getImageData(0,0,box.w,box.h).data,bg=[d[0],d[1],d[2]];const out=new Uint8Array(box.w*box.h);for(let i=0;i<out.length;i++)out[i]=Math.abs(d[i*4]-bg[0])+Math.abs(d[i*4+1]-bg[1])+Math.abs(d[i*4+2]-bg[2])>120?1:0;return out;};
     const ma=mask(a,0,0),mb=mask(b,box.px,box.py);
     // Dilate by one pixel to tolerate antialiasing.
     const near=(m,i)=>{const x=i%box.w,y=(i/box.w)|0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<box.w&&Y<box.h&&m[Y*box.w+X])return true;}return false;};
     let inkA=0,inkB=0,hitA=0,hitB=0;for(let i=0;i<ma.length;i++){if(ma[i]){inkA++;if(near(mb,i))hitA++;}if(mb[i]){inkB++;if(near(ma,i))hitB++;}}
     return {inkA,inkB,recall:hitA/Math.max(1,inkA),precision:hitB/Math.max(1,inkB)};},{dom:dom.toString('base64'),box});
   assert.ok(overlap.inkA>100&&overlap.inkB>100,'both show the formula '+JSON.stringify(overlap));
   assert.ok(overlap.recall>.7&&overlap.precision>.7,'texture glyphs align with the DOM '+JSON.stringify(overlap));
   console.log('Math texture alignment',JSON.stringify(overlap));
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Many formulas: the text is shown first and typeset after; a restored place survives the height changes.
  {const heavy='library/math-heavy.md',formulas=1500;
   const typeset=page=>page.waitForFunction(count=>document.querySelectorAll('.reader-math[data-state=ready]').length===count,formulas,{timeout:30000});
   const shownFirst=async page=>{const shown=await page.evaluate(()=>window.__shown);assert.equal(shown.formulas,formulas);assert.ok(shown.pending>0,'the document is visible before its formulas typeset: '+JSON.stringify(shown));};
   // Save a late place in continuous reading.
   let mark;
   {const {page,errors,context}=await open({layout:'scroll'},heavy);await shownFirst(page);await typeset(page);
    const saved=page.waitForRequest(r=>r.url().includes('/api/bookmark')&&r.method()==='POST',{timeout:5000});
    await page.evaluate(()=>{const h=[...document.querySelectorAll('#article h2')].find(h=>h.textContent==='Part 250');scrollTo(0,h.getBoundingClientRect().top+scrollY-innerHeight*.22+4);});
    mark=(await saved).postDataJSON();assert.ok(mark.source_offset>0);assert.deepEqual(errors,[]);await context.close();}
   const at=page=>page.evaluate(offset=>{const el=[...document.querySelectorAll('#article [data-source-start]')].find(el=>+el.dataset.sourceStart===offset),r=el.getBoundingClientRect(),v=document.querySelector('.book-viewport')?.getBoundingClientRect();
     return {top:r.top,bottom:r.bottom,line:innerHeight*.22,inSpread:v?[...el.getClientRects()].some(c=>c.width>0&&c.left>=v.left-2&&c.right<=v.right+2):null};},mark.source_offset);
   // Reopen: shown before typesetting, then back at the saved block once every formula is ready; the late note anchors.
   {const {page,errors,external,context}=await open({layout:'scroll'},heavy);await shownFirst(page);await typeset(page);
    const place=await at(page);assert.ok(place.top<=place.line+40&&place.bottom>=place.line-40,'the saved block is still at the reading line after typesetting: '+JSON.stringify(place));
    await page.waitForFunction(()=>CSS.highlights.get('reader-other')?.size===1&&document.querySelectorAll('.annotation-pin').length===1);
    assert.equal(await page.evaluate(()=>[...CSS.highlights.get('reader-other')][0].toString()),'distinct remark for part 280','the note beside late math anchors after typesetting');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}
   // Two-page: the saved block's spread survives the reflow, and the next turn advances one spread.
   {const {page,errors,context}=await open({layout:'spread',pageTurn:'slide'},heavy);await shownFirst(page);await typeset(page);
    const place=await at(page);assert.ok(place.inSpread,'two-page reopening shows the saved block after typesetting: '+JSON.stringify(place));
    const pages=await page.evaluate(()=>{const v=document.querySelector('.book-viewport'),gap=parseFloat(getComputedStyle(v.querySelector('.article')).columnGap)||40;return {offset:v.scrollLeft/(v.clientWidth+gap),label:document.querySelector('#pagination-slot [aria-current=page]')?.textContent};});
    assert.ok(Math.abs(pages.offset-Math.round(pages.offset))<.02,'the spread is aligned after the reflow: '+JSON.stringify(pages));
    const next=pages.label.split('–').map(n=>String(+n+2)).join('–');
    await page.locator('#main').focus();await page.keyboard.press('j');
    await page.waitForFunction(expected=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent===expected,next,{timeout:5000});
    assert.deepEqual(errors,[]);await context.close();}
   // A heading link wins over the bookmark: typesetting keeps the heading in view, not the saved place.
   for(const layout of ['scroll','spread']){const {page,errors,context}=await open({layout},heavy,undefined,'&h=part-120');await typeset(page);await page.waitForTimeout(150);
    const heading=await page.evaluate(()=>{const h=document.querySelector('#part-120'),r=h.getBoundingClientRect(),v=document.querySelector('.book-viewport')?.getBoundingClientRect();return v?{shown:r.left>=v.left-2&&r.right<=v.right+2}:{shown:r.top>-10&&r.top<innerHeight*.4,top:r.top};});
    assert.ok(heading.shown,layout+': the linked heading stays in view after typesetting: '+JSON.stringify(heading));
    assert.deepEqual(errors,[]);await context.close();}
   // Find typed while formulas typeset: hits are taken again from the typeset text (TeX is no longer found).
   {const {page,errors,context}=await open({layout:'scroll'},heavy);
    await page.locator('#main').focus();await page.keyboard.press('/');
    assert.ok(await page.evaluate(()=>document.querySelectorAll('.reader-math:not([data-state])').length)>0,'find starts before typesetting ends');
    await page.locator('#find-query').fill('pmatrix');await typeset(page);
    await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='0 / 0');
    await page.locator('#find-query').fill('distinct remark for part 290');await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='1 / 1');
    assert.equal(await page.evaluate(()=>[...CSS.highlights.get('reader-find')][0].toString()),'distinct remark for part 290');
    // Copying a typeset display formula still yields its TeX.
    const copied=await page.evaluate(()=>{const glyph=document.querySelectorAll('.reader-math-block')[299].querySelector('.katex-html'),range=document.createRange();range.selectNodeContents(glyph);getSelection().removeAllRanges();getSelection().addRange(range);
      const data=new DataTransfer();document.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain');});
    assert.match(copied,/^\$\$\\begin\{pmatrix\} 300 & 1/);
    assert.deepEqual(errors,[]);await context.close();}}

  // math: false keeps $ literal; a document without math never loads KaTeX.
  {const {page,requests,context}=await open({layout:'scroll'},'library/prices.md');await page.waitForTimeout(300);
   assert.equal(await page.locator('.reader-math').count(),0);assert.match(await page.locator('#article').textContent(),/\$x_1\$ and \$y_2\$/);
   assert.equal(requests.filter(r=>/\/controls\/(math\.js|katex\/)/.test(r)).length,0);await context.close();}
  console.log('Math passed: display, inline and \\(\\) formulas, invalid TeX with its reason, currency and code untouched, TeX copy, find and annotation offsets beside math, two-page fit, aligned page-turn texture, a math-heavy document shown before typesetting with its place, note and find kept, math: false, lazy local KaTeX with woff2 fonts.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
