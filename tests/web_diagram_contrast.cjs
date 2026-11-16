/* A label on a shape its author colored stays readable in every theme: at least 4.5:1, measured from what the browser computed. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const measure=()=>{const rgb=c=>c.match(/[\d.]+/g).slice(0,3).map(Number),lum=([r,g,b])=>[r,g,b].reduce((sum,v,i)=>{const c=v/255;return sum+[.2126,.7152,.0722][i]*(c<=.04045?c/12.92:((c+.055)/1.055)**2.4);},0);
  return [...document.querySelectorAll('.reader-diagram-canvas svg .pele-node')].map(node=>{const shape=node.querySelector('rect,path,polygon'),label=node.querySelector('text'),part=label.querySelector('tspan')||label;const a=lum(rgb(getComputedStyle(shape).fill)),b=lum(rgb(getComputedStyle(part).fill));return {text:label.textContent,fill:getComputedStyle(part).fill,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});};
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--diagrams'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1300,height:860}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'#read='+encodeURIComponent('library/diagram-colors.md'));await page.locator('.reader-diagram-canvas[data-state=ready]').waitFor();
  const themes=await page.evaluate(async()=>(await import('/assets/themes.mjs')).THEMES);assert.ok(themes.length>=20,'every shipped theme: '+themes.length);
  let fills=null;
  for(const theme of themes){
    await page.evaluate(name=>{document.documentElement.dataset.theme=name;},theme);
    const rows=await page.evaluate(measure);assert.equal(rows.length,7);
    for(const row of rows)assert.ok(row.ratio>=4.5,`${theme}: ${row.text} is ${row.ratio.toFixed(2)}:1`);
    fills??=rows;
    const same=rows.map(row=>row.fill);assert.deepEqual(same,fills.map(row=>row.fill),'the label does not depend on the theme');
  }
  assert.equal(fills.find(row=>row.text==='Deep blue').fill,'rgb(255, 255, 255)','a dark fill takes a light label');
  assert.equal(fills.find(row=>row.text==='Pale blue').fill,'rgb(0, 0, 0)','a pale fill takes a dark label');
  assert.equal(fills.find(row=>row.text==='White on pale').fill,'rgb(0, 0, 0)','an author color that fails is replaced');
  assert.equal(fills.find(row=>row.text==='Black on pale').fill,'rgb(0, 0, 0)','an author color that passes is kept');
  assert.deepEqual(errors,[]);
  console.log(`Diagram contrast passed: ${themes.length} themes, 7 authored fills, all at least 4.5:1.`);
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null)fixture.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
