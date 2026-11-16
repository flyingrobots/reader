/* Medium browser regression. Oracle: #149 restores a refused magazine commission without a reload. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {pinDate}=require('./web_clock.cjs');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});});
after(()=>browser?.close());

async function magazine(t,extra=[]){
  const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--magazine','--art','--art-none',...extra],{stdio:['ignore','pipe','inherit']});
  t.after(async()=>{if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}});
  const {url,now}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  t.after(()=>context.close());
  await pinDate(context,now);
  await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'user-reader-test',artAuto:'off'})));
  const page=await context.newPage();page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  t.after(()=>assert.deepEqual(errors,[],'art retry has no uncaught page errors'));
  await page.goto(url);
  const button=page.locator('.issue-cover [data-art-generate]');await button.waitFor();
  return {page,button};
}

for(const status of [400,409,429]){
  test(`a ${status} refusal restores the magazine button for one successful retry`,async t=>{
    const {page,button}=await magazine(t);
    let posts=0,queuedId=null;
    // Keep the real queued job pending in the UI until its pending-state assertion, without timing the fake voice.
    await page.route('**/api/art/jobs',async route=>{
      const response=await route.fetch(),data=await response.json();
      data.jobs=data.jobs.map(job=>job.id===queuedId?{...job,state:'queued'}:job);
      await route.fulfill({response,json:data});
    });
    await page.route('**/api/art',async route=>{
      posts++;
      if(posts===1)return route.fulfill({status,json:{error:`Synthetic refusal ${status}`}});
      const response=await route.fetch(),data=await response.json();queuedId=data.job.id;
      await route.fulfill({response,json:data});
    });
    const original=await button.elementHandle();
    await button.click();
    await page.locator('[data-sonner-toast]').filter({hasText:`Synthetic refusal ${status}`}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.issue-cover [data-art-generate]')?.disabled===false);
    assert.deepEqual(await button.evaluate((element,first)=>({same:element===first,label:element.textContent} ),original),
      {same:true,label:'Make cover art'},'the same button recovers its label without replacing the issue');
    await button.click();
    await page.locator('[data-sonner-toast]').filter({hasText:'Making art for'}).waitFor();
    assert.deepEqual({posts,disabled:await button.isDisabled(),label:await button.textContent()},
      {posts:2,disabled:true,label:'Making art…'},'one successful retry stays pending');
    await page.unroute('**/api/art/jobs');
    await page.waitForFunction(async id=>(await(await fetch('/api/art/jobs')).json()).jobs.some(job=>job.id===id&&job.state==='done'),queuedId,{timeout:15000});
  });
}

test('an actual art-owner refusal restores the magazine button',async t=>{
  const {page,button}=await magazine(t,['--art-owned']);
  const refused=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/art'&&response.request().method()==='POST');
  await button.click();
  assert.equal((await refused).status(),409);
  await page.locator('[data-sonner-toast]').filter({hasText:'Another Reader server owns art for this vault'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.issue-cover [data-art-generate]')?.disabled===false);
  assert.equal(await button.textContent(),'Make cover art');
});
