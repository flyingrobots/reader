/* A source question -> a local Scratch draft -> an explicit preserved save -> an article chat. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {readFileSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'python3',['tests/quiz_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking']});
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({theme:'user-reader-test',smooth:false,art:false,shapes:false,nextReads:false,participant:'Browser tester'})));
  const article=()=>page.goto(url+'#read='+encodeURIComponent('library/thought.md')).then(()=>page.waitForSelector('#article:not(.resume-pending)'));
  const question='Which color would you choose, and why?';
  await article();await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('a');
  const modal=page.locator('[data-reader-writing-prompt]');await modal.waitFor();
  // Opening asks at once with the default voice: no voice step and no extra button press.
  await modal.getByText(question,{exact:true}).waitFor({timeout:15000});
  assert.equal(await modal.getByRole('button',{name:'Ask a question'}).count(),0);
  assert.match(await modal.locator('[data-slot=message-header]').textContent(),/\S/);
  await modal.getByRole('button',{name:/^Question voice: /}).waitFor();
  await modal.getByRole('button',{name:'Show me in the text',exact:true}).click();await modal.waitFor({state:'hidden'});
  await page.waitForFunction(()=>CSS.highlights.get('reader-quiz')?.size===1);
  assert.equal(await page.evaluate(()=>[...CSS.highlights.get('reader-quiz')][0].toString()),'The first color is red.');
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('a');await modal.waitFor();
  await modal.evaluate(el=>{el.style.setProperty('transition-duration','700ms','important');el.style.setProperty('animation-duration','700ms','important');});
  await modal.getByRole('button',{name:'Write a response',exact:true}).click();
  await modal.waitFor({state:'hidden'});await page.locator('.cm-editor').waitFor();await page.locator('.scratch-prompt-context').getByText(question,{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.cm-content')),true,'closing the question must leave the response editor focused');
  // The question is a collapsible at the top of the editor pane; both panes run the full height below the toolbar.
  const fill=await page.evaluate(()=>{const scratch=document.querySelector('.scratch').getBoundingClientRect(),bar=document.querySelector('.scratch-bar').getBoundingClientRect();
    const pane=s=>document.querySelector(s).getBoundingClientRect(),editor=pane('.scratch-editor'),preview=pane('.scratch-preview'),cm=pane('.scratch-editor .cm-editor');
    return {inside:!!document.querySelector('.scratch-editor > .scratch-prompt-context [data-slot=collapsible-trigger]'),sameTop:Math.abs(editor.top-preview.top)<1,
      share:Math.min(editor.height,preview.height)/(scratch.bottom-bar.bottom),editorFill:(cm.bottom-editor.top)/editor.height};});
  assert.ok(fill.inside&&fill.sameTop&&fill.share>.9&&fill.editorFill>.98,'Scratch panes must run the full height: '+JSON.stringify(fill));
  await page.locator('.scratch-prompt-context').getByRole('button',{name:/^Question from /}).click();
  await page.locator('.scratch-prompt-context').getByText(question,{exact:true}).waitFor({state:'hidden'});
  await page.locator('.scratch-prompt-context').getByRole('button',{name:/^Question from /}).click();
  await page.locator('.scratch-editor .cm-content').click();
  await page.keyboard.press('i');await page.keyboard.type('# On color\n\nI choose red because it catches my eye.');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('.scratch-state').textContent==='Saved on this device');
  const draftHash=new URL(page.url()).hash;await page.reload();await page.locator('.cm-editor').waitFor();
  assert.equal(new URL(page.url()).hash,draftHash);await page.locator('.scratch-prompt-context').getByText(question,{exact:true}).waitFor();
  await page.locator('.scratch-preview').getByText('I choose red because it catches my eye.',{exact:true}).waitFor();
  await page.locator('[data-scratch-vault]').click();const save=page.locator('#scratch-save');await save.waitFor();
  await save.getByRole('button',{name:'Save and commit',exact:true}).click();await save.waitFor({state:'hidden'});
  const pieces=await page.evaluate(async()=>await(await fetch('/api/writing?participant=Browser%20tester')).json());assert.equal(pieces.pieces.length,1);
  const original=readFileSync(root+'/'+pieces.pieces[0].path,'utf8');assert.match(original,/prompt_id:/);assert.match(original,/Reader|prompt:/);
  await article();await page.locator('[data-reading-log-writing] a').waitFor();await page.locator('[data-writing-pin]').waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('h');
  await page.locator('.your-writing').getByRole('link',{name:'On color',exact:true}).waitFor();
  await article();await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('a');await modal.waitFor();
  // An opening typed in the dialog continues the existing draft for this question in Scratch.
  await modal.getByRole('textbox',{name:'Your answer'}).fill('Blue also tempts me.');await page.keyboard.press('Enter');
  await modal.waitFor({state:'hidden'});await page.locator('.cm-editor').waitFor();
  await page.locator('.scratch-preview').getByText('Blue also tempts me.',{exact:true}).waitFor();
  await page.locator('[data-scratch-vault]').click();await save.waitFor();await save.getByRole('button',{name:'Save and ask for a reply',exact:true}).click();
  await page.locator('.chat-panel').waitFor();await page.locator('.chat-panel').getByText(question,{exact:true}).waitFor({timeout:15000});
  assert.equal(readFileSync(root+'/'+pieces.pieces[0].path,'utf8'),original);
  const later=await page.evaluate(async()=>await(await fetch('/api/writing?participant=Browser%20tester')).json());assert.equal(later.pieces.length,2);assert.ok(later.pieces.some(p=>p.path.endsWith('.v2.md')));
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.querySelector('.chat-panel button[aria-label="Close chat"]')?.click());
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('a');await modal.waitFor();
  const box=await modal.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391,box);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log('Writing prompt browser: source link, Scratch autosave, explicit save, log, home, margin pin, preserved revision, reply chat and phone layout passed.');
 }finally{await browser?.close();fixture.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
