/* Companion navigation, relative resources, downloads and the HTML isolation boundary. */
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {createInterface} = require('node:readline');
const {mkdirSync, writeFileSync, readFileSync} = require('node:fs');
const {chromium} = require(process.env.READER_PLAYWRIGHT || 'playwright-core');

(async () => {
  const fixture = spawn(process.env.READER_PYTHON || '.venv/bin/python', ['tests/web_fixture.py'], {stdio:['ignore','pipe','inherit']});
  let browser;
  try {
    const {url, root} = await new Promise((resolve, reject) => {
      createInterface({input:fixture.stdout}).once('line', line => resolve(JSON.parse(line)));
      fixture.once('exit', code => reject(new Error('Fixture exited ' + code)));
    });
    const html = `<!doctype html><link rel="stylesheet" href="theme.css">
      <button id="run">Run analysis</button><output id="result">Waiting</output>
      <img id="figure" src="../assets/figure.svg"><a id="next" href="next.html">Next</a>
      <script>
        window.inlineRan = true;
        try { parent.document.body.dataset.companionEscaped = 'true'; } catch { window.parentBlocked = true; }
        try { localStorage.setItem('companion-escaped', 'true'); } catch { window.storageBlocked = true; }
        fetch('/api/library').then(() => window.apiRead = true).catch(() => window.apiBlocked = true);
      </script><script src="app.js"></script>`;
    for (const base of ['library/package', 'inbox/package']) {
      mkdirSync(root + '/' + base + '/implementation', {recursive:true});
      mkdirSync(root + '/' + base + '/assets', {recursive:true});
      writeFileSync(root + '/' + base + '/article.md', '# Companion package\n\n[Interactive map](implementation/index.html#run)\n\n[Builder](implementation/build.py)\n\n[Snapshot](implementation/snapshot.json)\n\n[Archive](assets/data.zip)\n');
      writeFileSync(root + '/' + base + '/implementation/index.html', html);
      writeFileSync(root + '/' + base + '/implementation/next.html', '<p id="next-page">A sibling page</p>');
      writeFileSync(root + '/' + base + '/implementation/theme.css', '#result { color: rgb(1, 99, 7); }');
      writeFileSync(root + '/' + base + '/implementation/app.js', 'document.querySelector("#run").onclick=()=>document.querySelector("#result").textContent="Three tasks";');
      writeFileSync(root + '/' + base + '/implementation/build.py', 'print("Build the graph")\n');
      writeFileSync(root + '/' + base + '/implementation/snapshot.json', '{"tasks":3}\n');
      writeFileSync(root + '/' + base + '/assets/figure.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>');
      writeFileSync(root + '/' + base + '/assets/data.zip', Buffer.from([80,75,3,4,0,255,128]));
    }
    browser = await chromium.launch({headless:true, executablePath:process.env.READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
    const context = await browser.newContext({viewport:{width:1300,height:900}});
    await context.addInitScript(() => { try { localStorage.setItem('reader.preferences.v1', JSON.stringify({smooth:false,layout:'scroll',theme:'user-reader-test'})); } catch {} });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    if(process.env.READER_DEBUG) page.on('console', message => console.log(message.type(), message.text()));
    page.on('request', request => requests.push(request.url()));
    const open = path => page.goto(url + '#read=' + encodeURIComponent(path));
    for (const base of ['library/package', 'inbox/package']) {
      await open(base + '/article.md');
      await page.locator('#article a[href="implementation/index.html#run"]').click();
      const iframe = page.locator('iframe.document-attachment');
      await iframe.waitFor();
      assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts');
      assert.match(await iframe.getAttribute('src'), /index\.html#run$/);
      const frame = page.frameLocator('iframe.document-attachment');
      await frame.locator('#run').click();
      await frame.locator('#result').filter({hasText:'Three tasks'}).waitFor();
      assert.equal(await frame.locator('#result').evaluate(el => getComputedStyle(el).color), 'rgb(1, 99, 7)');
      await frame.locator('#figure').evaluate(img => img.decode());
      const state = await frame.locator('body').evaluate(() => ({inline:window.inlineRan,parent:window.parentBlocked,storage:window.storageBlocked,api:window.apiBlocked}));
      assert.deepEqual(state, {inline:true,parent:true,storage:true,api:true});
      assert.equal(await page.evaluate(() => document.body.dataset.companionEscaped), undefined);
      await page.setViewportSize({width:390,height:844});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await iframe.evaluate(el => el.getBoundingClientRect().width <= innerWidth));
      await page.setViewportSize({width:1300,height:900});
      const download = await Promise.all([page.waitForEvent('download'), page.getByRole('link', {name:'Download original HTML'}).click()]);
      assert.equal(readFileSync(await download[0].path(), 'utf8'), html);
      await frame.locator('#next').click();
      await frame.locator('#next-page').waitFor();
      for (const [target, text] of [['implementation/build.py','Build the graph'],['implementation/snapshot.json','"tasks":3']]) {
        await open(base + '/article.md');
        await page.locator(`#article a[href="${target}"]`).click();
        await page.locator('#article pre').filter({hasText:text}).waitFor();
      }
      await open(base + '/article.md');
      await page.locator('#article a[href="assets/data.zip"]').click();
      const binary = await Promise.all([page.waitForEvent('download'), page.getByRole('link', {name:'Download attachment'}).click()]);
      assert.deepEqual(readFileSync(await binary[0].path()), Buffer.from([80,75,3,4,0,255,128]));
    }
    // The response CSP also isolates HTML opened directly, without the iframe's sandbox attribute.
    await page.goto(url + '/api/attachment/library/package/implementation/index.html');
    await page.locator('#run').click();
    await page.locator('#result').filter({hasText:'Three tasks'}).waitFor();
    assert.equal(await page.evaluate(() => window.storageBlocked), true);
    assert.ok(requests.every(path => path.startsWith(url)), 'no external resources');
    assert.deepEqual(errors, []);
    console.log('web_attachments: ok');
  } finally {
    await browser?.close();
    fixture.kill('SIGTERM');
    await new Promise(resolve => { if(fixture.exitCode !== null) resolve(); else fixture.once('exit', resolve); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
