/* The shadcn Code Block for every fenced block: header, language label and copy button as decoration,
   exact source text and offsets, lazy local syntax highlighting as CSS highlights, every theme,
   annotations inside code, the Mermaid source, chat, phone width, two-page layout and the page-turn texture. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,writeFileSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--code-blocks','--chat'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const path='library/code.md',source=(await (await fetch(url+'/api/document?path='+encodeURIComponent(path))).json()).text;
  const cp=offset=>Array.from(source.slice(0,offset)).length;
  const open=async(prefs,viewport={width:1300,height:860},target=path)=>{
    const context=await browser.newContext({viewport});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',...prefs}));
    const page=await context.newPage(),errors=[],external=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{requests.push(r.url());if(!r.url().startsWith(url))external.push(r.url());});
    await page.goto(url+'#read='+encodeURIComponent(target));await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
    return {page,errors,external,requests,context};};
  const toast=(page,text)=>page.locator('[data-sonner-toast]').filter({hasText:text});
  const highlighted=(page,n)=>page.waitForFunction(n=>document.querySelectorAll('#article [data-slot=code-block-code][data-highlight=done]').length>=n,n,{timeout:10000});

  // Continuous reading: structure, exact text and offsets, decoration, highlighting, copy, find, annotations, themes.
  {const {page,errors,external,requests,context}=await open({layout:'scroll'});
   const blocks=await page.$$eval('#article .reader-code-block',list=>list.map(host=>{const block=host.firstElementChild,header=block.querySelector('[data-slot=code-block-header]'),code=block.querySelector('[data-slot=code-block-code]'),button=header.querySelector('button');
     return {slot:block.dataset.slot,title:header.querySelector('[data-slot=code-block-title]').textContent,decoration:header.hasAttribute('data-reader-decoration'),button:button.getAttribute('aria-label'),buttonSlot:button.dataset.slot,
       text:code.textContent,start:+code.dataset.sourceStart,end:+code.dataset.sourceEnd,gutter:block.querySelector('[data-slot=code-block-gutter]')?.textContent??null,
       gutterHidden:block.querySelector('[data-slot=code-block-gutter]')?.getAttribute('aria-hidden')??null,inDetails:!!host.closest('details.reader-diagram-source'),highlight:code.dataset.highlight};}));
   assert.deepEqual(blocks.map(b=>b.title),['Python','Text','Mermaid','Bash','Text','JSON']);
   const fences=[...source.matchAll(/^```[^\n]*\n([\s\S]*?)^```\n/gm)];assert.equal(fences.length,blocks.length);
   blocks.forEach((b,i)=>{
     assert.equal(b.slot,'code-block');assert.ok(b.decoration,'the header is decoration');assert.equal(b.button,'Copy code');assert.equal(b.buttonSlot,'code-block-copy-button');
     assert.equal(b.text,fences[i][1],'the code text is the exact fence content');
     assert.deepEqual([b.start,b.end],[cp(fences[i].index),cp(fences[i].index+fences[i][0].length)],'the fence carries its source offsets');});
   assert.equal(blocks[0].gutter,'1\n2\n3\n4\n5\n6','multi-line code is numbered, blank lines included');assert.equal(blocks[0].gutterHidden,'true');
   assert.equal(blocks[3].gutter,null,'a one-line block has no gutter');assert.ok(blocks[2].inDetails,'the Mermaid source keeps its code block inside the disclosure');
   assert.equal(await page.locator('#article pre:not([data-slot])').count(),0,'no plain <pre> remains');
   // Highlighting loads lazily from local chunks; the late JSON block waits until it is near the viewport.
   await page.waitForFunction(()=>document.querySelector('#article [data-language=python]')?.dataset.highlight==='done',null,{timeout:10000});
   assert.equal(await page.locator('#article [data-language=json]').getAttribute('data-highlight'),'watching','off-screen code is not tokenized yet');
   assert.equal(await page.locator('#article [data-language=mermaid]').getAttribute('data-highlight'),'watching','closed diagram source is not tokenized yet');
   assert.equal(await page.locator('#article [data-language=text]').first().getAttribute('data-highlight'),'off');
   const syntax=await page.evaluate(()=>{const code=document.querySelector('#article [data-language=python]'),inside=name=>[...(CSS.highlights.get('reader-syntax-'+name)||[])].filter(r=>code.contains(r.startContainer)).map(r=>r.toString());
     return {keyword:inside('keyword'),string:inside('string-expression'),comment:inside('comment'),node:code.childNodes.length===1&&code.firstChild.nodeType===3,priority:CSS.highlights.get('reader-syntax-keyword').priority};});
   assert.ok(syntax.keyword.includes('def')&&syntax.keyword.includes('return'),'keywords: '+syntax.keyword);
   assert.ok(syntax.string.some(s=>s.includes('hello')),'strings: '+syntax.string);assert.ok(syntax.comment.some(s=>s.includes('careful comment')),'comments: '+syntax.comment);
   assert.ok(syntax.node,'highlighting adds no DOM: the code stays one text node');assert.equal(syntax.priority,-1,'syntax colors sit under annotations and find');
   assert.ok(requests.some(r=>/\/assets\/controls\/highlight\.js$/.test(r))&&requests.some(r=>/\/assets\/controls\/highlight\/python-[A-Z0-9]+\.js$/.test(r)),'Shiki and the Python grammar load locally');
   assert.ok(!requests.some(r=>/\.wasm$/.test(r)),'no WebAssembly');
   // Opening the Mermaid source highlights it.
   await page.locator('details.reader-diagram-source summary').first().click();
   await page.waitForFunction(()=>document.querySelector('#article [data-language=mermaid]').dataset.highlight==='done',null,{timeout:10000});
   await page.locator('.reader-code-block').first().scrollIntoViewIfNeeded();
   await page.screenshot({path:'.reader/web-dev/code-block-paper.png'});
   // A note anchored inside code paints at its exact phrase.
   await page.waitForFunction(()=>CSS.highlights.get('reader-other')?.size===1);
   assert.ok(await page.evaluate(()=>{const r=[...CSS.highlights.get('reader-other')][0];return r.toString()==='the anchored shell phrase'&&!!r.startContainer.parentElement.closest('[data-slot=code-block-code][data-language=bash]');}),'the annotation lands inside the bash block');
   // A new highlight made inside code gets exact source offsets.
   const phrase='a careful comment';
   await page.locator('#article [data-language=python]').evaluate((code,phrase)=>{const text=code.firstChild,at=text.data.indexOf(phrase),range=document.createRange();range.setStart(text,at);range.setEnd(text,at+phrase.length);getSelection().removeAllRanges();getSelection().addRange(range);code.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));},phrase);
   await page.locator('#selection-tools').waitFor();await page.locator('[data-annotate=highlight]').click();
   await page.waitForFunction(()=>CSS.highlights.get('reader-own')?.size===1);
   const mine=await page.evaluate(async()=>{const library=await (await fetch('/api/library')).json();const data=await (await fetch('/api/discussion?path=library%2Fcode.md&participant='+encodeURIComponent(library.participant))).json();return data.threads.filter(t=>t.owner===library.participant).map(t=>[t.location.start,t.location.end]);});
   const at=source.indexOf(phrase);assert.deepEqual(mine,[[cp(at),cp(at+phrase.length)]]);
   // Find reads code text but never the gutter or the header.
   await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').fill('greet');
   await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='1 / 2');
   await page.locator('#find-query').fill('Python');await page.waitForFunction(()=>document.querySelector('#find-count').textContent==='0 / 0');await page.keyboard.press('Escape');
   // Copy from the keyboard: focusable, labelled, exact text, a toast, a check icon for a moment.
   await context.grantPermissions(['clipboard-read','clipboard-write']);
   const copy=page.locator('#article .reader-code-block').first().getByRole('button',{name:'Copy code',exact:true});
   await copy.focus();assert.ok(await copy.evaluate(el=>document.activeElement===el));await page.keyboard.press('Enter');
   await page.waitForFunction(()=>{const b=document.querySelector('#article [data-code-copy]');return b.getAttribute('aria-label')==='Copied'&&b.dataset.copied==='true'&&!!b.querySelector('svg.lucide-check');});
   await toast(page,'Copied 6 lines of code.').waitFor();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),fences[0][1]);
   await page.waitForFunction(()=>document.querySelector('#article [data-code-copy]').getAttribute('aria-label')==='Copy code',null,{timeout:4000});
   // Theme switch recolors through CSS variables: same ranges, new ink.
   const before=await page.evaluate(()=>{window.__keyword=CSS.highlights.get('reader-syntax-keyword');const probe=document.createElement('span');probe.style.color='var(--code-keyword)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;});
   await page.getByRole('switch',{name:'Dark mode',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'ink');
   const after=await page.evaluate(()=>{const probe=document.createElement('span');probe.style.color='var(--code-keyword)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return {color,same:CSS.highlights.get('reader-syntax-keyword')===window.__keyword&&window.__keyword.size>0};});
   assert.notEqual(after.color,before,'keyword ink follows the theme');assert.ok(after.same,'no re-highlighting on theme change');
   await page.locator('.reader-code-block').first().scrollIntoViewIfNeeded();await page.screenshot({path:'.reader/web-dev/code-block-ink.png'});
   // Every theme: each syntax role and the header label are readable on the block's background.
   const report=await page.evaluate(async()=>{
     const {THEMES}=await import('/assets/themes.mjs');const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d',{willReadFrequently:true});
     const rgb=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='#000';ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data.slice(0,3)];};
     const lin=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;},lum=([r,g,b])=>.2126*lin(r)+.7152*lin(g)+.0722*lin(b),ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
     const still=document.createElement('style');still.textContent='*{transition:none!important}';document.head.append(still);
     const block=document.querySelector('#article [data-slot=code-block]'),title=block.querySelector('[data-slot=code-block-title]'),gutter=block.querySelector('[data-slot=code-block-gutter]'),code=block.querySelector('[data-slot=code-block-code]');
     const probe=document.createElement('span');block.append(probe);const roles=['keyword','string','string-expression','constant','function','parameter','punctuation','comment','link'];const failures=[];let min=99;
     for(const theme of THEMES){document.documentElement.dataset.theme=theme;await new Promise(r=>setTimeout(r,0));
       const bg=rgb(getComputedStyle(block).backgroundColor);
       const check=(what,color)=>{const r=ratio(rgb(color),bg);min=Math.min(min,r);if(r<4.5)failures.push(`${theme} ${what} ${r.toFixed(2)}`);};
       for(const role of roles){probe.style.color=`var(--code-${role})`;check(role,getComputedStyle(probe).color);}
       check('code',getComputedStyle(code).color);check('title',getComputedStyle(title).color);check('gutter',getComputedStyle(gutter).color);}
     probe.remove();still.remove();return {themes:THEMES.length,failures,min};});
   assert.equal(report.themes,22);assert.deepEqual(report.failures,[]);
   console.log(`  code contrast, 22 themes: every syntax role, code, label and line numbers ≥ ${report.min.toFixed(2)}:1`);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Chat: a fenced block in a message renders as a wrapped Code Block with copy, without line numbers.
  {const {page,errors,external,context}=await open({layout:'scroll'},{width:1300,height:900},'library/thought.md');
   await context.grantPermissions(['clipboard-read','clipboard-write']);
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');await page.locator('#chat-panel:not([hidden])').waitFor();
   const fence='```python\nprint("from chat")\nvalue = 2\n```';
   await page.waitForFunction(()=>document.activeElement?.id==='chat-input');
   for(const [index,line] of ['Compare this:','',...fence.split('\n')].entries()){if(index)await page.keyboard.press('Shift+Enter');await page.keyboard.type(line);}
   await page.keyboard.press('Enter');
   const message=page.locator('[data-chat-message]').filter({hasText:'Compare this'});await message.waitFor();
   const chat=await message.locator('[data-slot=code-block]').evaluate(block=>({title:block.querySelector('[data-slot=code-block-title]').textContent,wrap:block.querySelector('[data-slot=code-block-content]').hasAttribute('data-wrap'),gutter:!!block.querySelector('[data-slot=code-block-gutter]'),text:block.querySelector('[data-slot=code-block-code]').textContent}));
   assert.deepEqual(chat,{title:'Python',wrap:true,gutter:false,text:'print("from chat")\nvalue = 2\n'});
   await page.waitForFunction(()=>document.querySelector('[data-chat-message] [data-slot=code-block-code]')?.dataset.highlight==='done',null,{timeout:10000});
   await message.getByRole('button',{name:'Copy code',exact:true}).click();await toast(page,'Copied 2 lines of code.').waitFor();
   assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'print("from chat")\nvalue = 2\n');
   await page.screenshot({path:'.reader/web-dev/code-block-chat.png'});
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // Phone width: long lines scroll inside the block, never the page.
  {const {page,errors,context}=await open({layout:'scroll'},{width:390,height:844});
   const fit=await page.evaluate(()=>{const pre=document.querySelectorAll('#article [data-slot=code-block-content]')[1];return {page:document.documentElement.scrollWidth<=innerWidth+1,scrolls:pre.scrollWidth>pre.clientWidth,inside:pre.getBoundingClientRect().right<=innerWidth+1};});
   assert.deepEqual(fit,{page:true,scrolls:true,inside:true});
   await page.screenshot({path:'.reader/web-dev/code-block-phone.png'});assert.deepEqual(errors,[]);await context.close();}

  // Two-page reading: blocks fit their column, the page-turn texture paints syntax colors, and the sheet turns.
  {const {page,errors,external,context}=await open({layout:'spread'});
   await page.waitForFunction(()=>document.body.classList.contains('two-page'));await highlighted(page,1);await page.waitForTimeout(200);
   const fit=await page.evaluate(()=>{const a=document.querySelector('#article'),gap=parseFloat(getComputedStyle(a).columnGap),column=(a.clientWidth-gap)/2;
     return [...document.querySelectorAll('#article .reader-code-block')].filter(b=>!b.closest('details:not([open])')).map(b=>({fragments:b.getClientRects().length,width:b.getBoundingClientRect().width,column}));});
   for(const f of fit){assert.equal(f.fragments,1,'a code block never splits across columns');assert.ok(f.width<=f.column+1,'fits the column');}
   const texture=await page.evaluate(async()=>{
     const m=await import('/assets/controls/page-turn.js'),article=document.querySelector('.book-viewport > .article'),v=document.querySelector('.book-viewport').getBoundingClientRect(),half=v.width/2;
     const code=document.querySelector('#article [data-language=python]'),r=code.getBoundingClientRect();
     const box={x:r.left<v.left+half?v.left:v.left+half,y:v.top,w:half,h:v.height};
     // Probe colors without the page's color transitions.
     const probe=document.createElement('span');probe.style.transition='none';document.body.append(probe);const color=value=>{probe.style.color=value;return getComputedStyle(probe).color.match(/\d+/g).slice(0,3).map(Number);};
     const bg=`rgb(${color('var(--bg)').join(',')})`,keyword=color('var(--code-keyword)'),ink=color('var(--ink)');probe.remove();
     const canvas=m.rasterize(article,box,0,bg,1),data=canvas.getContext('2d').getImageData(Math.round(r.left-box.x),Math.round(r.top-box.y),Math.round(r.width),Math.round(r.height)).data;
     let near=0;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-keyword[0])+Math.abs(data[i+1]-keyword[1])+Math.abs(data[i+2]-keyword[2])<40&&Math.abs(data[i]-ink[0])+Math.abs(data[i+1]-ink[1])+Math.abs(data[i+2]-ink[2])>40)near++;
     return {near,png:canvas.toDataURL('image/png')};});
   writeFileSync('.reader/web-dev/code-block-texture.png',Buffer.from(texture.png.split(',')[1],'base64'));
   assert.ok(texture.near>20,'the page-turn texture paints keyword ink: '+texture.near+' pixels');
   await page.waitForFunction(()=>import('/assets/controls/page-turn.js').then(()=>true));await page.locator('#main').focus();await page.keyboard.press('j');await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>!!document.querySelector('.page-turn-canvas')),'the sheet turns');
   await page.screenshot({path:'.reader/web-dev/code-block-turn.png'});await page.waitForFunction(()=>!document.querySelector('.page-turn-canvas'),null,{timeout:3000});
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // A document without fenced code never loads the highlighter.
  {const {page,requests,context}=await open({layout:'scroll'},undefined,'library/thought.md');await page.waitForTimeout(400);
   assert.equal(requests.filter(r=>r.includes('/controls/highlight')).length,0);await context.close();}
  console.log('Code Block passed: shadcn markup for every fence, exact text and offsets, decoration header and gutter, lazy local Shiki highlights without DOM changes, Mermaid source, annotations inside code, find, keyboard copy with toast, theme switch, 22-theme contrast, chat, phone width, two-page fit, page-turn texture and turn, highlighter loaded only when needed.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
