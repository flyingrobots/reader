/* Obsidian callouts: rendering in three themes, exact annotation anchoring over callout
   bodies, find into folded callouts, contrast in every built-in theme, the two-page
   rasterizer and phone width. Synthetic fixture only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const THEMES=['ink','paper','orchid','orchid-dark','harvest','harvest-dark',...require('../src/reader_mcp/web_ui/famous-themes.json').themes.flatMap(t=>[t.id,t.id+'-dark'])];
const PATH='library/callouts.md';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--callouts'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const open=async(prefs={},viewport={width:1300,height:900})=>{
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,participant:'Callout tester',nextReads:false,...prefs}));
    const page=await context.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
    const seen=page.waitForResponse(r=>r.url().endsWith('/api/seen')&&r.request().method()==='POST');
    await page.goto(url+'/#read='+encodeURIComponent(PATH));await seen;await page.locator('.callout-icon svg').first().waitFor();
    return {page,errors,external,context};};
  const source=(await (await fetch(url+'/api/document?path='+encodeURIComponent(PATH))).json()).text;
  const slice=(start,end)=>Array.from(source).slice(start,end).join('');

  // Structure, types, titles, folding, nesting, decoration and offsets, in three themes.
  for(const theme of ['paper','ink',THEMES[6]+'-dark']){
    const {page,errors,external,context}=await open({theme});
    const info=await page.evaluate(()=>{const article=document.querySelector('#article');return {
      callouts:[...article.querySelectorAll('aside.callout')].map(a=>({type:a.dataset.callout,alias:a.dataset.calloutAlias||null,fold:a.dataset.calloutFold||null,open:a.querySelector(':scope>details')?.open??null,title:a.querySelector('.callout-title-text').textContent,decoration:a.querySelector('.callout-title').hasAttribute('data-reader-decoration'),svg:!!a.querySelector('.callout-icon svg'),start:+a.dataset.sourceStart,nested:!!a.parentElement.closest('aside.callout'),role:a.getAttribute('role')})),
      raw:article.textContent.includes('[!'),blockquotes:article.querySelectorAll('blockquote').length,
      bodies:[...article.querySelectorAll('.callout-content > p')].map(p=>({start:+p.dataset.sourceStart,end:+p.dataset.sourceEnd,text:p.textContent}))};});
    assert.deepEqual(info.callouts.map(c=>[c.type,c.alias,c.fold,c.open,c.title,c.nested]),[
      ['note',null,null,null,'A plain note',false],['info',null,'closed',false,'Folded details',false],['tip',null,'open',true,'Expanded hint',false],
      ['warning',null,null,null,'Warning',false],['quote',null,null,null,'Quoted voice',false],['question','faq',null,null,'Faq',false],
      ['note','marginalia',null,null,'Custom kind',false],['example',null,null,null,'Outer example',false],['danger',null,null,null,'Inner danger',true]],theme);
    assert.ok(info.callouts.every(c=>c.decoration&&c.svg&&c.role==='note'),'decorated header with an icon');
    assert.equal(info.raw,false,'no literal [!type] marker is shown');assert.equal(info.blockquotes,1,'a plain quotation stays a blockquote');
    for(const body of info.bodies)assert.equal(slice(body.start,body.end).replace(/^(> )+/gm,'').trim(),body.text.trim(),'body source map is exact');
    assert.equal(slice(info.callouts[0].start,info.callouts[0].start+9),'> [!note]');
    await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);await page.screenshot({path:`.reader/web-dev/callouts-${theme}.png`});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();
  }

  // Annotations: an existing thread anchors inside a callout body; a new selection there is exact.
  {const {page,errors,context}=await open({theme:'user-reader-test'});
   await page.waitForFunction(()=>[...(CSS.highlights.get('reader-other')||[])].some(r=>r.toString()==='a callout observation'));
   assert.equal(await page.locator('#article .annotation-pin').count(),1);
   await page.evaluate(()=>{const p=[...document.querySelectorAll('.callout[data-callout=tip] .callout-content p')][0],node=p.firstChild,at=node.data.indexOf('expanded hint body'),range=document.createRange();range.setStart(node,at);range.setEnd(node,at+'expanded hint body'.length);const s=getSelection();s.removeAllRanges();s.addRange(range);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
   await page.locator('#selection-tools').waitFor();
   const created=page.waitForResponse(r=>r.url().endsWith('/api/annotations')&&r.request().method()==='POST');
   await page.locator('#selection-tools [data-annotate=highlight]').click();const thread=await (await created).json();
   assert.equal(slice(thread.anchor.start,thread.anchor.end),'expanded hint body','new anchor is the exact source passage');
   await page.waitForFunction(()=>[...(CSS.highlights.get('reader-own')||[])].some(r=>r.toString()==='expanded hint body'));
   // A selection on the decorative header never anchors.
   await page.evaluate(()=>{const t=document.querySelector('.callout[data-callout=note] .callout-title-text'),range=document.createRange();range.selectNodeContents(t);const s=getSelection();s.removeAllRanges();s.addRange(range);t.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
   await page.waitForTimeout(100);assert.equal(await page.locator('#selection-tools').isVisible(),false,'header text is decoration');
   // Find skips titles, reaches folded bodies and opens their fold.
   await page.evaluate(()=>getSelection().removeAllRanges());await page.locator('#main').focus();await page.keyboard.press('/');
   await page.locator('#find-query').fill('Folded details');await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='0 / 0');
   await page.locator('#find-query').fill('folded observation');await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='1 / 1');
   await page.locator('#find-query').press('Enter');
   await page.waitForFunction(()=>document.querySelector('.callout[data-callout=info] details').open);
   assert.equal(await page.evaluate(()=>[...CSS.highlights.get('reader-current')][0].toString()),'folded observation');
   assert.deepEqual(errors,[]);await context.close();}

  // Contrast: callout title and body against the callout's own background, in every theme.
  {const {page,context}=await open({theme:'user-reader-test'});
   const rows=await page.evaluate(themes=>{
    const html=document.documentElement,canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
    const rgb=(...layers)=>{ctx.clearRect(0,0,1,1);for(const layer of layers){ctx.fillStyle=layer;ctx.fillRect(0,0,1,1);}return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
    const lum=v=>v.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((n,c,i)=>n+c*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{const [lo,hi]=[lum(a),lum(b)].sort((x,y)=>x-y);return (hi+.05)/(lo+.05);};
    const result=[];for(const theme of themes){html.dataset.theme=theme;const page=getComputedStyle(html).backgroundColor;
      for(const aside of document.querySelectorAll('aside.callout')){const bg=rgb(page,getComputedStyle(aside).backgroundColor),title=getComputedStyle(aside.querySelector('.callout-title')).color,body=aside.querySelector(':scope .callout-content > p');
        result.push({theme,type:aside.dataset.callout,title:ratio(rgb(page,getComputedStyle(aside).backgroundColor,title),bg),body:ratio(rgb(page,getComputedStyle(aside).backgroundColor,getComputedStyle(body).color),bg)});}}
    return result;},THEMES);
   assert.equal(new Set(rows.map(r=>r.theme)).size,6+2*require('../src/reader_mcp/web_ui/famous-themes.json').themes.length);
   const failing=rows.filter(r=>r.title<4.5||r.body<4.5);assert.deepEqual(failing,[],'callout text meets 4.5:1');
   console.log('Lowest callout contrast: title '+Math.min(...rows.map(r=>r.title)).toFixed(2)+', body '+Math.min(...rows.map(r=>r.body)).toFixed(2));
   await context.close();}

  // Two-page: the page-turn rasterizer draws the callout box and its icon.
  {const {page,errors,context}=await open({theme:'user-reader-test',layout:'spread'});
   await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
   const drawn=await page.evaluate(async()=>{const {rasterize}=await import('/assets/controls/page-turn.js');const article=document.querySelector('#article');
     const aside=document.querySelector('aside.callout'),icon=aside.querySelector('.callout-icon svg').getBoundingClientRect(),box=aside.getBoundingClientRect();
     const sample=(rect,color)=>{const canvas=rasterize(article,{x:rect.left,y:rect.top,w:rect.width,h:rect.height},0,'#ff00ff',2),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
       const probe=document.createElement('canvas').getContext('2d');probe.fillStyle=color;probe.fillRect(0,0,1,1);const [r,g,b]=probe.getImageData(0,0,1,1).data;let near=0,magenta=0;
       for(let i=0;i<data.length;i+=4){if(Math.abs(data[i]-r)+Math.abs(data[i+1]-g)+Math.abs(data[i+2]-b)<60)near++;if(data[i]===255&&data[i+1]===0&&data[i+2]===255)magenta++;}return {near,magenta,total:data.length/4};};
     return {icon:sample(icon,getComputedStyle(aside.querySelector('.callout-title')).color),box:sample({left:box.left+box.width-40,top:box.top+4,width:30,height:10},getComputedStyle(aside).backgroundColor)};});
   assert.ok(drawn.icon.near>20,'icon strokes are drawn: '+JSON.stringify(drawn.icon));
   assert.ok(drawn.box.near>drawn.box.total*.9&&drawn.box.magenta===0,'callout background is drawn: '+JSON.stringify(drawn.box));
   await page.screenshot({path:'.reader/web-dev/callouts-spread.png'});assert.deepEqual(errors,[]);await context.close();}

  // Phone width: no horizontal page scroll.
  {const {page,context}=await open({theme:'user-reader-test-dark'},{width:390,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'fits phone width');
   await page.screenshot({path:'.reader/web-dev/callouts-phone.png'});await context.close();}
  console.log('Callouts passed: 13 types, aliases, unknown fallback, titles, folding, nesting, decoration, exact body offsets in 3 themes; existing and new annotations in a callout body; find opens a fold and skips titles; contrast in 22 themes; two-page rasterizer draws box and icon; phone width.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
