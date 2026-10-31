/* Send to AI-TTS against the fixture's fake daemon: footer button, Space s menu, selection,
   From here, held playback, now-playing controls, an unavailable daemon, phone width. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync,readFileSync,writeFileSync,rmSync,existsSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const {scrollUntilHeld}=require('./web_wait.cjs');
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--speech'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url,speech}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  const requests=()=>existsSync(join(speech,'requests.jsonl'))?readFileSync(join(speech,'requests.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)):[];
  const submits=()=>requests().filter(r=>r.op==='submit');
  const until=async(test,ms=5000)=>{const end=Date.now()+ms;while(!test()){if(Date.now()>end)throw new Error('Timed out waiting for the fake daemon');await new Promise(r=>setTimeout(r,50));}};
  const flag=(name,on)=>on?writeFileSync(join(speech,name),''):rmSync(join(speech,name),{force:true});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760']});
  mkdirSync('.reader/web-dev',{recursive:true});
  const errors=[],external=[];
  const context=await browser.newContext({viewport:{width:1300,height:900},reducedMotion:'reduce'});
  await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'user-reader-test',layout:'scroll'}));
  const page=await context.newPage();
  // A 503 from the unavailable-daemon case is expected; Chrome logs it as a failed resource.
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/status of 503/.test(m.text()))errors.push(m.text());});page.on('request',r=>{if(!r.url().startsWith(url))external.push(r.url());});
  const toast=text=>page.locator('[data-sonner-toast]').filter({hasText:text}).last();
  const leader=async key=>{await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press(key);};
  await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));await page.locator('#article [data-source-start]').first().waitFor();await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  // Footer button: the whole article, Markdown after the frontmatter, Reader's stable source.
  await page.locator('#speak-article').click();await toast('Queued for AI-TTS.').waitFor();
  let sent=submits().at(-1);
  assert.deepEqual({origin:sent.origin,source:sent.source,sensitivity:sent.sensitivity,priority:sent.priority,content_format:sent.content_format},{origin:'Reader',source:'Reader',sensitivity:'confidential',priority:'normal',content_format:'markdown'});
  assert.ok(sent.text.trimStart().startsWith('# A quiet thought')&&!sent.text.includes('author: Ada')&&sent.text.includes('chapter 44'),'whole body, no frontmatter');
  // Now playing: progress, pause/resume reach the daemon, and the control leaves on Played.
  const control=page.locator('#speech-slot [data-speech-control]');
  await control.locator('[data-speech-label]',{hasText:/Speaking · \d of 3/}).waitFor({timeout:8000});
  await page.screenshot({path:'.reader/web-dev/speech-playing.png'});
  await control.locator('[data-speech-action=pause]').click();await control.locator('[data-speech-action=resume]').waitFor();
  assert.ok(requests().some(r=>r.op==='pause'));assert.match(await control.locator('[data-speech-label]').textContent(),/^Paused/);
  await control.locator('[data-speech-action=resume]').click();await control.locator('[data-speech-action=pause]').waitFor();
  assert.ok(requests().some(r=>r.op==='resume'));
  await control.waitFor({state:'detached',timeout:12000});
  // Space s opens the menu; a sends the whole article. A hold adds the pause note.
  flag('held',true);
  await leader('s');await page.locator('#speak-menu').waitFor();
  assert.ok(await page.locator('#speak-menu [data-speak=selection]').isDisabled(),'no selection yet');
  await page.keyboard.press('a');await toast('it plays when the pause ends').waitFor();
  assert.equal(submits().length,2);await page.locator('#speak-menu').waitFor({state:'detached'});
  await control.locator('[data-speech-label]',{hasText:'Queued · held'}).waitFor({timeout:6000});
  assert.ok(await control.locator('[data-speech-action]').isDisabled(),'transport waits until this passage is current');
  flag('held',false);await control.waitFor({state:'detached',timeout:12000});
  // Selection toolbar Speak sends only the selection, with the title first.
  await page.evaluate(()=>{const strong=[...document.querySelectorAll('#article strong')].find(el=>el.textContent==='a precise passage');const range=document.createRange();range.selectNodeContents(strong);getSelection().removeAllRanges();getSelection().addRange(range);strong.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.locator('#selection-tools:not([hidden]) #speak-selection').click();await toast('Queued for AI-TTS.').waitFor();
  sent=submits().at(-1);assert.equal(sent.text,'A quiet thought.\n\na precise passage');
  // From here: starts at the block at the reading line.
  await page.evaluate(()=>getSelection().removeAllRanges());
  // Chapter 30 starts far below, where blocks have estimated heights until they near the window: scroll until it
  // holds at the reading line once the blocks around it are laid out (#155).
  await scrollUntilHeld(page,'Chapter 30 at the reading line',()=>{const h=[...document.querySelectorAll('#article h2')].find(el=>el.textContent==='Chapter 30');return scrollY+h.getBoundingClientRect().top-innerHeight*.22+4;});
  const before=submits().length;await leader('s');await page.keyboard.press('f');await until(()=>submits().length>before);sent=submits().at(-1);assert.equal(submits().length,before+1);
  assert.ok(sent.text.startsWith('A quiet thought.\n\n## Chapter 30')&&!sent.text.includes('chapter 29 waits')&&sent.text.includes('chapter 44'),'from the reading position');
  await control.waitFor({state:'detached',timeout:15000});
  // An unavailable daemon is explained, not hidden: the companion prompt names it and offers setup, without an error toast.
  flag('down',true);await page.locator('#speak-article').click();
  await page.locator('[data-companion-prompt=ai-tts]').waitFor();
  assert.match(await page.locator('[data-companion-prompt=ai-tts] [data-prompt-title]').textContent(),/AI-TTS/);
  assert.equal(await page.locator('[data-sonner-toast][data-type=error]').count(),0);
  await page.locator('[data-companion-prompt=ai-tts] [data-prompt-action=dismiss]').click();await page.evaluate(()=>localStorage.removeItem('reader.companions.dismissed.v1'));
  flag('down',false);
  // Help lists the key; phone width keeps the glyph and pause/resume only.
  await page.locator('#main').focus();await page.keyboard.press('?');await page.locator('#help-keys dt').first().waitFor();
  assert.ok((await page.locator('#help').textContent()).includes('Send to AI-TTS'));
  await page.keyboard.press('Escape');await page.locator('#help').waitFor({state:'detached'});
  await page.locator('#speak-article').click();await control.waitFor();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.ok(await control.locator('[data-speech-action]').isVisible());assert.ok(!(await control.locator('[data-speech-label]').isVisible()));assert.ok(!(await control.locator('[data-speech-extra]').first().isVisible()));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  await page.screenshot({path:'.reader/web-dev/speech-phone.png'});
  await context.close();
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('Speech passed: footer and Space s menu queue the article, held note, selection-only Speak, From here offsets, now-playing progress with pause/resume reaching the daemon and leaving on Played, unavailable toast, help entry, phone width, local-only requests.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
