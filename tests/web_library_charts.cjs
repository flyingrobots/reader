/* Gallery charts through Reader's real dashboard, navigation and exact-version read API. Synthetic vault only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT || 'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON || '.venv/bin/python',['tests/web_fixture.py','--dashboard'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--renderer-process-limit=1','--js-flags=--max-old-space-size=128','--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  let page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce',timezoneId:'America/Los_Angeles'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.clock.install({time:new Date('2026-10-28T12:00:00Z')});
  await page.goto(url+'/?theme=paper#admin/library');await page.locator('.shelf-cell').first().waitFor();
  assert.equal(await page.locator('.stat-panel').count(),12);
  assert.equal(await page.locator('#latest-list .work-row').count(),8);
  await page.locator('#dashboard-more').click();assert.equal(await page.locator('#latest-list .work-row').count(),14);
  // Switch in the existing arrivals panel; keyboard-select one day and inspect exactly its works.
  await page.locator('#arrivals-view').click();assert.equal(await page.locator('#arrivals-view').getAttribute('aria-pressed'),'true');
  const cell=page.locator('.calendar-day[role=button]').last();const count=await cell.evaluate(el=>el.__data__.value);
  await cell.focus();await page.keyboard.press('Enter');assert.match(await page.locator('#dashboard-selection').textContent(),new RegExp('^'+count+' matching'));
  assert.equal(await page.locator('#latest-list .work-row').count(),count);assert.equal(await cell.getAttribute('aria-pressed'),'true');
  await page.locator('#arrivals-view').click();assert.equal(await page.locator('.calendar-day').count(),0);assert.equal(await page.locator('#arrivals-view').getAttribute('aria-pressed'),'false');
  // Read/unread topic segments select the precise topic/status intersection.
  const stack=page.locator('.topic-reading-segment').first();const subset=await stack.evaluate(el=>el.__data__.works.map(w=>w.primary).sort());
  await stack.focus();await page.keyboard.press('Space');assert.match(await page.locator('#editions-title').textContent(),/Unread/);
  const selected=await page.locator('#latest-list [data-path]').evaluateAll(els=>[...new Set(els.map(el=>el.dataset.path))].sort());assert.deepEqual(selected,subset);
  // Shelf picker and breadcrumbs reach sources, not catalog wrappers. A real open produces a read segment on return.
  const picker=page.locator('.shelf-picker');
  await picker.selectOption({label:'Ideas · 6 works'});await picker.selectOption({label:'Synthetic · 2 works'});
  assert.equal(await page.locator('.shelf-breadcrumbs [aria-current]').textContent(),'Synthetic');
  assert.equal(await page.locator('.shelf-cell[role=link]').count(),2);
  await page.locator('.shelf-cell[role=link]').filter({hasText:'A quiet thought'}).focus();await page.keyboard.press('Enter');
  await page.locator('#main .article').waitFor();assert.match(page.url(),/thought.md/);
  await page.goto(url+'/?theme=paper#admin/library');await page.locator('.topic-reading-segment[aria-label*="Read:"]').waitFor();
  assert.equal(await page.locator('.topic-reading-segment[aria-label*="Read:"]').evaluate(el=>el.__data__.value),1);
  assert.equal(await page.locator('[data-total="1"] strong').textContent(),'1');
  assert.equal(await page.locator('[data-total="2"] strong').textContent(),'13');
  assert.equal(await page.locator('#chart-reading .donut-total').textContent(),'7%');
  await page.locator('.shelf-picker').selectOption({label:'Ideas · 6 works'});
  await page.locator('.shelf-breadcrumbs button').filter({hasText:'All shelves'}).click();assert.equal(await page.locator('.shelf-breadcrumbs button').count(),1);
  await page.locator('.shelf-picker').selectOption({label:'Ideas · 6 works'});await page.locator('#atlas-reset').click();assert.equal(await page.locator('.shelf-breadcrumbs button').count(),1);
  await page.locator('#arrivals-view').click();await page.screenshot({path:'.reader/web-dev/gallery-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.reader/web-dev/gallery-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'charts fit mobile width');
  // Empty inventory and hostile metadata use the same server assets, with a synthetic bootstrap response.
  await page.route('**/api/library*',async route=>{const response=await route.fetch(),data=await response.json();data.works=[];data.metrics={...data.metrics,works:0,read:0,unread:0,authors:0};await route.fulfill({response,json:data});});
  await page.goto(url+'/#admin/library');await page.locator('.shelf-context').waitFor();assert.match(await page.locator('.shelf-context').textContent(),/No catalog works/);
  await page.locator('#arrivals-view').click();assert.equal(await page.locator('.calendar-day[role=button]').count(),0);assert.match(await page.locator('#chart-arrivals').textContent(),/No recorded arrivals/);
  await page.close();page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/library*',async route=>{const response=await route.fetch(),data=await response.json();data.works.forEach(work=>{work.topics=['<img src=x onerror="window.chartInjection=true">'];work.projects=['__proto__'];});await route.fulfill({response,json:data});});
  await page.goto(url+'/#admin/library');await page.locator('.shelf-picker option').nth(1).waitFor({state:'attached'});await page.locator('.shelf-picker').selectOption('1');
  assert.equal(await page.locator('#chart-atlas img').count(),0);assert.equal(await page.evaluate(()=>window.chartInjection),undefined);
  assert.deepEqual(errors,[]);console.log('Gallery charts passed: daily selection, read/unread topic subsets, full result pagination, keyboard shelf drill/open/reset, durable read status, mobile, empty inventory and escaped metadata.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
