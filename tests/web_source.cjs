/* The document header's Source link and `Space u`: both open the raw file bytes. Synthetic data only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--inbox'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  const filed='library/source-check/raw-note.md',filedBytes='---\ntitle: Synthetic raw note\nauthor: Example Author\n---\n\n# Synthetic raw note\n\nA *rendered* paragraph.\n';
  mkdirSync(join(root,'library/source-check'),{recursive:true});writeFileSync(join(root,filed),filedBytes);
  const preview='inbox/22222222-2222-4222-8222-222222222222/RW-91.md',previewBytes=readFileSync(join(root,preview),'utf8');
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});const errors=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  async function check(path,bytes,label){
    const payload=page.waitForResponse(r=>r.url().includes('/api/document?')&&r.request().method()==='GET');
    await page.goto(url+'/#read='+encodeURIComponent(path));const doc=await (await payload).json();
    await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
    const link=page.locator('.document-meta a.document-source');await link.waitFor();
    assert.equal(await link.getAttribute('href'),doc.file_url,label+': the header link is the payload file_url');
    assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
    assert.match(await link.getAttribute('title'),/Open the raw source file/);assert.equal((await link.textContent()).trim(),'Source');
    assert.equal(await page.locator('.document-footer a',{hasText:'Open original'}).getAttribute('href'),doc.file_url,label+': the footer link stays');
    const response=await page.request.get(new URL(doc.file_url,url).href);assert.equal(response.status(),200);
    assert.match(response.headers()['content-type'],/^text\/plain/,label+': served as text');assert.equal(await response.text(),bytes,label+': exact bytes, front matter included');
    // Space u opens the same URL in a new tab.
    await page.locator('#main').focus();const popup=context.waitForEvent('page');await page.keyboard.press('Space');await page.keyboard.press('u');
    const tab=await popup;await tab.waitForLoadState();assert.equal(tab.url(),new URL(doc.file_url,url).href,label+': Space u opens the raw file');
    assert.equal(await tab.evaluate(()=>document.body.innerText),bytes,label+': the tab shows the raw text');await tab.close();
  }
  await check(filed,filedBytes,'filed');
  await check(preview,previewBytes,'inbox preview');
  // The key map lists the shortcut.
  await page.locator('#main').focus();await page.keyboard.press('?');await page.locator('.keymap').first().waitFor();
  assert.match((await page.locator('.keymap').allTextContents()).join('\n'),/Space u\s*Open the raw source file/);await page.keyboard.press('Escape');
  // Every theme keeps the control readable against what it is painted on.
  const THEMES=['ink','paper','orchid','orchid-dark','harvest','harvest-dark',...require('../src/reader_mcp/web_ui/famous-themes.json').themes.flatMap(t=>[t.id,t.id+'-dark'])];
  const ratios=await page.evaluate(themes=>{
    const html=document.documentElement,original=html.dataset.theme,link=document.querySelector('.document-meta a.document-source'),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
    const rgb=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].slice(0,3);};
    const lum=values=>values.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    const still=document.createElement('style');still.textContent='*{transition:none!important}';document.head.append(still);const rows=[];
    // The outline button paints a translucent fill in dark themes: composite every layer down to the first opaque one.
    const behind=()=>{const layers=[];for(let el=link;el;el=el.parentElement){const value=getComputedStyle(el).backgroundColor;if(['rgba(0, 0, 0, 0)','transparent'].includes(value))continue;layers.push(value);if(!/\/\s*0?\.\d|rgba\(/.test(value))break;}
      context.clearRect(0,0,1,1);context.fillStyle=getComputedStyle(html).getPropertyValue('--bg')||'#fff';context.fillRect(0,0,1,1);for(const value of layers.reverse()){context.fillStyle=value;context.fillRect(0,0,1,1);}return [...context.getImageData(0,0,1,1).data].slice(0,3);};
    for(const theme of themes){html.dataset.theme=theme;
      const [lo,hi]=[lum(rgb(getComputedStyle(link).color)),lum(behind())].sort((a,b)=>a-b);rows.push({theme,ratio:(hi+.05)/(lo+.05)});}
    still.remove();html.dataset.theme=original;return rows;},THEMES);
  for(const row of ratios)assert.ok(row.ratio>=4.5,JSON.stringify(row));
  // Mobile: the header meta does not overflow the page.
  await page.setViewportSize({width:390,height:844});await page.goto(url+'/#read='+encodeURIComponent(filed));await page.locator('.document-meta a.document-source').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  const box=await page.locator('.document-meta a.document-source').boundingBox();assert.ok(box.height<48,'the control stays one line: '+box.height);
  await page.screenshot({path:'.reader/web-dev/source-mobile.png'});
  assert.deepEqual(errors,[]);console.log('Source passed: header Source link equals file_url for filed and inbox documents, raw text/plain bytes with front matter, Space u opens it, key map lists it, footer link kept, six-theme-family contrast and phone width fits.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
