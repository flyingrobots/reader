/* File-tree navigation, exact read styling and mode colors on synthetic data. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
const THEMES=['ink','paper','orchid','orchid-dark','harvest','harvest-dark',...require('../src/reader_mcp/web_ui/famous-themes.json').themes.flatMap(t=>[t.id,t.id+'-dark'])];
(async()=>{
 const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--breadcrumbs'],{stdio:['ignore','pipe','inherit']});let browser;
 try{
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',line=>resolve(JSON.parse(line)));fixture.once('exit',code=>reject(new Error('Fixture exited '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  let page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const seen=page.waitForResponse(response=>response.url().endsWith('/api/seen')&&response.request().method()==='POST');
  await page.goto(url+'/#read='+encodeURIComponent('library/research/causal/notes/source.md'));await seen;
  await page.locator('#main').focus();await page.keyboard.press('Space');await page.keyboard.press('e');
  const tree=page.getByRole('tree',{name:'Documents'});await tree.waitFor();assert.equal(await page.locator('#picker-filter').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'file-results');
  assert.equal(await page.locator('[data-doc-node=file]').count(),1,'default remains recent files');assert.equal(await page.locator('[data-doc-node=file]').getAttribute('data-read'),'true');
  await page.keyboard.press('/');await page.locator('#file-query').fill('causal');await page.waitForFunction(()=>document.querySelectorAll('[data-doc-node=file]').length===4);
  const source=page.locator('[data-doc-node=file]').filter({hasText:'Causal note source'}),sibling=page.locator('[data-doc-node=file]').filter({hasText:'Causal note sibling'});
  assert.equal(await source.getAttribute('data-read'),'true');assert.equal(await sibling.getAttribute('data-read'),'false');
  const colors=await page.evaluate(()=>[...document.querySelectorAll('[data-doc-node=file]')].map(row=>({read:row.dataset.read,color:getComputedStyle(row.querySelector('[data-doc-title]')).color})));assert.notEqual(colors.find(row=>row.read==='true').color,colors.find(row=>row.read==='false').color,'read title is muted');
  await source.hover();await tree.focus();await page.keyboard.press('ArrowLeft');
  const folder=page.locator('[data-tree-folder="library/research/causal/notes"] > [data-doc-node=folder]');
  assert.equal(await tree.getAttribute('aria-activedescendant'),await folder.getAttribute('id'));await page.keyboard.press('h');assert.equal(await folder.getAttribute('aria-expanded'),'false');await sibling.waitFor({state:'hidden'});
  await page.keyboard.press('j');assert.notEqual(await tree.getAttribute('aria-activedescendant'),await sibling.getAttribute('id'),'collapsed children are skipped');await page.keyboard.press('k');await page.keyboard.press('l');assert.equal(await folder.getAttribute('aria-expanded'),'true');await sibling.waitFor();await page.keyboard.press('l');assert.equal(await tree.getAttribute('aria-activedescendant'),await source.getAttribute('id'));
  await page.screenshot({path:'.reader/web-dev/documents-tree.png'});
  const contrast=await page.evaluate(themes=>{
    const html=document.documentElement,mode=document.querySelector('#vim-mode'),originalTheme=html.dataset.theme,originalMode=mode.dataset.mode;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
    function rgb(value){context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].slice(0,3);}
    function lum(values){return values.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
    function ratio(a,b){const [lo,hi]=[lum(rgb(a)),lum(rgb(b))].sort((a,b)=>a-b);return (hi+.05)/(lo+.05);}
    const rows=[],linkCode=document.createElement('a');linkCode.href='#';linkCode.dataset.readerDecoration='';linkCode.innerHTML='<code>notes/folder</code>';document.querySelector('#article').append(linkCode);const still=document.createElement('style');still.textContent='*{transition:none!important}';document.head.append(still);
    for(const theme of themes){
      html.dataset.theme=theme;const backgrounds=[];let minimum=Infinity;
      for(const value of ['NORMAL','BROWSE','SEARCH','INSERT','LEADER','SETTINGS','HELP','THREAD']){mode.dataset.mode=value;const style=getComputedStyle(mode);backgrounds.push(style.backgroundColor);minimum=Math.min(minimum,ratio(style.color,style.backgroundColor));}
      const root=getComputedStyle(html);for(const background of ['--surface','--raised'])minimum=Math.min(minimum,ratio(root.getPropertyValue('--muted'),root.getPropertyValue(background)));
      // Inline code inside a link: its text against the background it is actually painted on.
      const code=linkCode.querySelector('code');let behind=code;while(behind&&['rgba(0, 0, 0, 0)','transparent'].includes(getComputedStyle(behind).backgroundColor))behind=behind.parentElement;
      const linkCodeRatio=ratio(getComputedStyle(code).color,getComputedStyle(behind||html).backgroundColor);minimum=Math.min(minimum,linkCodeRatio);
      rows.push({theme,minimum,linkCode:linkCodeRatio,distinct:new Set(backgrounds).size});
    }
    linkCode.remove();still.remove();html.dataset.theme=originalTheme;mode.dataset.mode=originalMode;return rows;
  },THEMES);for(const row of contrast){assert.equal(row.distinct,8,JSON.stringify(row));assert.ok(row.minimum>=4.5,JSON.stringify(row));}console.log(JSON.stringify(contrast));
  // Tree navigation alone never reads a file. Enter opens the selected sibling.
  await sibling.hover();await tree.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>decodeURIComponent(location.hash).includes('/sibling.md'));await page.waitForFunction(()=>!document.querySelector('.resume-pending'));
  await page.close();
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await context.addInitScript(()=>localStorage.setItem('reader.preferences.v1',JSON.stringify({participant:'Different reader'})));page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.locator('#home-title').waitFor();await page.keyboard.press('Space');await page.keyboard.press('e');await page.getByRole('tree',{name:'Documents'}).waitFor();assert.equal(await page.locator('[data-doc-node=file][data-read=true]').count(),0,'another participant has independent receipts');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'.reader/web-dev/documents-tree-mobile.png'});
  assert.deepEqual(errors,[]);console.log('Documents passed: actual Collapsible/Button tree, recent default, explicit filter, folder/Vim navigation, read/unread distinction, participant isolation, six-theme contrast and mobile fit.');
 }finally{await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
