/* The Server card on Reader Admin's Service & tools page: commit, source, Tailscale address, identity, and the Update now / Pause toasts. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--service'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  const toast=text=>page.locator('[data-sonner-toast]').filter({hasText:text});
  const card=page.locator('[data-card=service]');
  // Installable app: manifest, touch icon, and a theme colour that follows the theme.
  await page.goto(url);await page.locator('#home-title').waitFor();
  const manifest=await page.evaluate(async()=>{const href=document.querySelector('link[rel=manifest]').href;const r=await fetch(href);return {type:r.headers.get('content-type'),body:await r.json()};});
  assert.equal(manifest.type,'application/manifest+json');assert.equal(manifest.body.display,'standalone');
  for(const icon of [...manifest.body.icons.map(i=>i.src),await page.locator('link[rel=apple-touch-icon]').getAttribute('href')])assert.equal((await page.request.get(url+icon)).status(),200,icon);
  await page.waitForFunction(()=>document.querySelector('meta[name=theme-color]').content===getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  // The card.
  await page.goto(url+'#admin/service');await card.waitFor();
  await card.locator('[data-fact=commit]').waitFor();
  assert.match(await card.locator('[data-fact=commit] dd').textContent(),/^1f2e3d4 · /);
  assert.equal(await card.locator('[data-fact=source] dd').textContent(),'preview/integration');
  assert.equal(await card.locator('[data-fact=tailscale] a').textContent(),'reader-host.example-tailnet.ts.net');
  assert.equal(await card.locator('[data-fact=tailscale] a').getAttribute('href'),'https://reader-host.example-tailnet.ts.net');
  assert.equal(await card.locator('[data-fact=identity] dd').textContent(),'This Mac (local)');
  assert.equal(await card.locator('[data-fact=subject]').textContent(),'A synthetic change');
  assert.equal(await card.locator('.backstage-badge').textContent(),'Running');
  await page.screenshot({path:'.reader/web-dev/server-card.png',fullPage:true});
  // Update now: a loading toast, then the outcome when the updater lands the new commit.
  await page.locator('#service-update').click();
  await toast('Checking for an update…').waitFor();assert.equal(await toast('Checking for an update…').getAttribute('data-type'),'loading');
  await toast('Updated to 9a8b7c6').waitFor({timeout:15000});assert.equal(await toast('Updated to 9a8b7c6').getAttribute('data-type'),'success');
  assert.equal(await toast('Checking for an update…').count(),0,'the loading toast is replaced');
  assert.match(await card.locator('[data-fact=commit] dd').textContent(),/^9a8b7c6 · /);
  assert.match(await card.locator('[data-fact=next-check] dd').textContent(),/^In (9|10) min$/);
  // Pause and resume.
  await page.locator('#service-pause').click();await toast('Updates paused').waitFor();
  await page.waitForFunction(()=>document.querySelector('#service-pause').textContent==='Resume updates');
  assert.equal(await card.locator('.backstage-badge').textContent(),'Updates paused');assert.equal(await card.locator('[data-fact=next-check] dd').textContent(),'Paused');
  await page.locator('#service-pause').click();await toast('Updates resumed').waitFor();await page.waitForFunction(()=>document.querySelector('#service-pause').textContent==='Pause updates');
  // Phone width.
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  const box=await card.boundingBox();assert.ok(box.x>=15&&box.x+box.width<=390-15,'16px gutters');
  await page.screenshot({path:'.reader/web-dev/server-card-phone.png',fullPage:true});
  await context.close();
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Service passed: manifest and icons, theme colour, Server card commit/source/Tailscale/identity, Update now loading and success toasts, pause and resume, phone width, local-only assets.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
