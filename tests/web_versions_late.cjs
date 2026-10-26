/* A slow version timeline never holds back the text: with /api/versions delayed by 2 s the article is shown first,
 * the chip arrives afterwards, the reading position stays on the same block (scroll and two pages), and deep links
 * to an edition or a historical commit still open that edition. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const essay='library/essays/tidal/';
const DELAY=2000;
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--editions','--versions'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const errors=[],viewport={width:1300,height:520};
  const open=async(prefs,{slow=false}={})=>{
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}
      // The page's own clock: when /api/versions was asked for and answered, and when the article became visible.
      const marks=window.__late={};const fetch=window.fetch;
      window.fetch=function(input,...rest){const href=String(input?.url||input);const versions=href.includes('/api/versions?');if(versions)marks.versionsAsked??=performance.now();
        const done=fetch.call(this,input,...rest);if(versions)done.then(()=>{marks.versionsAnswered??=performance.now();},()=>{});return done;};
      new MutationObserver(()=>{if(marks.visible===undefined&&document.querySelector('#article')&&!document.querySelector('.resume-pending')){marks.visible=performance.now();marks.chipAtVisible=!!document.querySelector('.version-line');}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    },JSON.stringify({smooth:false,theme:'paper',nextReads:false,...prefs}));
    if(slow)await context.route('**/api/versions?*',async route=>{await new Promise(resolve=>setTimeout(resolve,DELAY));await route.continue().catch(()=>{});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+(m.location()?.url||''));});
    return {page,context};
  };
  const ready=page=>page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
  const marks=page=>page.evaluate(()=>({...window.__late}));
  const paragraph=n=>`[...document.querySelectorAll('#article p')].find(p=>p.textContent.startsWith('Paragraph ${n} of'))`;
  const where=(page,n)=>page.evaluate(code=>{const p=eval(code),r=p.getBoundingClientRect(),v=document.querySelector('.book-viewport')?.getBoundingClientRect();
    return {top:Math.round(r.top),inSpread:v?r.left>=v.left-2&&r.right<=v.right+2:null};},paragraph(n));
  const firstText=async page=>{const m=await marks(page);
    assert.equal(m.versionsAnswered,undefined,'the article is visible while the version timeline is still on its way');
    assert.equal(m.chipAtVisible,false);
    assert.ok(m.visible-m.versionsAsked<600,`first text waited ${Math.round(m.visible-m.versionsAsked)} ms after /api/versions was requested (the old 600 ms race)`);
    return m;};
  const chipArrives=async(page,label)=>{const line=page.locator('#article > .version-line');await line.waitFor({timeout:DELAY+5000});
    assert.equal((await line.locator('[data-version-chip]').textContent()).trim(),label);
    const m=await marks(page);assert.ok(m.versionsAnswered>m.visible,'the chip follows the text');
    assert.equal(await page.locator('.version-line').count(),1,'one chip');
    await page.waitForTimeout(150);};   // Let a re-seek (if any) settle.

  let expected;
  // A saved place: Paragraph 20 near the top of a short window, in continuous reading.
  {const {page,context}=await open({layout:'scroll'});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await ready(page);await page.locator('#article > .version-line').waitFor();
   const saved=page.waitForResponse(r=>r.url().includes('/api/bookmark')&&r.request().method()==='POST',{timeout:5000});
   await page.evaluate(code=>{const p=eval(code);scrollTo(0,p.getBoundingClientRect().top+scrollY-innerHeight*.22);},paragraph(20));
   await saved;
   // With a quick timeline (chip in the first layout), reopening lands Paragraph 20 here.
   await page.reload();await ready(page);await page.locator('#article > .version-line').waitFor();expected=(await where(page,20)).top;
   await context.close();}

  // Continuous reading: text first, chip after, and the restored paragraph does not move.
  {const {page,context}=await open({layout:'scroll'},{slow:true});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await ready(page);await firstText(page);
   const before=await where(page,20);assert.ok(Math.abs(before.top-expected)<=4,`the bookmark restores Paragraph 20 where a quick timeline does: ${before.top} vs ${expected}`);
   await chipArrives(page,'v1 of 3');
   assert.match(await page.locator('#article > .version-line').textContent(),/Newer v3 available/);
   assert.equal(await page.locator('#status-version span').textContent(),'v1/3','the status twin fills in too');
   const after=await where(page,20);assert.ok(Math.abs(after.top-before.top)<=2,`Paragraph 20 stays put when the chip arrives: ${before.top} → ${after.top}`);
   await context.close();}

  // Two pages: the same bookmark opens the spread holding Paragraph 20, and it stays there once the chip is placed.
  {const {page,context}=await open({layout:'spread'},{slow:true});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));
   await firstText(page);
   const spread=()=>page.evaluate(()=>document.querySelector('#pagination-slot [aria-current=page]')?.textContent);
   assert.equal((await where(page,20)).inSpread,true,'two-page restore shows Paragraph 20');const at=await spread();
   assert.ok(at&&!at.startsWith('1–'),'the restore is past the first spread: '+at);
   await chipArrives(page,'v1 of 3');
   assert.equal((await where(page,20)).inSpread,true,'Paragraph 20 is still on the open spread after the chip');
   await context.close();}

  // Deep links: a newer edition and a historical commit open exactly that, even with a slow timeline.
  const older=(await (await fetch(url+'/api/versions?path='+encodeURIComponent(essay+'tidal.md')+'&participant=Browser%20tester')).json()).history[essay+'tidal.md'].at(-1).commit;
  {const {page,context}=await open({layout:'scroll'},{slow:true});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.v2.md'));await ready(page);await firstText(page);
   assert.equal(await page.locator('h1.document-title').textContent(),'The tidal archive (v2)');
   assert.match(await page.locator('.document-meta').textContent(),/Edition 2/,'until the chip arrives, the frontmatter edition is shown');
   await chipArrives(page,'v2 of 3');
   assert.doesNotMatch(await page.locator('.document-meta').textContent(),/Edition/,'the chip replaces "Edition N"');
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md@'+older));await page.locator('#article > .historical-banner').waitFor();await ready(page);
   assert.match(await page.locator('#article').textContent(),/kept an early thought/,'the historical text, not the current file');
   await page.waitForFunction(()=>/^@[0-9a-f]{7}$/.test(document.querySelector('#status-version span')?.textContent||''),null,{timeout:DELAY+5000});
   assert.equal(await page.locator('.version-line').count(),0,'no chip on a historical version');
   assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read='+essay+'tidal.md@'+older);
   await context.close();}

  // A quick timeline still lands in the first layout.
  {const {page,context}=await open({layout:'scroll'});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await ready(page);await page.locator('#article > .version-line').waitFor();
   assert.equal(await page.locator('.version-line').count(),1);await context.close();}
  assert.deepEqual(errors,[]);
  console.log(`Late versions passed: with /api/versions delayed ${DELAY} ms the article shows first, the chip and status twin follow, the restored paragraph stays put in scroll and two-page reading, and edition and historical deep links open what they name.`);
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
