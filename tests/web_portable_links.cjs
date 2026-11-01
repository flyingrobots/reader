/* Preserved originals and reading copies resolve local links, images and source anchors in the real reader. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {readFileSync,mkdirSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
  const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--portable-links'],{stdio:['ignore','pipe','inherit']});let browser;
  try{
    const {url,root,portable}=await new Promise((resolve,reject)=>{
      createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));
      fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));
    });
    browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
    const page=await browser.newPage({viewport:{width:1100,height:850},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const path of [portable.original,portable.copy]){
      await page.goto(url+'#read='+encodeURIComponent(path));
      const article=page.locator('#main .article');
      await article.getByRole('link',{name:'Repository',exact:true}).waitFor();
      assert.equal(await article.getByRole('link',{name:'Repository',exact:true}).getAttribute('href'),'https://github.com/example/portable-fixture');
      assert.equal(await article.getByRole('link',{name:'Tracked file',exact:true}).getAttribute('href'),`https://github.com/example/portable-fixture/blob/${portable.commit}/README.md`);
      assert.equal(await article.getByRole('link',{name:'Reference link',exact:true}).getAttribute('href'),'https://github.com/example/portable-fixture#readme');
      const missing=article.locator('.local-link-unavailable');
      assert.equal(await missing.textContent(),'Missing target');assert.match(await missing.getAttribute('title'),/unavailable/i);
      assert.equal(await article.locator('[href^="file:"],[src^="file:"]').count(),0);
      await page.waitForFunction(()=>{const image=document.querySelector('#main .article img[alt="Blue diagram"]');return image?.complete&&image.naturalWidth===40;});
      assert.match(await article.locator('img[alt="Blue diagram"]').getAttribute('src'),/#diagram$/);
      const raw=readFileSync(join(root,path),'utf8');
      const paragraph=article.locator('p').filter({hasText:'An anchor sentence stays unchanged.'});
      const anchor=await paragraph.evaluate(el=>({...el.dataset}));
      assert.equal(Number(anchor.sourceStart),[...raw.slice(0,raw.indexOf('An anchor sentence stays unchanged.'))].length);
      assert.match([...raw].slice(Number(anchor.sourceStart),Number(anchor.sourceEnd)).join(''),/An anchor sentence stays unchanged\./);
      assert.match(await article.locator('code').textContent(),/\[Literal\]\(file:\/\/\/literal\)/);
      await article.getByRole('link',{name:'Library source',exact:true}).click();
      await page.waitForURL(value=>decodeURIComponent(value.hash)==='#read=library/thought.md');
    }
    assert.equal(createHash('sha256').update(readFileSync(join(root,portable.original))).digest('hex'),portable.sha256);
    const stale=await page.request.get(url+'/api/portable-links?path='+encodeURIComponent(portable.original)+'&sha256='+'0'.repeat(64));
    assert.ok(stale.status()>=400,'a stale source hash must be refused');
    assert.deepEqual(errors,[]);
    mkdirSync('.reader/web-dev',{recursive:true});
    await page.goto(url+'#read='+encodeURIComponent(portable.original));
    await page.locator('#main .article img').waitFor();
    await page.screenshot({path:'.reader/web-dev/portable-links.png'});
    console.log('Portable links passed: original and reading copy, real Git remote, commit-pinned source, loaded copied image, local navigation, missing target, literal code, source preservation and stale-hash refusal.');
  }finally{
    await browser?.close();
    if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
