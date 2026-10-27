/* Prompted writing remains usable without IndexedDB or when writes exceed quota. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT || 'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'python3',['tests/quiz_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
  const outcomes=[];
  for(const failure of ['blocked','quota']){
   const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
   try{
    await context.addInitScript(failure=>{
     localStorage.setItem('reader.preferences.v1',JSON.stringify({theme:'paper',smooth:false,art:false,shapes:false,nextReads:false,participant:'Storage '+failure}));
     if(failure==='blocked')Object.defineProperty(globalThis,'indexedDB',{get(){throw new DOMException('Storage blocked for regression','SecurityError');}});
     else IDBObjectStore.prototype.put=function(){throw new DOMException('Storage quota for regression','QuotaExceededError');};
    },failure);
    const page=await context.newPage();
    await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await page.locator('#article:not(.resume-pending)').waitFor();
    const openQuestion=async()=>{await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('a');await page.locator('[data-reader-writing-prompt]').waitFor();};
    await openQuestion();let modal=page.locator('[data-reader-writing-prompt]');
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-reader-writing-prompt] button')].some(el=>/^(Ask a question|Write a response)$/.test(el.textContent.trim())));
    if(await modal.getByRole('button',{name:'Ask a question',exact:true}).count())await modal.getByRole('button',{name:'Ask a question',exact:true}).click();
    await modal.getByRole('button',{name:'Write a response',exact:true}).waitFor({timeout:15000});
    await modal.getByRole('button',{name:'Write a response',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.cm-editor')||[...document.querySelectorAll('[data-sonner-toast]')].some(el=>/Storage (blocked|quota) for regression/.test(el.textContent)));
    const opened=await page.locator('.cm-editor').count()===1;outcomes.push({failure,opened});
    if(!opened)continue;
    await modal.waitFor({state:'hidden'});await page.locator('.scratch-prompt-context').waitFor();
    await page.keyboard.press('i');await page.keyboard.type('# '+failure+' response\n\nA transient answer.');await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('.scratch-state')?.textContent==='Not saved on this device');
    await page.evaluate(()=>{location.hash='#read='+encodeURIComponent('library/thought.md');});await page.locator('#article:not(.resume-pending)').waitFor();
    await openQuestion();await page.locator('[data-reader-writing-prompt]').getByRole('button',{name:'Write a response',exact:true}).click();
    await page.locator('.cm-editor').waitFor();await page.locator('.scratch-prompt-context').waitFor();
    assert.match(await page.locator('.cm-content').textContent(),/A transient answer\./,'same-tab navigation retains the answer');
    await page.locator('[data-scratch-vault]').click();const save=page.locator('#scratch-save');await save.waitFor();
    await save.getByRole('button',{name:'Save and commit',exact:true}).click();await save.waitFor({state:'hidden'});
    const pieces=await page.evaluate(async participant=>await(await fetch('/api/writing?participant='+encodeURIComponent(participant))).json(),'Storage '+failure);
    assert.equal(pieces.pieces.length,1);assert.ok(pieces.pieces[0].prompt_id,'vault save preserves prompt provenance');
   }finally{await context.close();}
  }
  assert.deepEqual(outcomes,[{failure:'blocked',opened:true},{failure:'quota',opened:true}],'both storage failures must still open the response editor');
  console.log('Prompt storage fallback: blocked IndexedDB and quota failure retain prompt/answer in the tab and allow explicit vault saves.');
 }finally{
  await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
