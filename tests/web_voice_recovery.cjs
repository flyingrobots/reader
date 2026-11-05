/* Explorer split geometry and AI-TTS catalog recovery without remounting the page. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const {createInterface}=require('node:readline');
const {writeFileSync,rmSync}=require('node:fs');const {join}=require('node:path');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{let browser;const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--speech'],{stdio:['ignore','pipe','inherit']});try{
 const {url,speech}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',s=>resolve(JSON.parse(s)));fixture.once('exit',c=>reject(Error('fixture '+c)));});
 browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({smooth:false,nextReads:false})));
 {
  writeFileSync(join(speech,'down'),'');await page.goto(url+'#admin/service');
  const voice=page.locator('#companion-ai-tts [data-speech-voice]');await voice.getByRole('alert').waitFor();
  rmSync(join(speech,'down'));await page.locator('#companion-ai-tts [data-action=check]').click();
  await voice.locator('select:not(:disabled) option[value="voice-a"]').waitFor({state:'attached',timeout:6000});
  assert.ok(!(await voice.locator('select').isDisabled()),'catalog retries when the companion recovers');
  assert.equal(await voice.getByRole('alert').count(),0,'successful retry clears the error');
  await page.goto(url+'#read=library%2Fthought.md');await page.locator('#article').waitFor();
  writeFileSync(join(speech,'down'),'');await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('s');
  const popup=page.locator('#speak-menu [data-speech-voice]');await popup.getByRole('alert').waitFor();
  rmSync(join(speech,'down'));await popup.getByRole('button',{name:'Retry voices'}).click();
  await popup.locator('select:not(:disabled) option[value="voice-b"]').waitFor({state:'attached'});
  assert.equal(await popup.getByRole('alert').count(),0,'popup retry recovers without reopening');
 }
 console.log('Recovery regression passed.');
}finally{await browser?.close();if(fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(r=>fixture.once('exit',r));}}})().catch(e=>{console.error(e);process.exitCode=1;});
