/* Scratch pad (RW-33): Space w buffers, Vim modes and Escape, the shared-renderer preview (Mermaid and math), drafts that
   survive reload, :drafts, :cite, Save to vault with its commit, Edit in scratch giving .v2.md, 390px layout, lazy editor chunk. */
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,readFileSync,existsSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const shots=process.env.READER_SHOTS||'.reader/web-dev';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--writing'],{stdio:['ignore','pipe','inherit']});let browser;
 const errors=[],external=[],requested=[];
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync(shots,{recursive:true});
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',HOME:'/dev/null'}});
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  await context.addInitScript(value=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',nextReads:false}));
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+(m.location()?.url||''));});
  page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());else requested.push(new URL(r.url()).pathname);});
  const mode=()=>page.locator('#vim-mode').textContent();
  const text=()=>page.evaluate(()=>document.querySelector('.cm-content').cmView?.view?.state.doc.toString()??[...document.querySelectorAll('.cm-line')].map(l=>l.textContent).join('\n'));
  const ex=async command=>{await page.keyboard.type(':'+command);await page.keyboard.press('Enter');};  // From Vim normal mode.
  const toast=async text=>page.locator('[data-sonner-toast]',{hasText:text}).first().waitFor({timeout:8000});
  const ready=()=>page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));

  // Read a document and select a passage: :cite will quote it.
  await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await ready();
  await page.evaluate(()=>{const strong=document.querySelector('#article strong');const range=document.createRange();range.selectNodeContents(strong);getSelection().removeAllRanges();getSelection().addRange(range);strong.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#selection-tools:not([hidden])').waitFor();
  await page.evaluate(()=>getSelection().removeAllRanges());
  assert.equal(requested.filter(p=>p.endsWith('/controls/editor.js')).length,0,'the editor chunk is not requested before a buffer opens');
  // Space w opens a new buffer.
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('w');
  await page.locator('.cm-editor').waitFor();
  assert.match(new URL(page.url()).hash,/^#scratch=[0-9a-f-]{36}$/);
  assert.equal(requested.filter(p=>p.endsWith('/controls/editor.js')).length,1);
  assert.equal(await mode(),'SCRATCH · NORMAL');
  // i, typing, then Esc: normal mode, still in the editor. A second Esc returns to Reader NORMAL.
  await page.keyboard.press('i');assert.equal(await mode(),'SCRATCH · INSERT');
  await page.keyboard.type('# On splits\n\nSome $x^2$ thinking about panes.\n\n```mermaid\ngraph TD\nA-->B\n```\n\n');
  await page.keyboard.press('Escape');
  assert.equal(await mode(),'SCRATCH · NORMAL');
  assert.ok(await page.evaluate(()=>!!document.activeElement.closest('.cm-editor')),'Esc stays in the editor');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'main','a second Esc leaves the editor');
  await page.locator('.scratch-editor .cm-content').click();
  // The preview uses the document renderer: Mermaid and KaTeX.
  await page.locator('.scratch-preview .reader-diagram-canvas[data-state=ready] svg').waitFor();
  await page.locator('.scratch-preview .reader-math[data-state=ready]').waitFor();
  assert.equal(await page.locator('.scratch-preview h1').textContent(),'On splits');
  // A local image and an embed resolve from the notebook folder, before it exists (#114).
  assert.equal(existsSync(root+'/library/notebook'),false);
  await page.keyboard.press('G');await page.keyboard.press('o');await page.keyboard.type('![a pixel](library/figures/pixel.png)\n\n![[seed-note]]\n');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('.scratch-preview img[alt="a pixel"]')?.complete&&document.querySelector('.scratch-preview img[alt="a pixel"]').naturalWidth===1,null,{timeout:8000}).catch(async()=>{throw new Error('local image did not load: '+await page.locator('.scratch-preview').innerHTML());});
  assert.equal(await page.locator('.scratch-preview img[alt="a pixel"]').getAttribute('src'),'/api/file?path=library%2Ffigures%2Fpixel.png');
  await page.locator('.scratch-preview .embedded-content',{hasText:'A small embedded idea.'}).waitFor({timeout:8000});
  assert.equal(await page.locator('.scratch-preview').getByText(/unavailable|couldn’t be read/).count(),0);
  assert.match(await page.locator('#status-position').textContent(),/^\d+ words · (Saved on this device|Unsaved)$/);
  // :cite inserts the last selection as a cited quote.
  await page.keyboard.press('G');await page.keyboard.press('o');await page.keyboard.press('Escape');await ex('cite');
  const cited=await text();
  assert.match(cited,/> a precise passage\n>\n> — \[A quiet thought\]\(\.\.\/thought\.md\)/);
  await page.locator('.scratch-preview blockquote').waitFor();
  await page.screenshot({path:shots+'/scratch-split.png'});
  // A reload restores the draft; :drafts lists it.
  await page.waitForFunction(()=>document.querySelector('.scratch-state').textContent==='Saved on this device');
  const draftHash=new URL(page.url()).hash;
  await page.reload();await page.locator('.cm-editor').waitFor();
  assert.equal(new URL(page.url()).hash,draftHash);
  assert.match(await text(),/^# On splits\n/);
  await page.locator('.scratch-editor .cm-content').click();await ex('drafts');
  const listed=page.locator('.scratch-drafts [data-draft]');await listed.first().waitFor();
  assert.equal(await listed.count(),1);assert.match(await listed.first().textContent(),/On splits.*words/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.scratch-drafts').isHidden(),true);
  // :preview cycles Side by side → Source → Preview.
  await ex('preview');assert.equal(await page.locator('.scratch').getAttribute('data-layout'),'source');
  await ex('preview');assert.equal(await page.locator('.scratch').getAttribute('data-layout'),'preview');
  await page.locator('[data-scratch-layout]').click();assert.equal(await page.locator('.scratch').getAttribute('data-layout'),'split');
  // Save to vault: the dialog, the committed file and the toast.
  await page.locator('[data-scratch-vault]').click();const dialog=page.locator('#scratch-save');await dialog.waitFor();
  assert.equal(await dialog.locator('[name=title]').inputValue(),'On splits');assert.equal(await dialog.locator('[name=slug]').inputValue(),'on-splits');
  assert.equal(await dialog.locator('[name=responds_to]').inputValue(),'library/thought.md','responds to the document you came from');
  const path=await dialog.locator('[data-save-path]').textContent();assert.match(path,/^library\/notebook\/\d{4}-\d{2}-\d{2}-on-splits\.md$/);
  await page.screenshot({path:shots+'/scratch-save.png'});
  await dialog.locator('[type=submit]').click();await toast(`Saved to ${path} and committed.`);
  const saved=readFileSync(root+'/'+path,'utf8');
  assert.match(saved,/^---\ntitle: "On splits"\nauthor: "Synthetic Writer"\nparticipant: "Browser tester"\ndate: \d{4}-\d{2}-\d{2}\nkind: Notebook\nstatus: draft\nresponds_to: "library\/thought.md"\nresponds_to_sha256: [0-9a-f]{64}\ndocument_revision: 1\ntags: \[you\/writing\]\n---\n\n# On splits\n/);
  assert.equal(git('show','--name-only','--format=','HEAD').trim(),path);assert.match(git('log','-1','--format=%B'),new RegExp('Reader-Writing: '+path));
  assert.equal(await page.locator('.scratch-state').textContent(),'In vault');
  // Saving the same draft again writes a new version, never over the file.
  await page.locator('.scratch-editor .cm-content').click();await page.keyboard.press('G');await page.keyboard.press('o');await page.keyboard.type('A second thought.');await page.keyboard.press('Escape');
  await ex('write vault');await dialog.waitFor();assert.equal(await dialog.locator('#scratch-save-title').textContent(),'Save a new version');
  const v2=path.replace(/\.md$/,'.v2.md');assert.equal(await dialog.locator('[data-save-path]').textContent(),v2);
  await dialog.locator('[name=shifted]').fill('A second thought.');await dialog.locator('[type=submit]').click();await toast(`Saved to ${v2} and committed.`);
  assert.equal(readFileSync(root+'/'+path,'utf8'),saved,'the original bytes are unchanged');
  assert.match(readFileSync(root+'/'+v2,'utf8'),/document_revision: 2\nprevious_version: "library\/notebook\/[^"]+-on-splits\.md"\nwhat_shifted: "A second thought."/);
  // Edit in scratch on the saved piece: a draft based on it; saving gives the next version.
  await page.goto(url+'#read='+encodeURIComponent(v2));await ready();
  await page.locator('#edit-scratch').click();await page.locator('.cm-editor').waitFor();
  assert.match(await text(),/^# On splits\n[\s\S]*A second thought\./);assert.doesNotMatch(await text(),/^---/);
  await page.locator('[data-scratch-vault]').click();await dialog.waitFor();
  const v3=path.replace(/\.md$/,'.v3.md');assert.equal(await dialog.locator('[data-save-path]').textContent(),v3);
  await dialog.locator('[data-save-close]').first().click();
  assert.equal(git('status','--porcelain','library/index.md').trim(),'','collection navigation is untouched');
  assert.equal(existsSync(root+'/writings'),false);
  // The page command line: :enew opens a new buffer and :e scratch the latest draft (RW-18 folds these in).
  const pageEx=async command=>{await page.locator('#main').focus();await page.keyboard.press(':');await page.keyboard.type(command);await page.keyboard.press('Enter');};
  await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await ready();
  // "ay yanks the sentence under the reading cursor into register a.
  await page.locator('#main').focus();for(const key of ['v','"','a','y'])await page.keyboard.press(key);await toast('register a');
  await pageEx('enew');await page.locator('.cm-editor').waitFor();
  const fresh=new URL(page.url()).hash;assert.match(fresh,/^#scratch=[0-9a-f-]{36}$/);assert.doesNotMatch(await text(),/On splits|thinking/,'a new, empty buffer');
  // Ctrl-r a in insert mode pastes register a as a cited block; Ctrl-w in the editor is Vim's, never the window prefix.
  await page.keyboard.press('i');await page.keyboard.type('Quoted: ');await page.keyboard.press('Control+r');await page.keyboard.press('a');
  assert.match(await text(),/^Quoted: > .+\n>\n> — \[A quiet thought\]\(\.\.\/thought\.md\)/,'register a, cited');
  await page.keyboard.press('Control+w');await page.keyboard.press('v');
  assert.equal(await page.locator('.split-pane').count(),0,'Ctrl-w v inside the editor does not split');
  assert.notEqual(await mode(),'WINDOW');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('.scratch-state')?.textContent==='Saved on this device');
  await pageEx('e scratch');await page.waitForFunction(fresh=>location.hash===fresh,fresh);await page.locator('.cm-editor').waitFor();
  assert.match(await text(),/^Quoted: /,':e scratch opens the latest draft');
  // Phone width: one column with 16px gutters and no horizontal scroll.
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  const layout=await page.evaluate(()=>{const s=document.querySelector('.scratch'),e=document.querySelector('.scratch-editor').getBoundingClientRect();return {scroll:document.documentElement.scrollWidth<=innerWidth,left:e.left,right:innerWidth-e.right,preview:getComputedStyle(document.querySelector('.scratch-preview')).display};});
  assert.deepEqual(layout,{scroll:true,left:16,right:16,preview:'none'});
  await page.screenshot({path:shots+'/scratch-phone.png'});
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Scratch pad passed: lazy editor chunk, Space w route, Vim insert/normal and double Esc, Mermaid and math preview, local image and embed preview, :cite quote, reload restore, :drafts, :preview layouts, Save to vault with exact frontmatter and a one-file commit, :enew and :e scratch from the page command line, Ctrl-r a register paste, Ctrl-w left to the editor, .v2.md with original bytes kept, Edit in scratch, 390px layout, local-only requests.');
 }catch(error){console.error('Page errors:',errors);throw error;}finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
