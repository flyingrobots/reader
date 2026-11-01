/* Flat explorer behavior against synthetic library metadata and documents. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/library*',async route=>{const response=await route.fetch(),data=await response.json();
    // More than two pages; the last matching article would have disappeared behind the old recent cap.
    data.works.push(...Array.from({length:45},(_,i)=>({primary:`library/synthetic/article-${i}.md`,title:`Synthetic article ${String(i).padStart(2,'0')}`,authors:['Synthetic author'],projects:['Explorer test'],types:['Essay'],date:`2026-09-${String(i%28+1).padStart(2,'0')}`,read:i%2===0})));
    await route.fulfill({response,json:data});});
  await page.goto(url);await page.locator('#home-title').waitFor();
  const before=await page.locator('#smooth-wrapper').boundingBox();
  await page.keyboard.press('Space');await page.keyboard.press(',');await page.keyboard.press('e');await page.locator('#picker').waitFor();
  assert.equal(await page.locator('#picker').evaluate(el=>el.tagName),'ASIDE');assert.equal(await page.locator('dialog[open]').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'file-results');assert.equal(await page.locator('[data-article-row]').count(),20);
  const explorer=await page.locator('#picker').boundingBox(),content=await page.locator('#smooth-wrapper').boundingBox();
  assert.ok(content.x>=explorer.width-1);assert.ok(content.width<before.width-200,'explorer reduces the content width');
  assert.equal(await page.getByRole('button',{name:'Previous article page'}).isDisabled(),true);
  await page.getByRole('button',{name:'Next article page'}).click();const second=await page.locator('[data-article-row]').first().getAttribute('data-path');
  assert.match(await page.locator('#explorer-count').textContent(),/^21–40 of/);
  await page.getByRole('button',{name:'Previous article page'}).click();assert.notEqual(await page.locator('[data-article-row]').first().getAttribute('data-path'),second);
  await page.locator('#file-query').fill('Synthetic author');assert.match(await page.locator('#explorer-count').textContent(),/^1–20 of 45/);
  await page.locator('#explorer-sort').click();await page.getByRole('option',{name:'Title A–Z',exact:true}).click();assert.match(await page.locator('[data-article-row]').first().textContent(),/Synthetic article 00/);
  await page.getByRole('button',{name:'Next article page'}).click();await page.getByRole('button',{name:'Next article page'}).click();
  assert.equal(await page.locator('[data-article-row]').count(),5);assert.match(await page.locator('[data-article-row]').last().textContent(),/Synthetic article 44/);assert.equal(await page.getByRole('button',{name:'Next article page'}).isDisabled(),true);
  await page.locator('#explorer-read').click();await page.getByRole('option',{name:'Unread',exact:true}).click();assert.match(await page.locator('#explorer-count').textContent(),/^1–20 of 22/);assert.equal(await page.locator('[data-article-row][data-read=true]').count(),0);
  await page.locator('#file-query').fill('no matches anywhere');assert.equal(await page.locator('[data-empty]').count(),1);assert.match(await page.locator('#explorer-count').textContent(),/^0 articles$/);
  // Escape from a nested Select closes that popup alone; from the text input it closes the column.
  await page.locator('#explorer-sort').click();await page.locator('[data-slot=select-content][data-open]').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#picker').isVisible(),true);
  await page.locator('#file-query').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#picker').isVisible(),false);
  await page.keyboard.type(':files');await page.keyboard.press('Enter');await page.locator('#picker').waitFor();assert.equal(await page.locator('#file-query').inputValue(),'no matches anywhere');
  await page.locator('#file-query').fill('');await page.locator('#explorer-read').click();await page.getByRole('option',{name:'All articles',exact:true}).click();
  await page.locator('#file-query').fill('Another thought');await page.locator('[data-article-row]').click();await page.locator('#article').waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  assert.equal(await page.locator('#picker').isVisible(),true);assert.equal(await page.locator('[data-article-row][aria-current=page]').count(),1);assert.equal(await page.locator('[data-article-row][data-read=true]').count(),1);
  await page.locator('#layout-swap').click();await page.waitForFunction(()=>document.body.classList.contains('two-page')&&!document.querySelector('.resume-pending'));await page.locator('.book-viewport #article').waitFor();assert.ok((await page.locator('#smooth-wrapper').boundingBox()).x>=explorer.width-1);await page.screenshot({path:'.reader/web-dev/file-explorer-desktop.png'});
  await page.locator('#file-query').fill('');await page.locator('#file-results').focus();await page.keyboard.press('j');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-article-row')),true);
  await page.keyboard.press(',');await page.keyboard.press('e');assert.equal(await page.locator('#picker').isVisible(),false);
  await page.keyboard.press(',');await page.keyboard.press('e');await page.locator('#picker').waitFor();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  const narrow=await page.locator('#picker').boundingBox(),narrowContent=await page.locator('#smooth-wrapper').boundingBox();assert.ok(narrowContent.x>=narrow.width-1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'.reader/web-dev/file-explorer-mobile.png'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#picker').isVisible(),false);await page.keyboard.press('Space');await page.keyboard.press('e');await page.getByRole('button',{name:'Search contents',exact:true}).click();await page.locator('#search-query').waitFor();assert.deepEqual(errors,[]);
  console.log('Explorer passed: nonmodal left column, leader toggle, :files, Escape and nested Select, complete inventory, three pages, metadata/status filters, sorting, empty state, persistent state, article loading/read receipts, keyboard, mobile geometry.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
