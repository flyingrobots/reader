/* Mermaid diagrams drawn by Pele: figures, error fallback, live theming, find, annotations,
   the enlarge dialog, two-page fit, the page-turn texture and local-only loading. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--diagrams'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async(prefs,path,viewport={width:1300,height:860})=>{
    const context=await browser.newContext({viewport});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',...prefs}));
    const page=await context.newPage(),errors=[],external=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{requests.push(r.url());if(!r.url().startsWith(url))external.push(r.url());});
    await page.goto(url+'#read='+encodeURIComponent(path));await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
    return {page,errors,external,requests,context};};
  const settled=page=>page.waitForFunction(()=>document.querySelectorAll('.reader-diagram').length===4&&!document.querySelector('.reader-diagram-canvas[data-state=loading]'));

  // Continuous reading: figures, error fallback, accessibility, inert links, theming, find, dialog, annotations.
  {const {page,errors,external,requests,context}=await open({layout:'scroll'},'library/diagrams.md');
   await settled(page);
   const figures=await page.$$eval('.reader-diagram',list=>list.map(f=>{const c=f.querySelector('.reader-diagram-canvas');return {state:c.dataset.state,svg:c.querySelector(':scope > svg')?.getAttribute('class')||null,role:c.getAttribute('role'),label:c.getAttribute('aria-label'),decoration:c.hasAttribute('data-reader-decoration'),open:f.querySelector('details').open,text:c.textContent,links:c.querySelectorAll('a').length,described:!!document.getElementById(c.getAttribute('aria-describedby')||'-')};}));
   assert.deepEqual(figures.map(f=>f.state),['ready','ready','ready','error']);
   assert.match(figures[0].svg,/pele-flowchart/);assert.match(figures[1].svg,/pele-sequence/);assert.match(figures[2].svg,/pele-pie/);
   for(const f of figures.slice(0,3)){assert.equal(f.role,'img');assert.ok(f.decoration);assert.ok(f.described,'the source disclosure describes the figure');assert.equal(f.open,false);assert.equal(f.links,0,'diagram links are inert');}
   assert.match(figures[0].label,/^Diagram, flowchart LR: .*Intake desk.*Library shelf/);
   assert.equal(figures[3].open,true,'an invalid diagram shows its source');assert.match(figures[3].text,/^Couldn’t draw this diagram: Parse error/);
   assert.equal(await page.locator('.reader-diagram').nth(3).locator('[data-slot=code-block]').count(),1,'source keeps the code block with its copy button');
   assert.ok(requests.some(r=>/\/assets\/controls\/diagrams\.js$/.test(r)),'diagram chunk loads');assert.ok(requests.some(r=>/\/assets\/controls\/diagrams\/.+\.js$/.test(r)),'per-type chunks load');
   await page.screenshot({path:'.reader/web-dev/diagrams-scroll.png',fullPage:true});
   // Theme change recolors through CSS variables, without re-rendering (same nodes).
   const before=await page.evaluate(()=>{window.__diagramNode=document.querySelector('.pele-flowchart .pele-node rect');window.__diagramSvg=document.querySelector('.pele-flowchart');return getComputedStyle(window.__diagramNode).stroke;});
   await page.getByRole('switch',{name:'Dark mode',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'ink');
   const after=await page.evaluate(()=>({stroke:getComputedStyle(window.__diagramNode).stroke,same:document.querySelector('.pele-flowchart .pele-node rect')===window.__diagramNode&&document.querySelector('.pele-flowchart')===window.__diagramSvg}));
   assert.notEqual(after.stroke,before,'stroke follows the theme');assert.ok(after.same,'no re-render on theme change');
   await page.screenshot({path:'.reader/web-dev/diagrams-ink.png',fullPage:true});
   // Find reads the source in the disclosure, never the drawing's labels.
   await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').fill('Library shelf');
   await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='1 / 1');
   assert.ok(await page.evaluate(()=>!!CSS.highlights.get('reader-current')&&[...CSS.highlights.get('reader-current')][0].startContainer.parentElement.closest('details.reader-diagram-source')),'find lands on the source line');
   await page.keyboard.press('Escape');
   // Enlarge: click, then Enter from the keyboard.
   await page.locator('.reader-diagram-canvas').first().click();await page.locator('#diagram-dialog #diagram-body > svg').waitFor();
   assert.ok(await page.evaluate(()=>{const s=document.querySelector('#diagram-body > svg');return s.getBoundingClientRect().width>=+s.getAttribute('width')-1;}),'dialog shows the diagram at least full size');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#diagram-dialog'));
   await page.locator('.reader-diagram-canvas').nth(2).focus();await page.keyboard.press('Enter');await page.locator('#diagram-dialog #diagram-body > svg.pele-pie').waitFor();
   await page.keyboard.press('Escape');
   // A highlight on the paragraph after a diagram keeps its exact source offsets.
   const sentence='The paragraph after the flowchart carries a careful observation.';
   await page.locator('#article p',{hasText:sentence}).evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
   await page.locator('#selection-tools').waitFor();await page.locator('[data-annotate=highlight]').click();
   const located=await page.waitForFunction(async sentence=>{const library=await (await fetch('/api/library')).json();const doc=await (await fetch('/api/document?path=library%2Fdiagrams.md')).json();const data=await (await fetch('/api/discussion?path=library%2Fdiagrams.md&participant='+encodeURIComponent(library.participant))).json();const t=data.threads[0];if(!t)return null;const start=[...doc.text.slice(0,doc.text.indexOf(sentence))].length;return {start:t.location.start,end:t.location.end,expected:[start,start+[...sentence].length]};},sentence);
   const offsets=await located.jsonValue();assert.deepEqual([offsets.start,offsets.end],offsets.expected);
   await page.waitForFunction(()=>CSS.highlights.get('reader-own')?.size===1);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Two-page reading: every figure fits its column, and the page-turn texture shows the drawing.
  {const {page,errors,external,context}=await open({layout:'spread'},'library/diagrams.md');
   await settled(page);await page.waitForFunction(()=>document.body.classList.contains('two-page'));await page.waitForTimeout(300);
   const fit=await page.evaluate(()=>{const a=document.querySelector('#article'),style=getComputedStyle(a),gap=parseFloat(style.columnGap),column=(a.clientWidth-gap)/2,height=a.getBoundingClientRect().height;
     return [...document.querySelectorAll('.reader-diagram')].map(f=>{const rects=[...f.getClientRects()];return {fragments:rects.length,width:rects[0].width,height:rects[0].height,column,columnHeight:height};});});
   for(const f of fit){assert.equal(f.fragments,1,'a figure never splits across columns');assert.ok(f.width<=f.column+1,'fits the column width');assert.ok(f.height<=f.columnHeight+1,'fits the column height');}
   const texture=await page.evaluate(async()=>{
     const m=await import('/assets/controls/page-turn.js'),article=document.querySelector('.book-viewport > .article');await m.warmSvgImages(article,1);
     const svg=document.querySelector('.pele-pie'),r=svg.getBoundingClientRect(),v=document.querySelector('.book-viewport').getBoundingClientRect(),half=v.width/2;
     const box={x:r.left<v.left+half?v.left:v.left+half,y:v.top,w:half,h:v.height};
     const probe=document.createElement('span');probe.style.color='var(--bg)';document.body.append(probe);const bg=getComputedStyle(probe).color;probe.remove();
     const canvas=m.rasterize(article,box,0,bg,1),ctx=canvas.getContext('2d'),data=ctx.getImageData(Math.round(r.left-box.x),Math.round(r.top-box.y),Math.round(r.width),Math.round(r.height)).data;
     const ref=ctx.getImageData(0,0,1,1).data;let differ=0;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-ref[0])+Math.abs(data[i+1]-ref[1])+Math.abs(data[i+2]-ref[2])>30)differ++;
     return {fraction:differ/(data.length/4),png:canvas.toDataURL('image/png')};});
   require('node:fs').writeFileSync('.reader/web-dev/diagrams-texture.png',Buffer.from(texture.png.split(',')[1],'base64'));
   assert.ok(texture.fraction>.15,'page-turn texture paints the pie chart, not just its labels: '+texture.fraction.toFixed(3));
   // The real turn runs without errors with diagrams on the page.
   await page.waitForFunction(()=>import('/assets/controls/page-turn.js').then(()=>true));await page.locator('#main').focus();await page.keyboard.press('j');await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>!!document.querySelector('.page-turn-canvas')),'the sheet turns');
   await page.screenshot({path:'.reader/web-dev/diagrams-turn.png'});await page.waitForFunction(()=>!document.querySelector('.page-turn-canvas'),null,{timeout:3000});
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Phone width: diagrams scale or scroll inside their figure, never the page.
  {const {page,errors,context}=await open({layout:'scroll'},'library/diagrams.md',{width:390,height:844});await settled(page);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page scroll');
   await page.screenshot({path:'.reader/web-dev/diagrams-phone.png'});assert.deepEqual(errors,[]);await context.close();}

  // A document without Mermaid never loads the diagram chunk.
  {const {page,requests,context}=await open({layout:'scroll'},'library/other.md');await page.waitForTimeout(300);
   assert.equal(requests.filter(r=>r.includes('/controls/diagrams')).length,0);await context.close();}
  console.log('Diagrams passed: flowchart, sequence and pie drawn, invalid source shown with its error, live theme without re-render, find on source, enlarge by click and Enter, exact annotation offsets, two-page fit, page-turn texture, phone width, lazy and local-only loading.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
