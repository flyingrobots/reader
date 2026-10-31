/* Real shadcn section Items, section routes and all-library paging on synthetic metadata. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',s=>resolve(JSON.parse(s)));fixture.once('exit',c=>reject(Error('Fixture exited '+c)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disk-cache-size=10485760']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/library*',async route=>{const response=await route.fetch(),data=await response.json(),seed=data.works.find(work=>work.primary==='library/thought.md');
   data.works.push(...Array.from({length:27},(_,i)=>({...seed,primary:`library/section-older/${i}.md`,title:`Older section article ${i}`,date:'2020-01-01',read:false})));
   await route.fulfill({response,json:data});});
  await page.goto(url);const link=page.locator('#issue-sections [data-library-section]').first();await link.waitFor();
  assert.equal(await link.getAttribute('data-slot'),'item');const label=await link.getAttribute('data-library-section');
  const route=await link.getAttribute('href');assert.ok(route.startsWith('#section='));await link.click();await page.locator('[data-section-page]').waitFor();
  assert.equal(await page.locator('#section-title').textContent(),label);assert.equal(await page.locator('#main [data-article-row]').count(),20);
  assert.ok((await page.locator('[data-section-page]').textContent()).includes('articles in this section'));
  await page.locator('#main').getByRole('button',{name:'Next article page'}).click();assert.ok((await page.locator('#main [data-article-row]').allTextContents()).some(text=>text.includes('Older section article')),'section includes older articles beyond the homepage issue');
  await page.reload();await page.locator('#section-title').waitFor();assert.equal(new URL(page.url()).hash,route);
  await page.locator('#section-query').fill('A quiet thought');assert.equal(await page.locator('#main [data-article-row]').count(),1);await page.locator('#main [data-article-row]').click();await page.locator('#article').waitFor();
  await page.goBack();await page.locator('#section-title').waitFor();assert.equal(new URL(page.url()).hash,route);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#reader-home').click();await page.locator('#home-title').waitFor();assert.equal(await page.locator('#status-location').isVisible(),false);assert.equal(await page.locator('#vim-mode + #reader-home').count(),1);
  assert.deepEqual(errors,[]);console.log('Sections passed: shadcn Item links, all-library membership including older articles, paging, filtering, open article, deep-link reload, browser Back, mobile bounds, footer home.');
 }finally{await browser?.close();fixture.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
