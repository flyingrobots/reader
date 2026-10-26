/* Article prompt cards and coding jobs in the browser (RW-44): a valid block becomes one card and an example inside a
   fence stays code; viewing, hovering, expanding and reloading start nothing; typing stays in the editor and Escape
   leaves it; Run → PR admits one run whose live trace ends in a verified pull request; a reload resumes the same run
   from its archive; a failed verification expands its step by itself. Synthetic fixture: a local Git remote, a fake
   coding CLI and a fake GitHub (tests/web_fixture.py --coding). Never a real model, repository or GitHub. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const DOC='library/audit.md';
async function fixture(flags){
  const child=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--coding',...flags],{stdio:['ignore','pipe','inherit']});
  const info=await new Promise((resolve,reject)=>{createInterface({input:child.stdout}).once('line',line=>resolve(JSON.parse(line)));child.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  return {child,url:info.url};
}
(async()=>{
 let browser;const children=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disable-breakpad']});
  const open=async url=>{
    const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:url});
    await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',art:false}));}catch{}});
    const page=await context.newPage(),errors=[],posts=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/jobs'))posts.push(r.postDataJSON());});
    return {context,page,errors,posts};
  };
  const read=async(page,url)=>{await page.goto(url+'#read='+encodeURIComponent(DOC));
    await page.waitForFunction(p=>document.querySelector('.document-footer')?.textContent.startsWith(p)&&!document.querySelector('.resume-pending'),DOC);};
  const runs=(page)=>page.evaluate(()=>fetch('/api/jobs').then(r=>r.json()).then(d=>d.runs));

  {const {child,url}=await fixture([]);children.push(child);
   const {context,page,errors,posts}=await open(url);
   await read(page,url);
   const card=page.locator('[data-prompt-card="bound-parser-depth"]');
   await card.waitFor();
   assert.equal(await page.locator('[data-prompt-card]').count(),1,'one card; the example inside a fence stays code');
   assert.match(await page.locator('#article pre').last().textContent(),/An example inside a fence never runs/);
   assert.match(await card.textContent(),/Bound parser depth/);assert.match(await card.textContent(),/acme\/widget/);assert.match(await card.textContent(),/Issue #277/);
   await page.waitForFunction(()=>!document.querySelector('[data-prompt-run]')?.disabled,null,{timeout:10000});
   assert.match(await card.locator('.prompt-card-plan').textContent(),/new branch from main in acme\/widget, links issue #277/);
   // Viewing, hovering, expanding and reloading never start a job.
   await card.hover();await page.locator('#article').click({position:{x:5,y:5}});
   await page.reload();await read(page,url);await card.waitFor();
   assert.deepEqual(posts,[]);assert.deepEqual(await runs(page),[]);
   // The prompt is a form: typed keys stay in the editor (j and Space are reader motions elsewhere); Escape leaves it.
   const editor=card.locator('textarea');
   await editor.click();await page.keyboard.press('End');await page.keyboard.type(' j k ');
   assert.ok((await editor.inputValue()).endsWith(' j k '),'reader motions do not take the editor’s keys');
   assert.match(await card.textContent(),/Edited for this run/);
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement?.matches('[data-prompt-card]')),true,'Escape leaves the editor for the card');
   await card.getByRole('button',{name:/Restore the article’s prompt/}).click();
   assert.match(await card.textContent(),/As written/);
   // Copy copies the prompt as shown.
   await card.locator('[data-prompt-copy]').click();
   assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/^Check issue #277 before changing anything/);
   // Run → PR: one admission, a live summary, then a verified pull request.
   await card.locator('[data-prompt-run]').click();
   await card.locator('.job-summary').waitFor();
   assert.equal(posts.length,1);assert.equal(posts[0].action,'submit');assert.match(posts[0].request_id,/^[0-9a-f-]{36}$/);
   await page.waitForFunction(()=>document.querySelector('.job-summary')?.dataset.jobStatus==='pr_opened',null,{timeout:60000});
   assert.match(await card.locator('.job-links').textContent(),/Pull request #\d+/);
   await card.getByRole('button',{name:'Show trace'}).click();
   const trace=card.locator('.activity');await trace.waitFor();
   assert.ok(await trace.locator('[data-activity-github]').count()>=2,'GitHub rows for the issue, the push and the pull request');
   assert.ok(await trace.locator('[data-activity-item=tool]').count()>=3,'Reader’s steps and the agent’s commands are tool rows');
   // A reload resumes the same run from its archive; the admin API reads the same run.
   const id=await card.locator('.job-summary').getAttribute('data-job-id');
   await page.reload();await read(page,url);
   await page.waitForFunction(id=>document.querySelector('.job-summary')?.dataset.jobId===id,id,{timeout:10000});
   const admin=await page.evaluate(id=>fetch('/api/jobs/run?id='+id).then(r=>r.json()),id);
   assert.equal(admin.outcome,'pr_opened');assert.equal((await runs(page)).length,1);
   assert.deepEqual(errors,[]);
   await context.close();
  }

  {const {child,url}=await fixture(['--coding-verify-fails']);children.push(child);
   const {context,page,errors}=await open(url);
   await read(page,url);
   const card=page.locator('[data-prompt-card="bound-parser-depth"]');
   await page.waitForFunction(()=>!document.querySelector('[data-prompt-run]')?.disabled,null,{timeout:10000});
   await card.locator('[data-prompt-run]').click();
   await page.waitForFunction(()=>document.querySelector('.job-summary')?.dataset.jobStatus==='failed',null,{timeout:60000});
   const failed=card.locator('[data-activity-item=tool]').filter({hasText:'Verify:'});
   await failed.waitFor({timeout:10000});
   assert.equal(await failed.locator('[data-slot=trace-collapsible-trigger]').getAttribute('aria-expanded'),'true','a failed check expands by itself');
   assert.equal(await page.evaluate(()=>document.activeElement===document.body||!!document.activeElement?.closest('[data-prompt-card]')),true,'it does not steal focus');
   assert.doesNotMatch(await card.locator('.job-links').count()?await card.locator('.job-links').textContent():'',/Pull request/);
   assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('web_coding_jobs: ok');
 }finally{
  await browser?.close();
  for(const child of children)child.kill('SIGTERM');
 }
})().catch(error=>{console.error(error);process.exit(1);});
