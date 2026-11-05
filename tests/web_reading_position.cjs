/* Reading position in continuous reading: what progress measures, and which place a bookmark keeps.
 * Covers tables and embeds at the end of an article, one-screen articles, the margin between two blocks,
 * the top of a document at several window sizes, and the note for a read of a sibling edition. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const essay='library/essays/tidal/';
const paragraphs=n=>Array.from({length:n},(_,i)=>`Paragraph ${i+1} keeps a careful thought about fences and gates.`).join('\n\n');
const table='| a | b |\n|---|---|\n'+Array.from({length:120},(_,i)=>`| row ${i} | value |`).join('\n');
const TRAILING_TABLE=`# Probe\n\n${paragraphs(3)}\n\n${table}\n`;
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--editions','--versions'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--disable-gpu']});
  const errors=[];
  const ready=page=>page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
  const open=async(path,{width=1300,height=800,text,participant='Position tester'}={})=>{
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
    await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',nextReads:false,participant}));
    // The document's text is swapped in the browser, so its source hash and the fixture stay as they are.
    if(text)await context.route('**/api/document?*',async route=>{const response=await route.fetch(),body=await response.json();body.text=text;await route.fulfill({response,json:body});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url+'#read='+encodeURIComponent(path));await ready(page);await page.waitForTimeout(200);return {page,context};};
  const saved=page=>page.waitForResponse(r=>r.url().includes('/api/bookmark')&&r.request().method()==='POST',{timeout:6000}).then(r=>r.request().postDataJSON());
  const percent=async page=>{await page.waitForTimeout(150);return +await page.locator('#progress-slider').getAttribute('aria-valuenow');};
  const reopen=async page=>{await page.reload();await ready(page);await page.waitForTimeout(250);return page.evaluate(()=>scrollY);};
  const end=page=>page.locator('#progress-slider').focus().then(()=>page.keyboard.press('End')).then(()=>page.waitForTimeout(350));

  // The top of a document stays the top, wherever the save line falls under the title: short, tall and phone windows.
  for(const [width,height] of [[1300,520],[1440,800],[1440,1000],[1920,1200],[1300,1400],[390,664]]){
   const {page,context}=await open(essay+'tidal.v3.md',{width,height,participant:`Top ${width}x${height}`});
   const first=saved(page);await page.evaluate(()=>scrollTo(0,1));await first;
   const again=saved(page);await page.evaluate(()=>scrollTo(0,0));await again;
   assert.equal(await reopen(page),0,`reopening from the top at ${width}x${height} keeps the title in view`);
   await context.close();}

  // The margin between two blocks keeps the next block.
  {const {page,context}=await open(essay+'tidal.v3.md',{participant:'Margin reader'});
   const {y,next}=await page.evaluate(()=>{const blocks=[...document.querySelectorAll('#article p[data-source-start]')],a=blocks[10].getBoundingClientRect(),b=blocks[11];return {y:Math.round((a.bottom+b.getBoundingClientRect().top)/2+scrollY-innerHeight*.22),next:+b.dataset.sourceStart};});
   const mark=saved(page);await page.evaluate(y=>scrollTo(0,y),y);assert.equal((await mark).source_offset,next,'a line in the margin names the next block');
   await context.close();}

  // A table at the end is reading: the bar counts it, End reaches its foot, and a reader inside it comes back there.
  {const {page,context}=await open(essay+'tidal.md',{text:TRAILING_TABLE,participant:'Table reader'});
   const max=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight);
   await page.evaluate(y=>scrollTo(0,y),Math.round(max*.25));assert.ok(await percent(page)<40,'a quarter of the way down is not finished');
   await end(page);assert.equal(await percent(page),100);
   assert.ok(await page.evaluate(()=>Math.abs(document.querySelector('#article table').getBoundingClientRect().bottom-innerHeight)<=2),'End stops at the foot of the table');
   const y=await page.evaluate(()=>{const t=document.querySelector('#article table').getBoundingClientRect();return Math.round(t.top+scrollY+t.height/2-innerHeight*.22);});
   const mark=saved(page);await page.evaluate(y=>scrollTo(0,y),y);const inside=await mark;
   assert.equal(inside.source_offset,await page.evaluate(()=>+document.querySelector('#article table').dataset.placeStart),'inside a table the table is the place');assert.ok(inside.progress<.97,'and it is not finished');
   assert.ok(Math.abs(await reopen(page)-y)<=4,'reopening returns to the middle of the table');
   await context.close();}

  // A table or embed in the middle is a place: inside it you come back to it, and in the margin above it you do not skip it.
  {const body=`# Probe\n\n${paragraphs(4)}\n\n${table}\n\n${paragraphs(40)}\n`;
   const {page,context}=await open(essay+'tidal.md',{text:body,participant:'Mid table reader'});
   const box=()=>page.evaluate(()=>{const t=document.querySelector('#article table').getBoundingClientRect();return {top:t.top+scrollY,height:t.height,line:innerHeight*.22,start:+document.querySelector('#article table').dataset.placeStart};});
   const {top,height,line,start}=await box();
   const y=Math.round(top+height/2-line);let mark=saved(page);await page.evaluate(y=>scrollTo(0,y),y);const inside=await mark;
   assert.equal(inside.source_offset,start,'inside a table the table is the place');assert.ok(inside.block_fraction>.3&&inside.block_fraction<.7,'and how far down it');
   assert.ok(Math.abs(await reopen(page)-y)<=4,'reopening returns to the middle of the table');
   const margin=Math.round(top-line-8);mark=saved(page);await page.evaluate(y=>scrollTo(0,y),margin);assert.equal((await mark).source_offset,start,'the margin above a table names the table');
   assert.ok(Math.abs(await reopen(page)-(top-line))<=4,'and reopening does not skip it');
   await context.close();}
  {const body=`# Probe\n\n${paragraphs(4)}\n\n![[tidal.v2.md]]\n\n![[tidal.v3.md]]\n\n${paragraphs(40)}\n`;
   const {page,context}=await open(essay+'tidal.md',{text:body,participant:'Mid embed reader'});
   await page.locator('#article > .document-embed').nth(1).locator('p').first().waitFor();await page.waitForTimeout(400);
   const {y,start}=await page.evaluate(()=>{const e=document.querySelectorAll('#article > .document-embed')[1],r=e.getBoundingClientRect();return {y:Math.round(r.top+scrollY+r.height/2-innerHeight*.22),start:+e.dataset.placeStart};});
   const mark=saved(page);await page.evaluate(y=>scrollTo(0,y),y);assert.equal((await mark).source_offset,start,'inside an embed the embed is the place');
   await reopen(page);await page.locator('#article > .document-embed').nth(1).locator('p').first().waitFor();await page.waitForTimeout(600);
   assert.ok(await page.evaluate(()=>{const e=document.querySelectorAll('#article > .document-embed')[1].getBoundingClientRect(),line=innerHeight*.22;return e.top<=line&&e.bottom>line;}),'reopening returns inside that embed');
   await context.close();}

  // An attachment is not finished by waiting on it.
  {const context=await browser.newContext({viewport:{width:1300,height:800},reducedMotion:'reduce'});
   await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',nextReads:false,participant:'Attachment reader'}));
   await context.route('**/api/document?*',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,text:null,kind:'.zip',preview_url:null}});});
   const page=await context.newPage(),progress=[];page.on('request',r=>{if(r.url().includes('/api/bookmark')&&r.method()==='POST')progress.push(r.postDataJSON().progress);});
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await page.getByText('Download attachment').waitFor();await page.waitForTimeout(3600);
   assert.ok(progress.every(p=>p<.97),'no finish after the dwell: '+progress);
   await context.close();}

  // Nearly fitting is still one screen: a small scroll does not finish it.
  {const {page,context}=await open(essay+'tidal.md',{width:1300,height:500,text:`# Short\n\n${paragraphs(2)}\n`,participant:'Near fit reader'});
   const over=await page.evaluate(()=>{const kids=[...document.querySelectorAll('#article > p')];return Math.round(kids.at(-1).getBoundingClientRect().bottom-innerHeight);});
   await page.setViewportSize({width:1300,height:500+over-20});await page.waitForTimeout(250);
   const mark=saved(page);await page.evaluate(()=>scrollTo(0,20));assert.ok((await mark).progress<.5,'twenty pixels into a nearly fitting article is not most of it');
   await context.close();}

  // One screen: only the dwell finishes it, and the slider still moves the page.
  {const {page,context}=await open(essay+'tidal.md',{width:1300,height:500,text:'# Short\n\nOne paragraph that fits.\n',participant:'Short reader'});
   const mark=saved(page);await page.evaluate(()=>scrollTo(0,1));assert.ok((await mark).progress<.97,'a one-pixel scroll does not finish a document');
   await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(100);await end(page);
   assert.ok(await page.evaluate(()=>scrollY>0),'End moves the page');
   await context.close();}

  // Embeds at the end are reading too: End reaches the foot of the last one.
  {const {page,context}=await open(essay+'tidal.md',{text:`# Probe\n\n${paragraphs(3)}\n\n${Array.from({length:12},()=>'![[tidal.v2.md]]').join('\n\n')}\n`,participant:'Embed reader'});
   await page.locator('#article .document-embed').first().waitFor();await page.waitForTimeout(500);
   const count=await page.locator('#article > .document-embed').count();assert.ok(count>=2,'the embeds rendered: '+count);
   await end(page);await end(page);assert.equal(await percent(page),100);
   assert.ok(await page.evaluate(()=>{const all=document.querySelectorAll('#article > .document-embed');return Math.abs(all[all.length-1].getBoundingClientRect().bottom-innerHeight)<=2;}),'End stops at the foot of the last embed');
   await context.close();}

  // Your own earlier read: the reading log says "just now", so the chip keeps the earlier local day, and not today's.
  {const chip=async(at,now)=>{const context=await browser.newContext({viewport:{width:1300,height:800},reducedMotion:'reduce',timezoneId:'America/Los_Angeles'});
     await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',nextReads:false,participant:'Return reader'}));
     await context.route('**/api/versions?*',async route=>{const response=await route.fetch(),body=await response.json();body.read={where:'current',path:essay+'tidal.md',label:'v1',at};await route.fulfill({response,json:body});});
     const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(now));
     await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.md'));await ready(page);await page.locator('[data-version-chip]').waitFor();
     const shown=await page.locator('.version-line .version-read').allTextContents();await context.close();return shown;};
   // 00:16Z on Oct 25 is the evening of Oct 24 in Los Angeles.
   assert.deepEqual(await chip('2026-10-25T00:16:00Z','2026-10-26T00:20:00Z'),['You last read this on Oct 24'],'an earlier local day is shown');
   assert.deepEqual(await chip('2026-10-25T00:16:00Z','2026-10-25T00:20:00Z'),[],'today adds nothing to the reading log');}

  // A read of a sibling edition is news on the chip.
  {const {page,context}=await open(essay+'tidal.md',{participant:'Sibling reader'});await page.waitForTimeout(300);
   await page.goto(url+'#read='+encodeURIComponent(essay+'tidal.v2.md'));await page.getByRole('heading',{name:'The tidal archive (v2)',exact:true}).waitFor();await ready(page);
   assert.match((await page.locator('.version-line .version-read').textContent()).trim(),/^You read v1 on [A-Z][a-z]{2} \d+$/);
   await context.close();}

  assert.deepEqual(errors,[]);
  console.log('Reading position passed: the top stays the top at six window sizes, a margin keeps the next block, trailing tables and embeds count as reading and a table restores inside itself, one-screen articles finish only by dwell, and the chip shows a sibling read and your earlier day.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
