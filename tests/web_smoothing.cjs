/* GSAP must retain its normal glide; stalled-position recovery must not snap ordinary scrolls. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',s=>resolve(JSON.parse(s)));fixture.once('exit',c=>reject(Error('Fixture exited '+c)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking','--disk-cache-size=10485760','--media-cache-size=1048576']});
  for(const route of ['', '#read=library%2Fthought.md']){
   const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
   await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:true,layout:'scroll',art:false,artHero:false,shapes:false,nextReads:false,backlinks:false})));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url+'/'+route);await page.locator(route?'#article':'#home-title').waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(()=>{const spacer=document.createElement('div');spacer.style.height='6000px';spacer.setAttribute('aria-hidden','true');document.querySelector('#main').append(spacer);ScrollTrigger.refresh();scrollTo(0,0);});
   await page.waitForTimeout(1200);
   const result=await page.evaluate(async()=>{
    const smoother=ScrollSmoother.get();if(!smoother)return {active:false};
    const original=smoother.scrollTop,calls=[],frames=[],started=performance.now();
    smoother.scrollTop=function(value){if(arguments.length)calls.push({ms:performance.now()-started,value});return original.apply(this,arguments);};
    window.scrollTo(0,1000);
    await new Promise(resolve=>{function sample(now){frames.push({ms:now-started,shown:-gsap.getProperty('#smooth-content','y')});if(now-started<1100)requestAnimationFrame(sample);else resolve();}requestAnimationFrame(sample);});
    smoother.scrollTop=original;
    return {active:true,calls,frames,native:scrollY};
   });
   assert.equal(result.active,true,'GSAP is active with smooth enabled and no reduced-motion preference');
   assert.deepEqual(result.calls,[],`${route||'homepage'}: ordinary scrolling must not invoke the immediate recovery setter`);
   assert.ok(result.frames.some(frame=>frame.shown>50&&frame.shown<950),'the page renders an intermediate position rather than jumping');
   assert.ok(Math.abs(result.frames.at(-1).shown-result.native)<1,'the glide reaches the native scroll position');
   assert.deepEqual(errors,[]);console.log('Smooth scrolling passed:',route||'homepage');await context.close();
  }
 }finally{await browser?.close();fixture.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
