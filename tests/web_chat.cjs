/* Chat with the voices: Space m, @mentions, streamed replies, replies, raised hands and chime-ins, Kai paste, cancel, reload and phone width. Fake voices only. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--chat'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const open=async(viewport={width:1300,height:900})=>{const context=await browser.newContext({viewport,reducedMotion:'reduce'});await context.addInitScript(()=>{try{if(!localStorage.getItem('reader.preferences.v1'))localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,theme:'paper',layout:'scroll'}));}catch{}});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});return {page,context};};
  const toast=(page,text)=>page.locator('[data-sonner-toast]').filter({hasText:text});
  const doc=url+'#read='+encodeURIComponent('library/thought.md');
  const {page,context}=await open();
  await page.goto(doc);await page.locator('#article h1').waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');
  await page.locator('#chat-panel:not([hidden])').waitFor();
  await page.waitForFunction(()=>document.activeElement?.id==='chat-input');
  assert.equal(await page.locator('#vim-mode').textContent(),'CHAT');
  assert.ok(await page.locator('#chat-panel').evaluate(el=>el.hasAttribute('data-reader-decoration')));
  assert.match(await page.locator('#chat-title').textContent(),/A quiet thought/);
  // @ opens the voice list; Enter picks the highlighted voice.
  await page.keyboard.type('@cl');
  await page.locator('[data-slot=combobox-item]').filter({hasText:'@claude'}).waitFor();
  assert.equal(await page.locator('[data-slot=combobox-item]').count(),1,'filtered to the matching voice');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#chat-input').value==='@claude ');
  await page.keyboard.type('what does this passage do?');await page.keyboard.press('Enter');
  await page.locator('[data-chat-message][data-author="Browser tester"]').waitFor();
  assert.equal((await page.locator('[data-chat-message][data-author="Browser tester"] .chat-markdown').textContent()).trim(),'@claude what does this passage do?','typing right after choosing a mention keeps the caret after it');
  await toast(page,'Claude is replying…').waitFor();
  // Streamed text renders incrementally.
  const turn=page.locator('[data-chat-turn][data-author=Claude]');
  await turn.locator('.chat-markdown').waitFor();
  const first=(await turn.locator('.chat-markdown').textContent()).length;
  await page.waitForFunction(n=>(document.querySelector('[data-chat-turn] .chat-markdown')?.textContent.length||0)>n+10,first);
  const second=(await turn.locator('.chat-markdown').textContent()).length;
  assert.ok(first>0&&second>first,'partial text grows before the reply is done');
  assert.match(await turn.locator('.chat-turn-state').textContent(),/Thinking/);
  await page.screenshot({path:'.reader/web-dev/chat-streaming.png'});
  const reply=page.locator('[data-chat-message][data-author=Claude]').first();await reply.waitFor({timeout:15000});
  assert.equal(await reply.locator('strong').textContent(),'precise','markdown renders through the Reader pipeline');
  assert.match(await reply.locator('.chat-runtime').textContent(),/fake-voice 1\.0\.0 · fake-model-1/);
  assert.match(await reply.locator('.chat-facts').textContent(),/\d+\.\d s/);
  assert.equal(await page.locator('[data-chat-turn]').count(),0);
  // Raw output is hidden by default.
  const claudeRaw=reply.locator(`[data-chat-raw="${await reply.getAttribute('data-chat-message')}"]`);
  assert.equal(await claudeRaw.count(),1);assert.equal(await claudeRaw.evaluate(el=>el.open),false);
  assert.equal(await claudeRaw.locator('.chat-raw-steps').count(),0);
  assert.match(await page.locator('[data-chat-log-usage]').textContent(),/^\d+(\.\d)? (B|KiB|MiB), 1 run$/,'archived log usage updates when a turn ends');
  // Listening checks: Agy (fake) raises a hand; Let them speak produces a chime-in.
  const hand=page.locator('[data-chat-hand][data-author=Agy]');await hand.waitFor({timeout:15000});
  assert.match(await hand.textContent(),/Agy has something to add: the runner boundary matters here/);
  await toast(page,'1 voice has something to add').waitFor();
  await page.locator('[data-chat-listened]').filter({hasText:'Agy'}).waitFor();
  assert.match(await reply.locator('[data-chat-listened]').textContent(),/listened: Reader librarian, Agy/);
  // Listening checks keep their raw output too, compactly under the reply they followed.
  const listenRaw=reply.locator('[data-chat-listen-raw]');
  await page.waitForFunction(()=>/Listening checks · raw output \(4\)/.test(document.querySelector('[data-chat-listen-raw] > summary')?.textContent||''));
  assert.equal(await listenRaw.evaluate(el=>el.open),false);
  await listenRaw.locator('> summary').click();
  const agyCheck=listenRaw.locator('.chat-raw-compact').filter({hasText:'Agy · raised a hand'});
  await agyCheck.locator('> summary').click();
  assert.match(await agyCheck.locator('.chat-raw-note').last().textContent(),/logs\/llm\/listen\/\d{4}\/\d\d\/\d\d\/[0-9a-f-]+ · done · exit 0/);
  assert.match(await listenRaw.locator('.chat-raw-compact > summary').filter({hasText:'Garbled'}).textContent(),/Garbled · Unreadable output/);
  await listenRaw.locator('> summary').click();
  await page.screenshot({path:'.reader/web-dev/chat-hand.png'});
  await hand.locator('[data-chat-hand-accept]').click();
  const chime=page.locator('[data-chat-message][data-author=Agy][data-chat-kind=chime_in]');await chime.waitFor({timeout:15000});
  assert.equal((await chime.locator('.chat-chimed').textContent()).trim(),'chimed in');
  assert.match(await chime.locator('.chat-markdown').textContent(),/runner boundary matters/);
  await page.waitForFunction(()=>document.querySelector('[data-chat-hand][data-author=Agy]')?.dataset.handState==='accepted');
  assert.equal(await hand.locator('[data-chat-hand-accept]').count(),0);
  // Reply to a voice: the button fills @claude, focuses the composer and shows the chip.
  await page.locator('#chat-input').fill('draft words');
  await reply.locator('[data-chat-reply]').click();
  await page.waitForFunction(()=>document.activeElement?.id==='chat-input');
  assert.equal(await page.locator('#chat-input').inputValue(),'@claude draft words');
  assert.equal(await page.locator('#chat-input').evaluate(el=>el.selectionStart),8,'caret after the mention');
  assert.match(await page.locator('[data-chat-replying]').textContent(),/Replying to Claude · “The passage is precise: it names one thing/);
  await page.locator('#chat-input').fill('');
  // r on a focused voice message does the same, replacing a leading mention.
  await page.locator('#chat-input').fill('@agy why?');await reply.focus();await page.keyboard.press('r');
  await page.waitForFunction(()=>document.activeElement?.id==='chat-input');
  assert.equal(await page.locator('#chat-input').inputValue(),'@claude why?');
  await page.keyboard.press('End');await page.keyboard.type(' Say more.');await page.keyboard.press('Enter');
  const answer=page.locator('[data-chat-message][data-author="Browser tester"]').last();
  await answer.locator('[data-chat-quote]').waitFor();
  assert.equal(await page.locator('[data-chat-replying]').count(),0,'the chip clears on send');
  assert.match(await answer.locator('[data-chat-quote]').textContent(),/Claude The passage is precise/);
  await page.locator('[data-chat-message][data-author=Claude]').nth(1).waitFor({timeout:15000});
  await answer.locator('[data-chat-quote]').click();
  await page.waitForFunction(()=>document.querySelector('[data-chat-message][data-author=Claude]')?.hasAttribute('data-chat-flash'));
  const seen=await reply.evaluate(el=>{const r=el.getBoundingClientRect(),p=document.querySelector('#chat-panel').getBoundingClientRect();return r.bottom>p.top&&r.top<p.bottom;});
  assert.ok(seen,'the quoted message is scrolled into view');
  // Typing straight past the mention list keeps every character.
  await page.locator('#chat-input').focus();await page.keyboard.type('@agy what about provenance?');
  assert.equal(await page.locator('#chat-input').inputValue(),'@agy what about provenance?');await page.keyboard.press('Enter');
  // agy's real stream-json: interim narration and a draft stream live, with elapsed time against the configured timeout.
  const agyTurn=page.locator('[data-chat-turn][data-author=Agy]');
  await page.waitForFunction(()=>/Let me read the passage first/.test(document.querySelector('[data-chat-turn][data-author=Agy] .chat-markdown')?.textContent||''));
  assert.match(await agyTurn.locator('[data-chat-elapsed]').textContent(),/^\d+:\d\d of 1 min$/);
  // Opening raw output while it runs shows tool steps as they arrive.
  await agyTurn.locator('[data-chat-raw] > summary').click();
  assert.match(await agyTurn.locator('[data-chat-raw] > summary').textContent(),/live/);
  await agyTurn.locator('.chat-raw-step[data-raw-kind=tool]').first().waitFor();
  const agy=page.locator('[data-chat-message][data-author=Agy][data-chat-kind=message]');await agy.waitFor({timeout:20000});
  assert.equal(await agy.locator('strong').textContent(),'effector boundary','result.response replaces the streamed draft');
  assert.doesNotMatch(await agy.locator('.chat-markdown').textContent(),/rough draft|Let me read/);
  assert.equal(await agy.getAttribute('data-chat-state'),'done');
  const agyRaw=agy.locator(`[data-chat-raw="${await agy.getAttribute('data-chat-message')}"]`);
  assert.equal(await agyRaw.evaluate(el=>el.open),true,'the disclosure stays open when the turn finishes');
  await page.waitForFunction(()=>document.querySelectorAll('[data-chat-message][data-author=Agy][data-chat-kind=message] .chat-raw-step[data-raw-kind=result]').length===1);
  const tools=agyRaw.locator('.chat-raw-step[data-raw-kind=tool]');
  assert.equal(await tools.count(),2);
  assert.match(await tools.nth(0).textContent(),/view_file.*done.*library\/thought\.md.*A precise passage/s);
  assert.equal(await tools.nth(1).getAttribute('data-raw-state'),'error');assert.match(await tools.nth(1).locator('.chat-raw-error').textContent(),/NOT_FOUND: file does not exist/);
  assert.match(await agyRaw.locator('.chat-raw-step[data-raw-kind=result]').textContent(),/Result · SUCCESS/);
  assert.equal(await agyRaw.locator('.chat-raw-step[data-raw-kind=text]').count(),2,'reply deltas collapse into one row per step');
  assert.equal(await agyRaw.locator('.chat-raw-text').first().evaluate(el=>el.open),false);
  await agyRaw.locator('[data-raw-view=events]').click();
  const events=(await agyRaw.locator('.chat-raw-events').textContent()).split('\n');
  assert.ok(events.length>10&&events.every(line=>JSON.parse(line)),'one JSON event per line');
  assert.match(await agyRaw.locator('.chat-raw-note').last().textContent(),/logs\/llm\/chat\/\d{4}\/\d\d\/\d\d\/[0-9a-f-]+ · done · exit 0/);
  await page.screenshot({path:'.reader/web-dev/chat-raw.png'});
  await agyRaw.locator('> summary').click();
  assert.equal(await page.locator('[data-chat-message][data-author="Browser tester"]').last().locator('.chat-markdown').textContent().then(t=>t.trim()),'@agy what about provenance?');
  // A CLI that exits 0 with output Reader can't read fails with that reason, not "empty".
  await page.locator('#chat-input').fill('@garbled hello');await page.keyboard.press('Enter');
  const garbled=page.locator('[data-chat-message][data-author=Garbled]');await garbled.waitFor({timeout:15000});
  assert.equal(await garbled.locator('[data-chat-failure]').getAttribute('data-chat-failure'),'unreadable');
  assert.match(await garbled.locator('[data-chat-reason]').textContent(),/Garbled’s CLI \(fake-voice\) exited 0 but Reader couldn’t read its output/);
  await toast(page,'Garbled: Failed').waitFor();
  // No mention: one voice is chosen at random (seeded in the fixture).
  const before=await page.locator('[data-chat-message]').count();
  await page.locator('#chat-input').fill('And the second chapter?');await page.locator('#chat-send').click();
  await toast(page,'was chosen at random').waitFor();
  await page.locator('[data-chat-message][data-author]').nth(before+1).waitFor({timeout:15000});
  assert.match(await page.locator('[data-chat-message]').nth(before+1).locator('.chat-runtime').textContent(),/chosen at random/);
  // Kai by paste.
  await page.locator('#chat-paste-toggle').click();await page.locator('#chat-paste-body').fill('Kai thinks the observation is *earned*.');
  await page.getByRole('button',{name:'Save as Kai'}).click();
  const kai=page.locator('[data-chat-message][data-author=Kai]');await kai.waitFor();
  assert.match(await kai.locator('.chat-runtime').textContent(),/pasted by hand/);assert.equal(await kai.locator('em').textContent(),'earned');
  // Cancel a running turn; it fails visibly with Retry.
  await page.locator('#chat-input').fill('@sloth take your time');await page.keyboard.press('Enter');
  const sloth=page.locator('[data-chat-turn][data-author=Sloth]');await sloth.waitFor();
  await page.waitForFunction(()=>/Thinking/.test(document.querySelector('[data-chat-turn][data-author=Sloth] .chat-turn-state')?.textContent||''));
  // Cancelling a queued turn still answers its message: a Cancelled reply with Retry and a toast.
  await page.locator('#chat-input').fill('@librarian queued behind Sloth');await page.keyboard.press('Enter');
  const queuedTurn=page.locator('[data-chat-turn][data-author="Reader librarian"]');await queuedTurn.waitFor();
  await page.waitForFunction(()=>/Queued/.test(document.querySelector('[data-chat-turn][data-author="Reader librarian"] .chat-turn-state')?.textContent||''));
  await queuedTurn.locator('[data-chat-cancel]').click();
  const unrun=page.locator('[data-chat-message][data-author="Reader librarian"][data-chat-state=cancelled]');await unrun.waitFor({timeout:10000});
  assert.match(await unrun.locator('.chat-error').textContent(),/Cancelled before it started/);
  assert.equal(await unrun.locator('[data-chat-retry]').count(),1);
  await toast(page,'Reader librarian: Cancelled').waitFor();
  await sloth.locator('[data-chat-cancel]').click();
  const cancelled=page.locator('[data-chat-message][data-author=Sloth][data-chat-state=cancelled]');await cancelled.waitFor({timeout:10000});
  await toast(page,'Sloth: Cancelled').waitFor();assert.equal(await toast(page,'Sloth: Cancelled').getAttribute('data-type'),'error');
  assert.equal(await cancelled.locator('[data-chat-retry]').count(),1);
  // The chime-in setting persists per chat.
  await page.locator('#chat-chime-ins').click();await page.getByRole('option',{name:'Voices speak freely'}).click();
  await page.waitForFunction(()=>/speak freely/.test(document.querySelector('#chat-chime-ins')?.textContent||''));
  const count=await page.locator('[data-chat-message]').count();
  await page.setViewportSize({width:1300,height:900});await page.screenshot({path:'.reader/web-dev/chat.png'});
  // Esc closes; Space m reopens the same chat.
  await page.keyboard.press('Escape');await page.locator('#chat-panel').waitFor({state:'hidden'});
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');await page.locator('#chat-panel:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-chat-message]').count(),count);
  // Reload restores the chat from the vault file.
  await page.reload();await page.locator('#article h1').waitFor();
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');
  await page.locator('[data-chat-message]').nth(count-1).waitFor();assert.equal(await page.locator('[data-chat-message]').count(),count);
  assert.equal(await page.locator('#chat-history').count(),1,'the document lists its chats');
  assert.match(await page.locator('#chat-chime-ins').textContent(),/speak freely/,'the setting is stored with the chat');
  assert.equal(await page.locator('[data-chat-hand]').count()>=1,true,'hands are kept in the record');
  // The thread panel's Chat button toggles the same panel.
  await page.keyboard.press('Escape');await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('t');
  await page.locator('#thread-panel:not([hidden])').waitFor();await page.locator('#chat-open').click();await page.locator('#chat-panel:not([hidden])').waitFor();
  assert.ok(await page.locator('#thread-panel').isHidden());
  await context.close();
  // Phone width: a bottom sheet with no horizontal scroll.
  {const {page,context}=await open({width:390,height:844});
   await page.goto(doc);await page.locator('#article h1').waitFor();
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');
   await page.locator('[data-chat-message]').first().waitFor();
   const box=await page.locator('#chat-panel').boundingBox();
   assert.ok(box.x>=0&&box.x+box.width<=391&&box.y>100&&box.y+box.height<=844,'bottom sheet within the viewport: '+JSON.stringify(box));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
   await page.screenshot({path:'.reader/web-dev/chat-phone.png'});
   await context.close();}
  // Space m with no document open only explains.
  {const {page,context}=await open();await page.goto(url);await page.locator('#home-title').waitFor();
   await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('m');
   await toast(page,'Open a document to chat about it.').waitFor();assert.ok(await page.locator('#chat-panel').isHidden());await context.close();}
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Chat passed: Space m panel and CHAT mode, @ autocomplete, incremental streaming, markdown, runtime footer, agy stream-json with result.response replacing the draft, live raw output with tool steps (hidden by default), unreadable-output reason, raised hand and chime-in, Reply button, r and quote bar, chime-in setting, random choice, Kai paste, cancel with Retry and toasts, Esc and reopen, reload from the vault, thread-panel button, phone bottom sheet, local-only requests.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
