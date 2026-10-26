/* The modal keyboard (synthetic data): VISUAL selections anchor like mouse ones, the `:` command line,
   registers and Ctrl-r, the location list, marks and jumps, document motions, the generated help, and
   two-page VISUAL. No page errors, no external requests and no key capture while typing. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const press=async(page,...keys)=>{for(const key of keys)await page.keyboard.press(key);};
const status=page=>page.evaluate(()=>({mode:document.querySelector('#vim-mode').textContent,keys:document.querySelector('#status-keys').textContent,qf:document.querySelector('#status-qf').hidden?'':document.querySelector('#status-qf').textContent}));
const highlightText=(page,name)=>page.evaluate(name=>[...(CSS.highlights.get(name)||[])].map(range=>range.toString()).join('|'),name);
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--modal','--search-page'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const errors=[],external=[];
  const open=async(path,{viewport={width:1440,height:900},prefs=null}={})=>{
   const context=await browser.newContext({reducedMotion:'reduce',viewport});const page=await context.newPage();
   page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});
   if(prefs)await context.addInitScript(prefs=>localStorage.setItem('reader.preferences.v1',JSON.stringify(prefs)),prefs);
   await page.goto(url+'/#read='+encodeURIComponent(path));await page.waitForFunction(()=>!document.querySelector('.resume-pending')&&document.querySelector('#article p')&&getComputedStyle(document.querySelector('#article p')).visibility==='visible');
   await page.locator('#main').focus();return page;};
  const source=page=>page.evaluate(()=>fetch('/api/file?path='+encodeURIComponent('library/thought.md')).then(r=>r.text()));
  let page=await open('library/thought.md');const before=await source(page);

  // The help is generated from the table: every mapped key appears, with the existing descriptions.
  const help=await page.evaluate(()=>({text:document.querySelector('#help').textContent,dts:[...document.querySelectorAll('#help-keys dt')].map(dt=>dt.textContent.replace(/\s+/g,' ')),listed:window.readerKeymap.listed(),commands:window.readerKeymap.commands()}));
  const label=key=>({'<Space>':'Space','<CR>':'Enter','<Down>':'↓','<Up>':'↑','<Left>':'←','<Right>':'→','{a-z}':'a–z','{mark}':'a–z'})[key]||key.replace(/^<C-(.)>$/,'Ctrl $1').replace(/^<(.+)>$/,'$1');
  const tokens=keys=>keys.match(/<[^>]+>|\{[a-z-]+\}|./g)||[];
  for(const entry of help.listed.filter(e=>e.runs)){
   const shown=tokens(entry.keys).map(label).join(' ');
   assert.ok(help.dts.some(dt=>dt.includes(shown)),`the help lists ${entry.keys} (${shown})`);
  }
  for(const entry of help.listed.filter(e=>e.help))assert.ok(help.text.includes(entry.help.replace(/`/g,'').slice(0,24)),'help text for '+entry.keys);
  for(const text of ['Show or hide the document outline','Prose colors: Off, Subtle, Clear, Vivid','Send to AI-TTS','Return to your homepage','Select from the keyboard'])assert.ok(help.text.includes(text),text);
  for(const name of ['open','theme','layout','grep','copen','marks','registers','help'])assert.ok(help.commands.includes(name)&&help.text.includes(':'+name),'command '+name);

  // v, three sentences, h: a highlight anchored exactly like a mouse selection; the source is unchanged.
  await press(page,'v');assert.equal((await status(page)).mode,'VISUAL');
  await press(page,'}','}','}','Escape');assert.equal((await status(page)).mode,'NORMAL','Escape leaves VISUAL');
  await press(page,'v',')',')',')');
  const shown=await status(page);assert.match(shown.keys,/3 sentences · 22 words/,'the status line counts the selection: '+shown.keys);
  const three='A quiet library holds room for careful thought. Each passage carries a different observation. A quiet library holds room for careful thought.';
  assert.equal(await highlightText(page,'reader-visual'),three+' ','the visual highlight covers the three sentences');
  assert.equal((await page.evaluate(()=>getSelection().toString())).trim(),three,'the page selection mirrors VISUAL for assistive technology');
  assert.ok(await page.locator('#selection-tools').isHidden(),'no mouse toolbar in VISUAL');
  const created=page.waitForResponse(r=>r.url().endsWith('/api/annotations')&&r.request().method()==='POST');
  await press(page,'h');const thread=await (await created).json();
  const cp=offset=>Array.from(before.slice(0,offset)).length,first=before.indexOf('A quiet library',before.indexOf('## Chapter 1\n'));
  assert.equal(thread.anchor.quote,three,'the highlight quotes the three sentences');
  assert.equal(thread.anchor.start,cp(first),'anchored at chapter 1, as a mouse selection would be');
  assert.equal(await source(page),before,'source bytes unchanged');
  assert.equal((await status(page)).mode,'NORMAL');

  // V then c: the comment dialog with the whole block.
  await page.waitForFunction(()=>document.querySelector('.annotation-pin'));
  await press(page,'V');assert.equal((await status(page)).mode,'VISUAL LINE');
  await press(page,'c');await page.locator('#annotation-dialog[open]').waitFor();
  const block=await page.evaluate(()=>document.querySelector('#annotation-quote').textContent);
  assert.ok(block.startsWith('A quiet library')&&block.trim().endsWith('different observation.')&&block.length>800,'the whole paragraph: '+block.slice(0,80));
  await press(page,'Escape');await page.locator('#annotation-dialog[open]').waitFor({state:'detached'});

  // ]c reaches the new thread's margin mark; Enter on it opens the thread.
  await press(page,'g','g');await page.waitForTimeout(100);await press(page,']','c');
  await page.waitForFunction(()=>document.activeElement?.classList.contains('annotation-pin'));
  await press(page,'Escape');

  // Counts: 3j scrolls three steps.
  await press(page,'g','g');await page.waitForFunction(()=>scrollY===0);await press(page,'3','j');await page.waitForFunction(()=>scrollY>=250);

  // The command line: completion, a command, an unknown one.
  await press(page,':');assert.equal((await status(page)).mode,'COMMAND');assert.ok(await page.locator('#command-input').isVisible());
  await page.keyboard.type('the');await press(page,'Tab');assert.equal(await page.locator('#command-input').inputValue(),'theme ','Tab completes :the to :theme');
  await page.keyboard.type('pa');await press(page,'Tab');assert.equal(await page.locator('#command-input').inputValue(),'theme paper','Tab completes the argument');
  await press(page,'Enter');await page.waitForFunction(()=>document.documentElement.dataset.theme==='paper');
  assert.equal((await status(page)).mode,'NORMAL');assert.ok(await page.locator('#command-line').isHidden());
  await press(page,':');await page.keyboard.type('chnages');await press(page,'Enter');
  await page.locator('[data-sonner-toast]',{hasText:'Did you mean :changes?'}).waitFor();
  await press(page,':');await press(page,'ArrowUp');assert.equal(await page.locator('#command-input').inputValue(),'chnages','Up recalls the last command');await press(page,'Escape');
  assert.equal((await status(page)).mode,'NORMAL');

  // Typing never triggers keys: / then letters go into the find field.
  await press(page,'/');await page.keyboard.type('v:j');assert.equal(await page.locator('#find-query').inputValue(),'v:j');assert.notEqual((await status(page)).mode,'VISUAL');
  await press(page,'Escape');await page.locator('#main').focus();

  // Marks: ma, move away, 'a returns; '' goes back to where the jump started.
  await page.evaluate(()=>scrollTo(0,2400));await page.waitForTimeout(150);const marked=await page.evaluate(()=>scrollY);
  await press(page,'m','a');await press(page,'g','g');await page.waitForFunction(()=>scrollY===0);
  await press(page,"'",'a');await page.waitForFunction(at=>Math.abs(scrollY-at)<40,marked);
  await press(page,"'","'");await page.waitForFunction(()=>scrollY<40);
  // Ctrl-o walks back through the jump list.
  await press(page,'Control+o');await page.waitForFunction(at=>Math.abs(scrollY-at)<40,marked);

  // Registers: "ay yanks the sentence under the cursor with its citation; :registers lists it.
  await press(page,'v','"','a','y');await page.locator('[data-sonner-toast]',{hasText:'register a'}).waitFor();
  await press(page,':');await page.keyboard.type('registers');await press(page,'Enter');
  await page.locator('#list-panel').waitFor();assert.equal((await status(page)).mode,'REGISTERS');
  assert.ok((await page.locator('#list-body').textContent()).includes('"a'),'register a is listed');
  await press(page,'Escape');await page.locator('#list-panel').waitFor({state:'hidden'});

  // :grep fills the location list; ]q opens the next location with its words found.
  await press(page,':');await page.keyboard.type('grep lighthouse');await press(page,'Enter');
  await page.locator('#list-panel').waitFor();assert.equal((await status(page)).mode,'QUICKFIX');
  assert.match((await status(page)).qf,/^QF –\/\d+$/);
  await press(page,'Escape');await page.locator('#list-panel').waitFor({state:'hidden'});
  await press(page,']','q');await page.waitForFunction(()=>location.hash.includes('harbor')&&!document.querySelector('.resume-pending'));
  await page.waitForFunction(()=>(CSS.highlights.get('reader-find')?.size||0)>0);
  assert.match((await status(page)).qf,/^QF 1\/\d+$/);
  await page.context().close();

  // Ctrl-r a pastes the citation into a writing box in another document.
  page=await open('library/notes.md');
  await press(page,'v','}','Escape','v','"','b','y');await page.locator('[data-sonner-toast]',{hasText:'register b'}).waitFor();
  await press(page,'v','c');await page.locator('#annotation-dialog[open]').waitFor();
  await press(page,'Control+r','b');
  const pasted=await page.locator('#annotation-body').inputValue();
  assert.ok(pasted.startsWith('> The first claim needs a source.')&&pasted.includes('— [Field notes](library/notes.md)'),'citation pasted: '+pasted);
  await press(page,'Escape');

  // Footnotes: % goes from the reference to its note and back.
  await press(page,'g','g');await page.waitForTimeout(50);await press(page,'%');
  await page.waitForFunction(()=>[...(CSS.highlights.get('reader-cursor')||[])].some(r=>r.toString()==='[^1]'));
  const atNote=await page.evaluate(()=>{const r=[...CSS.highlights.get('reader-cursor')][0];const block=r.startContainer.parentElement.closest('p');return block.textContent.startsWith('[^1]:');});
  assert.ok(atNote,'% reaches the note');
  await press(page,'%');await page.waitForFunction(()=>{const r=[...(CSS.highlights.get('reader-cursor')||[])][0];return r&&!r.startContainer.parentElement.closest('p').textContent.startsWith('[^1]:');});
  // Links and figures.
  await press(page,'g','g');await press(page,']','l');await page.waitForFunction(()=>document.activeElement?.matches('#article a[href]'));
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'a quiet thought');
  // ]l scrolls; its scroll event arrives on the next frame and closes any preview, so let it land first.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await press(page,'K');await page.locator('#link-preview').waitFor();
  await press(page,']','f');await page.waitForFunction(()=>document.querySelector('#article .change-target')?.matches('table'));
  // gd: the first use of a term found with /.
  await press(page,':');await page.keyboard.type('find stacks');await press(page,'Enter');await press(page,'n');await press(page,'g','d');
  await page.waitForFunction(()=>{const r=[...(CSS.highlights.get('reader-cursor')||[])][0];return r?.toString()==='stacks'&&!!r.startContainer.parentElement.closest('td');});
  await page.context().close();

  // Two-page VISUAL: moving past the page edge turns the spread.
  page=await open('library/thought.md',{prefs:{layout:'spread'}});
  await page.waitForFunction(()=>document.querySelector('.book-viewport'));
  const spread=()=>page.evaluate(()=>Math.round(document.querySelector('.book-viewport').scrollLeft));
  // The bookmark from the first visit may open a later spread; VISUAL starts on whichever spread is shown.
  const start=await spread();await press(page,'v');
  for(let i=0;i<40&&await spread()===start;i++){await press(page,'}');await page.waitForTimeout(30);}
  assert.ok(await spread()>start,'the spread turned');
  const visible=await page.evaluate(()=>{const r=[...CSS.highlights.get('reader-cursor')][0].getBoundingClientRect(),box=document.querySelector('.book-viewport').getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;});
  assert.ok(visible,'the cursor is on the shown spread');
  await press(page,'Escape');assert.equal((await status(page)).mode,'NORMAL');
  await page.context().close();

  // Phone width: the command line fits the status line without horizontal scroll.
  page=await open('library/notes.md',{viewport:{width:390,height:844}});
  await press(page,':');await page.keyboard.type('open a very long document name that keeps going');
  const fit=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,input:document.querySelector('#command-input').getBoundingClientRect().right}));
  assert.ok(fit.scroll<=fit.width&&fit.input<=fit.width,'no horizontal scroll at phone width: '+JSON.stringify(fit));
  await press(page,'Escape');assert.equal((await status(page)).mode,'NORMAL');
  await page.context().close();

  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('Modal keyboard passed: generated help, VISUAL highlight anchoring and V comment, ]c, counts, command line completion/history/suggestion, no capture while typing, marks, \'\', Ctrl-o, registers and Ctrl-r, :grep with ]q, footnotes, ]l K, ]f, gd, two-page VISUAL.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
