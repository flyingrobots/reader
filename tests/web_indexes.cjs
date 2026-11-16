/* Indexes: truthful D3 geometry, shadcn composition, keyboard inspection, busy/unknown/error states and phone bounds. */
require('./jail_guard.cjs');
const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {createInterface}=require('node:readline');const {mkdirSync,readFileSync}=require('node:fs');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{let browser;const fixture=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py','--maintenance'],{stdio:['ignore','pipe','inherit']});
try{const {url}=await new Promise((resolve,reject)=>{createInterface({input:fixture.stdout}).once('line',s=>resolve(JSON.parse(s)));fixture.once('exit',c=>reject(Error('fixture '+c)));});
browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-gpu','--disable-background-networking','--disk-cache-size=10485760']});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/maintenance'))posts.push(r.postDataJSON());});
// Old observations must remain usable without a page visit silently starting an audit.
const now=new Date().toISOString(),check=(state,extra={})=>({state,checked_at:'2000-06-01T12:00:00Z',message:'Synthetic measurement',...extra});
let unavailable=false,status={running:null,checking:false,jobs:[{id:'done',kind:'check',label:'Freshness check',state:'succeeded',started_at:now,finished_at:now,elapsed_seconds:26,result:{search:'partial'}}],checks:{
search:check('partial',{text_documents:100,unembedded:25,documents:120,files:130,passages:1000,usage:{database:[250*2**20,1000*2**20],cache:[100*2**20,1000*2**20],passages:[1000,4000]}}),
browse:check('current',{works:120,changed:0}),catalog:check('current',{documents:120,usage:{files:[120,50000],sources:[500*2**20,2000*2**20]}}),links:check('stale',{new:4,changed:2}),
limits:check('over',{items:[{key:'works',label:'Works',used:12000,limit:10000},{key:'inbox',label:'Inbox files',used:null,limit:10000},{key:'threads',label:'Annotation threads',used:5,limit:100}]})},kinds:{}};
await page.route('**/api/maintenance',route=>route.request().method()==='GET'?route.fulfill({status:unavailable?503:200,json:unavailable?{error:'Synthetic offline'}:status}):route.fulfill({json:{id:'requested-'+posts.length,kind:route.request().postDataJSON().kind,label:'Synthetic requested job',state:'running',started_at:now,finished_at:null,elapsed_seconds:null,result:null,error:null}}));
await page.goto(url+'#admin/indexes');await page.locator('[data-index-chart=coverage] svg[role=group] path').first().waitFor();
assert.equal(posts.length,0,'opening Indexes with old measurements does not start maintenance');
assert.ok(await page.locator('[data-job=catalog]').isEnabled());assert.ok(await page.locator('[data-saved-measurements]').isVisible());
assert.match(await page.locator('#index-inspector [data-fact=checked]').textContent(),/2000/);
await page.locator('[data-admin-nav=settings]').click();await page.locator('#preferences-form').waitFor();
await page.locator('[data-admin-nav=indexes]').click();await page.locator('[data-index-fleet]').waitFor();
assert.equal(posts.length,0,'revisiting Indexes does not recheck already-stale results');
assert.equal(await page.locator('[data-index-chart=coverage] svg[role=group]').textContent().then(s=>s.includes('75%')),true);
assert.equal(await page.locator('#indexing-guide').count(),0,'inline guide moved to reference');
const openDocs=async()=>{await page.locator('#admin-doc-toggle').click();await page.locator('#admin-reference-pane').waitFor();},closeDocs=async()=>{await page.keyboard.press('Escape');await page.locator('#admin-reference-pane').waitFor({state:'hidden'});};
assert.ok(await page.locator('#admin-reference-pane').isHidden(),'documentation starts closed');assert.equal(await page.locator('#admin-doc-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#admin-dashboard-pane').count(),0,'no split pane');
assert.ok(await page.locator('[data-index-fleet]').evaluate(el=>el.getBoundingClientRect().width>800),'the dashboard has the full width');
await openDocs();await page.locator('#admin-doc-model-use-and-determinism').waitFor({state:'attached'});assert.deepEqual(await page.locator('#admin-doc-body h2').allTextContents(),[...readFileSync('docs/topics/indexes.md','utf8').matchAll(/^## (.+)$/gm)].map(match=>match[1]),'viewer renders canonical topic headings');assert.match(await page.locator('#admin-doc-body').textContent(),/no recurring index-rebuild schedule/);assert.equal(await page.getByRole('dialog',{name:'Indexes reference'}).count(),1,'documentation is a titled sheet');assert.equal(await page.locator('#admin-doc-toggle').getAttribute('aria-expanded'),'true');await closeDocs();assert.equal(await page.evaluate(()=>document.activeElement?.id),'admin-doc-toggle','Escape returns focus to the Docs button');


await page.getByRole('button',{name:'About Index update policy',exact:true}).click();await page.locator('#admin-reference-pane').waitFor();assert.equal(await page.locator('#admin-doc-toggle').getAttribute('aria-expanded'),'true','info icons open the reference');await closeDocs();
const leftTop=await page.evaluate(()=>scrollY);
await page.getByRole('button',{name:'About Index update policy',exact:true}).click();await page.locator('#admin-reference-pane').waitFor();assert.equal(await page.locator('#admin-reference-pane').getAttribute('data-doc-section'),'update-policy-and-schedules');await page.waitForFunction(()=>document.activeElement?.id==='admin-doc-update-policy-and-schedules');assert.ok(await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop>0));assert.equal(await page.evaluate(()=>scrollY),leftTop,'documentation navigation preserves dashboard position');
const links=await page.locator('[data-admin-doc-link]').evaluateAll(nodes=>nodes.map(node=>node.dataset.adminDocLink));assert.ok(await page.evaluate(ids=>ids.every(id=>!!document.getElementById('admin-doc-'+id)),links),'every info target resolves');
await page.locator('#admin-doc-contents').selectOption('embedding-model-and-privacy');assert.equal(await page.locator('#admin-reference-pane').getAttribute('data-doc-section'),'embedding-model-and-privacy');await page.waitForFunction(()=>document.activeElement?.id==='admin-doc-embedding-model-and-privacy');
await page.locator('#admin-doc-contents').selectOption('interactive-charts');await page.locator('#admin-doc-body a[href="#embedding-coverage"]').click();assert.equal(await page.locator('#admin-reference-pane').getAttribute('data-doc-section'),'embedding-coverage');assert.equal(new URL(page.url()).hash,'#admin/indexes','doc links preserve admin route');
await closeDocs();assert.equal(await page.locator('[data-index-fleet] [data-slot=table]').count(),1);assert.equal(await page.locator('[data-index-summary] [data-slot=card]').count(),3);
await page.getByRole('button',{name:'Needs embeddings: 25 text documents',exact:true}).click({position:{x:30,y:30}});assert.match(await page.locator('[data-index-chart=coverage] [role=status]').textContent(),/25 needs embeddings/);
await openDocs();const docTop=await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop);assert.ok(docTop>0,'the reference reopens where it was left');await closeDocs();await openDocs();assert.equal(await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop),docTop,'close/open preserves reference position');await closeDocs();const budget=page.getByRole('button',{name:/^Catalog sources:/});await budget.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#index-inspector').getAttribute('data-inspected-index'),'catalog');await openDocs();assert.equal(await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop),docTop,'inspector updates preserve documentation scroll');await closeDocs();
await page.getByRole('tab',{name:'Inventories',exact:true}).click();const works=page.getByRole('button',{name:/^Works: 12,000 of 10,000/});await works.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#index-inspector').getAttribute('data-inspected-index'),'limits');
assert.equal(await page.getByRole('button',{name:/^Inbox files:/}).count(),0,'unknown usage is omitted, not zero');assert.ok((await works.textContent()).includes('120.0%'),'over-budget value is honest');
await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'About Index update policy',exact:true}).click();assert.equal(await page.locator('#admin-reference-pane').getAttribute('data-doc-section'),'update-policy-and-schedules');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone page fits');assert.ok(await page.locator('#admin-reference-pane').evaluate(el=>el.getBoundingClientRect().width>=innerWidth-1),'the sheet fills a phone');mkdirSync('.reader/web-dev',{recursive:true});await page.screenshot({path:'.reader/web-dev/indexes-phone.png',fullPage:true});await closeDocs();
await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'.reader/web-dev/indexes-dashboard.png',fullPage:true});assert.equal(posts.length,0,'chart interactions never launch rebuilds');
await page.getByRole('button',{name:'About Index update policy',exact:true}).click();assert.equal(await page.locator('#admin-reference-pane').getAttribute('data-doc-section'),'update-policy-and-schedules');await closeDocs();
await Promise.all([page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/maintenance')),page.locator('[data-index-fleet] [data-rebuild-status=search]').click()]);assert.equal(posts.at(-1)?.kind,'search','status button starts the complete search rebuild');
const saved=status;
status={...status,checks:{},jobs:[]};await page.reload();await page.locator('[data-index=search][data-state=unknown]').waitFor();
assert.ok(await page.locator('[data-job=catalog]').isEnabled(),'unmeasured indexes can be updated directly');
assert.equal(posts.length,1,'an empty measurement cache does not start a full audit');
await Promise.all([page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/maintenance')),page.locator('#maintenance-check').click()]);
assert.equal(posts.at(-1)?.kind,'check','a full check remains explicitly available');
status=saved;
status={...status,running:{id:'active',kind:'check',label:'Freshness check',state:'running',started_at:new Date(Date.now()-23000).toISOString()},checking:false};await page.reload();await page.locator('[data-index-busy]').waitFor();assert.ok(await page.locator('#maintenance-check').isDisabled());assert.ok(await page.locator('[data-job=catalog]').isDisabled());assert.ok(await page.locator('[data-index-fleet] [data-rebuild-status=search]').isDisabled());assert.match(await page.locator('#backstage-indexes').textContent(),/Checking freshness/);assert.ok(await page.getByRole('button',{name:'Needs embeddings: 25 text documents',exact:true}).isVisible(),'cached measurements stay visible during checking');
status={...status,checking:true,running:{...status.running,progress:'Checking Browse indexes (2/5)'}};await page.reload();await page.getByRole('status').filter({hasText:'Checking Browse indexes (2/5)'}).first().waitFor();
status={...status,checks:{}};await page.reload();await page.locator('[data-index-busy]').waitFor();assert.equal(await page.locator('[data-index-chart=coverage] svg[role=group]').count(),0);assert.match(await page.locator('[data-index-chart=capacity]').textContent(),/Missing values are not zero/);
unavailable=true;await page.reload();await page.locator('#indexes-unavailable').waitFor();assert.ok(await page.locator('[data-job=search]').isDisabled());
await page.reload();await page.locator('#admin-doc-toggle').waitFor();await page.locator('#admin-reference-pane').waitFor({state:'attached'});assert.ok(await page.locator('#admin-reference-pane').isHidden(),'documentation reopens closed after a reload');
unavailable=false;status=saved;await page.setViewportSize({width:1440,height:1000});await page.goto(url+'#admin');await page.reload();await page.locator('#admin-overview').waitFor();await page.locator('[data-overview=attention][data-state=ready] [data-slot=table]').waitFor();assert.equal(await page.locator('#admin-reference-pane').getAttribute('data-doc-topic'),'overview','reference follows Admin navigation');
// Overview leads with the summary and the attention table, from the same synthetic checks: partial, current, current, stale, over.
assert.equal(await page.locator('[data-overview-summary]').count(),4,'four summary cards');
assert.match(await page.locator('[data-overview-summary=attention]').textContent(),/3/);assert.match(await page.locator('[data-overview-summary=indexes]').textContent(),/2 of 5/);
assert.deepEqual(await page.locator('[data-attention-subject]').allTextContents(),['Search index','Link graph','Other inventories'],'each problem is a table row');
assert.match(await page.locator('[data-attention=check-links]').textContent(),/Needs rebuild/);await page.locator('[data-attention=check-links] a').waitFor();
assert.equal(await page.locator('[data-overview=indexes] tbody tr').count(),5,'index health is a table');assert.equal(await page.locator('[data-check=links]').getAttribute('data-state'),'stale');
assert.match(await page.locator('[data-admin-nav-badge=indexes]').textContent(),/3/,'the sidebar counts index problems');
await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overview fits a phone');assert.ok(await page.locator('[data-attention=check-links] a').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'each problem can be opened on a phone without sideways scrolling');await page.setViewportSize({width:1440,height:1000});
// Every registered section has its own canonical reference, including unavailable backend pages.

for(const topic of ['overview','jobs','logs','repositories','voices','models','inbox','indexes','artwork','library','service','settings']){
  await page.locator('[data-admin-nav="'+topic+'"]').click();
  await page.waitForFunction(topic=>document.querySelector('#admin-reference-pane')?.dataset.docTopic===topic,topic);
  assert.equal(await page.locator('#admin-workspace').count(),1,'one shared workspace for '+topic);
  await openDocs();
  assert.deepEqual(await page.locator('#admin-doc-body h2').allTextContents(),[...readFileSync('docs/topics/'+topic+'.md','utf8').matchAll(/^## (.+)$/gm)].map(match=>match[1]),topic+' canonical headings');
  await closeDocs();
  const targets=await page.locator('[data-admin-doc-link]').evaluateAll(nodes=>nodes.map(node=>node.dataset.adminDocLink));
  assert.ok(await page.evaluate(ids=>ids.every(id=>!!document.getElementById('admin-doc-'+id)),targets),topic+' help targets resolve');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),topic+' fits desktop');
}
await openDocs();await page.locator('#admin-doc-contents').selectOption('troubleshooting');await page.waitForFunction(()=>document.activeElement?.id==='admin-doc-troubleshooting');
const settingsTop=await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop);assert.ok(settingsTop>0);await closeDocs();
await page.locator('[data-admin-nav="indexes"]').click();await page.waitForFunction(()=>document.querySelector('#admin-reference-pane')?.dataset.docTopic==='indexes');
assert.equal(await page.locator('#admin-reference-pane').getAttribute('data-doc-section'),'update-policy-and-schedules','section restored across navigation');
await page.locator('[data-admin-nav="settings"]').click();await page.waitForFunction(()=>document.querySelector('#admin-reference-pane')?.dataset.docTopic==='settings');
await openDocs();assert.equal(await page.locator('#admin-reference-pane').getAttribute('data-doc-section'),'troubleshooting');assert.ok(Math.abs(await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop)-settingsTop)<2,'per-section scroll restored');await closeDocs();

await openDocs();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'shared reference fits phone');await closeDocs();
await page.setViewportSize({width:1440,height:1000});await page.locator('[data-admin-nav="indexes"]').click();await openDocs();await page.locator('#admin-doc-contents').selectOption('update-policy-and-schedules');await page.waitForFunction(()=>document.activeElement?.id==='admin-doc-update-policy-and-schedules');
const rememberedTop=await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop);assert.ok(rememberedTop>0);
await closeDocs();await page.locator('[data-admin-nav="settings"]').click();await page.locator('[data-admin-nav="indexes"]').click();await openDocs();
assert.ok(Math.abs(await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop)-rememberedTop)<2,'hidden reference preserves position across topic navigation');
await closeDocs();await page.reload();await page.locator('#admin-doc-toggle').waitFor();await openDocs();assert.ok(Math.abs(await page.locator('#admin-doc-body').evaluate(el=>el.scrollTop)-rememberedTop)<2,'closed reference preserves position across reload');
assert.deepEqual(errors,[]);console.log('Indexes passed: D3 measured coverage and budgets, shadcn cards/table/tabs, keyboard and click inspection, no rebuild from charts, unknown and over-budget values, cached busy state, unavailable state and mobile bounds.');
}finally{await browser?.close();if(fixture.exitCode===null){fixture.kill('SIGTERM');await new Promise(r=>fixture.once('exit',r));}}})().catch(e=>{console.error(e);process.exitCode=1;});
