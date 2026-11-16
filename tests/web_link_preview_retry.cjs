/* Medium browser regressions. Oracle: #136 permits a retry after transient failures and retains real 404/success entries. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');

let fixture,browser,url;
before(async()=>{
  fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--links'],{stdio:['ignore','pipe','inherit']});
  ({url}=await new Promise((resolve,reject)=>{
    createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));
    fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));
  }));
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
});
after(async()=>{
  await browser?.close();
  if(fixture&&fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}
});

async function open(t){
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  t.after(()=>context.close());
  await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'user-reader-test',nextReads:false})));
  const page=await context.newPage();
  page.setDefaultTimeout(5000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  t.after(()=>assert.deepEqual(errors,[],'preview recovery has no uncaught page errors'));
  await page.goto(url+'#read=library%2Flinked%2Fsource.md');
  await page.locator('#article a').first().waitFor();
  await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  return page;
}

for(const phase of ['resolve','preview']){
  for(const fault of ['429','network']){
    test(`${phase} ${fault} failure retries on the next K without reloading`,async t=>{
      const page=await open(t);
      let requests=0;
      await page.route(`**/api/${phase}?*`,route=>{
        requests++;
        if(requests>1)return route.continue();
        return fault==='429'?route.fulfill({status:429,json:{error:'Reader is busy.'}}):route.abort('connectionfailed');
      });
      const link=page.locator('#article a',{hasText:'a quiet thought'});
      await link.focus();
      await page.locator('#link-preview [data-link-preview-excerpt]').filter({hasText:fault==='429'?'Reader is busy.':'Reader isn’t reachable.'}).waitFor();
      await page.keyboard.press('K');
      await page.locator('#link-preview [data-link-preview-title]').filter({hasText:'A quiet thought'}).waitFor({timeout:3000});
      assert.equal(requests,2,`${phase} ${fault}: the second K makes one fresh request`);
    });
  }
  test(`${phase} genuine 404 remains cached on the next focus`,async t=>{
    const page=await open(t);
    let requests=0;
    await page.route(`**/api/${phase}?*`,route=>{
      requests++;
      return route.fulfill({status:404,json:{error:'No such library document.'}});
    });
    const link=page.locator('#article a',{hasText:'a quiet thought'});
    await link.focus();
    await page.locator('#link-preview [data-link-preview-excerpt]').filter({hasText:'No such library document.'}).waitFor();
    await page.locator('#main').focus();
    await page.locator('#link-preview').waitFor({state:'hidden'});
    await link.focus();
    await page.locator('#link-preview [data-link-preview-excerpt]').filter({hasText:'No such library document.'}).waitFor();
    assert.equal(requests,1,`${phase}: a genuine 404 does not make another request`);
  });
}

test('a successful document preview remains cached on the next focus',async t=>{
  const page=await open(t);
  let requests=0;
  await page.route('**/api/preview?*',route=>{requests++;return route.continue();});
  const link=page.locator('#article a',{hasText:'a quiet thought'});
  await link.focus();
  await page.locator('#link-preview [data-link-preview-title]').filter({hasText:'A quiet thought'}).waitFor();
  await page.locator('#main').focus();
  await page.locator('#link-preview').waitFor({state:'hidden'});
  await link.focus();
  await page.locator('#link-preview [data-link-preview-title]').filter({hasText:'A quiet thought'}).waitFor();
  assert.equal(requests,1,'a successful preview is reused without another preview request');
});

test('a late failure preserves the replacement preview and its cached result',async t=>{
  // Exercise installLinks' public API port with a controlled settlement order. No clock or private-cache access.
  const context=await browser.newContext();
  t.after(()=>context.close());
  const page=await context.newPage();
  page.setDefaultTimeout(5000);
  await page.route('**/preview-probe',route=>route.fulfill({contentType:'text/html',body:'<article id="article"><a id="target" href="thought.md">Target</a></article><button id="outside">Outside</button><output id="result"></output>'}));
  await page.goto(url+'/preview-probe');
  await page.evaluate(async()=>{
    const {installLinks}=await import('/assets/links.mjs');
    const first=Promise.withResolvers();
    const probe={first,calls:0,rendered:[]};
    globalThis.previewProbe=probe;
    installLinks({state:{doc:{path:'library/source.md'},prefs:{participant:'preview-test'}},reading:{isTurning:()=>false},
      api:async path=>{
        if(path.startsWith('/api/resolve'))return {path:'library/thought.md'};
        probe.calls++;
        return probe.calls===1?first.promise:{title:'Newer document'};
      },
      renderPreview:preview=>{
        const text=preview?.data.title||preview?.data.message||'';
        document.querySelector('#result').textContent=text;
        if(text)probe.rendered.push(text);
      }});
  });
  await page.locator('#target').focus();
  await page.waitForFunction(()=>previewProbe.calls===1);
  // The public contract bounds the cache at 200 links. External previews fill it without network requests.
  await page.evaluate(()=>{
    for(let i=0;i<200;i++){
      const link=document.createElement('a');link.href=`https://example.invalid/cache-${i}`;link.textContent='External';
      document.querySelector('#article').append(link);link.focus({preventScroll:true});
    }
    document.querySelector('#target').focus({preventScroll:true});
  });
  await page.waitForFunction(()=>document.querySelector('#result').textContent==='Newer document');
  await page.evaluate(()=>previewProbe.first.reject(Object.assign(new Error('Old request refused'),{status:429})));
  await page.locator('#outside').focus();
  await page.locator('#target').focus();
  await page.waitForFunction(()=>document.querySelector('#result').textContent==='Newer document');
  assert.deepEqual(await page.evaluate(()=>({requests:previewProbe.calls,staleShown:previewProbe.rendered.includes('Old request refused')})),
    {requests:2,staleShown:false},'an evicted request owns neither the replacement cache entry nor the current display');
});
