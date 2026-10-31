/* Reader page review (outside Admin): each named page on desktop, tablet and phone profiles, in a light (Paper) and a dark
   (Ink) theme, against the synthetic fixture. Saves one full-page screenshot per page, profile and theme under
   READER_SHOTS/page-review/, and fails on page errors, console errors or horizontal page overflow.
   Usage: node tests/web_page_review.cjs [page …]   (default: every page below). Admin has tests/web_admin_review.cjs. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium,devices}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const shots=(process.env.READER_SHOTS||'.reader/web-dev')+'/page-review';
/** Page name → route, a selector present once the page has rendered, and keys that open a panel on it (optional). */
const PAGES={home:['#','#home-title'],search:['#search','#search-query'],results:['#search='+encodeURIComponent('q=observation'),'[data-work]'],article:['#read=library%2Fthought.md','#article'],
  queue:['#read=library%2Fthought.md','#article',['Space','r'],'#queue-panel:not([hidden]) [data-queue-row]'],
  picker:['#','#home-title',['Space','e'],'#picker[data-open]'],help:['#','#home-title',['Shift+Slash'],'#help'],
  issue:['#issue=2026-W43','.issue-cover']};
const SECTIONS=process.argv.slice(2).length?process.argv.slice(2):Object.keys(PAGES);
const PROFILES={desktop:{viewport:{width:1440,height:900}},tablet:devices['iPad Mini'],phone:devices['iPhone 13']};
// The frozen test theme pair (tests/test_theme_fixture.py), so screenshots do not change when product themes do.
const THEMES=['user-reader-test','user-reader-test-dark'];
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--maintenance','--inbox','--dashboard','--search-page','--queue','--magazine'],{stdio:['ignore','pipe','inherit']});let browser;
 const failures=[];
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync(shots,{recursive:true});
  for(const [profile,options] of Object.entries(PROFILES))for(const theme of THEMES){
   const context=await browser.newContext({...options,reducedMotion:'reduce'});
   await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme,nextReads:false,backlinks:false}));
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/status of 50[03]/.test(m.text()))errors.push(m.text());});
   for(const section of SECTIONS){
    const name=`${section}-${profile}-${theme}`;errors.length=0;
    try{
     const [route,ready,keys,opened]=PAGES[section];await page.goto(url+'/'+route);await page.locator(ready).first().waitFor({timeout:8000});
     if(keys){await page.locator('#main').focus();for(const key of keys)await page.keyboard.press(key);await page.locator(opened).first().waitFor({timeout:8000});}
     await page.waitForTimeout(900);   // Status polls answer and loading states settle.
     const overflow=await page.evaluate(()=>{const doc=document.documentElement,wide=[...document.querySelectorAll('#main *')].filter(el=>el.getBoundingClientRect().right>doc.clientWidth+1).map(el=>el.id||el.getAttribute('data-slot')||el.className.toString().slice(0,60)).slice(0,5);return {scroll:doc.scrollWidth-doc.clientWidth,wide};});
     await page.screenshot({path:`${shots}/${name}.png`,fullPage:true});
     assert.ok(overflow.scroll<=1,`horizontal page overflow ${overflow.scroll}px: ${overflow.wide.join(', ')}`);
     assert.deepEqual(errors,[]);
     console.log('ok   '+name);
    }catch(error){failures.push(name);console.log('FAIL '+name+': '+String(error?.message||error).split('\n')[0].slice(0,300));}
   }
   await context.close();
  }
  console.log(`Screenshots: ${shots}`);
 }finally{await browser?.close();fixture.kill();}
 if(failures.length){console.log(failures.length+' failed');process.exit(1);}
})().catch(error=>{console.error(error);process.exit(1);});
