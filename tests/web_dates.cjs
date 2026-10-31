/* Local dates: receipts minutes either side of midnight UTC are labelled with the reader's own day in Los Angeles and Tokyo
   (version chip, timeline tag, reading log, History groups) instead of the UTC calendar date. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const tidal='library/essays/tidal/tidal.md';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--editions','--versions','--dates'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  const errors=[],external=[];
  const cases=[
   // 17:20 PDT on Oct 24: the 00:16Z receipt is this evening, not "Oct 25".
   {timezoneId:'America/Los_Angeles',participant:'Evening tester',now:'2026-10-25T00:20:00Z',chip:'You read this on Oct 24',tag:'you read Oct 24',
    other:['Night owl','Oct 16'],history:[['Today',['The tidal archive']],['Yesterday',['A quiet thought']],['Oct 21',['Another thought']]]},
   // 00:20 JST on Oct 25: the 15:16Z receipt is already today, not "Oct 24".
   {timezoneId:'Asia/Tokyo',participant:'Morning tester',now:'2026-10-24T15:20:00Z',chip:'You read this on Oct 25',tag:'you read Oct 25',
    other:['Early bird','Oct 17'],history:[['Today',['The tidal archive']],['Yesterday',['A quiet thought']],['Oct 20',['Another thought']]]}];
  for(const c of cases){
   const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce',timezoneId:c.timezoneId});
   await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper',nextReads:false,layout:'scroll',participant:c.participant}));
   const page=await context.newPage();await page.clock.setFixedTime(new Date(c.now));
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
   // Opening marks the document read now; keep the fixture's receipts so the labels under test stay fixed.
   await page.route('**/api/seen',route=>route.request().method()==='POST'?route.fulfill({json:{participant:c.participant,updated:1,read:true}}):route.continue());
   await page.route('**/api/history',route=>route.request().method()==='POST'?route.fulfill({json:{ok:true}}):route.continue());
   await page.goto(url+'#read='+encodeURIComponent(tidal));
   assert.equal(await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone),c.timezoneId);
   await page.getByRole('heading',{name:'The tidal archive',exact:true}).waitFor();
   await page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending'));
   // Version chip and the explorer's read tag.
   const read=page.locator('.version-line .version-read');await read.waitFor();
   assert.equal((await read.textContent()).trim(),c.chip,c.timezoneId+' chip');
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('v');
   const panel=page.locator('#versions-panel');await panel.locator('.vt-tag.read').first().waitFor();
   assert.equal(await panel.locator('.vt-file .vt-tag.read').first().textContent(),c.tag,c.timezoneId+' timeline tag');
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   // Reading log: another reader's mark from more than a week ago shows its local date; the title has the local zone.
   const log=page.locator('.reading-log');await log.locator('[data-reading-log-details]').waitFor();
   await log.locator('[data-reading-log-toggle]').click();await log.locator('[data-reading-log-agents-toggle]').click();
   const row=log.locator('[data-reading-log-agents] [data-reading-log-row]',{hasText:c.other[0]});
   assert.equal(await row.locator('time').textContent(),c.other[1],c.timezoneId+' reading log');
   assert.match(await row.locator('time').getAttribute('title'),new RegExp(`· ${c.other[0]} · ${c.other[1]}, 2026, \\d+:16\\s[AP]M (GMT[+-]\\d+|[A-Z]{3,4})$`));
   // History groups by the local day of each open, relative to the local today.
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('r');
   const queue=page.locator('#queue-panel');await queue.waitFor();await queue.getByRole('tab',{name:'History'}).click();
   await queue.locator('#queue-list-history [data-queue-row]').first().waitFor();
   const groups=await queue.locator('#queue-list-history [role=group], #queue-list-history section').evaluateAll(els=>els.map(g=>[g.querySelector('[data-section-label]')?.textContent,[...g.querySelectorAll('[data-queue-title]')].map(t=>t.textContent)]).filter(([label])=>label));
   assert.deepEqual(groups,c.history,c.timezoneId+' history groups');
   await context.close();
  }
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Local dates passed: in America/Los_Angeles and Asia/Tokyo, receipts minutes either side of midnight UTC show the local day in the version chip and timeline tag, reading log dates and local-zone titles, and History Today/Yesterday/date groups.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
