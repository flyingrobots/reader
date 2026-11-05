/* Publish in every shipped theme: text reads at WCAG AA and control borders at 3:1, measured from what the browser computed, composited over what is behind them. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const measure=()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const paint=canvas.getContext('2d',{willReadFrequently:true});
  const parse=color=>{paint.clearRect(0,0,1,1);paint.fillStyle=color;paint.fillRect(0,0,1,1);const d=paint.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255];};
  const over=(top,under)=>[0,1,2].map(i=>top[i]*top[3]+under[i]*(1-top[3]));
  const lum=c=>c.slice(0,3).reduce((sum,v,i)=>{const x=v/255;return sum+[.2126,.7152,.0722][i]*(x<=.04045?x/12.92:((x+.055)/1.055)**2.4);},0);
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const behind=element=>{const layers=[];for(let node=element;node;node=node.parentElement){const c=parse(getComputedStyle(node).backgroundColor);if(c[3]>0){layers.push(c);if(c[3]===1)break;}}let under=[255,255,255];for(const c of layers.reverse())under=over(c,under);return under;};
  const failures=[];let text=0,controls=0;
  for(const element of document.querySelectorAll('#backstage-publish *')){
    if(!element.getClientRects().length)continue;const style=getComputedStyle(element);if(style.visibility==='hidden')continue;
    if([...element.childNodes].some(node=>node.nodeType===3&&node.textContent.trim())&&!element.closest('[disabled],[aria-disabled=true],[data-disabled]')){
      text++;const back=behind(element),r=ratio(over(parse(style.color),back),back),size=parseFloat(style.fontSize),need=size>=24||size>=18.66&&+style.fontWeight>=700?3:4.5;
      if(r<need)failures.push(`${element.textContent.trim().slice(0,40)}: ${r.toFixed(2)}:1`);}
    if(element.matches('[data-slot=checkbox]:not([data-checked]),[data-slot=radio-group-item]:not([data-checked]),[data-slot=input]')){
      controls++;const back=behind(element.parentElement),r=ratio(over(parse(style.borderTopColor),back),back);
      if(r<3)failures.push(`${element.dataset.slot} border: ${r.toFixed(2)}:1`);}
  }
  return {failures,text,controls};
};
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--inbox'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  await page.goto(url+'#admin/publish');await page.locator('#backstage-publish [data-slot=input]').first().waitFor();
  // Colors mid-transition would be measured as neither theme.
  await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});await page.mouse.move(2,2);
  const themes=await page.evaluate(async()=>(await import('/assets/themes.mjs')).THEMES);assert.ok(themes.length>=20);
  const failed={};let seen;
  for(const theme of themes){
    await page.evaluate(name=>{document.documentElement.dataset.theme=name;},theme);await page.evaluate(()=>new Promise(requestAnimationFrame));
    seen=await page.evaluate(measure);assert.ok(seen.text>10&&seen.controls>=2,'the page rendered');if(seen.failures.length)failed[theme]=seen.failures;
  }
  assert.deepEqual(failed,{});
  console.log(`Theme contrast passed: ${themes.length} themes, ${seen.text} text elements and ${seen.controls} controls each.`);
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null)fixture.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
