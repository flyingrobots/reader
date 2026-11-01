/* Routes: heading fragments in #read= URLs, the h / l visit list after hash arrivals, and missing documents (synthetic data). */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--fragments'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const errors=[];const context=await browser.newContext({viewport:{width:1300,height:850},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{if(!sessionStorage.getItem('seeded')){localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false}));sessionStorage.setItem('seeded','1');}}catch{}});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const settled=()=>page.waitForFunction(()=>document.querySelector('#article')&&!document.querySelector('.resume-pending')&&!document.querySelector('[data-skeleton]'));
  const title=()=>page.locator('.document-title').first().textContent();
  const at=name=>page.waitForFunction(name=>document.querySelector('.document-title')?.textContent===name&&!document.querySelector('.resume-pending'),name,{timeout:5000}).then(()=>true,()=>false);
  const headingOnScreen=()=>page.evaluate(()=>{const r=document.querySelector('#far-section')?.getBoundingClientRect();return !!r&&r.top>=0&&r.top<innerHeight/2;});
  const hash=()=>page.evaluate(()=>decodeURIComponent(location.hash));
  // #56: following a link to a heading puts the heading in the URL; reload and history come back to it.
  await page.goto(url+'/#read='+encodeURIComponent('library/linker.md'));await settled();
  await page.getByRole('link',{name:'the far section'}).click();await page.waitForFunction(()=>decodeURIComponent(location.hash).startsWith('#read=library/far.md'));await settled();await page.waitForTimeout(200);
  assert.equal(await hash(),'#read=library/far.md&h=far-section');assert.ok(await headingOnScreen(),'the link scrolls to the heading: '+await page.evaluate(()=>JSON.stringify([!!document.querySelector('#far-section'),document.querySelector('#article h2')?.outerHTML,scrollY,document.querySelector('#far-section')?.getBoundingClientRect().top])));
  await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(600);
  await page.reload();await settled();await page.waitForTimeout(300);assert.ok(await headingOnScreen(),'reload returns to the heading');
  await page.goBack();assert.ok(await at('Linker'));await page.goForward();await settled();await page.waitForTimeout(200);assert.ok(await headingOnScreen(),'Forward returns to the heading');
  // Hand-made heading links, raw and escaped, and an unknown heading never break the page.
  for(const route of ['#read=library%2Ffar.md#far-section','#read=library%2Ffar.md%23far-section']){
   await page.goto(url+'/?fresh='+Math.random()+route);await settled();await page.waitForTimeout(200);assert.equal(await title(),'Far document',route);assert.ok(await headingOnScreen(),route);
   assert.equal(await hash(),'#read=library/far.md&h=far-section','the URL is normalized');
  }
  await page.goto(url+'/?fresh=1#read='+encodeURIComponent('library/far.md')+'&h=nowhere%E0%A4');assert.ok(await at('Far document'),'an unknown or malformed heading opens the document');
  // #11: a document reached by a #read= link from the homepage stays in the h / l list.
  await page.goto(url+'/?fresh=2');await page.locator('#home-title').waitFor();
  await page.evaluate(()=>{const a=document.createElement('a');a.href='#read='+encodeURIComponent('library/linker.md');a.id='hash-link';a.textContent='hash link';document.body.append(a);});
  await page.evaluate(()=>document.querySelector('#hash-link').click());assert.ok(await at('Linker'));
  await page.getByRole('link',{name:'the far section'}).click();await page.waitForFunction(()=>decodeURIComponent(location.hash).startsWith('#read=library/far.md'));await settled();
  await page.locator('#main').focus();await page.keyboard.press('h');assert.ok(await at('Linker'),'h goes back to the hash-arrived document');
  await page.locator('#main').focus();await page.keyboard.press('l');assert.ok(await at('Far document'));
  // A fresh #read= landing, then Reader Admin (Settings): h returns to the document.
  await page.goto(url+'/?fresh=3#read='+encodeURIComponent('library/linker.md'));await settled();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('p');await page.waitForFunction(()=>location.hash==='#admin/settings');
  await page.locator('#main').focus();await page.keyboard.press('h');assert.ok(await at('Linker'),'h after landing and Space p');
  // #52: a missing document shows one clear message and no toast.
  await page.goto(url+'/?fresh=4#read='+encodeURIComponent('library/no-such-folder/missing.md'));
  await page.getByRole('heading',{name:'Link target not found'}).waitFor();await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-sonner-toast]').count(),0,'no toast on top of the page message');
  assert.ok((await page.locator('#main').textContent()).includes('library/no-such-folder/missing.md'));
  await page.locator('#missing-find').click();await page.locator('#picker:not([hidden])').waitFor();
  assert.deepEqual(errors,[]);console.log('Routes passed: heading in #read= URLs across links, reload, history and hand-made links; h after hash arrival; one missing-document message.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
