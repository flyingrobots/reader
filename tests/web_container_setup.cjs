/* Real browser/UI with synthetic API responses. Checks pinned approval and inference consent,
   stale-preview invalidation, literal verification argv and absence of implicit job admission. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {chromium}=require(process.env.READER_PLAYWRIGHT||'playwright-core');
(async()=>{
 let browser,child;
 try{
  child=spawn(process.env.READER_PYTHON||'.venv/bin/python',['tests/web_fixture.py'],{stdio:['ignore','pipe','inherit']});
  const {url}=await new Promise((resolve,reject)=>{createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l)));child.once('exit',code=>reject(new Error('fixture exit '+code)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROME||'/usr/bin/chromium',args:['--no-sandbox','--disable-background-networking']});
  const page=await browser.newPage({viewport:{width:1300,height:1000}}),posts=[],jobPosts=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const revision='a'.repeat(40),config={name:'acme/widget coding job',image:'reader-coding:local',remoteUser:'root',userEnvProbe:'none'};
  let missing=true,registered=null;
  await page.route('**/api/repositories*',async route=>{
   const request=route.request(),body=request.method()==='POST'?request.postDataJSON():null;
   if(body)posts.push(body);
   let result={configured:!!registered,error:null,repositories:[]};
   if(body?.action==='discover-container')result={repo:body.repo,ref:body.base,base_sha:revision,state:missing?'missing':'found',configurations:missing?[]:[{path:'.devcontainer/devcontainer.json',blob_sha:'b'.repeat(40)}]};
   if(body?.action==='infer-container'){
    result={repo:body.repo,revision,path:null,blob_sha:null,sha256:'c'.repeat(64),configuration:config,inferred:true,consent:true,manifests:['package.json'],assumptions:['Synthetic assumption']};
   }
   if(body?.action==='select-container')result={repo:body.repo,revision,path:body.path,blob_sha:'b'.repeat(40),sha256:'d'.repeat(64),configuration:config,inferred:false};
   if(body?.action==='register'){registered=body;result={...result,registered:body.repo};}
   await route.fulfill({json:result});
  });
  await page.route('**/api/jobs',async route=>{if(route.request().method()==='POST'){jobPosts.push(route.request().postDataJSON());await route.abort();}else await route.continue();});
  await page.goto(url+'#admin/repositories');
  await page.getByLabel('GitHub repository',{exact:true}).fill('acme/widget');
  await page.getByRole('button',{name:'Inspect GitHub configuration',exact:true}).click();
  const infer=page.getByRole('button',{name:'Infer configuration',exact:true});await infer.waitFor();
  assert.equal(await infer.isDisabled(),true);
  assert.equal(posts.filter(p=>p.action==='infer-container').length,0);
  await page.getByRole('checkbox',{name:'Allow inference for this inspected revision'}).check();await infer.click();
  await page.getByLabel('Configuration to approve').waitFor();
  await page.getByLabel('Prepared local image identity').fill('sha256:'+'e'.repeat(64));
  await page.getByLabel('Workstation git-locks store').fill('/synthetic/workstation.git');
  await page.getByLabel('Container verification command, one argument per line').fill('python3\n-c\nprint("a b")');
  await page.getByRole('button',{name:'Approve registration',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-repository-message]')?.textContent.includes('Configured acme/widget'));
  assert.ok(registered);assert.equal(registered.entry.environment.revision,revision);
  assert.equal(registered.entry.environment.consent,true);
  assert.ok(!('manifests' in registered.entry.environment)&&!('assumptions' in registered.entry.environment)&&!('repo' in registered.entry.environment));
  assert.ok(!('checkout' in registered.entry)&&!('worktree_root' in registered.entry));
  assert.deepEqual(registered.entry.verify.argv,['python3','-c','print("a b")']);
  await page.getByLabel('Base branch',{exact:true}).fill('next');
  assert.equal(await page.getByLabel('Configuration to approve').count(),0);
  assert.equal(await page.getByRole('button',{name:'Approve registration',exact:true}).isDisabled(),true);
  missing=false;
  await page.getByRole('button',{name:'Inspect GitHub configuration',exact:true}).click();
  await page.getByRole('button',{name:'Review configuration',exact:true}).click();
  await page.getByLabel('Configuration to approve').waitFor();
  assert.equal(posts.filter(p=>p.action==='infer-container').length,1,'existing configuration is selected without inference');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'form fits phone width');
  const inferred=posts.filter(p=>p.action==='infer-container');
  assert.equal(inferred.length,1);assert.equal(inferred[0].consent,true);assert.equal(inferred[0].revision,revision);
  assert.deepEqual(jobPosts,[],'setup must not admit a job');
  assert.deepEqual(errors,[]);console.log('web_container_setup: ok');
 }finally{await browser?.close();child?.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exit(1);});
