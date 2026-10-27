/* Theme Editor against a disposable synthetic vault and a fake Google Fonts. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--themes'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(url))external.push(request.url());});
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(url);await page.locator('#home-title').waitFor();
  const editor=page.locator('#theme-editor');
  // F10 toggles; Space , t opens; the Settings sheet links to it.
  await page.keyboard.press('F10');await editor.waitFor();await page.waitForFunction(()=>document.querySelector('#vim-mode').textContent==='SETTINGS');
  await page.keyboard.press('F10');await editor.waitFor({state:'hidden'});
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press(',');await page.waitForFunction(()=>document.querySelector('#status-keys').textContent.includes('theme editor'));await page.keyboard.press('t');await editor.waitFor();
  await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('p');await page.locator('#theme-editor-open').click();await editor.waitFor();
  assert.ok(await page.locator('#backstage-settings').isVisible(),'the editor opens over Reader Admin\'s Settings');
  // Built-in Ink & Paper is read from the cascade; the dark variant is current.
  assert.equal(await page.locator('#token-bg').inputValue(),'#141713');assert.ok(await page.getByText('Saving creates your own copy').isVisible());
  await page.locator('#theme-name').fill('Dusk test');
  await page.locator('#token-ink').fill('#4a4a4a');await page.locator('#token-ink').press('Enter');
  const fail=page.locator('.theme-checks li[data-severity=fail]').filter({hasText:'Body text on page'});await fail.waitFor();
  const previewInk=await page.locator('.theme-preview').evaluate(el=>getComputedStyle(el).getPropertyValue('--ink').trim());assert.equal(previewInk,'#4a4a4a','preview follows the draft');
  await page.getByRole('button',{name:'Fix contrast failures'}).click();await fail.waitFor({state:'detached'});
  const fixed=await page.locator('#token-ink').inputValue();assert.notEqual(fixed,'#4a4a4a');
  // Simulated color vision changes only the preview.
  await page.locator('#theme-simulation').click();await page.getByRole('option',{name:'Deuteranopia',exact:true}).click();
  assert.equal(await page.locator('#token-chart-1').inputValue(),'#9fc08b');assert.notEqual(await page.locator('.theme-preview').evaluate(el=>getComputedStyle(el).getPropertyValue('--chart-1').trim()),'#9fc08b');
  // Google Fonts: search and install through the local server only.
  await page.locator('#font-search').fill('lo');await page.locator('.theme-font-results li').filter({hasText:'Lora'}).getByRole('button',{name:'Add'}).click();
  await page.locator('.theme-font-results li').filter({hasText:'Lora'}).getByRole('button',{name:'Added'}).waitFor();
  await page.locator('#font-serif').click();await page.getByRole('option',{name:'Lora · Serif'}).click();
  assert.match(await page.locator('.theme-preview').evaluate(el=>getComputedStyle(el).getPropertyValue('--serif')),/^'Lora'/);
  // Headings: each level takes its own font and size; blank keeps the default.
  // The Reading font goes back to its default, so Lora below can come only from the H1 setting.
  await page.locator('#font-serif').click();await page.getByRole('option',{name:'Default (Newsreader)'}).click();
  await page.locator('#heading-font-h1').click();await page.getByRole('option',{name:'Lora · Serif'}).click();
  await page.locator('#heading-size-h2').fill('40');await page.locator('#heading-size-h2').press('Enter');
  await page.locator('#heading-size-h5').fill('500');await page.locator('#heading-size-h5').press('Enter');
  assert.equal(await page.locator('#heading-size-h5').inputValue(),'','an out-of-range size is refused');
  const previewHeading=sel=>page.locator('.theme-preview .article '+sel).evaluate(el=>({family:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize}));
  assert.match((await previewHeading('h1')).family,/^Lora/);assert.equal((await previewHeading('h2')).size,'40px');
  assert.match((await previewHeading('h2')).family,/^Newsreader/);assert.equal((await previewHeading('h4')).size,'17px','unset levels keep the preview default');
  // Light variant: derive from dark, then save and use.
  await page.locator('.theme-editor-form .theme-variant button').filter({hasText:'Light'}).click();
  await page.getByRole('button',{name:'Derive dark variant from light'}).click();
  await page.getByRole('button',{name:'Save and use'}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='user-dusk-test');
  const listed=await (await page.request.get(url+'/api/themes')).json();assert.deepEqual(listed.themes.map(t=>t.id),['dusk-test']);assert.equal(listed.themes[0].fonts.serif,null);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()),listed.themes[0].light.bg);
  assert.deepEqual(listed.themes[0].headings.h1,{font:'Lora',size:null});assert.deepEqual(listed.themes[0].headings.h2,{font:null,size:40});assert.deepEqual(listed.themes[0].headings.h5,{font:null,size:null});
  await page.locator('#theme-editor-foot, .theme-editor-foot').getByText('Saved in the vault').waitFor();
  mkdirSync('.reader/web-dev',{recursive:true});await page.screenshot({path:'.reader/web-dev/theme-editor.png'});
  await page.keyboard.press('Escape');await editor.waitFor({state:'hidden'});
  // The footer lists newly saved custom themes alongside the built-ins, without visiting Settings.
  await page.locator('#quick-theme').click();await page.getByRole('option',{name:'Paper',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='paper');
  await page.locator('#quick-theme').click();await page.getByRole('option',{name:'Dusk test · Light',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='user-dusk-test');
  // The footer switch pairs custom variants; a reload paints from the cache.
  await page.goto(url);await page.locator('#home-title').waitFor();
  await page.getByRole('switch',{name:'Dark mode',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'user-dusk-test-dark');
  await page.route('**/api/themes',route=>route.abort());
  await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'user-dusk-test-dark');assert.ok((await page.locator('#reader-user-themes').textContent()).includes('user-dusk-test-dark'));
  await page.locator('#home-title').waitFor();await page.unroute('**/api/themes');await page.reload();await page.locator('#home-title').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'user-dusk-test-dark');
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('link[data-theme-font]')].some(l=>l.getAttribute('href')==='/fonts/lora/font.css')));
  // A document's headings follow the theme: H1's font also sets the title; H2 takes its size; H3 keeps the default.
  await page.goto(url+'#read=library/thought.md');await page.locator('.article h2').first().waitFor();
  const docHeading=sel=>page.locator(sel).first().evaluate(el=>({family:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize}));
  assert.match((await docHeading('.article .document-title')).family,/^Lora/);assert.equal((await docHeading('.article h2')).size,'40px');assert.match((await docHeading('.article h2')).family,/^Newsreader/);
  await page.goto(url);await page.locator('#home-title').waitFor();
  // Delete returns to a built-in of the same polarity.
  await page.keyboard.press('F10');await editor.waitFor();assert.equal(await page.locator('#theme-name').inputValue(),'Dusk test');
  await page.getByRole('button',{name:'Delete theme'}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='ink');
  assert.deepEqual((await (await page.request.get(url+'/api/themes')).json()).themes,[]);
  await page.screenshot({path:'.reader/web-dev/theme-editor-new.png'});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.querySelector('#theme-editor').scrollWidth<=innerWidth+1),'editor fits phone width');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);console.log('Theme Editor passed: F10/leader/settings entry, built-in copy, contrast fix, CVD preview, local font install, per-level heading font and size (preview, saved, document), save/use/pair/reload cache, delete fallback, phone width, local-only requests.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
