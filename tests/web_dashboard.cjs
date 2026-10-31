/* Dashboard (Reader Admin's Library page), browse-first picker and theme acceptance on a synthetic vault. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT || 'playwright-core');
const THEMES=['ink','paper','orchid','orchid-dark','harvest','harvest-dark',...require('../src/reader_mcp/web_ui/famous-themes.json').themes.flatMap(t=>[t.id,t.id+'-dark'])];
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON || '.venv/bin/python',['tests/web_fixture.py','--dashboard'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  const launch=()=>chromium.launch({headless:true,executablePath:process.env.READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--renderer-process-limit=1','--js-flags=--max-old-space-size=128','--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  browser=await launch();
  let page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/?theme=orchid-dark#admin/library');await page.locator('#backstage-library [data-statistics-grid]').waitFor();await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-stat-panel]').count(),12);assert.equal(await page.locator('[data-stat-panel] svg[role]').count(),12);
  assert.ok(await page.locator('.shelf-cell').count()>0);assert.equal(await page.locator('[data-total="0"] [data-total-value]').textContent(),'14');
  await page.locator('#panel-reading [data-chart-choice]').filter({hasText:'Unread'}).click();assert.equal(await page.locator('#editions-title').textContent(),'Unread');assert.match(await page.locator('#dashboard-selection').textContent(),/14 matching works/);
  const margin=page.locator('[data-margin-item]').filter({hasText:'Bo'}).first();await margin.waitFor();
  assert.equal(await margin.locator('[data-quote]').textContent(),'“a precise passage worth”');assert.match(await margin.locator('[data-count]').textContent(),/^1 comment ·/);
  assert.match(await page.locator('#panel-discussion [data-slot=card-description]').textContent(),/^\d+ comments? · 1 warning$/);
  await page.locator('#dashboard-reset').click();assert.equal(await page.locator('#editions-title').textContent(),'Latest additions');
  const contrast=await page.evaluate(themes=>{
    function rgb(name){const color=getComputedStyle(document.documentElement).getPropertyValue(name),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].slice(0,3);}
    function lum(c){return c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
    function ratio(a,b){const [lo,hi]=[lum(a),lum(b)].sort((a,b)=>a-b);return (hi+.05)/(lo+.05);}
    return themes.map(theme=>{document.documentElement.dataset.theme=theme;return {theme,minimum:Math.min(...['--ink','--muted','--faint','--accent'].flatMap(foreground=>['--surface','--bg'].map(background=>ratio(rgb(foreground),rgb(background))))),button:ratio(rgb('--accent'),rgb('--accent-ink'))};});
  },THEMES);
  console.log(JSON.stringify(contrast));
  for(const row of contrast){assert.ok(row.minimum>=4.5,JSON.stringify(row));assert.ok(row.button>=4.5,JSON.stringify(row));}
  // Run independent theme, picker and mobile cases in fresh browsers to bound resident memory.
  await browser.close();browser=await launch();page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/?theme=orchid-dark#admin/library');await page.locator('[data-statistics-grid]').waitFor();
  await page.keyboard.press('Space');await page.keyboard.press('e');await page.locator('#picker').waitFor();
  assert.equal(await page.locator('#picker-title').textContent(),'File Explorer');assert.equal(await page.evaluate(()=>document.activeElement.id),'file-results');
  await page.keyboard.press('j');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-article-row')),true);
  await page.keyboard.press('/');assert.equal(await page.evaluate(()=>document.activeElement.id),'file-query');
  await page.locator('#file-query').fill('quiet thought');assert.match(await page.locator('#file-results').textContent(),/A quiet thought/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#picker').isVisible(),false);
  await browser.close();browser=await launch();page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/?theme=harvest-dark#admin/library');await page.locator('#backstage-library [data-statistics-grid]').waitFor();await page.getByRole('switch',{name:'Dark mode',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'harvest');assert.equal(new URL(page.url()).searchParams.has('theme'),false);
  await page.getByRole('switch',{name:'Dark mode',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'harvest-dark');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'dashboard fits narrow screens');
  await page.screenshot({path:'.reader/web-dev/dashboard-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Dashboard acceptance passed: 12 live charts including zoomable shelves, real counts, chart selection/reset, browse-first picker, explicit filter and Escape, 22 theme contrasts, paired toggles, mobile.');console.log(JSON.stringify(contrast));
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
