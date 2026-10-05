import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, copyFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'reader-install-'));
  const project=join(root,'software/plugins/reader'),vault=join(root,'vault'),dest=join(vault,'.obsidian/plugins/reader');
  await mkdir(join(project,'dist'),{recursive:true});await mkdir(dest,{recursive:true});
  await copyFile(resolve('install.mjs'),join(project,'install.mjs'));
  try{await copyFile(resolve('settings.mjs'),join(project,'settings.mjs'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await writeFile(join(project,'dist/manifest.json'),JSON.stringify({id:'reader',version:'test'}));
  await writeFile(join(project,'dist/LICENSE'),'Apache-2.0 fixture');
  await writeFile(join(project,'dist/main.js'),'// fixture');await writeFile(join(project,'dist/styles.css'),'/* fixture */');
  const settings=JSON.stringify({participant:'A reader',codexPath:'/example/tool',dateMode:'arrival'});
  await writeFile(join(dest,'data.json'),settings);
  return {root,project,vault,dest,settings};
}

test('interrupted settings writes preserve the previous settings bytes',async()=>{
  const f=await fixture();
  try{
    const preload=join(f.root,'fail-write.mjs');
    await writeFile(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const original=fs.promises.writeFile;
fs.promises.writeFile=async(path,data,...args)=>{if(String(path).includes('data.json')){await original(path,'{"partial":');throw new Error('Injected write interruption');}return original(path,data,...args);};syncBuiltinESMExports();`);
    const result=spawnSync(process.execPath,['--import',preload,join(f.project,'install.mjs'),f.vault],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Injected write interruption/);
    assert.equal(await readFile(join(f.dest,'data.json'),'utf8'),f.settings);
    assert.deepEqual((await readdir(f.dest)).filter(x=>x.endsWith('.tmp')),[]);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('installer preserves preferences and binds the separate code root',async()=>{
  const f=await fixture();try{
    const result=spawnSync(process.execPath,[join(f.project,'install.mjs'),f.vault],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const data=JSON.parse(await readFile(join(f.dest,'data.json'),'utf8'));
    assert.equal(data.participant,'A reader');assert.equal(data.codexPath,'/example/tool');
    assert.equal(data.backendRoot,join(f.root,'software'));
  }finally{await rm(f.root,{recursive:true,force:true});}
});
