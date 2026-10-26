/* Status line priority (#74), using only a disposable synthetic vault: items give way by their declared
   data-status-priority, lowest first, so an extra item never pushes the mode or Backstage off screen. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT || 'playwright-core');

(async()=>{
 const fixture=spawn(process.env.READER_PYTHON || '.venv/bin/python',['tests/web_fixture.py','--breadcrumbs'],{stdio:['ignore','pipe','inherit']});
 let browser;
 try {
  const {url}=await new Promise((resolve,reject)=>{const lines=createInterface({input:fixture.stdout});lines.once('line',line=>{lines.close();try{resolve(JSON.parse(line));}catch(error){reject(error);}});fixture.once('exit',code=>reject(new Error('Fixture exited: '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disable-breakpad','--disable-crash-reporter','--disk-cache-size=10485760','--media-cache-size=1048576']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/#read='+encodeURIComponent('library/research/causal/notes/source.md'));
  await page.locator('#article p').first().waitFor();await page.waitForTimeout(500);
  // Every status item declares its priority, so a new item has to choose where it gives way.
  const crowd=()=>page.evaluate(()=>{const line=document.querySelector('#statusline'),box=e=>e.getBoundingClientRect();
    const children=[...line.children].filter(e=>e.id!=='reading-progress'&&!e.classList.contains('sr-only'));
    const shown=children.filter(e=>getComputedStyle(e).display!=='none'&&box(e).width>0);
    const overlaps=[];for(let i=0;i<shown.length;i++)for(let j=i+1;j<shown.length;j++){const a=box(shown[i]),b=box(shown[j]);if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5)overlaps.push(shown[i].id+'/'+shown[j].id);}
    const rank=e=>Number(e.dataset.statusPriority??99),gaveWay=children.filter(e=>e.hasAttribute('data-status-hidden'));
    // Content spilling out of its own box (a crushed mode label) overlaps visually even when boxes do not.
    const squeezed=shown.filter(e=>e.id!=='status-location'&&getComputedStyle(e).overflowX==='visible'&&e.scrollWidth>e.clientWidth+1).map(e=>e.id);
    return {squeezed,offscreen:shown.filter(e=>box(e).right>innerWidth+.5||box(e).left<-.5).map(e=>e.id),overlaps,
      essentials:['vim-mode','status-location','settings-open'].filter(id=>!shown.some(e=>e.id===id)),
      outOfOrder:gaveWay.filter(e=>shown.some(s=>rank(s)>rank(e))).map(e=>e.id),
      undeclared:children.filter(e=>!e.dataset.statusPriority&&!e.id.startsWith('synthetic-')).map(e=>e.id),
      shown:shown.map(e=>e.id),gaveWay:gaveWay.map(e=>e.id),scroll:document.documentElement.scrollWidth<=innerWidth+1};});
  const expectFits=async(label,widths=[700,390,320])=>{const seen={};for(const width of widths){await page.setViewportSize({width,height:844});await page.waitForTimeout(250);const got=await crowd();seen[width]=got;
    assert.deepEqual({squeezed:got.squeezed,offscreen:got.offscreen,overlaps:got.overlaps,essentials:got.essentials,outOfOrder:got.outOfOrder,scroll:got.scroll},{squeezed:[],offscreen:[],overlaps:[],essentials:[],outOfOrder:[],scroll:true},`${label} at ${width} px: nothing overlaps or leaves the viewport, the mode, breadcrumb and Backstage stay, and items give way lowest priority first (shown ${got.shown.join(' ')}; gave way ${got.gaveWay.join(' ')})`);}
    return seen;};
  // A synthetic extra item of middling priority, as another feature branch would add, in both layouts.
  await page.evaluate(()=>{const extra=document.createElement('span');extra.id='synthetic-extra';extra.dataset.statusPriority='3';extra.style.cssText='flex:none;width:60px;white-space:nowrap';extra.textContent='Extra item';document.querySelector('#layout-swap').before(extra);});
  await page.locator('#layout-swap').click();await page.waitForFunction(()=>document.body.classList.contains('two-page'));await page.waitForTimeout(450);
  const spread=await expectFits('two-page status line with an extra item');
  assert.ok(spread[700].shown.includes('synthetic-extra'),'there is room for the extra item at 700 px');
  assert.ok(spread[390].shown.includes('pagination-slot'),'pagination outranks the extra item at 390 px');
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(250);
  assert.deepEqual((await crowd()).gaveWay,[],'at desktop width every item comes back');
  await page.locator('#layout-swap').click();await page.waitForFunction(()=>!document.body.classList.contains('two-page'));await page.waitForTimeout(450);
  await expectFits('scrolling status line with an extra item');
  // An item that declares no priority gives way before every declared one.
  await page.evaluate(()=>{const loose=document.createElement('span');loose.id='synthetic-undeclared';loose.style.cssText='flex:none;width:80px';loose.textContent='Undeclared';document.querySelector('#settings-open').before(loose);});
  const loose=await expectFits('an undeclared item',[390]);
  assert.ok(loose[390].gaveWay.includes('synthetic-undeclared'),'an undeclared item gives way at 390 px');
  assert.deepEqual(loose[390].undeclared,[],'every built-in status item declares data-status-priority');
  // The breadcrumb's folder menu still opens above the line and stays on screen.
  const nav=page.getByRole('navigation',{name:'Document breadcrumb'});await nav.locator('summary').click();const menu=await nav.getByRole('menu').boundingBox();
  assert.ok(menu.x>=0&&menu.x+menu.width<=390,'the folder menu stays within the viewport');await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log('Status priority acceptance passed: declared priorities, lowest gives way first, no overlap or overflow at 700/390/320 px in both layouts.');
 } finally {await browser?.close();if(fixture.exitCode===null&&fixture.signalCode===null){fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
