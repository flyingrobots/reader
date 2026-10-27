/* Inbox on Reader Admin's Inbox page: arrivals, previews, You got mail, Stop, held claims. A fake Codex only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,writeFileSync,rmSync,existsSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--inbox'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[],writes=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(value=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'paper'}));
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());if(r.method()==='POST')writes.push(new URL(r.url()).pathname+' '+(r.postData()||''));});
  const toast=text=>page.locator('[data-sonner-toast]').filter({hasText:text});
  // The list, titles from receipts, and the footer count.
  await page.goto(url+'#admin/inbox');await page.locator('#inbox .inbox-arrival').first().waitFor();
  assert.equal(await page.locator('#settings-open span').textContent(),'Backstage · 3');
  assert.deepEqual(await page.locator('.inbox-arrival-title').allTextContents(),['Synthetic spec ninety','Synthetic spec ninety-one','A loose dropped note']);
  assert.equal(await page.locator('#admin-title').textContent(),'Inbox','the inbox is its own page');
  assert.match(await page.locator('[data-arrival="11111111-1111-4111-8111-111111111111"]').textContent(),/Claude · Reader · 2026-10-24 via Synthetic courier/);
  assert.equal(await page.locator('[data-arrival="11111111-1111-4111-8111-111111111111"] [data-integrity]').getAttribute('data-integrity'),'intact');
  assert.equal(await page.locator('[data-arrival="loose-note.md"] [data-integrity]').textContent(),'No receipt');
  assert.match(await page.locator('#inbox-mail-note').textContent(),/Ask the librarian to file 3 arrivals/);
  await page.screenshot({path:'.reader/web-dev/inbox.png',fullPage:true});
  // A preview is plain reading: nothing written for the librarian.
  const before=writes.length;
  await page.locator('[data-arrival="22222222-2222-4222-8222-222222222222"]').click();
  await page.getByRole('heading',{name:'RW-91'}).waitFor();
  assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read=inbox/22222222-2222-4222-8222-222222222222/RW-91.md');
  assert.match(await page.locator('.document-kicker').textContent(),/Inbox preview/);
  assert.match(await page.locator('#status-location [aria-current=page]').textContent(),/Inbox · RW-91\.md/);
  await page.mouse.wheel(0,400);await page.waitForTimeout(700);
  await page.goBack();await page.locator('#inbox .inbox-arrival').first().waitFor();
  assert.deepEqual(writes.slice(before),[],'no receipts, bookmarks or discussion for an inbox preview');
  assert.equal(existsSync(join(root,'engagement')),false);
  // You got mail: loading toast, a live activity transcript from scripted Codex events, success toast, report.
  writeFileSync(join(root,'.fake-pause'),'');
  await page.locator('#inbox-mail').click();
  await toast('The librarian is reading the mail…').waitFor();assert.equal(await toast('reading the mail').getAttribute('data-type'),'loading');
  await page.locator('#inbox[data-run-state=running]').waitFor();assert.ok(await page.locator('#inbox-mail').isDisabled());
  const log=page.locator('#inbox .activity-log'),item=id=>log.locator(`[data-item-id="${id}"]`);
  await item('item_8').waitFor({timeout:10000});
  await page.screenshot({path:'.reader/web-dev/inbox-timer-and-colors.png'});
  const elapsedLabels=(await page.locator('#inbox .inbox-run').innerText()).match(/\b(?:Running for|Elapsed)\b/g)||[];
  assert.equal(elapsedLabels.length,1,'a running inbox has one elapsed-time counter, not one in each nested panel');
  const statusColors=await page.evaluate(()=>{
    const color=selector=>getComputedStyle(document.querySelector('#inbox '+selector)).color;
    return [color('.activity-meta [data-status=running]'),color('.activity-meta [data-filed] [data-slot=trace-icon]'),color('.activity-log [data-status=error]')];
  });
  assert.equal(new Set(statusColors).size,3,'running, filed and failed work have distinct colors as well as labels and icons');
  await page.evaluate(()=>{document.documentElement.dataset.theme='ink';});await page.waitForTimeout(450);
  await page.screenshot({path:'.reader/web-dev/inbox-running-ink.png'});
  await page.evaluate(()=>{document.documentElement.dataset.theme='paper';});await page.waitForTimeout(450);
  assert.equal(await log.getAttribute('role'),'log');assert.equal(await log.getAttribute('aria-live'),'polite');
  assert.equal(await page.locator('#inbox .activity').getAttribute('data-reader-decoration'),'');
  assert.match(await item('item_0').textContent(),/I’ll file the three synthetic arrivals/);
  assert.equal(await item('item_0').locator('[data-slot=message]').count(),1,'agent messages are Message');
  assert.match(await item('item_2').textContent(),/^Thought/,'reasoning is collapsed to its line');
  assert.match(await item('item_1').textContent(),/Plan1 of 3 done/);
  assert.match(await page.locator('[data-activity-step-label]').textContent(),/Step 2 of 3: File the documents/);
  // A failed test run opens itself with parsed results; a passing command stays one collapsed line.
  assert.match(await item('item_8').textContent(),/exited with code 1/);
  assert.match(await item('item_8').locator('[data-activity-tests=pytest]').textContent(),/Ran 5 tests, 1 failed.*3 passed · 1 skipped/);
  assert.ok(await item('item_8').locator('[data-activity-terminal]').isVisible());
  assert.equal(await item('item_3').locator('[data-activity-terminal]').count(),0,'collapsed until asked');
  assert.match(await item('item_4').textContent(),/Called reader\.search/);assert.match(await item('sources-item_5').textContent(),/Searched the web for “shadcn trace component”/);
  assert.match(await item('item_6').textContent(),/Changed 5 files/);
  assert.equal(await page.locator('[data-activity-queue] [data-filed]').count(),3,'every arrival is marked filed when its path appears in file changes');
  assert.deepEqual(await page.locator('[data-activity-queue] [data-slot=trace-title]').allTextContents(),['Synthetic spec ninety','Synthetic spec ninety-one','A loose dropped note']);
  // 250 lines show the last 200 until asked.
  await item('item_7').locator('[data-slot=trace-collapsible-trigger]').click();
  await item('item_7').locator('[data-activity-terminal]').waitFor();
  assert.match(await item('item_7').locator('[data-activity-terminal]').textContent(),/^line 51\nline 52/);
  await item('item_7').locator('[data-activity-full]').click();assert.match(await item('item_7').locator('[data-activity-terminal]').textContent(),/^line 1\nline 2\n/);
  await item('item_7').locator('[data-slot=trace-collapsible-trigger]').click();
  // Follow the newest item; Jump to latest after scrolling up.
  await page.waitForFunction(()=>{const el=document.querySelector('#inbox .activity-log');return el.scrollHeight>el.clientHeight;});
  await page.waitForFunction(()=>{const el=document.querySelector('#inbox .activity-log');return el.scrollHeight-el.scrollTop-el.clientHeight<48;});
  await log.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await page.locator('[data-activity-jump]').click();
  await page.waitForFunction(()=>{const el=document.querySelector('#inbox .activity-log');return el.scrollHeight-el.scrollTop-el.clientHeight<48;});
  assert.equal(await page.locator('[data-activity-jump]').count(),0);
  // j/k move between items inside the transcript without scrolling the page; Enter expands one.
  await log.focus();await page.keyboard.press('j');
  assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-activity-item]')?.dataset.itemId),'item_0');
  await page.keyboard.press('j');await page.keyboard.press('j');await page.keyboard.press('j');
  assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-activity-item]')?.dataset.itemId),'item_3');
  await page.keyboard.press('Enter');await item('item_3').locator('[data-activity-terminal]').waitFor();
  await page.keyboard.press('k');assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-activity-item]')?.dataset.itemId),'item_2');
  await page.screenshot({path:'.reader/web-dev/inbox-running.png'});
  rmSync(join(root,'.fake-pause'));
  await toast('Mail filed: 3 arrivals').waitFor({timeout:15000});assert.equal(await toast('Mail filed').getAttribute('data-type'),'success');
  await page.locator('#inbox-report').filter({hasText:'Filed the synthetic mail'}).waitFor();
  assert.equal(await page.evaluate(()=>window.reportScriptRan),undefined,'report HTML is sanitized');
  assert.equal(await page.locator('#inbox-report').getAttribute('data-reader-decoration'),'');
  // A report that opens with `# Title` stays at transcript scale in the log (#79); the report view keeps its own heading size.
  const heads=await page.evaluate(()=>{const px=el=>parseFloat(getComputedStyle(el).fontSize),log=document.querySelector('#inbox .activity-log'),body=log.querySelector('.activity-prose');
    return {body:px(body),h1:px(log.querySelector('.activity-prose h1')),h2:px(log.querySelector('.activity-prose h2')),report:px(document.querySelector('#inbox-report h1'))};});
  assert.ok(heads.h1<=heads.body*1.25&&heads.h2<=heads.h1,JSON.stringify(heads));assert.equal(heads.report,17,JSON.stringify(heads));
  // The finished transcript ends with the commit Checkpoint and Context.
  await page.locator('#inbox [data-activity-item=context]').waitFor();
  const kinds=await log.locator('[data-activity-item]').evaluateAll(rows=>rows.map(r=>r.dataset.activityItem));
  assert.equal(kinds.at(-1),'context');assert.ok(kinds.lastIndexOf('checkpoint')>kinds.lastIndexOf('tool'),kinds.join());
  assert.match(await log.locator('[data-activity-checkpoint="1a2b3c4d"]').textContent(),/Committed 1a2b3c4d · File the synthetic mail/);
  assert.match(await log.locator('[data-activity-context]').textContent(),/182k in · 4\.2k out/);
  await log.locator('[data-activity-context]').hover();await page.locator('[data-slot=hover-card-content]').filter({hasText:'Cached input'}).waitFor();
  assert.match(await page.locator('[data-slot=hover-card-content]').textContent(),/82% of input tokens came from the cache/);
  await page.mouse.move(0,0);
  assert.match(await item('item_11').textContent(),/exited with code 128/);assert.match(await log.locator('[data-activity-item=error] [data-activity-notice]').textContent(),/Codex: Reconnecting/,'a retry notice is not a failure');
  assert.equal(await page.locator('#inbox .activity-working').count(),0,'polling stops when the run is finished');
  const polls=[];page.on('request',r=>{if(r.url().includes('/api/inbox/events'))polls.push(r.url());});await page.waitForTimeout(2500);assert.deepEqual(polls,[],'no event polling after the run');
  await page.waitForFunction(()=>document.querySelector('#settings-open span').textContent==='Backstage');
  assert.equal(await page.locator('#inbox-blocked').getAttribute('data-reason'),'empty');
  assert.ok(writes.some(w=>w.startsWith('/api/inbox')&&w.includes('"sandbox_mode":"workspace-write"')),'the sandboxed default is sent');
  await page.screenshot({path:'.reader/web-dev/inbox-report.png',fullPage:true});
  await log.screenshot({path:'.reader/web-dev/activity-paper.png'});
  // Legible in every theme: prose, trace lines and terminal text against their own backgrounds.
  const themes=await page.evaluate(()=>{const ids=new Set(['ink','paper','orchid','orchid-dark','harvest','harvest-dark']);for(const sheet of document.styleSheets){let rules;try{rules=sheet.cssRules;}catch{continue;}for(const rule of rules)for(const m of (rule.selectorText||'').matchAll(/\[data-theme="?([\w-]+)"?\]/g))ids.add(m[1]);}return [...ids].filter(id=>!id.startsWith('user-'));});
  assert.ok(themes.length>=22,themes.join());
  await item('item_8').scrollIntoViewIfNeeded();
  const lows=[];
  for(const theme of themes){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await page.waitForTimeout(450);  // Theme colors transition.
    const result=await page.evaluate(theme=>{
      const canvas=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
      const rgb=color=>{canvas.clearRect(0,0,1,1);canvas.fillStyle='#000';canvas.fillStyle=color;canvas.fillRect(0,0,1,1);const d=canvas.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255];};
      const lum=([r,g,b])=>[r,g,b].map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const bg=el=>{for(let n=el;n;n=n.parentElement){const c=rgb(getComputedStyle(n).backgroundColor);if(c[3]>.5)return c;}return rgb(getComputedStyle(document.body).backgroundColor);};
      const ratio=el=>{const a=lum(rgb(getComputedStyle(el).color)),b=lum(bg(el));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
      const q=s=>document.querySelector('#inbox .activity-log '+s);
      return {theme,prose:ratio(q('.activity-prose')),line:ratio(q('[data-slot=trace-line]:not([data-status])')),error:ratio(q('[data-slot=trace-line][data-status=error]')),terminal:ratio(q('[data-activity-terminal] [data-slot=code-block-content]')),notice:ratio(q('[data-activity-notice]')),checkpoint:ratio(q('[data-activity-checkpoint] [data-slot=marker-content]'))};
    },theme);
    for(const [key,value] of Object.entries(result))if(key!=='theme'&&value<4.5)lows.push(`${theme} ${key} ${value.toFixed(2)}`);
    if(['ink','orchid-dark','harvest'].includes(theme)||theme===themes.at(-1))await log.screenshot({path:`.reader/web-dev/activity-${theme}.png`});
  }
  assert.deepEqual(lows,[],'transcript text keeps WCAG contrast in every theme');
  await page.evaluate(()=>{document.documentElement.dataset.theme='paper';});
  // File tree and citations open vault documents.
  await item('item_6').locator('[data-activity-file-tree] button[data-change=add]').filter({hasText:'loose-note.md'}).click();
  await page.getByRole('heading',{name:'A loose dropped note'}).waitFor();
  assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read=library/filed/loose-note.md','file tree entries open filed documents');
  await page.goBack();await page.locator('#inbox .activity-log').waitFor();
  await page.locator('#inbox .activity-log [data-cite="library/filed/loose-note.md"]').first().click();
  await page.getByRole('heading',{name:'A loose dropped note'}).waitFor();
  await page.goBack();await page.locator('#inbox-report').waitFor();
  await page.locator('#inbox-report a').first().click();await page.getByRole('heading',{name:'A loose dropped note'}).waitFor();
  assert.equal(decodeURIComponent(new URL(page.url()).hash),'#read=library/filed/loose-note.md','report links open filed documents');
  // Stop during a slow run.
  writeFileSync(join(root,'.fake-slow'),'');
  mkdirSync(join(root,'inbox/33333333-3333-4333-8333-333333333333'));writeFileSync(join(root,'inbox/33333333-3333-4333-8333-333333333333/late.md'),'# A late arrival\n');
  await page.goto(url+'#admin/inbox');await page.reload();await page.locator('[data-arrival="33333333-3333-4333-8333-333333333333"]').waitFor();
  assert.equal(await page.locator('#settings-open span').textContent(),'Backstage · 1');
  // A second tab whose status is stale: its click is refused with 409 and it joins the run instead of erroring.
  const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));
  await other.goto(url+'#admin/inbox');await other.locator('#inbox-mail:not([disabled])').waitFor();
  await page.locator('#inbox-mail').click();await page.locator('#inbox-stop:not([disabled])').waitFor({timeout:8000});
  const refused=other.waitForResponse(r=>r.url().endsWith('/api/inbox')&&r.request().method()==='POST');
  await other.locator('#inbox-mail').click();
  assert.equal((await refused).status(),409,'already running is a conflict, not a rate limit');
  await other.locator('#inbox[data-run-state=running] #inbox-stop').waitFor({timeout:5000});
  await other.locator('[data-sonner-toast]').filter({hasText:'The librarian is already reading the mail'}).waitFor();
  assert.equal(await other.locator('[data-sonner-toast][data-type=error]').count(),0,'no error toast for joining a run');
  assert.ok(await other.locator('#inbox-mail').isDisabled());
  await other.close();
  await page.locator('#inbox-stop').click();
  await page.locator('#inbox[data-run-state=stopped]').waitFor({timeout:10000});await toast('Inbox run stopped').waitFor();
  assert.match(await page.locator('#inbox-run-message').textContent(),/Stopped by user/);
  rmSync(join(root,'.fake-slow'));
  // A failed run ends its transcript with a Stack Trace of the runner message and stderr tail.
  writeFileSync(join(root,'.fake-fail'),'');
  await page.locator('#inbox-mail').click();
  await toast('The librarian couldn’t file the mail').waitFor({timeout:15000});
  const stack=page.locator('#inbox .activity-log [data-activity-stack]');await stack.waitFor();
  assert.match(await stack.textContent(),/Codex exited with status 1.*RuntimeError: synthetic intake failure/s);
  assert.match(await page.locator('#inbox .activity-log [data-activity-item=message]').textContent(),/Checking receipts|I’ll file/);
  await page.locator('#inbox .activity').screenshot({path:'.reader/web-dev/activity-failed.png'});
  rmSync(join(root,'.fake-fail'));
  // A held Upkeep claim disables the button with its explanation.
  writeFileSync(join(root,'.reader/upkeep-claims.json'),JSON.stringify({'inbox/33333333-3333-4333-8333-333333333333':'agent-test'}));
  await page.reload();await page.locator('#inbox-blocked[data-reason=claims]').waitFor();
  assert.ok(await page.locator('#inbox-mail').isDisabled());assert.match(await page.locator('#inbox-blocked').textContent(),/Filing already assigned/);
  rmSync(join(root,'.reader/upkeep-claims.json'));
  // Host access is an explicit setting (on Reader Admin's Settings page), sent as the sandbox mode.
  await page.locator('[data-admin-nav=settings]').click();await page.locator('#preferences-form').waitFor();
  await page.locator('#inbox-sandbox').click();await page.getByRole('option',{name:'Host access',exact:true}).click();await page.locator('[data-slot=select-content][data-open]').waitFor({state:'hidden'});
  await page.locator('#preferences-form button[type=submit]').click();await toast('Preferences saved.').waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('reader.preferences.v1')).inboxSandbox),'danger-full-access');
  await page.locator('[data-admin-nav=inbox]').click();await page.locator('#inbox').waitFor();
  await page.setViewportSize({width:390,height:844});await page.locator('#inbox').scrollIntoViewIfNeeded();await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  if(await page.locator('#inbox .activity-log').count()){
    assert.ok(await page.evaluate(()=>[...document.querySelectorAll('#inbox .activity-log [data-slot=trace-collapsible-trigger] [data-slot=trace-line]')].every(l=>l.getBoundingClientRect().height<=24)),'tool lines collapse to one line at 390px');
    assert.ok(await page.evaluate(()=>{const log=document.querySelector('#inbox .activity-log');return log.scrollWidth<=log.clientWidth+1;}),'the transcript does not scroll sideways');
    await page.locator('#inbox .activity').screenshot({path:'.reader/web-dev/activity-phone.png'});
  }
  await page.screenshot({path:'.reader/web-dev/inbox-phone.png',fullPage:true});
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await context.close();
  console.log('Inbox passed: receipt titles and provenance, footer count, read-only previews, You got mail loading/success toasts and sanitized report, live activity transcript (message, reasoning, plan, steps, queue, tools with terminal and parsed tests, MCP, sources, file tree, errors, checkpoint, context; follow, Jump to latest, j/k, truncation, every-theme contrast), report links, Stop during a slow run, held-claim refusal, Host access setting, phone width, local-only requests.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
