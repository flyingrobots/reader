/* Split view (RW-32): Ctrl-w keys, panes as embedded same-origin apps, the shell's status bar, open-in-split, per-pane
   bookmarks and receipts, theme sync, history, layout restore, side-by-side compare with scrollbind, two-page panes, phone refusal. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {waitFor,watch,sanitizerReport}=require('./web_wait.cjs');
const shots=process.env.READER_SHOTS||'.reader/web-dev';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--links','--editions','--versions'],{stdio:['ignore','pipe','inherit']});let browser;
 const errors=[],external=[],writes=[],busy=[];
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync(shots,{recursive:true});
  const open=async(prefs={},viewport={width:1280,height:900})=>{
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    // Only the first document of the context seeds preferences, so panes and reloads keep what the test changes.
    await context.addInitScript(value=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',nextReads:false,...prefs}));
    const page=await context.newPage();watch(page);
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!sanitizerReport(m))errors.push(m.text()+' '+(m.location()?.url||''));});
    page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());else if(r.method()==='POST')writes.push({path:new URL(r.url()).pathname,body:r.postData(),frame:r.frame()?.url()||''});});
    page.on('response',r=>{if(r.status()===429)busy.push(r.url());});
    return {page,context};
  };
  const ready=frame=>waitFor(frame,'pane document rendered and resumed',()=>({article:!!document.querySelector('#article'),resumed:!document.querySelector('.resume-pending'),title:!!document.querySelector('.document-title')}));
  const pane=async(page,n)=>{const handle=await page.locator(`iframe[title^="Pane ${n} of"]`).elementHandle({timeout:5000});return handle.contentFrame();};
  const count=page=>page.locator('.split-pane').count();
  const indicator=page=>page.locator('#split-indicator').textContent();
  const win=async(page,key)=>{await page.keyboard.press('Control+w');await page.keyboard.press(key);};
  const toast=async(page,text)=>page.locator('[data-sonner-toast]',{hasText:text}).first().waitFor({timeout:5000});
  const title=frame=>frame.locator('.document-title').first().textContent();
  const library=page=>page.evaluate(async()=>(await (await fetch('/api/library?participant=Browser%20tester')).json()).works);

  {const {page,context}=await open();
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await ready(page.mainFrame());
   await page.locator('#main').focus();
   const lengthBefore=await page.evaluate(()=>history.length);
   // Ctrl-w v: two panes, each its own app; the new one opens the picker and Esc keeps the document.
   await win(page,'v');await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   assert.equal(await page.locator('#main').isVisible(),false,'the single view gives way to the panes');
   const [one,two]=[await pane(page,1),await pane(page,2)];await ready(one);await ready(two);
   await two.waitForFunction(()=>!!document.querySelector('#picker')?.matches('[data-open]'));
   assert.equal(await page.locator('#split-indicator').textContent(),'2/2');
   await page.keyboard.press('Escape');await two.waitForFunction(()=>!!!document.querySelector('#picker')?.matches('[data-open]'));
   assert.equal(await title(two),'A quiet thought','Esc keeps the current document');
   assert.match(decodeURIComponent(new URL(page.url()).hash),/^#split=\{"t":\{"d":"row"/);
   assert.equal(await two.evaluate(()=>document.documentElement.classList.contains('embedded-pane')&&getComputedStyle(document.querySelector('#statusline')).display),'none','a pane has no status bar of its own');
   assert.equal(await page.locator('.split-pane.focused').getAttribute('data-pane'),await page.locator(`iframe[title^="Pane 2 of"]`).evaluate(el=>el.parentElement.dataset.pane));
   // Highlights stay in their pane: find in pane 2 paints only pane 2's registry.
   await page.keyboard.press('/');await two.locator('#find-query').fill('distinct observation');await page.keyboard.press('Enter');
   assert.ok(await two.evaluate(()=>CSS.highlights.get('reader-find')?.size)>10);
   assert.equal(await one.evaluate(()=>CSS.highlights.get('reader-find')?.size??0),0);
   // j scrolls only the focused pane.
   for(let i=0;i<6;i++)await page.keyboard.press('j');
   await two.waitForFunction(()=>scrollY>300);
   assert.equal(await one.evaluate(()=>scrollY),0,'the other pane does not move');
   // Ctrl-w h moves focus left; the status breadcrumb and number follow the focused pane.
   await win(page,'h');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent==='1/2');
   await page.keyboard.press('Space');await page.keyboard.press('e');await one.locator('#picker[data-open]').waitFor();
   await page.keyboard.press('/');await page.keyboard.type('Another');await one.locator('[data-doc-node][data-index]',{hasText:'Another thought'}).first().waitFor();await page.keyboard.press('Enter');
   await one.waitForFunction(()=>document.querySelector('.document-title')?.textContent==='Another thought'&&!document.querySelector('.resume-pending'));
   await page.waitForFunction(()=>document.querySelector('#status-location').textContent.includes('other.md'));
   assert.equal(await title(two),'A quiet thought');
   assert.equal(await page.evaluate(()=>history.length),lengthBefore+1,'only the split itself added a history entry; panes replace theirs');
   await page.screenshot({path:shots+'/split-vertical.png'});
   // Each pane wrote its own receipt and bookmark for the same participant.
   const works=await library(page);assert.equal(works.find(w=>w.primary==='library/other.md').read,true);assert.equal(works.find(w=>w.primary==='library/thought.md').read,true);
   await win(page,'l');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent==='2/2');
   await page.waitForTimeout(700);
   const marks=writes.filter(w=>w.path==='/api/bookmark').map(w=>JSON.parse(w.body));
   assert.ok(marks.some(m=>m.path==='library/thought.md'&&m.source_offset>0),'pane 2 saved its scrolled place');
   assert.ok(marks.every(m=>m.participant==='Browser tester'));
   assert.ok(writes.filter(w=>w.path==='/api/seen'&&w.frame.includes('?pane=1')).length>=2,'receipts post from the panes');
   // A theme change reaches every pane.
   await page.locator('#theme-switch-slot [role=switch]').click();
   for(const frame of [one,two])await frame.waitForFunction(()=>document.documentElement.dataset.theme!=='user-reader-test');
   const theme=await page.evaluate(()=>document.documentElement.dataset.theme);
   assert.equal(await one.evaluate(()=>document.documentElement.dataset.theme),theme);
   // Ctrl-w s stacks, x swaps, = equalizes; a fifth pane is refused.
   await page.locator('iframe[title^="Pane 2 of"]').focus();
   await win(page,'s');await page.waitForFunction(()=>document.querySelectorAll('.split-pane').length===3);
   const three=await pane(page,3);await ready(three);await three.waitForFunction(()=>!!document.querySelector('#picker')?.matches('[data-open]'));await page.keyboard.press('Escape');
   const boxes=()=>page.evaluate(()=>[...document.querySelectorAll('.split-pane')].map(el=>({id:el.dataset.pane,x:parseInt(el.style.left),y:parseInt(el.style.top),w:parseInt(el.style.width),h:parseInt(el.style.height)})).sort((a,b)=>a.x-b.x||a.y-b.y));
   const stacked=await boxes();assert.equal(stacked.length,3);assert.equal(stacked[1].x,stacked[2].x,'the new pane sits under pane 2');assert.ok(stacked[2].y>stacked[1].y);
   assert.equal(await indicator(page),'3/3');
   await win(page,'x');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent==='1/3');
   const swapped=await boxes();assert.equal(swapped[0].id,stacked[2].id,'x swapped the focused pane with the next (the first)');
   // Drag the divider, then = equalizes again.
   const divider=page.locator('.split-divider.row');const db=await divider.boundingBox();
   await page.mouse.move(db.x+3,db.y+200);await page.mouse.down();await page.mouse.move(db.x+203,db.y+200,{steps:4});await page.mouse.up();
   const dragged=await boxes();assert.ok(dragged[0].w>800,'the divider resized the panes');
   await win(page,'=');await page.waitForFunction(()=>[...document.querySelectorAll('.split-pane')].every(el=>Math.abs(parseInt(el.style.width)-637)<=1));
   const equal=await boxes();assert.ok(Math.abs(equal[0].w-equal[1].w)<=1,JSON.stringify([dragged,equal,await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,80))]));
   await win(page,'s');await page.waitForFunction(()=>document.querySelectorAll('.split-pane').length===4);
   const four=await pane(page,2);await ready(four);await four.waitForFunction(()=>!!document.querySelector('#picker')?.matches('[data-open]'));await page.keyboard.press('Escape');
   await win(page,'v');await toast(page,'Up to 4 panes.');
   assert.equal(await count(page),4);
   await page.waitForTimeout(600);assert.deepEqual(busy,[],'four panes load without a 429');
   await page.screenshot({path:shots+'/split-four.png'});
   // Reload restores the layout.
   const layout=decodeURIComponent(new URL(page.url()).hash);
   await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===4);
   for(let n=1;n<=4;n++)await ready(await pane(page,n));
   assert.equal(decodeURIComponent(new URL(page.url()).hash),layout,'the same tree, paths and focus');
   // q closes the focused pane; o keeps only the focused one and the iframes go away.
   await win(page,'q');await page.waitForFunction(()=>document.querySelectorAll('.split-pane').length===3);
   await page.waitForFunction(()=>/^\d\/3$/.test(document.querySelector('#split-indicator').textContent));
   const was=await indicator(page);await win(page,'w');await page.waitForFunction(was=>document.querySelector('#split-indicator').textContent!==was,was);
   const kept=await page.evaluate(()=>document.querySelector('.split-pane.focused iframe').contentDocument.querySelector('.document-title').textContent);
   await win(page,'o');await page.waitForFunction(()=>!document.querySelector('.split-pane')&&document.querySelector('#article')&&!document.querySelector('.resume-pending'));
   assert.equal(await page.locator('.document-title').first().textContent(),kept,'the shell shows the kept pane’s document');
   assert.equal(await page.locator('iframe').count(),0,'single-pane Reader has no iframe');
   assert.equal(await page.locator('#split-indicator').isVisible(),false);
   assert.match(new URL(page.url()).hash,/^#read=/);
   // Ctrl-w f on a focused link and Shift-click open the target in the other pane.
   await page.goto(url+'#read='+encodeURIComponent('library/linked/source.md'));await ready(page.mainFrame());
   await page.locator('#article a',{hasText:'a quiet thought'}).click({modifiers:['Shift']});
   await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   const right=await pane(page,2);await right.waitForFunction(()=>document.querySelector('.document-title')?.textContent==='A quiet thought');
   assert.equal(await title(await pane(page,1)),'Link sampler');
   const left=await pane(page,1);await ready(left);
   await win(page,'h');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent==='1/2');
   await left.locator('#article a',{hasText:'other'}).first().focus();
   await win(page,'f');await right.waitForFunction(()=>document.querySelector('.document-title')?.textContent==='Another thought');
   assert.equal(await indicator(page),'2/2','the target pane takes focus');
   // Browser Back never steps a background pane: it leaves the split for the single view before it.
   await page.goBack();await page.waitForFunction(()=>!document.querySelector('.split-pane')&&document.querySelector('.document-title')?.textContent==='Link sampler');
   await context.close();}

  // A #split= layout with a scratch pad pane restores that draft, not the homepage (#92).
  {const {page,context}=await open();
   const draft='0f8fad5b-d9cb-469f-a165-70867728950e',layout={t:{d:'row',s:[.5,.5],c:['#read='+encodeURIComponent('library/thought.md'),'#scratch='+draft]},f:1};
   await page.goto(url+'#split='+encodeURIComponent(JSON.stringify(layout)));
   await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   const scratch=await pane(page,2);await scratch.locator('.cm-editor').waitFor({timeout:8000});
   assert.equal(new URL(scratch.url()).hash,'#scratch='+draft,'the pane opens that draft');
   await page.waitForTimeout(300);
   assert.deepEqual(JSON.parse(decodeURIComponent(new URL(page.url()).hash.slice(7))).t.c,layout.t.c,'the shell keeps the scratch route in its layout');
   await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   await (await pane(page,2)).locator('.cm-editor').waitFor({timeout:8000});
   assert.equal(new URL((await pane(page,2)).url()).hash,'#scratch='+draft,'and survives a reload');
   await context.close();}

  // Side by side compare from the Versions panel: the older version on the left, scrolling together.
  {const {page,context}=await open();
   await page.goto(url+'#read='+encodeURIComponent('library/essays/tidal/tidal.md'));await ready(page.mainFrame());
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('v');await page.locator('#versions-panel').waitFor();
   for(let i=0;i<3;i++)await page.keyboard.press('j');  // Past the History summary to the file's first commit.
   assert.match(await page.evaluate(()=>document.activeElement.dataset.ref),/tidal\.md@[0-9a-f]{40}$/);
   await page.locator('#versions-panel [data-compare-split]').click();
   await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   const [old,now]=[await pane(page,1),await pane(page,2)];await ready(old);await ready(now);
   assert.match(await old.locator('#article').textContent(),/kept an early thought/,'the left pane is the older version');
   assert.doesNotMatch(await now.locator('#article').textContent(),/kept an early thought/);
   await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent.includes('⇅'));
   assert.equal(await page.locator('.split-bind[aria-pressed=true]').count(),1,'the divider shows the link');
   // Scroll the focused (older) pane; the matching paragraph on the right lines up within a frame plus 50 ms.
   await win(page,'h');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent.startsWith('1/2'));
   for(const n of [9,20]){
     await old.evaluate(n=>{const p=[...document.querySelectorAll('#article p')].find(el=>el.textContent.startsWith('Paragraph '+n+' '));scrollTo(0,scrollY+p.getBoundingClientRect().top-120);},n);
     await page.waitForTimeout(16+50);
     const [a,b]=await Promise.all([old,now].map(frame=>frame.evaluate(n=>[...document.querySelectorAll('#article p')].find(el=>el.textContent.startsWith('Paragraph '+n+' ')).getBoundingClientRect().top,n)));
     assert.ok(Math.abs(a-b)<=3,`paragraph ${n} aligned: ${a} vs ${b}`);
   }
   await page.screenshot({path:shots+'/split-compare.png'});
   // The divider toggle unlinks them.
   await page.locator('.split-bind[aria-pressed=true]').click({force:true});await page.waitForFunction(()=>!document.querySelector('#split-indicator').textContent.includes('⇅'));
   const before=await now.evaluate(()=>scrollY);await old.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);
   assert.equal(await now.evaluate(()=>scrollY),before,'unlinked panes scroll on their own');
   await context.close();}

  // The window keys live in the keymap (RW-18): Space W is the same prefix, the shell shows WINDOW with generated hints,
  // Ctrl held for the second key works, Ctrl-w in a text field is left alone, and :vsplit / :split / :set scrollbind work in a pane.
  {const {page,context}=await open({},{width:1600,height:900});
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await ready(page.mainFrame());
   await page.locator('#main').focus();await page.keyboard.press('/');await page.locator('#find-query').focus();
   await page.keyboard.press('Control+w');await page.keyboard.press('v');
   assert.equal(await count(page),0,'Ctrl-w v while typing does not split');assert.notEqual(await page.locator('#vim-mode').textContent(),'WINDOW');
   await page.keyboard.press('Escape');await page.locator('#main').focus();
   // #111: the WINDOW prefix waits 1.5 s for its next key, which a loaded machine can spend on the round trips that read
   // the status bar. So the page records the status bar while the keys go in back to back, and the test checks it after.
   await page.evaluate(()=>{const seen=window.__windowStatus=[],bar=document.querySelector('#statusline');
     new MutationObserver(()=>seen.push([document.querySelector('#vim-mode').textContent,document.querySelector('#status-keys').textContent])).observe(bar,{subtree:true,childList:true,characterData:true});});
   await page.keyboard.press('Space');await page.keyboard.press('Shift+W');await page.keyboard.press('v');
   const shown=await page.evaluate(()=>window.__windowStatus.find(([mode])=>mode==='WINDOW'));
   assert.ok(shown,'Space W shows WINDOW');assert.match(shown[1],/v side by side.*s stacked/);
   await waitFor(page,'Space W v opens a second pane',()=>({panes:document.querySelectorAll('.split-pane iframe').length===2}));
   const two=await pane(page,2);await ready(two);await two.waitForFunction(()=>!!document.querySelector('#picker')?.matches('[data-open]'));await page.keyboard.press('Escape');
   await two.waitForFunction(()=>!!!document.querySelector('#picker')?.matches('[data-open]'));
   await page.keyboard.press('Control+w');await page.keyboard.press('Control+w');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent==='1/2');
   await page.keyboard.press('Control+w');await page.keyboard.press('l');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent==='2/2');
   // A pane's command line shows in its own status bar while typing.
   const paneEx=async command=>{await page.keyboard.press(':');await two.locator('#command-input').waitFor({state:'visible'});await page.keyboard.type(command);await page.keyboard.press('Enter');};
   await paneEx('set scrollbind');await page.waitForFunction(()=>document.querySelector('#split-indicator').textContent.includes('⇅'));
   assert.equal(await page.locator('.split-bind[aria-pressed=true]').count(),1,':set scrollbind links the panes');
   await paneEx('set noscrollbind');await page.waitForFunction(()=>!document.querySelector('#split-indicator').textContent.includes('⇅'));
   await paneEx('split Another thought');await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===3);
   const three=await pane(page,3);await three.waitForFunction(()=>document.querySelector('.document-title')?.textContent==='Another thought');
   assert.equal(await three.evaluate(()=>!!document.querySelector('#picker')?.matches('[data-open]')),false,':split with a document skips the picker');
   assert.equal(await indicator(page),'3/3');
   // #111: keys reach a pane only once it has the keyboard, and a document that is still rendering moves focus to its
   // page when it finishes (closing a command line opened meanwhile), so wait for both before typing into the new pane.
   await ready(three);
   await waitFor(three,'pane 3 has the keyboard',()=>({focused:document.documentElement.classList.contains('pane-focused'),keyboard:document.hasFocus(),_active:document.activeElement?.id||document.activeElement?.tagName}),{timeout:10000});
   await page.keyboard.press(':');await waitFor(three,'pane 3 command line open',()=>({open:!!document.querySelector('#command-input')?.offsetParent,_mode:document.querySelector('#vim-mode')?.textContent,_keyboard:document.hasFocus()}),{timeout:10000});await page.keyboard.type('vsplit');await page.keyboard.press('Enter');
   // If :vsplit does not split, report each pane's command line and status (a baseline stress run saw this wait time out).
   await waitFor(page,':vsplit from pane 3 opens a fourth pane',()=>({panes:document.querySelectorAll('.split-pane iframe').length===4,_indicator:document.querySelector('#split-indicator').textContent,
     _lines:[...document.querySelectorAll('.split-pane iframe')].map(f=>{const d=f.contentDocument,i=d?.querySelector('#command-input');return {line:i?(i.offsetParent?'open:':'closed:')+i.value:null,mode:d?.querySelector('#vim-mode')?.textContent,focus:d?.hasFocus()};})}));
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.split-pane')].filter(p=>p.style.top===document.querySelector('.split-pane.focused').style.top).length),2,':vsplit splits the focused pane side by side');
   await context.close();}

  // Two-page reading in vertical panes uses one column each at 1280px; at 390px splitting is refused.
  {const {page,context}=await open({layout:'spread'});
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await ready(page.mainFrame());
   await page.locator('#main').focus();await win(page,'v');await page.waitForFunction(()=>document.querySelectorAll('.split-pane iframe').length===2);
   for(let n=1;n<=2;n++){const frame=await pane(page,n);await ready(frame);await frame.waitForFunction(()=>document.body.classList.contains('two-page'));
     assert.equal(await frame.evaluate(()=>getComputedStyle(document.querySelector('#article')).columnCount),'1',`pane ${n} reads one column`);}
   await page.keyboard.press('Escape');
   await page.setViewportSize({width:390,height:844});
   await page.waitForFunction(()=>document.querySelector('.split-root').classList.contains('split-narrow'));
   assert.equal(await page.locator('.split-pane:visible').count(),1,'a narrow window shows only the focused pane');
   await page.screenshot({path:shots+'/split-narrow.png'});
   await context.close();}
  {const {page,context}=await open({},{width:390,height:844});
   await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await ready(page.mainFrame());
   await page.locator('#main').focus();await win(page,'v');await toast(page,'Splitting needs a wider window.');
   assert.equal(await page.locator('.split-pane').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await context.close();}

  assert.deepEqual(external,[]);assert.deepEqual(busy,[]);assert.deepEqual(errors,[]);
  console.log('Split view passed: Space W prefix with WINDOW hints, Ctrl-w Ctrl-w, Ctrl-w ignored while typing, :set scrollbind / noscrollbind and :vsplit / :split from a pane, Ctrl-w v with picker and Esc, per-pane highlights and j, Ctrl-w h/l focus with status number and breadcrumb, panes replace history, per-pane receipts and bookmarks, theme to every pane, Ctrl-w s/x/=/drag, fifth pane refused, four panes without 429, reload restore, a scratch pane in a #split= layout, q and o back to one pane without iframes, Shift-click and Ctrl-w f, Back leaves the split, side-by-side compare aligned within a frame plus 50 ms and unlinking, one column per two-page pane at 1280px, narrow fallback, 390px refusal, local-only requests.');
 }catch(error){console.error('Page errors:',errors);throw error;}finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
