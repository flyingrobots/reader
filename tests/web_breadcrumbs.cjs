/* Footer navigation acceptance, using only a disposable synthetic vault. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT || 'playwright-core');

(async()=>{
 const fixture=spawn(process.env.READER_PYTHON || '.venv/bin/python',['tests/web_fixture.py','--breadcrumbs'],{stdio:['ignore','pipe','inherit']});
 let browser;
 try {
  const {url}=await new Promise((resolve,reject)=>{const lines=createInterface({input:fixture.stdout});lines.once('line',line=>{lines.close();try{resolve(JSON.parse(line));}catch(error){reject(error);}});fixture.once('exit',code=>reject(new Error('Fixture exited: '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/#read='+encodeURIComponent('library/research/causal/notes/source.md'));
  await page.locator('#article p').first().waitFor();await page.waitForTimeout(500);
  const nav=page.getByRole('navigation',{name:'Document breadcrumb'});
  assert.equal(await nav.locator('[aria-current=page]').textContent(),'source.md');
  assert.equal(await nav.getByRole('link',{name:'Library',exact:true}).count(),1);
  assert.equal(await nav.getByRole('button',{name:'notes',exact:true}).count(),1);
  await nav.getByRole('button',{name:'notes',exact:true}).click();await page.locator('#picker').waitFor();
  assert.equal(await page.locator('#explorer-folder').textContent(),'library/research/causal/notes/');
  assert.equal(await page.locator('[data-article-row]').count(),2);
  assert.ok((await page.locator('[data-article-path]').allTextContents()).every(path=>path.startsWith('library/research/causal/notes/')));
  await page.keyboard.press('/');await page.locator('#file-query').fill('causal');await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-article-row]').count(),2);
  await page.getByRole('button',{name:'All folders',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-article-row]').length===4);
  assert.equal(await page.locator('#explorer-folder').isVisible(),false);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  const summary=nav.locator('summary');await summary.focus();await page.keyboard.press('Enter');
  await nav.getByRole('menu').waitFor();await page.waitForTimeout(50);
  assert.equal(await page.locator('#vim-mode').textContent(),'BROWSE');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'research');
  await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'causal');
  // Scroll/status updates must not recreate the breadcrumb or steal menu focus.
  await page.evaluate(()=>window.scrollTo(0,200));await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'causal');
  await page.keyboard.press('Escape');assert.equal(await summary.getAttribute('aria-expanded'),'false');assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
  await summary.click();await nav.getByRole('menuitem',{name:'research',exact:true}).click();await page.locator('#picker').waitFor();
  assert.equal(await page.locator('[data-article-row]').count(),4);await page.keyboard.press('Escape');
  await page.locator('#layout-swap').click();await page.waitForFunction(()=>document.body.classList.contains('two-page'));await page.waitForTimeout(450);
  await nav.locator('summary').click();await nav.getByRole('menu').waitFor();
  assert.ok(await nav.getByRole('menu').evaluate(el=>el.getBoundingClientRect().bottom<innerHeight-30));
  await page.screenshot({path:'.reader/web-dev/breadcrumbs-desktop.png'});await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
  assert.equal(await nav.getByRole('button',{name:'notes',exact:true}).count(),0);
  await nav.locator('summary').click();assert.equal(await nav.getByRole('menuitem').count(),3);
  const box=await nav.getByRole('menu').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390,'menu stays within narrow viewport');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'footer does not overflow the page');
  const statusCrowd=()=>page.evaluate(()=>{const box=e=>e.getBoundingClientRect(),location=box(document.querySelector('#status-location'));
    const items=[...document.querySelectorAll('#statusline > :not(#reading-progress)')].filter(e=>getComputedStyle(e).display!=='none'&&box(e).width>0);
    const overlaps=[];for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=box(items[i]),b=box(items[j]);if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5)overlaps.push(items[i].id+'/'+items[j].id);}
    const escaped=[...document.querySelectorAll('#status-location .breadcrumb-item > *, #status-location .breadcrumb-separator')].filter(e=>box(e).width>0&&(box(e).right>location.right+.5||box(e).left<location.left-.5)).map(e=>e.textContent||e.className);
    return {overlaps,escaped,offscreen:items.filter(e=>box(e).right>innerWidth+.5).map(e=>e.id),library:box(document.querySelector('#status-location [data-library-home]')).width};});
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(200);const crowd=await statusCrowd();
    assert.deepEqual(crowd,{overlaps:[],escaped:[],offscreen:[],library:crowd.library},width+' px two-page status line: breadcrumb stays inside its slot and nothing overlaps');assert.ok(crowd.library>20,'the Library crumb stays readable');}
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  await page.screenshot({path:'.reader/web-dev/breadcrumbs-mobile.png'});await page.keyboard.press('Escape');
  await nav.getByRole('link',{name:'Library',exact:true}).click();await page.locator('#home-title').waitFor();
  assert.equal(await nav.locator('[aria-current=page]').textContent(),'Library');assert.equal(await nav.locator('details').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Breadcrumb acceptance passed: parent-scoped search, all-folders reset, keyboard menu, stable focus, two-page overlay, mobile bounds, home navigation.');
 } finally {await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
