/* Obsidian embeds: fragments, block ids, images, PDFs, nesting, cycles, code, links, annotations, find, lazy loading,
   two-page mode, phone width and the 50-embed performance check (tests/fixtures/transclusion/corpus.json). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--transclusion'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[],requests=[],trees=[];  // trees: the targets each /api/embeds request carried
  const context=async(viewport,prefs={})=>{const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});await ctx.addInitScript(value=>{try{if(!sessionStorage.getItem('seeded')){localStorage.setItem('reader.preferences.v1',value);sessionStorage.setItem('seeded','1');}}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',participant:'Browser tester',...prefs}));return ctx;};
  const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());else{const address=new URL(r.url());requests.push(address.pathname);if(address.pathname==='/api/embeds')trees.push(address.searchParams.getAll('target'));}});return page;};
  const open=async(page,path)=>{await page.evaluate(()=>document.querySelector('#article')?.setAttribute('data-stale','')).catch(()=>{});await page.goto(url+'/#read='+encodeURIComponent(path));await page.waitForFunction(()=>document.querySelector('#article:not([data-stale])')&&!document.querySelector('.resume-pending'),null,{timeout:15000}).catch(async error=>{throw new Error(error.message+'\n'+JSON.stringify(errors)+'\n'+(await page.evaluate(()=>location.href+' '+document.body.className+' '+document.querySelector('#main')?.innerHTML.slice(0,600))));});await page.waitForTimeout(150);};
  const embed=(page,raw)=>page.locator(`#article .document-embed[data-embed="${raw.replace(/"/g,'\\"')}"]`).first();
  const settled=page=>page.waitForFunction(()=>!document.querySelector('#article [data-embed-state=loading]'));

  // Fragments, nesting, notes and code: the corpus host document.
  {const ctx=await context({width:1300,height:900});const page=watch(await ctx.newPage());
   await open(page,'library/main.md');await settled(page);
   await page.screenshot({path:'.reader/web-dev/transclusion-host.png'});
   const whole=embed(page,'Target Note');
   assert.equal(await whole.getAttribute('data-embed-state'),'ok');
   assert.equal(await whole.locator('.embedded-content').getAttribute('data-source-path'),'library/notes/deep/Target Note.md');
   assert.equal((await whole.locator('.embed-header').textContent()).trim(),'from Target Note ↗');
   assert.equal(await whole.locator('.embed-header').getAttribute('data-reader-decoration'),'');
   const wholeText=await whole.locator('.embedded-content').textContent();
   assert.ok(wholeText.includes('Intro paragraph of the target.')&&!wholeText.includes('tags:'),'frontmatter is never embedded');
   assert.ok(!/\^(beta-para|list-two|callout-id|table-id)/.test(wholeText),'block ids are hidden');
   assert.equal(await page.evaluate(()=>document.querySelector('#article').closest('body').querySelectorAll('#article p > div').length),0,'standalone embeds are blocks, not divs in paragraphs');
   // A heading section (to the next heading of the same level; a code comment is not a heading) with its alias.
   const alpha=embed(page,'notes/deep/Target Note#Alpha|An alias');
   assert.equal(await alpha.locator('.embed-header cite').textContent(),'An alias');
   const alphaText=await alpha.locator('.embedded-content').textContent();
   assert.ok(alphaText.includes('echo alpha')&&alphaText.includes('Child body.')&&!alphaText.includes('Beta paragraph'),alphaText);
   // A list item block, with its child item and without its siblings.
   const item=embed(page,'Target Note#^list-two');const itemText=(await item.locator('.embedded-content').textContent()).replace(/\s+/g,' ').trim();
   assert.equal(itemText,'list item two nested under two');
   // Images with a size; PDFs draw the named page.
   const image=embed(page,'dot.png|300x200');assert.equal(await image.count(),0,'an image embed is an image, not a document embed');
   const img=page.locator('#article img.embed-image[data-embed-image]').first();
   assert.deepEqual(await img.evaluate(el=>[el.getAttribute('width'),el.getAttribute('height'),new URL(el.src).search]),['300','200','?path=library%2Fassets%2Fdot.png']);
   await page.waitForFunction(()=>document.querySelector('#article img.embed-image').naturalWidth>0);
   const pdf=embed(page,'paper.pdf#page=3');await pdf.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelector('#article .document-embed[data-embed="paper.pdf#page=3"] .embed-pdf canvas'),null,{timeout:15000});
   await page.screenshot({path:'.reader/web-dev/transclusion-pdf.png'});
   assert.equal(await pdf.locator('.embed-pdf').getAttribute('data-pdf-shown'),'3');assert.equal(await pdf.locator('.pdf-page-label').textContent(),'3 / 4');
   assert.match(await pdf.locator('.embed-header').textContent(),/page 3/);
   // Missing, ambiguous, unsupported, cycles and depth say so in place.
   const states=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#article > .document-embed')].map(el=>[el.dataset.embed,el.dataset.embedState])));
   assert.deepEqual(states,{'Target Note':'ok','notes/deep/Target Note#Alpha|An alias':'ok','Target Note#^list-two':'ok','paper.pdf#page=3':'ok','Nope':'missing','notes/loopA':'ok','notes/d1':'ok','twin':'ambiguous','notes/data.csv':'unsupported','v1.2 notes':'ok'});
   assert.match(await embed(page,'Nope').textContent(),/No document matches this embed · Nope/);
   const cycle=page.locator('#article .document-embed[data-embed="notes/loopA"] .document-embed[data-embed="loopB"] .document-embed[data-embed="loopA"]');
   assert.equal(await cycle.getAttribute('data-embed-state'),'cycle');assert.match(await cycle.textContent(),/embeds itself/);
   const depth=await page.evaluate(()=>{let el=document.querySelector('#article .document-embed[data-embed="notes/d1"]'),levels=[];while(el){levels.push(el.dataset.embedState);el=el.querySelector('.embedded-content > .document-embed');}return levels;});
   assert.deepEqual(depth,['ok','ok','ok','ok','depth'],'four levels, then a note');
   // Code, inline code and an escaped embed stay text.
   const code=await page.locator('#article pre').last().textContent();assert.match(code,/!\[\[sibling\]\]/);
   assert.equal(await page.locator('#article code',{hasText:'![[sibling]]'}).count()>=1,true);
   assert.equal(await page.locator('#article p a[href="sibling"]').count(),1,'\\![[x]] is a ! and a link');
   // Links and images inside an embed resolve from the embedded file (rebased), and the outline keeps to the host.
   const nestedImage=whole.locator('.embedded-content img[alt="dot"]');assert.equal(new URL(await nestedImage.evaluate(el=>el.src)).search,'?path=library%2Fassets%2Fdot.png');
   const rail=await page.locator('#outline-rail a').allTextContents().catch(()=>[]);assert.ok(!rail.includes('Alpha')&&!rail.includes('Alpha Child'),'embedded headings stay out of the outline: '+rail);
   // The reading cursor's text model reads through embeds but never their headers or notes.
   const model=await page.evaluate(async()=>{const {textModel}=await import('/assets/cursor.mjs');const text=textModel(document.querySelector('#article')).text;return {body:text.includes('Alpha body line.'),header:text.includes('from Target Note'),note:text.includes('No document matches')};});
   assert.deepEqual(model,{body:true,header:false,note:false});
   // Find covers embedded text.
   await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').fill('Child body');await page.waitForTimeout(200);
   assert.match(await page.locator('#find-count').textContent(),/^1 \/ [2-9]/,'find reaches the embedded copies');
   await page.keyboard.press('Escape');await page.locator('#find-close').click().catch(()=>{});
   // An annotation made in an embed belongs to the embedded file.
   const target=alpha.locator('.embedded-content p',{hasText:'Alpha body line.'});await target.scrollIntoViewIfNeeded();
   await page.evaluate(()=>{const p=[...document.querySelectorAll('#article .document-embed[data-embed="notes/deep/Target Note#Alpha|An alias"] .embedded-content p')].find(el=>el.textContent.includes('Alpha body line.'));const node=p.firstChild,range=document.createRange();range.setStart(node,0);range.setEnd(node,'Alpha body line'.length);getSelection().removeAllRanges();getSelection().addRange(range);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
   await page.locator('#selection-tools').waitFor();
   const created=page.waitForResponse(r=>r.url().endsWith('/api/annotations')&&r.request().method()==='POST');
   await page.locator('[data-annotate=highlight]').click();const body=JSON.parse((await created).request().postData());
   assert.equal(body.path,'library/notes/deep/Target Note.md');
   const source=(await (await page.request.get(url+'/api/document?path='+encodeURIComponent(body.path))).json()).text;
   assert.equal([...source].slice(body.start,body.end).join(''),'Alpha body line');
   await page.waitForFunction(()=>document.querySelectorAll('#article .annotation-pin').length>=1);
   // A header opens the embedded document at the section.
   await alpha.locator('.embed-source').click();await page.waitForFunction(()=>location.hash.includes('Target%20Note.md'));await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
   assert.match(decodeURIComponent(await page.evaluate(()=>location.hash)),/h=Alpha$/);
   await page.waitForFunction(()=>CSS.highlights.get('reader-own')?.size>=1,null,{timeout:5000});
   assert.equal(await page.evaluate(()=>[...CSS.highlights.get('reader-own')][0].toString()),'Alpha body line','the highlight shows on the embedded file itself');
   // A relative link in the embedded file, clicked from the host, opens the file next to it.
   await open(page,'library/main.md');await settled(page);
   await embed(page,'Target Note').locator('.embedded-content a',{hasText:'sibling'}).click();
   await page.waitForFunction(()=>decodeURIComponent(location.hash).includes('library/notes/deep/sibling.md'));
   await page.waitForFunction(()=>document.querySelector('#article img[alt=spaced]')?.naturalWidth>0,null,{timeout:5000});  // a percent-encoded image path
   await ctx.close();}

  // Fifty embeds: 16 resolve with the document in one request, the rest as you read; no per-embed fetches.
  {const ctx=await context({width:1300,height:900});const page=watch(await ctx.newPage());requests.length=0;trees.length=0;
   const started=Date.now();await open(page,'library/many.md');const firstPaint=Date.now()-started;
   const counts=await page.evaluate(()=>{const s=[...document.querySelectorAll('#article > .document-embed')].map(el=>el.dataset.embedState);return {ok:s.filter(x=>x==='ok').length,deferred:s.filter(x=>x==='deferred').length};});
   assert.deepEqual(counts,{ok:16,deferred:34});
   const early=requests.filter(p=>p==='/api/embeds').length;assert.equal(early,1,'one tree request for the first 16');
   const scrollStart=Date.now();
   for(let i=0;i<60&&await page.locator('#article [data-embed-state=deferred]').count();i++){await page.mouse.wheel(0,4000);await page.waitForTimeout(60);}
   await page.waitForFunction(()=>!document.querySelector('#article [data-embed-state=deferred],#article [data-embed-state=loading]'),null,{timeout:20000});
   const allLoaded=Date.now()-scrollStart;
   assert.equal(await page.locator('#article > .document-embed[data-embed-state=ok]').count(),50);
   assert.equal(requests.filter(p=>p==='/api/document').length,1,'only the host document is fetched');
   // Batching, not timing: how many requests the scroll produces depends on how fast responses come back while it
   // scrolls, so count what each request carried. The 34 deferred embeds never go one per request, and no request
   // carries more than a batch (16).
   const later=trees.slice(1);
   assert.ok(later.length<=Math.ceil(34/3),'lazy embeds load in batches, not one per request: '+later.map(t=>t.length).join(','));
   assert.equal(later.reduce((n,t)=>n+t.length,0),34,'each deferred embed is requested once');
   assert.ok(later.every(t=>t.length>=1&&t.length<=16),'a batch carries at most 16: '+later.map(t=>t.length).join(','));
   await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').fill('distinct embedded line 49');await page.waitForTimeout(200);
   assert.equal(await page.locator('#find-count').textContent(),'1 / 1');
   console.log(JSON.stringify({perf:{embeds:50,first_paint_ms:firstPaint,remaining_34_ms:allLoaded,embed_requests:trees,document_requests:1}}));
   await ctx.close();}

  // Two-page mode lays embeds into the spread and loads them all (no viewport to observe); the page turn rasterizes them.
  {const ctx=await context({width:1300,height:820},{layout:'spread'});const page=watch(await ctx.newPage());
   await open(page,'library/many.md');await page.waitForFunction(()=>document.body.classList.contains('two-page'));
   await page.waitForFunction(()=>!document.querySelector('#article [data-embed-state=deferred],#article [data-embed-state=loading]'),null,{timeout:20000});
   assert.equal(await page.locator('#article > .document-embed[data-embed-state=ok]').count(),50);
   await open(page,'library/main.md');await settled(page);
   const box=await embed(page,'Target Note').locator('.embedded-content').boundingBox();assert.ok(box&&box.width>100,'embedded text is laid out in the spread');
   await page.waitForFunction(()=>import('/assets/controls/page-turn.js').then(()=>true));
   await page.locator('#main').focus();await page.keyboard.press('j');await page.waitForTimeout(250);
   await page.waitForFunction(()=>!document.querySelector('.page-turn-canvas'),null,{timeout:4000});
   await page.waitForFunction(()=>document.querySelector('#article .embed-pdf canvas'),null,{timeout:15000});
   assert.ok(await page.evaluate(()=>{const c=document.querySelector('#article .embed-pdf canvas').getBoundingClientRect(),v=document.querySelector('.book-viewport').getBoundingClientRect();return c.height<=v.height;}),'a PDF page fits its column');
   await page.screenshot({path:'.reader/web-dev/transclusion-spread.png'});
   await ctx.close();}

  // Phone width: no horizontal scroll.
  {const ctx=await context({width:390,height:844});const page=watch(await ctx.newPage());
   await open(page,'library/main.md');await settled(page);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page scroll at phone width');
   await page.screenshot({path:'.reader/web-dev/transclusion-phone.png',fullPage:false});
   await ctx.close();}

  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('web_transclusion: ok');
 }catch(error){console.error(error);process.exitCode=1;}
 finally{await browser?.close();fixture.kill('SIGTERM');}
})();
