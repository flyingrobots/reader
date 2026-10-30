/* Prose colors (Colorful Language) against a synthetic vault and the fake colorful CLI. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const start=async flag=>{const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py',flag],{stdio:['ignore','pipe','inherit']});
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});return {fixture,url};};
const stop=async fixture=>{if(fixture&&fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}};
// Words each named highlight covers, read back from the live Range objects.
const covered=page=>page.evaluate(()=>Object.fromEntries([...CSS.highlights].filter(([name])=>name.startsWith('reader-prose-')).map(([name,set])=>[name.slice(13),[...set].map(r=>r.toString())])));
(async()=>{
 let browser,fixture;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  let url;
  const open=async(prefs,path='library/prose.md',viewport={width:1200,height:900})=>{
    const context=await browser.newContext({viewport,reducedMotion:prefs.reducedMotion||'reduce'});
    await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',...prefs}));
    const page=await context.newPage(),errors=[],external=[],posts=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/status of 409/.test(m.text()))errors.push(m.text());});
    page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());if(r.method()==='POST'&&r.url().endsWith('/api/prose'))posts.push(r.postDataJSON());});
    await page.goto(url+'#read='+encodeURIComponent(path));await page.waitForFunction(()=>!document.querySelector('.resume-pending')&&document.querySelector('#article')).catch(error=>{throw new Error(path+' did not open: '+errors.join(' | ')+' '+error.message);});
    return {page,context,errors,external,posts};
  };
  const leader=async(page,key)=>{await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press(key);};
  const settled=page=>page.waitForFunction(()=>{const s=CSS.highlights.get('reader-prose-function');return s&&s.size>0;},null,{timeout:8000});

  // 1. Without Colorful, the toggle explains how to install it and the page is unchanged.
  ({fixture,url}=await start('--prose-missing'));
  {const {page,context,errors,external}=await open({});
   // The Settings default (Clear) says nothing on open when Colorful is missing; Space c explains.
   await page.waitForTimeout(400);assert.equal(await page.locator('[data-sonner-toast]').count(),0,'no toast on open');
   await leader(page,'c');
   // The companion prompt: what is missing and what it adds, its repo, and (without cargo) How to install.
   const prompt=page.locator('[data-companion-prompt=colorful]');await prompt.waitFor();
   assert.equal(await prompt.locator('[data-prompt-title]').textContent(),'Prose colors needs Colorful Language');
   assert.equal(await prompt.locator('a').getAttribute('href'),'https://github.com/flyingrobots/colorful-language');
   assert.equal(await prompt.locator('[data-prompt-action=setup]').count(),1,'no cargo: guided setup, not Install');
   await prompt.locator('[data-prompt-action=dismiss]').click();await prompt.waitFor({state:'detached'});
   assert.deepEqual(await covered(page),{},'no prose highlights');assert.equal(await page.locator('#prose-chip').isHidden(),true);
   assert.equal(await page.evaluate(()=>/prose-(subtle|clear|vivid)/.test(document.body.className)),false);
   await leader(page,'p');await page.locator('#prose-status').filter({hasText:"isn't installed"}).waitFor();
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}
  await stop(fixture);

  ({fixture,url}=await start('--prose'));
  // 2. Space c colors the open document: named highlights over the right words, never code, math or diagrams.
  {const {page,context,errors,external,posts}=await open({proseColors:'off'});
   assert.deepEqual(await covered(page),{},'off when Settings say Off');
   // Diagrams draw after first paint; compare against the settled article.
   await page.waitForFunction(()=>!document.querySelector('#article .reader-diagram-canvas[data-state=loading]'));
   const markup=await page.locator('#article').innerHTML();
   await leader(page,'c');await settled(page);
   await page.waitForFunction(()=>document.body.classList.contains('prose-subtle'));
   assert.equal(await page.locator('#prose-chip').isVisible(),true);assert.equal(await page.locator('#prose-chip').getAttribute('aria-label'),'Prose colors: Subtle');
   const words=await covered(page);
   for(const word of ['The','and','for','a'])assert.ok(words.function.includes(word),'function: '+word);
   assert.ok(words.proper.includes('Ada'),'proper noun');assert.ok(words.number.includes('12')&&words.number.includes('3'),'numbers');
   assert.ok(words.quote.includes('“')&&words.quote.includes('”'),'quotes');assert.ok(words.noun.includes('library')&&words.verb.includes('holds'),'open classes');
   assert.ok(!words.function.includes('Colored'),'no stray words');
   assert.deepEqual(words.quoted,['each passage waits'],'the quoted passage between paired marks');
   const leaks=await page.evaluate(()=>[...CSS.highlights].filter(([n])=>n.startsWith('reader-prose-')).flatMap(([,set])=>[...set]).filter(r=>r.startContainer.parentElement.closest('pre,code,.katex,details,[data-reader-decoration],.reader-code-block')).map(r=>r.toString()));
   assert.deepEqual(leaks,[],'code, math, diagrams and decorations stay uncolored');
   // Visible blocks go first; the rest fills in progressively, in bounded batches.
   assert.ok(posts.length>=1&&posts.every(p=>p.segments.length<=400&&p.sha256.length===64));
   assert.ok(posts[0].segments.some(s=>s.text.startsWith('The quiet library holds 12 rooms')),'first batch carries the visible opening');
   const requests=posts.length;
   // Space c steps Subtle → Clear → Vivid → Off → Subtle: CSS only, the colored ranges are reused.
   const paints=()=>page.evaluate(()=>{const b=getComputedStyle(document.body),r=getComputedStyle(document.documentElement);return {fn:b.getPropertyValue('--prose-ink-function').trim(),line:b.getPropertyValue('--prose-line-proper').trim(),wash:b.getPropertyValue('--prose-bg-quoted').trim(),recede:r.getPropertyValue('--prose-recede').trim(),vivid:r.getPropertyValue('--prose-function').trim(),underline:r.getPropertyValue('--prose-underline').trim(),washToken:r.getPropertyValue('--prose-wash').trim()};});
   await leader(page,'c');await page.waitForFunction(()=>document.body.classList.contains('prose-clear'));
   assert.equal(await page.locator('#prose-chip').getAttribute('aria-label'),'Prose colors: Clear');
   let paint=await paints();assert.equal(paint.fn,paint.recede,'Clear recedes function words');assert.equal(paint.line,'','Clear underlines nothing');
   await leader(page,'c');await page.waitForFunction(()=>document.body.classList.contains('prose-vivid'));
   assert.equal(await page.locator('#prose-chip').getAttribute('aria-label'),'Prose colors: Vivid');
   paint=await paints();assert.equal(paint.fn,paint.vivid,'Vivid paints the derived role token');assert.equal(paint.line,paint.underline,'Vivid underlines names');assert.equal(paint.wash,paint.washToken,'Vivid washes quoted passages');
   await page.screenshot({path:'.reader/web-dev/prose-vivid.png'});
   await leader(page,'c');await page.waitForFunction(()=>!/prose-(subtle|clear|vivid)/.test(document.body.className)&&!CSS.highlights.has('reader-prose-function'));
   assert.equal(await page.locator('#prose-chip').isHidden(),true);
   await leader(page,'c');await page.waitForFunction(()=>document.body.classList.contains('prose-subtle')&&CSS.highlights.has('reader-prose-function'));
   await page.waitForTimeout(300);assert.equal(posts.length,requests,'switching styles sends no request');
   // Find still works over colored text, and the DOM is unchanged.
   await page.keyboard.press('/');await page.locator('#find-query').fill('careful thought');
   await page.waitForFunction(()=>CSS.highlights.get('reader-find')?.size>0);
   assert.equal(await page.locator('#article').innerHTML(),markup,'the article DOM is unchanged');
   await page.keyboard.press('Escape');
   assert.match(await page.locator('#status-keys').innerHTML(),/kbd/);
   await leader(page,'?');assert.ok((await page.locator('#help').textContent()).includes('Prose colors: Off, Subtle, Clear, Vivid'));await page.keyboard.press('Escape');
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // 3. The Settings default colors on open (a saved pre-scale "skim" means Subtle); annotations and selection work over colored text.
  {const {page,context,errors}=await open({proseColors:'skim'},'library/thought.md');
   await settled(page);assert.ok(await page.evaluate(()=>document.body.classList.contains('prose-subtle')),'skim reads as Subtle');await page.waitForFunction(()=>CSS.highlights.get('reader-warning')?.size===1);
   assert.equal(await page.locator('.annotation-pin.warning').count(),1,'margin annotation still anchors');
   const selected=await page.evaluate(()=>{const p=[...document.querySelectorAll('#article p')].find(el=>el.textContent.includes('distinct observation for chapter 3'));const node=[...p.childNodes].find(n=>n.nodeType===3);const range=document.createRange();const at=node.data.indexOf('distinct observation');range.setStart(node,at);range.setEnd(node,at+'distinct observation for chapter 3'.length);getSelection().removeAllRanges();getSelection().addRange(range);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return getSelection().toString();});
   assert.equal(selected,'distinct observation for chapter 3');await page.locator('#selection-tools').waitFor();
   await leader(page,'p');await page.locator('#prose-status').filter({hasText:'Using Colorful 0.4.0'}).waitFor();
   assert.match(await page.locator('#prose-colors').textContent(),/^Subtle: function words fade a little/);
   // #44: Colorful's open-class lexicon is a small seed list, and Settings says so rather than promising every word a color.
   assert.match(await page.locator('#prose-status').textContent(),/Vivid colors nouns, verbs, adjectives and adverbs only for the few words Colorful's lexicon knows; most content words keep the body ink\./);
   assert.deepEqual(errors,[]);await context.close();}

  // 4. Two-page reading: the page-turn textures carry the prose inks.
  {const {page,context,errors}=await open({layout:'spread',proseColors:'vivid',reducedMotion:'no-preference'},'library/prose.md',{width:1300,height:820});
   await page.waitForFunction(()=>document.body.classList.contains('two-page'));await settled(page);
   await page.waitForFunction(()=>import('/assets/controls/page-turn.js').then(()=>true));
   await page.evaluate(()=>{window.inks=new Set();const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(...args){window.inks.add(this.fillStyle);return fill.apply(this,args);};});
   await page.waitForFunction(()=>document.querySelector('#article').scrollWidth>0);await page.waitForTimeout(500);
   await page.locator('#main').focus();await page.keyboard.press('j');
   await page.waitForFunction(()=>window.inks.size>2,null,{timeout:4000});
   const result=await page.evaluate(()=>{const c=document.createElement('canvas').getContext('2d');const norm=v=>{c.fillStyle=v;return c.fillStyle;};const s=getComputedStyle(document.body);return {inks:[...window.inks],want:['function','noun','verb'].map(r=>norm(s.getPropertyValue('--prose-ink-'+r).trim()))};});
   for(const ink of result.want)assert.ok(result.inks.includes(ink),'page turn paints '+ink+' among '+result.inks.join(' '));
   await page.waitForFunction(()=>!document.querySelector('.page-turn-canvas'),null,{timeout:4000});
   await page.screenshot({path:'.reader/web-dev/prose-two-page.png'});
   assert.deepEqual(errors,[]);await context.close();}

  // Monocolor paints real Colorful Language ranges with multiple supplied shades.
  for(const theme of ['monocolor','monocolor-dark']){
   const {page,context,errors}=await open({theme,proseColors:'vivid'});await settled(page);
   const paint=await page.evaluate(()=>{
    const body=getComputedStyle(document.body),roles=['function','proper','quote','number','noun','verb','adjective','adverb'];
    return Object.fromEntries(roles.map(role=>[role,body.getPropertyValue('--prose-'+role).trim()]));
   });
   const palette=new Set(Object.values(require('../src/reader_mcp/web_ui/famous-themes.json').themes.find(t=>t.id==='monocolor').palette));
   for(const value of Object.values(paint))assert.ok(palette.has(value));
   assert.ok(new Set(Object.values(paint)).size>=(theme.endsWith('-dark')?5:4),theme+' uses a grayscale range');
   assert.ok((await covered(page)).proper.includes('Ada'),'Colorful ranges are active');
   await page.screenshot({path:'.reader/web-dev/prose-'+theme+'.png'});
   assert.deepEqual(errors,[]);await context.close();
  }

  // 5. Every theme, light and dark, at every intensity. Subtle: every role 4.5:1. Clear: function
  //    words and punctuation recede to 3:1 (and no further than 3.3:1), content words hold 7:1, names,
  //    numbers and quotes 4.5:1 with names ≥ 0.12 ΔE_OK from the content ink. Vivid: every role 4.5:1,
  //    0.08 ΔE_OK apart and from ink and muted, and still 4.5:1 over the quoted-passage wash.
  {const {page,context,errors}=await open({proseColors:'vivid'});
   await settled(page);
   const report=await page.evaluate(async()=>{
     const {THEMES}=await import('/assets/themes.mjs');const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d',{willReadFrequently:true});
     const rgb=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='#000';ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data.slice(0,3)];};
     const lin=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
     const lum=([r,g,b])=>[r,g,b].map(lin).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
     const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
     const lab=([r,g,b])=>{[r,g,b]=[r,g,b].map(lin);const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];};
     const dE=(a,b)=>{const x=lab(a),y=lab(b);return Math.hypot(x[0]-y[0],x[1]-y[1],x[2]-y[2]);};
     const over=(top,alpha,back)=>top.map((v,i)=>Math.round(v*alpha+back[i]*(1-alpha)));
     const probe=document.createElement('span');probe.style.transition='none';document.querySelector('#article').append(probe);
     const still=document.createElement('style');still.textContent='*{transition:none!important}';document.head.append(still);
     const paragraph=document.querySelector('#article p');const failures=[],min={subtle:9,clearRecede:9,clearRecedeMax:0,clearRole:9,content:99,vivid:9,distinct:9,wash:9,names:9};
     const roles=['function','proper','quote','number','punct','noun','verb','adjective','adverb'];
     for(const theme of THEMES){
       // Palette-only Monocolor intentionally has no hue separation; covered by web_theme_picker.
       if(theme==='monocolor'||theme==='monocolor-dark')continue;
       document.documentElement.dataset.theme=theme;await new Promise(r=>setTimeout(r,0));
       const root=getComputedStyle(document.documentElement),bg=rgb(root.getPropertyValue('--bg').trim()),muted=rgb(root.getPropertyValue('--muted').trim());
       const fail=(what,value)=>failures.push(`${theme} ${what} ${typeof value==='number'?value.toFixed(3):value}`);
       for(const level of ['subtle','clear','vivid']){document.body.classList.remove('prose-subtle','prose-clear','prose-vivid');document.body.classList.add('prose-'+level);
         const ink=rgb(getComputedStyle(paragraph).color),paint={};
         for(const role of roles){probe.style.color=`var(--prose-ink-${role},var(--ink))`;paint[role]=rgb(getComputedStyle(probe).color);}
         if(level==='subtle')for(const role of roles){const v=ratio(paint[role],bg);min.subtle=Math.min(min.subtle,v);if(v<4.5)fail('subtle '+role,v);}
         if(level==='clear'){
           const v=ratio(ink,bg);min.content=Math.min(min.content,v);if(v<7)fail('clear content',v);
           for(const role of ['function','punct']){const r=ratio(paint[role],bg);min.clearRecede=Math.min(min.clearRecede,r);min.clearRecedeMax=Math.max(min.clearRecedeMax,r);if(r<3||r>3.3)fail('clear recede '+role,r);}
           for(const role of ['proper','number','quote']){const r=ratio(paint[role],bg);min.clearRole=Math.min(min.clearRole,r);if(r<4.5)fail('clear '+role,r);}
           const names=dE(paint.proper,ink);min.names=Math.min(min.names,names);if(names<.12)fail('clear names vs ink ΔE',names);}
         if(level==='vivid'){
           for(const role of roles){const r=ratio(paint[role],bg);min.vivid=Math.min(min.vivid,r);if(r<4.5)fail('vivid '+role,r);}
           const colored=roles.filter(r=>r!=='punct');
           for(let i=0;i<colored.length;i++)for(const [name,other] of [...colored.slice(i+1).map(n=>[n,paint[n]]),['ink',ink],['muted',muted]]){const d=dE(paint[colored[i]],other);min.distinct=Math.min(min.distinct,d);if(d<.08)fail(`vivid ΔE ${colored[i]}/${name}`,d);}
           const wash=getComputedStyle(document.body).getPropertyValue('--prose-bg-quoted').trim();probe.style.color=wash;const parts=getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
           const washed=over(parts.slice(0,3),parts[3]??1,bg);for(const value of [ink,...colored.map(r=>paint[r])]){const r=ratio(value,washed);min.wash=Math.min(min.wash,r);if(r<4.5)fail('vivid over wash',r);}}}}
     probe.remove();still.remove();return {themes:THEMES.length,failures,min};});
   assert.equal(report.themes,6+2*require('../src/reader_mcp/web_ui/famous-themes.json').themes.length);assert.deepEqual(report.failures,[]);
   const m=report.min;console.log(`  prose contrast, 22 themes: Subtle ≥ ${m.subtle.toFixed(2)}:1; Clear skeleton ${m.clearRecede.toFixed(2)}–${m.clearRecedeMax.toFixed(2)}:1, content ≥ ${m.content.toFixed(2)}:1, roles ≥ ${m.clearRole.toFixed(2)}:1, names ΔE_OK ≥ ${m.names.toFixed(3)} from ink; Vivid ≥ ${m.vivid.toFixed(2)}:1, roles ΔE_OK ≥ ${m.distinct.toFixed(3)}, over wash ≥ ${m.wash.toFixed(2)}:1`);
   assert.deepEqual(errors,[]);await context.close();}

  // 6. Phone width: no horizontal scroll, the chip still shows.
  {const {page,context,errors,external}=await open({},'library/prose.md',{width:390,height:844});
   await settled(page);assert.ok(await page.evaluate(()=>document.body.classList.contains('prose-clear')),'Clear is the default');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page scroll');
   assert.equal(await page.locator('#prose-chip').isVisible(),true);await page.screenshot({path:'.reader/web-dev/prose-phone.png'});
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}

  // 7. PDF text layers are colored, the canvas is untouched.
  {const {page,context,errors}=await open({proseColors:'vivid'},'library/pages.pdf');
   await page.waitForFunction(()=>document.querySelector('.textLayer span'));await settled(page);
   const words=await covered(page);assert.ok(words.adjective.includes('precise')||words.noun.includes('observation'),'PDF words carry roles');
   assert.ok(await page.evaluate(()=>[...CSS.highlights.get('reader-prose-function')].every(r=>r.startContainer.parentElement.closest('.textLayer'))));
   assert.deepEqual(errors,[]);await context.close();}
  // 8. The home issue: Space c colors its standfirsts and note under the issue's week, never titles or controls.
  {const context=await browser.newContext({viewport:{width:1200,height:900},reducedMotion:'reduce'});
   await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',art:false,proseColors:'off'}));
   const page=await context.newPage(),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/prose'))posts.push(r.postDataJSON());});
   await page.goto(url+'#');await page.locator('.issue').waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('.cover-standfirst,.feature-standfirst,.issue-note')].some(e=>e.textContent.trim()),null,{timeout:8000});
   assert.deepEqual(await covered(page),{},'the issue starts uncolored');
   await leader(page,'c');await settled(page);
   assert.ok(posts.length&&posts.every(p=>/^\d{4}-W\d{2}$/.test(p.issue)&&!('path' in p)),'issue requests carry the week: '+JSON.stringify(posts.map(p=>Object.keys(p))));
   assert.ok(await page.evaluate(()=>[...CSS.highlights].filter(([n])=>n.startsWith('reader-prose-')).every(([,set])=>[...set].every(r=>r.startContainer.parentElement.closest('.cover-standfirst,.feature-standfirst,.issue-note')))),'only issue prose is colored');
   assert.equal(await page.locator('#prose-chip').isVisible(),true);
   await leader(page,'c');await leader(page,'c');await leader(page,'c');
   await page.waitForFunction(()=>!CSS.highlights.has('reader-prose-function'));
   assert.deepEqual(errors,[]);await context.close();}
  console.log('Prose colors passed: missing-binary explanation (quiet default), Space c Off/Subtle/Clear/Vivid, legacy settings, quoted passages, role words, code/math/diagram exclusion, visible-first batches, style switch without requests, find, annotations and selection, two-page textures, 22-theme floors per intensity, phone width, PDF text layers, local-only requests.');
 }finally{await browser?.close();await stop(fixture);}
})().catch(error=>{console.error(error);process.exitCode=1;});
