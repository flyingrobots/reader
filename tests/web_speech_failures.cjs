/* Medium browser contract: only the selected utterance/segment may control playback.
   An owned Audio adapter supplies deterministic completion, rejection and error events. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {test}=require('node:test');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');

test('browser speech failures preserve playback ownership',async t=>{
  const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--speech'],{stdio:['ignore','pipe','inherit']});
  let browser;
  try{
    const {url}=await new Promise((resolve,reject)=>{
      createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));
      fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));
    });
    browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking']});
    async function scene({pending=false,defer=false}={}){
      const page=await browser.newPage();
      await page.addInitScript(defer=>{
        window.media=[];window.playRejections=[];window.deferPlay=defer;
        window.Audio=class extends EventTarget{
          constructor(){super();this.src='';this.paused=true;window.media.push(this);}
          play(){this.paused=false;return window.deferPlay?new Promise((resolve,reject)=>window.playRejections.push(reject)):Promise.resolve();}
          pause(){this.paused=true;}
          load(){}
          removeAttribute(name){if(name==='src')this.src='';}
        };
      },defer);
      const state={pending,cancelled:[]};
      await page.route('**/api/speak/utt_*',route=>{
        const id=new URL(route.request().url()).pathname.split('/').at(-1);
        if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='cancel')state.cancelled.push(id);
        return route.fulfill({json:route.request().method()==='POST'?{ok:true}:{id,playback:false,state:'Ready',segment_count:3,segments:[0,1,2].map(index=>({index,audio_ready:!(state.pending&&index===1)}))}});
      });
      await page.goto(url+'#read='+encodeURIComponent('library/thought.md'));
      await page.locator('#speak-article').waitFor();
      const track=id=>page.evaluate(async id=>{
        const {trackSpeech}=await import('/assets/controls/reader-controls.js');
        trackSpeech({id,playback:false,state:'Queued',segment_count:3});
      },id);
      const control=page.locator('#speech-slot [data-speech-control]');
      await track('utt_'+ 'a'.repeat(32));
      await control.locator('[data-speech-label]',{hasText:'Speaking · 1 of 3'}).waitFor();
      return {page,state,track,control};
    }
    await t.test('a post-start media error stops playback with a retry instruction',async()=>{
      const {page,control}=await scene();
      try{
        await page.evaluate(()=>window.media.at(-1).dispatchEvent(new Event('error')));
        await control.waitFor({state:'detached',timeout:2000});
        await page.getByText(/Read aloud.*try again/).waitFor();
      }finally{await page.close();}
    });
    await t.test('a replaced utterance cannot pause or finish its successor',async()=>{
      const {page,control,track,state}=await scene({defer:true});
      try{
        await page.evaluate(()=>{window.oldMedia=window.media.at(-1);window.deferPlay=false;});
        await track('utt_'+ 'b'.repeat(32));
        await page.waitForFunction(()=>window.media.at(-1).src.includes('utt_'+ 'b'.repeat(32)));
        await page.evaluate(()=>{window.playRejections[0](new DOMException('replaced','AbortError'));window.oldMedia.dispatchEvent(new Event('error'));window.oldMedia.dispatchEvent(new Event('ended'));});
        await control.locator('[data-speech-label]',{hasText:'Speaking · 1 of 3'}).waitFor({timeout:2000});
        assert.equal(await page.evaluate(()=>window.media.at(-1).paused),false);
        assert.deepEqual(state.cancelled,['utt_'+ 'a'.repeat(32)],'replaced synthesis must be cancelled without cancelling its successor');
      }finally{await page.close();}
    });
    await t.test('Next stops the old segment while the selected segment is preparing',async()=>{
      const {page,control,state}=await scene({pending:true});
      try{
        await page.evaluate(()=>{window.oldMedia=window.media.at(-1);});
        await control.getByRole('button',{name:'Next segment'}).click();
        await control.locator('[data-speech-label]',{hasText:'Preparing speech'}).waitFor();
        assert.equal(await page.evaluate(()=>window.oldMedia.paused),true,'old segment must stop immediately');
        await page.evaluate(()=>window.oldMedia.dispatchEvent(new Event('ended')));
        state.pending=false;
        await control.locator('[data-speech-label]',{hasText:'Speaking · 2 of 3'}).waitFor();
        assert.match(await page.evaluate(()=>window.media.at(-1).src),/\/segments\/1$/);
      }finally{await page.close();}
    });
  }finally{
    await browser?.close();
    if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}
  }
});
