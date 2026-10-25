/* The magazine homepage: masthead, cover, features, contents, keys, issues, themes and phone width. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const THEMES=['ink','paper','orchid','orchid-dark','harvest','harvest-dark',...require('../src/reader_mcp/web_ui/famous-themes.json').themes.flatMap(t=>[t.id,t.id+'-dark'])];
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper'}));}catch{}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  await page.goto(url);await page.locator('#home-title').waitFor();await page.locator('.issue-cover').waitFor();
  // Masthead, one cover, up to five features, contents; excluded types and newsletter papers stay out.
  const week=await page.locator('#issue').getAttribute('data-week');assert.match(week,/^\d{4}-W\d{2}$/);
  assert.match(await page.locator('.issue-dateline').textContent(),/Issue \d+/);
  assert.equal(await page.locator('.issue-cover').count(),1);
  assert.equal(await page.locator('.cover-title').textContent(),'The distance between the map and the coast','unread essay and newsletter pick');
  const features=await page.locator('.feature-title').allTextContents();assert.ok(features.length>=3&&features.length<=5,features.join());
  const kickers=await page.locator('.issue-feature .issue-kicker').allTextContents();assert.equal(new Set(kickers.map(k=>k.split('·')[0].trim())).size,kickers.length,'one project per feature');
  assert.ok(!kickers.some(k=>/^ECHO/i.test(k)),'no feature repeats the cover’s project');
  const text=await page.locator('#issue').textContent();
  assert.ok(!text.includes('Task ticket that never appears'),'excluded type');assert.ok(text.includes('An essay already read'),'read pieces stay in the contents');
  assert.equal(await page.locator('.issue-letter-title').textContent(),'The Weekly: a synthetic issue');
  await page.waitForFunction(()=>document.querySelector('.cover-standfirst')?.dataset.source==='opening');
  const standfirst=await page.locator('.cover-standfirst').textContent();assert.match(standfirst,/^The distance between the map and the coast — The opening paragraph/);assert.ok(!/quotation|mermaid/.test(standfirst));
  assert.equal(await page.locator('.contents-group li[data-read]').count(),1);
  await page.screenshot({path:'.reader/web-dev/magazine.png',fullPage:true});
  // Keyboard: j/k between pieces, g c to the cover, Enter opens.
  await page.locator('#main').focus();await page.keyboard.press('j');
  assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-cover')),true);
  await page.keyboard.press('j');assert.equal(await page.evaluate(()=>document.activeElement.closest('.issue-feature')!==null),true);
  await page.keyboard.press('j');await page.keyboard.press('k');assert.equal(await page.evaluate(()=>document.activeElement.textContent),features[0]);
  await page.keyboard.press('g');await page.keyboard.press('c');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-cover')),true);
  // Reading queue (RW-30): q on a focused piece and + Queue on a feature add it; Space q stays unbound (RW-12).
  const toast=text=>page.locator('[data-sonner-toast]').filter({hasText:text});
  const coverPath=await page.evaluate(()=>document.activeElement.dataset.path);
  await page.keyboard.press('q');await toast('Added to your queue').first().waitFor();
  const featurePath=await page.locator('.issue-feature').first().locator('[data-piece]').getAttribute('data-path');
  await page.locator('.issue-feature').first().locator('[data-queue-add]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-sonner-toast]').length>=2);
  const queued=await page.evaluate(async()=>(await (await fetch('/api/queue?participant=Browser%20tester')).json()).queued.map(r=>r.path));
  assert.deepEqual(queued,[coverPath,featurePath],'q and + Queue add the cover and a feature, in order');
  assert.ok(await page.locator('.issue-cover [data-queue-add]').evaluate(el=>el.checkVisibility()));
  await page.locator('[data-cover]').focus();
  const toasts=await page.locator('[data-sonner-toast]').count();
  await page.keyboard.press(' ');await page.keyboard.press('q');await page.waitForTimeout(300);
  assert.equal(await page.locator('#queue-panel').isHidden(),true,'Space q opens nothing');
  assert.equal(await page.locator('[data-sonner-toast]').count(),toasts,'Space q is reserved and does nothing');
  assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-cover')),true);
  await page.keyboard.press('j');await page.keyboard.press('Enter');await page.getByRole('heading',{name:features[0]}).waitFor();
  assert.match(decodeURIComponent(new URL(page.url()).hash),/^#read=library\/issue\//);
  // Issues: [ and ] change the issue and the URL.
  await page.goBack();await page.locator('.issue-cover').waitFor();await page.locator('#main').focus();
  await page.keyboard.press('[');await page.waitForFunction(w=>document.querySelector('#issue')?.dataset.week!==w,week);
  const previous=await page.locator('#issue').getAttribute('data-week');assert.equal(decodeURIComponent(new URL(page.url()).hash),'#issue='+previous);
  assert.equal(await page.locator('.cover-title').textContent(),'Last week’s lead essay');
  await page.reload();await page.locator('.issue-cover').waitFor();assert.equal(await page.locator('#issue').getAttribute('data-week'),previous,'past issues are addressable');
  await page.locator('#main').focus();await page.keyboard.press(']');await page.waitForFunction(w=>document.querySelector('#issue')?.dataset.week===w,week);assert.equal(new URL(page.url()).hash,'');
  await page.locator('.issue-archive summary').click();assert.ok(await page.locator('.issue-archive li').count()>=2);await page.keyboard.press('Escape');
  // The dashboard moved to Behind the scenes.
  await page.locator('#issue-backstage').click();await page.locator('#backstage-library .statistics-grid').waitFor();
  assert.equal(await page.locator('#backstage-library .stat-panel').count(),12);assert.equal(await page.locator('#backstage h1').count(),1,'one page heading');
  await page.goto(url);await page.locator('.issue-cover').waitFor();
  // Every theme: the issue's own text against the page.
  await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
  const contrast=await page.evaluate(themes=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d',{willReadFrequently:true});
    function rgb(color){c.clearRect(0,0,1,1);c.fillStyle='#000';c.fillStyle=color;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].slice(0,3);}
    function lum(v){return v.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);}
    function ratio(a,b){const [lo,hi]=[lum(a),lum(b)].sort((x,y)=>x-y);return (hi+.05)/(lo+.05);}
    const selectors=['.issue-flag','.issue-dateline','.cover-title a','.cover-standfirst','.issue-kicker','.issue-byline','.feature-title a','.feature-standfirst','.contents-title','.contents-group li[data-read] .contents-title','.contents-meta','.issue-summary dt','.issue-footer','.issue-index button'];
    return themes.map(theme=>{document.documentElement.dataset.theme=theme;const bg=rgb(getComputedStyle(document.body).backgroundColor==='rgba(0, 0, 0, 0)'?getComputedStyle(document.documentElement).backgroundColor:getComputedStyle(document.body).backgroundColor);
      const rows=selectors.map(s=>[s,ratio(rgb(getComputedStyle(document.querySelector(s)).color),bg)]);const worst=rows.sort((a,b)=>a[1]-b[1])[0];return {theme,worst:worst[0],minimum:Math.round(worst[1]*100)/100};});
  },THEMES);
  console.log(JSON.stringify(contrast));
  for(const row of contrast)assert.ok(row.minimum>=4.5,JSON.stringify(row));
  // Wide windows: the rail's sections index jumps without changing the route.
  const hash=new URL(page.url()).hash;await page.locator('.issue-index [data-jump="contents-1"]').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'contents-1');assert.equal(new URL(page.url()).hash,hash,'a section jump is not a route');
  // The lead feature beside the cover starts at the top of the row, and + Queue (feature and cover) keeps the text's left edge.
  for(const width of [1440,1920]){
    await page.setViewportSize({width,height:width===1440?900:1080});await page.waitForTimeout(250);
    const lead=await page.evaluate(()=>{const feature=document.querySelector('.issue-feature'),cover=document.querySelector('.issue-cover');
      const action=feature.querySelector('.issue-queue'),standfirst=feature.querySelector('.feature-standfirst');if(standfirst)standfirst.hidden=true;
      // The ghost button's text, not its padded box, lines up with the column (the cover's + Queue too).
      const textLeft=el=>{const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect().left;};
      const f=feature.getBoundingClientRect(),a=action.getBoundingClientRect(),number=feature.querySelector('.feature-number').getBoundingClientRect(),kicker=cover.querySelector('.issue-kicker, .cover-title').getBoundingClientRect();
      const result={gap:Math.round(number.top-kicker.top),actionLeft:Math.round(textLeft(action)-f.left),coverLeft:Math.round(textLeft(cover.querySelector('.issue-queue'))-cover.getBoundingClientRect().left),actionNarrow:a.width<f.width/2};if(standfirst)standfirst.hidden=false;return result;});
    assert.ok(Math.abs(lead.gap)<=4,`lead feature aligns to the top of the cover row at ${width}: ${JSON.stringify(lead)}`);
    assert.deepEqual({left:Math.abs(lead.actionLeft)<=1,cover:Math.abs(lead.coverLeft)<=1,narrow:lead.actionNarrow},{left:true,cover:true,narrow:true},`an action in the lead feature is left-aligned at ${width}: ${JSON.stringify(lead)}`);
  }
  // 1920 and 2560: the issue uses the window, no horizontal scroll, extra width becomes columns, prose keeps its measure.
  const wide=[];
  for(const width of [1920,2560]){
    await page.setViewportSize({width,height:1200});await page.waitForTimeout(250);
    const m=await page.evaluate(()=>{
      const rect=s=>document.querySelector(s).getBoundingClientRect(),cover=rect('.issue-cover'),rail=rect('.issue-summary'),masthead=rect('.issue-masthead'),contents=rect('.contents-columns');
      const ch=el=>{const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;width:1ch';el.append(probe);const w=probe.getBoundingClientRect().width;probe.remove();return w;};
      const sf=document.querySelector('.cover-standfirst'),fs=document.querySelector('.issue-feature:not(:first-child) .feature-standfirst'),cs=getComputedStyle(document.querySelector('.contents-columns'));
      const gap=parseFloat(cs.columnGap),columns=Math.floor((contents.width+gap)/(parseFloat(cs.columnWidth)+gap));
      return {scroll:document.documentElement.scrollWidth-innerWidth,left:Math.min(cover.left,masthead.left),right:Math.max(rail.right,masthead.right),viewport:innerWidth,railBeside:rail.left>cover.right,
        cover:sf.getBoundingClientRect().width/ch(sf),feature:fs.getBoundingClientRect().width/ch(fs),columns,leadBeside:rect('.issue-feature').top<cover.bottom&&rect('.issue-feature').left>cover.right};});
    wide.push({width,...m});
    assert.ok(m.scroll<=1,'no horizontal scroll at '+width);
    assert.ok((m.right-m.left)/m.viewport>=.85,`content spans ≥ 85% at ${width}: ${JSON.stringify(m)}`);
    assert.ok(m.left>=32&&m.viewport-m.right>=32,'outer margins at '+width);
    assert.ok(m.railBeside&&m.leadBeside,'rail and lead feature beside the cover at '+width);
    assert.ok(m.cover<=75&&m.feature<=75,`prose measure ≤ 75ch at ${width}: ${JSON.stringify(m)}`);
    assert.ok(m.columns>=(width>=2560?5:4),`contents columns at ${width}: ${m.columns}`);
    await page.screenshot({path:`.reader/web-dev/magazine-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&!document.querySelector('.issue-index').checkVisibility()),'1280: no scroll, the index rail is a wide-window feature');
  console.log(JSON.stringify(wide));
  // Phone width: one column, no horizontal scroll.
  await page.evaluate(()=>{document.documentElement.dataset.theme='harvest-dark';});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  const box=await page.locator('.issue-cover').boundingBox();assert.ok(box.x>=15&&box.x+box.width<=390-15,'16px gutters');
  await page.screenshot({path:'.reader/web-dev/magazine-mobile.png',fullPage:true});
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log(`Magazine passed: masthead, cover, ${features.length} features from distinct projects, standfirst, contents with read dimmed, j/k/g c/Enter, q and + Queue (Space q unbound), [ ] issues and URLs, dashboard on Behind the scenes, ${THEMES.length} theme contrasts, 1920/2560 full-width spread with rail, bounded measures and ${wide.map(w=>w.columns).join('/')} contents columns, phone width, local-only requests.`);
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
