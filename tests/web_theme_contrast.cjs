/* Every surface in every shipped theme: text reads at WCAG AA and control borders at 3:1, measured from what the browser computed and composited over what is
   behind it. Text over images is skipped, because no single background color exists to measure against. Hover and focus states aren't covered.
   READER_CONTRAST_ONLY=name limits a run to surfaces whose names contain it. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {readdirSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const measure=()=>{const cv=document.createElement('canvas');cv.width=cv.height=1;const x=cv.getContext('2d',{willReadFrequently:true});const parse=c=>{x.clearRect(0,0,1,1);x.fillStyle=c;x.fillRect(0,0,1,1);const d=x.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255];};
const lum=c=>c.slice(0,3).reduce((s,v,i)=>{const k=v/255;return s+[.2126,.7152,.0722][i]*(k<=.04045?k/12.92:((k+.055)/1.055)**2.4);},0),ratio=(a,b)=>{const A=lum(a),B=lum(b);return (Math.max(A,B)+.05)/(Math.min(A,B)+.05);},over=(t,u)=>[0,1,2].map(i=>t[i]*t[3]+u[i]*(1-t[3]));
const behind=e=>{const L=[];let image=false;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.backgroundImage!=='none'&&!/^(html|body)$/i.test(n.tagName))image=true;const c=parse(s.backgroundColor);if(c[3]>0){L.push(c);if(c[3]===1)break;}}let u=parse(getComputedStyle(document.documentElement).backgroundColor).slice(0,3);for(const c of L.reverse())u=over(c,u);return {u,image};};
const sig=e=>{const path=[];for(let n=e,i=0;n&&i<3;n=n.parentElement,i++)path.unshift((n.dataset?.slot)||(n.id&&!/\d{3}/.test(n.id)?'#'+n.id:'')||n.tagName.toLowerCase()+(n.getAttribute('class')?'.'+String(n.getAttribute('class')).split(/\s+/).filter(c=>!/[:\[\]/]/.test(c))[0]:''));return path.join('>').slice(0,90);};
const vis=e=>{if(!e.getClientRects().length)return false;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.visibility==='hidden'||s.display==='none'||+s.opacity===0)return false;}return true;};
const dimmed=e=>{let o=1;for(let n=e;n;n=n.parentElement)o*=+getComputedStyle(n).opacity;return o;};
const fails=[];let text=0,ctrl=0,skippedImage=0,hasModal=[...document.querySelectorAll('[data-reader-modal],[role=dialog],#help:not([hidden]),[data-slot=dialog-content],[data-slot=sheet-content]')].find(m=>{if(m.matches('[data-closed]'))return false;const r=m.getBoundingClientRect();return r.width>40&&r.height>40&&r.left<innerWidth&&r.right>0&&vis(m);});
for(const e of document.querySelectorAll('body *')){if(e.closest('[aria-hidden=true]:not(svg)')||e.closest('script,style,noscript'))continue;if(hasModal&&!hasModal.contains(e)&&!e.closest('[data-slot=sonner]'))continue;if(!vis(e))continue;
const s=getComputedStyle(e),own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
if(own&&!e.closest('[disabled],[aria-disabled=true],[data-disabled]')&&!e.closest('.sr-only,[data-slot=skeleton]')&&!(s.clip&&s.clip!=='auto')&&s.clipPath!=='inset(50%)'){text++;const svg=e.closest('svg');const b=behind(svg?svg.parentElement:e);if(b.image){skippedImage++;}else{const fg=parse(svg&&s.fill!=='none'?s.fill:s.color);if(svg&&s.stroke!=='none'&&s.paintOrder.startsWith('stroke'))b.u=parse(s.stroke).slice(0,3);fg[3]*=dimmed(e);const r=ratio(over(fg,b.u),b.u),sz=parseFloat(s.fontSize),need=sz>=24||(sz>=18.66&&+s.fontWeight>=700)?3:4.5;if(r<need)fails.push({k:'text',r:+r.toFixed(2),need,sig:sig(e),t:e.textContent.trim().slice(0,30),});}}
if(e.matches('[data-slot=checkbox]:not([data-checked]),[data-slot=radio-group-item]:not([data-checked]),[data-slot=input],[data-slot=textarea],[data-slot=select-trigger],[data-slot=native-select],[data-slot=input-group],[data-slot=combobox-trigger]')&&!e.closest('[disabled],[data-disabled]')&&!e.matches('[disabled]')){ctrl++;const b=behind(e.parentElement),w=parseFloat(s.borderTopWidth);const c=w>0?over(parse(s.borderTopColor),b.u):b.u,r=ratio(c,b.u);if(r<3)fails.push({k:'control',r:+r.toFixed(2),need:3,sig:sig(e),t:e.dataset.slot});}
if(e.matches('[data-slot=switch][data-unchecked]')){ctrl++;const b=behind(e.parentElement),c=over(parse(s.backgroundColor),b.u),r=ratio(c,b.u);if(r<3)fails.push({k:'control',r:+r.toFixed(2),need:3,sig:sig(e),t:'switch'});}}
return {fails,text,ctrl,skippedImage};};

const key=(...keys)=>async page=>{await page.locator('#main').focus().catch(()=>{});for(const name of keys)await page.keyboard.press(name);};
const command=name=>async page=>{await page.locator('#main').focus().catch(()=>{});await page.keyboard.press(':');await page.keyboard.type(name);await page.keyboard.press('Enter');await page.waitForTimeout(700);};
const click=selector=>async page=>{await page.locator(selector).first().click({timeout:8000});};
const SECTIONS=['overview','jobs','logs','publish','encrypted','inbox','library','indexes','artwork','repositories','voices','models','service','settings'];
const admin=prefix=>SECTIONS.map(section=>({name:prefix+section,route:'#admin'+(section==='overview'?'':'/'+section),ready:'#admin-title'}));
const article='#read=library%2Fthought.md';
const PASSES=[
 {flags:['--maintenance','--inbox','--dashboard','--search-page','--queue','--magazine','--diagrams'],surfaces:()=>[...admin('admin-'),
  {name:'admin-docs',route:'#admin/publish',ready:'#admin-title',steps:[click('#admin-doc-toggle')],wait:'#admin-reference-pane'},
  {name:'theme-editor',route:'#admin/settings',ready:'#theme-editor-open',steps:[click('#theme-editor-open')],wait:'[data-reader-modal],[role=dialog][data-open]'},
  {name:'home',route:'#',ready:'#home-title'},{name:'search',route:'#search',ready:'#search-query'},{name:'results',route:'#search='+encodeURIComponent('q=observation'),ready:'[data-work]'},
  {name:'article',route:article,ready:'#article'},{name:'queue',route:article,ready:'#article',steps:[key('Space','r')],wait:'#queue-panel:not([hidden]) [data-queue-row]'},
  {name:'picker',route:'#',ready:'#home-title',steps:[key('Space','e')],wait:'#picker:not([hidden])'},{name:'help',route:'#',ready:'#home-title',steps:[key('Shift+Slash')],wait:'#help'},
  {name:'find',route:article,ready:'#article',steps:[key('/')],wait:'#find-query'},{name:'issue',route:'#issue=2026-W43',ready:'.issue-cover'},
  {name:'diagrams',route:'#read=library%2Fdiagrams.md',ready:'.reader-diagram-canvas[data-state=ready]'},
  {name:'diagram-dialog',route:'#read=library%2Fdiagrams.md',ready:'.reader-diagram-canvas[data-state=ready]',steps:[click('.reader-diagram-canvas[data-state=ready]')],wait:'#diagram-body > svg'}]},
 {flags:['--coding','--companions','--local-model','--service','--art','--chat','--reading-log','--writing','--callouts','--code-blocks','--math','--prose','--shapes','--links','--outline','--inbox','--maintenance','--magazine','--dashboard','--queue'],surfaces:root=>[...admin('data-'),
  ...readdirSync(root+'/library',{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.md')&&!/^(sample|related|citer)-/.test(entry.name)).slice(0,40).map(entry=>({name:'doc-'+entry.name,route:'#read='+encodeURIComponent('library/'+entry.name),ready:'#article'})),
  ...['art','changes','chat','colors','files','grep','layout','marks','outline','registers','shape','speak','themes','threads','versions','zen'].map(name=>({name:':'+name,route:article,ready:'#article',steps:[command(name)]}))]},
];
(async()=>{let browser;const failed=[];let themes,measured=0,count=0;
 browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu']});
 try{for(const pass of PASSES){
  const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py',...pass.flags],{stdio:['ignore','pipe','inherit']});
  try{const {url,root}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
   const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addInitScript(value=>{try{localStorage.setItem('reader.preferences.v1',value);}catch{}},JSON.stringify({smooth:false,theme:'ink'}));
   for(const surface of pass.surfaces(root).filter(item=>!process.env.READER_CONTRAST_ONLY||item.name.includes(process.env.READER_CONTRAST_ONLY))){const page=await context.newPage();count++;
    await page.goto(url+'/'+surface.route);await page.locator(surface.ready).first().waitFor({timeout:30000});
    // Colors mid-transition would be measured as neither theme.
    await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});await page.waitForTimeout(900);
    for(const step of surface.steps||[])await step(page);if(surface.wait)await page.locator(surface.wait).first().waitFor({timeout:15000});await page.mouse.move(2,2);await page.waitForTimeout(300);
    themes??=await page.evaluate(async()=>(await import('/assets/themes.mjs')).THEMES);
    for(const theme of themes){await page.evaluate(name=>{document.documentElement.dataset.theme=name;},theme);await page.waitForTimeout(40);
     const result=await page.evaluate(measure);assert.ok(result.text>0,`${surface.name} measured no text`);measured+=result.text+result.ctrl;
     for(const fail of result.fails)failed.push(`${surface.name} ${theme}: ${fail.sig} "${fail.t}" ${fail.r}:1, needs ${fail.need}:1`);}
    await page.close();}
   await context.close();
  }finally{if(fixture.exitCode===null&&fixture.signalCode===null)fixture.kill('SIGTERM');}}
  assert.ok(themes.length>=20);assert.equal(failed.length,0,`${failed.length} contrast failures:\n${[...new Set(failed)].slice(0,40).join('\n')}`);
  console.log(`Theme contrast passed: ${count} surfaces in ${themes.length} themes, ${measured} measurements.`);
 }finally{await browser?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
