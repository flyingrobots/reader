/* An open Reader tab recovers its write token before starting one synthetic inbox job. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT || 'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'python3',['tests/web_fixture.py','--inbox'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
  const page=await browser.newPage({reducedMotion:'reduce'});
  await page.addInitScript(()=>{
   localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,art:false,shapes:false}));
   const original=globalThis.fetch;globalThis.inboxResponses=[];globalThis.writeResponses=[];globalThis.tokenRefreshes=0;
   globalThis.fetch=async(...args)=>{
    const response=await original(...args);
    if(args[0]==='/api/token')tokenRefreshes++;
    if(args[1]?.method==='POST'){writeResponses.push(response.status);if(args[0]==='/api/inbox')inboxResponses.push(response.status);}
    return response;
   };
  });
  // The tab retained the previous process's bootstrap token; the actual server has a new one.
  await page.route('**/api/library*',async route=>{
   const response=await route.fetch(),data=await response.json();
   await route.fulfill({response,json:{...data,token:'previous-server-token'}});
  });
  await page.goto(url+'#admin/inbox');await page.locator('#inbox-mail').waitFor();await page.locator('#inbox-mail').click();
  await page.waitForFunction(()=>inboxResponses.includes(200)||[...document.querySelectorAll('[data-sonner-toast]')].some(el=>el.textContent.includes('same-origin Reader token')));
  assert.equal(await page.locator('[data-sonner-toast]').filter({hasText:'A same-origin Reader token'}).count(),0,'a stale tab must refresh its token and start the inbox without a page reload');
  // A background write may refresh first; the user action must still start only one job.
  assert.deepEqual(await page.evaluate(()=>inboxResponses.filter(status=>status===200)),[200],'only one inbox start is accepted');
  assert.equal(await page.evaluate(()=>writeResponses.includes(403)),true,'the tab really encountered a rejected stale-token preflight');
  assert.equal(await page.evaluate(()=>tokenRefreshes),1,'concurrent writes share the refresh');
  console.log('Inbox token recovery: stale tab, rejected token preflight recovered, one accepted fake inbox start.');
 }finally{
  await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
