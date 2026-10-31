/* Synthetic end-to-end acceptance checks. Requires playwright-core and Chrome. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT || 'playwright-core');

(async()=>{
 const fixture=spawn(process.env.READER_PYTHON || '.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});
 let browser;
 try {
  const {url}=await new Promise((resolve,reject)=>{const lines=createInterface({input:fixture.stdout});lines.once('line',line=>{lines.close();try{resolve(JSON.parse(line));}catch(e){reject(e);}});fixture.once('exit',code=>reject(new Error('Fixture exited: '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  let context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
  let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function freshContext(reducedMotion='reduce'){
    const storageState=await context.storageState();await context.close();
    context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion,storageState});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  }
  await page.goto(url);await page.locator('#home-title').waitFor();
  await page.locator('.issue-cover').waitFor();assert.equal(await page.locator('#issue [data-piece]').count(),2,'both works are in this issue');
  assert.equal(await page.locator('#statusline').isVisible(),true);
  await page.keyboard.press('Space');await page.keyboard.press('e');await page.keyboard.press('/');await page.locator('#file-query').fill('quie thoght');
  await page.waitForTimeout(500);await page.keyboard.press('Enter');await page.locator('#article p').first().waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#main').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  assert.equal(await page.locator('#progress-pips button').count(),1);
  await page.keyboard.press('/');await page.locator('#find-query').fill('distinct observation');await page.keyboard.press('Enter');
  assert.match(await page.locator('#find-count').textContent(),/1 \/ 44/);
  await page.keyboard.press('n');assert.match(await page.locator('#find-count').textContent(),/2 \/ 44/);
  await page.keyboard.press('N');assert.match(await page.locator('#find-count').textContent(),/1 \/ 44/);
  await page.locator('#layout-swap').click();await page.waitForFunction(()=>document.body.classList.contains('two-page') && document.querySelector('.book-viewport')?.scrollWidth>innerWidth);
  await page.waitForTimeout(600);
  const initial=await page.locator('.book-viewport').evaluate(el=>({left:el.scrollLeft,width:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,columns:getComputedStyle(el.querySelector('article')).columnCount}));
  assert.equal(initial.columns,'2');assert.ok(initial.height>500);assert.ok(initial.scroll>initial.width*3);
  await page.locator('#main').focus();await page.keyboard.press('j');await page.waitForTimeout(550);
  const advanced=await page.locator('.book-viewport').evaluate(el=>el.scrollLeft);assert.ok(advanced>initial.width,'j advances an entire spread');
  await page.locator('.book-viewport').hover();await page.mouse.wheel(0,350);await page.waitForTimeout(600);
  const wheeled=await page.locator('.book-viewport').evaluate(el=>el.scrollLeft);assert.ok(wheeled>advanced,'wheel advances another spread');
  await page.waitForTimeout(700);await page.reload();await page.waitForTimeout(1000);
  const resumed=await page.locator('.book-viewport').evaluate(el=>el.scrollLeft);assert.ok(Math.abs(resumed-wheeled)<3,'same edition restores spread on reload');
  await page.locator('#progress-slider').hover({position:{x:700,y:7}});await page.locator('#progress-popover').waitFor();assert.match(await page.locator('#progress-popover').textContent(),/% · \d+ min remaining/);
  await page.getByRole('switch',{name:'Dark mode',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'user-reader-test');
  await page.locator('#settings-open').click();await page.locator('#reader-admin').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='admin-title'&&location.hash==='#admin');
  await page.goBack();await page.locator('#article').waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  await page.keyboard.press('Escape');await page.locator('#main').focus();await page.keyboard.press('g');await page.keyboard.press('g');await page.waitForTimeout(600);
  await page.locator('#progress-pips button').click();await page.locator('#thread-reply').waitFor();await page.waitForTimeout(250);
  await page.locator('#reply-body').fill('A reply from the synthetic reader.');await page.waitForTimeout(30);assert.equal(await page.locator('#vim-mode').textContent(),'INSERT');
  await page.locator('#thread-reply button[type=submit]').click();await page.waitForFunction(()=>document.querySelectorAll('.comment').length===2);
  await page.locator('#thread-close').click();
  await page.screenshot({path:'.reader/web-dev/two-pages.png'});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);
  assert.equal(await page.locator('#article').evaluate(el=>getComputedStyle(el).columnCount),'1');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no mobile page overflow');
  await page.screenshot({path:'.reader/web-dev/two-pages-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#main').focus();await page.keyboard.press('g');await page.keyboard.press('g');await page.waitForTimeout(400);
  await page.locator('#article strong').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#selection-tools').waitFor();await page.locator('[data-annotate=comment]').click();await page.locator('#annotation-body').fill('A source-anchored browser note after an emoji.');
  await page.locator('#annotation-form button').click();await page.waitForFunction(()=>document.querySelectorAll('#progress-pips button').length===2);await page.locator('#thread-reply').waitFor();
  assert.match(await page.locator('.thread-quote').textContent(),/a precise passage/);
  await page.locator('#thread-close').click();
  // Continuous scrolling and an automatic bookmark must survive a reload too.
  await page.locator('#layout-swap').click();await page.waitForTimeout(500);
  await page.locator('#main').focus();await page.keyboard.press('Control+d');await page.waitForTimeout(700);
  const scrollPosition=await page.evaluate(()=>scrollY);assert.ok(scrollPosition>100);
  await page.reload();await page.waitForTimeout(800);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scrollPosition)<4);
  // Enable facing pages again before opening a different document format.
  await page.locator('#layout-swap').click();await page.waitForTimeout(500);
  // Release Markdown/screenshot surfaces before the PDF worker and canvases.
  await freshContext();
  await page.goto(url+'/#read='+encodeURIComponent('library/pages.pdf'));
  await page.waitForFunction(()=>document.querySelector('.pdf-page canvas')?.width>0);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.pdf-page').count(),6);
  assert.equal(await page.locator('.pdf-page .textLayer span').first().isVisible(),true);
  await page.locator('#main').focus();await page.keyboard.press('j');await page.waitForTimeout(700);
  const pdfPosition=await page.locator('.book-viewport').evaluate(el=>el.scrollLeft);assert.ok(pdfPosition>1000);
  await page.reload();await page.waitForFunction(()=>document.querySelector('.book-viewport')?.scrollLeft>1000);await page.waitForTimeout(300);
  assert.ok(Math.abs(await page.locator('.book-viewport').evaluate(el=>el.scrollLeft)-pdfPosition)<3);
  await page.keyboard.press('/');await page.locator('#find-query').fill('precise observation');
  await page.waitForFunction(()=>document.querySelector('#find-count')?.textContent==='1 / 6');await page.keyboard.press('Enter');await page.waitForTimeout(500);
  await page.screenshot({path:'.reader/web-dev/two-pages-pdf.png'});
  await page.locator('#layout-swap').click();await page.waitForTimeout(900);
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('two-page')),false);
  assert.ok(await page.locator('.pdf-page').first().evaluate(el=>el.clientHeight>500));
  // Exercise actual GSAP smoothing, with the fixed rails outside its transform.
  await freshContext('no-preference');
  await page.goto(url+'/#read='+encodeURIComponent('library/thought.md'));await page.locator('#article strong').first().waitFor();await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>!!window.ScrollSmoother.get()),true);
  await page.locator('#main').focus();await page.keyboard.press('Control+d');await page.waitForTimeout(1100);
  assert.ok(await page.evaluate(()=>scrollY>100));
  assert.ok(await page.locator('#statusline').evaluate(el=>Math.abs(el.getBoundingClientRect().bottom-innerHeight)<2));
  await context.close();
  // A real touch gesture must pan and snap the narrow-screen paged viewport.
  const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await touchContext.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({layout:'spread',participant:'Touch tester'})));
  const touchPage=await touchContext.newPage();touchPage.on('pageerror',e=>errors.push(e.message));
  await touchPage.goto(url+'/#read='+encodeURIComponent('library/thought.md'));await touchPage.locator('.book-viewport').waitFor();await touchPage.waitForTimeout(700);
  const cdp=await touchContext.newCDPSession(touchPage);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:330,y:350}]});
  for(const x of [280,230,180,130,60]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:350}]});await touchPage.waitForTimeout(40);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touchPage.waitForTimeout(700);
  assert.ok(await touchPage.locator('.book-viewport').evaluate(el=>el.scrollLeft>100),'horizontal touch gesture advances a page');
  await touchContext.close();
  assert.deepEqual(errors,[]);
  console.log('Browser acceptance passed: real columns, wheel/Vim turning, resume, find, highlights, replies, status, themes, drawer, mobile, and PDF spreads/resume/find.');
 } finally {await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(e=>{console.error(e);process.exitCode=1;});
