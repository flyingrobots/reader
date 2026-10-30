/* Companions with git-locks absent and fake tools only: the not-installed prompt (Space s, Space c), Don't show again,
   Install from the prompt as a background job with progress and toasts, the Companions card (status, guide, Copy, confirm,
   Set path, install log), and the git-locks fallbacks end to end: a chat reply, a scratch pad save and a local-model run. */
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,readFileSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const shots=process.env.READER_SHOTS||'.reader/web-dev';
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--companions','--no-git-locks','--chat','--writing','--local-model'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync(shots,{recursive:true});
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',HOME:'/dev/null'}});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:url});
  await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
  const page=await context.newPage();
  // Expected refusals Chrome logs as failed resources: the missing daemon (503), missing Colorful (409), the bad path (400), the second install (429).
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/status of (400|409|429|503)/.test(m.text()))errors.push(m.text());});
  page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  const toast=text=>page.locator('[data-sonner-toast]').filter({hasText:text}).last();
  const leader=async key=>{await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press(key);};
  const doc=url+'#read='+encodeURIComponent('library/thought.md');
  const ready=async()=>{await page.locator('#article [data-source-start]').first().waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));};
  await page.goto(doc);await ready();

  // Space s without AI-TTS: a calm prompt naming what is missing, what it adds and its repo; never an error toast.
  await leader('s');await page.locator('#speak-menu[open]').waitFor();await page.keyboard.press('a');
  const speakPrompt=page.locator('[data-companion-prompt=ai-tts]');await speakPrompt.waitFor();
  assert.equal(await speakPrompt.locator('.companion-prompt-title').textContent(),'Read aloud needs AI-TTS');
  assert.match(await speakPrompt.textContent(),/local speech daemon/);
  assert.equal(await speakPrompt.locator('a').getAttribute('href'),'https://github.com/flyingrobots/AI-TTS');
  assert.equal(await speakPrompt.locator('[data-prompt-action=install]').count(),0,'AI-TTS is guided, never auto-installed');
  assert.equal(await page.locator('[data-sonner-toast][data-type=error]').count(),0);
  await page.screenshot({path:shots+'/companions-prompt.png'});
  // How to install opens Reader Admin's Service & tools on its card with the commands, and Copy copies them.
  await speakPrompt.locator('[data-prompt-action=setup]').click();
  const guide=page.locator('#companion-guide-ai-tts');await guide.waitFor();
  assert.match(new URL(page.url()).hash,/^#admin\/service$/);
  assert.match(await guide.locator('pre').textContent(),/make install/);
  await guide.getByRole('button',{name:'Copy the commands'}).click();await guide.getByText('Copied').waitFor();
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/^git clone https:\/\/github\.com\/flyingrobots\/AI-TTS\.git\ncd AI-TTS\n/);

  // The Companions card: every companion renders, git-locks is absent and coordination is this Reader only.
  const card=name=>page.locator(`[data-companion=${name}]`);
  await card('colorful').waitFor();
  assert.equal(await card('ai-tts').getAttribute('data-state'),'missing');
  assert.equal(await card('colorful').getAttribute('data-state'),'missing');
  assert.equal(await card('git-locks').getAttribute('data-state'),'missing');
  // The agent command lines are Reader Admin's Voices page.
  await page.locator('[data-admin-nav=voices]').click();await page.locator('#companion-cli').waitFor();
  assert.match(await page.locator('#companion-gpu').textContent(),/GPU coordination: This Reader only/);
  assert.equal(await page.locator('[data-cli]').count(),3,'claude, codex and agy are listed, status only');
  assert.equal(await page.locator('[data-cli][data-state=missing]').count(),3,'the fixture never sees this Mac\'s agent CLIs (#134)');
  assert.equal(await page.locator('#companion-cli button').count(),0,'no install buttons for account-bound CLIs');
  await page.locator('[data-admin-nav=service]').click();await card('wide-md').waitFor();
  // wide-md: Install lists what will change before anything runs; Cancel runs nothing.
  await card('wide-md').locator('[data-action=install]').click();
  const confirm=card('wide-md').locator('.companion-confirm');await confirm.waitFor();
  assert.match(await confirm.textContent(),/install_wide_md\.py/);assert.match(await confirm.textContent(),/sudo/);
  await confirm.getByRole('button',{name:'Cancel'}).click();await confirm.waitFor({state:'detached'});
  // Set path refuses a path that is not an executable.
  await card('colorful').locator('[data-action=set-path]').click();
  await card('colorful').locator('input').fill('/nonexistent/colorful');await card('colorful').getByRole('button',{name:'Save'}).click();
  await card('colorful').locator('[role=alert]').filter({hasText:'not an executable file'}).waitFor();
  await page.locator('#companions').screenshot({path:shots+'/companions-card.png'});

  // Space c without Colorful: the prompt offers Install; Install runs a background job with progress and toasts.
  await page.goto(doc);await ready();
  await leader('c');
  const colorPrompt=page.locator('[data-companion-prompt=colorful]');await colorPrompt.waitFor();
  assert.equal(await colorPrompt.locator('.companion-prompt-title').textContent(),'Prose colors needs Colorful Language');
  await colorPrompt.locator('[data-prompt-action=install]').click();
  await toast('Install Colorful Language running…').waitFor();
  assert.equal(await toast('Install Colorful Language running…').getAttribute('data-type'),'loading');
  await toast('Building Colorful').waitFor({timeout:10000});
  // A second install is refused while one runs.
  const refused=await page.evaluate(async()=>{const token=(await (await fetch('/api/library')).json()).token;
    const r=await fetch('/api/companions',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Token':token},body:JSON.stringify({action:'install',name:'wide-md'})});return [r.status,(await r.json()).error];});
  assert.equal(refused[0],429);assert.match(refused[1],/already running/);
  await toast('Install Colorful Language finished').waitFor({timeout:30000});
  assert.match(await toast('Install Colorful Language finished').textContent(),/Colorful Language 0\.4\.0 is ready/);
  // Now Space c colors prose with the built (fake) binary.
  await leader('c');await toast('Prose colors: Subtle.').waitFor();
  await page.waitForFunction(()=>document.body.classList.contains('prose-subtle')&&CSS.highlights?.get('reader-prose-noun')?.size>0);

  // Don't show again: the next Space s says what is missing in one line, without the prompt.
  await leader('s');await page.locator('#speak-menu[open]').waitFor();await page.keyboard.press('a');
  await page.locator('[data-companion-prompt=ai-tts]').waitFor();
  await page.locator('[data-companion-prompt=ai-tts] [data-prompt-action=dismiss]').click();
  await page.locator('[data-companion-prompt=ai-tts]').waitFor({state:'detached'});
  await leader('s');await page.locator('#speak-menu[open]').waitFor();await page.keyboard.press('a');
  await toast('Read aloud needs AI-TTS.').waitFor();
  assert.equal(await page.locator('[data-companion-prompt]').count(),0);

  // Reader Admin after the install: installed, built by Reader, with the install log; the job is in Recent runs.
  await page.goto(url+'#admin/service');await card('colorful').waitFor();
  await page.locator('[data-companion=colorful][data-state=installed]').waitFor();
  assert.match(await card('colorful').locator('[data-fact=version]').textContent(),/0\.4\.0/);
  assert.match(await card('colorful').locator('[data-fact=path]').textContent(),/\.reader\/tooling\/bin\/colorful$/);
  await card('colorful').locator('.companion-log summary').click();
  await card('colorful').locator('.companion-log pre').filter({hasText:'Compiling colorful-cli'}).waitFor();
  await page.locator('[data-admin-nav=indexes]').click();await page.locator('#recent-runs').waitFor();
  await page.locator('#recent-runs [data-job-state=succeeded]').filter({hasText:'Install Colorful Language'}).first().waitFor();
  const tools=readFileSync(root+'/.fake-tools/calls.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.ok(tools.some(t=>t.tool==='git'&&t.argv.includes('61d0aa8b20837decdb26c92f71b967c7b14578d7')),'the pinned commit is checked out');
  assert.ok(tools.filter(t=>t.tool==='cargo').every(t=>t.argv[0]==='build'&&t.argv.includes('--locked')));

  // git-locks absent: a local-model run takes Reader's own GPU lock.
  await page.locator('[data-admin-nav=models]').click();await page.locator('#lm-gpu').filter({hasText:'This Reader only'}).waitFor();
  await page.locator('#lm-server-start').click();await page.locator('.lm-server[data-server-state=ready]').waitFor({timeout:15000});
  await page.locator('[data-enqueue=standfirst][data-scope=recent]').click();await toast('Queued').waitFor();
  await page.locator('[data-run=standfirst]').click();
  await toast('Local model finished').waitFor({timeout:40000});
  assert.doesNotMatch(await toast('Local model finished').textContent(),/failed/);

  // git-locks absent: a chat reply is committed under Reader's flock.
  await page.goto(doc);await ready();
  await leader('m');await page.waitForFunction(()=>document.activeElement?.id==='chat-input');
  await page.keyboard.type('@cl');await page.locator('[data-slot=combobox-item]').filter({hasText:'@claude'}).waitFor();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#chat-input').value==='@claude ');
  await page.keyboard.type('what stands out?');await page.keyboard.press('Enter');
  await page.locator('[data-chat-turn][data-author=Claude]').waitFor({timeout:15000});
  const deadline=Date.now()+20000;let log='';
  while(Date.now()<deadline&&!/Claude replied/.test(log=git('log','--format=%s')))await new Promise(r=>setTimeout(r,200));
  assert.match(log,/Claude replied/,'the reply was committed without git-locks');
  // git-locks absent: a scratch pad save commits.
  const saved=await page.evaluate(async()=>{const token=(await (await fetch('/api/library')).json()).token;
    const r=await fetch('/api/writing',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Token':token},
      body:JSON.stringify({action:'save',request_id:crypto.randomUUID(),title:'Without locks',slug:'without-locks',status:'draft',body:'# Without locks\n\nSaved.\n'})});return [r.status,await r.json()];});
  assert.equal(saved[0],200,JSON.stringify(saved[1]));assert.equal(saved[1].status,'committed');assert.equal(saved[1].locked_by,'flock');
  assert.equal(git('show','--name-only','--format=','HEAD').trim(),saved[1].path);

  // Phone width: the Companions section has no horizontal scroll.
  await page.setViewportSize({width:390,height:844});await page.goto(url+'#admin/service');await card('git-locks').waitFor();
  await card('git-locks').locator('[data-action=guide]').click();await page.locator('#companion-guide-git-locks').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page scroll at 390px');
  await page.locator('#companions').screenshot({path:shots+'/companions-phone.png'});

  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('web_companions: ok');
 }finally{await browser?.close();fixture.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exit(1);});
