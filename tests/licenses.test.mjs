import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {packageRoot,shippedInputs,writeLicenses} from '../web/licenses.mjs';

const pkg=(root,name,files={'LICENSE':'MIT '+name},extra={})=>{
  const dir=join(root,'node_modules',name);mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'package.json'),JSON.stringify({name,version:'1.0.0',license:'MIT',...extra}));
  for(const [file,text] of Object.entries(files))writeFileSync(join(dir,file),text);
  return dir;
};

test('only inputs with bytes in some output ship',()=>{
  const metafiles=[
    {inputs:{'node_modules/kept/a.js':{},'node_modules/shaken/b.js':{}},outputs:{'x.js':{inputs:{'node_modules/kept/a.js':{bytesInOutput:12},'node_modules/shaken/b.js':{bytesInOutput:0}}}}},
    {inputs:{},outputs:{'y.js':{inputs:{'node_modules/kept/a.js':{bytesInOutput:3},'src/own.ts':{bytesInOutput:9}}},'z.js':{inputs:{'node_modules/late/c.js':{bytesInOutput:1}}}}},
  ];
  assert.deepEqual(shippedInputs(metafiles),['node_modules/kept/a.js','node_modules/late/c.js','src/own.ts']);
});

test('the package root skips nested unnamed type markers',()=>{
  const root=mkdtempSync(join(tmpdir(),'reader-licenses-'));
  try{
    const dir=pkg(root,'@scope/thing');mkdirSync(join(dir,'dist/esm'),{recursive:true});
    writeFileSync(join(dir,'dist/esm/package.json'),'{"type":"module"}');
    assert.equal(packageRoot(join(dir,'dist/esm/index.js')),dir);
    assert.throws(()=>packageRoot(join(root,'orphan/index.js')),/Missing package metadata/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('the license folder is rebuilt: a removed dependency disappears',()=>{
  const root=mkdtempSync(join(tmpdir(),'reader-licenses-'));
  try{
    const out=join(root,'licenses');mkdirSync(out);
    writeFileSync(join(out,'removed-dependency-LICENSE'),'stale');
    const a=pkg(root,'@scope/kept',{'LICENSE.md':'MIT kept'}),b=pkg(root,'plain',{'license':'MIT plain','README.md':'no'});
    writeFileSync(join(root,'LICENSE.extra'),'extra');
    const deps=writeLicenses(out,[b,a,a],{'extra-LICENSE':join(root,'LICENSE.extra')});
    assert.deepEqual(Object.keys(deps),['@scope/kept','plain']);
    assert.deepEqual(deps.plain,{version:'1.0.0',license:'MIT'});
    assert.deepEqual(readdirSync(out).sort(),['@scope-kept-LICENSE.md','extra-LICENSE','plain-license']);
    assert.equal(readFileSync(join(out,'plain-license'),'utf8'),'MIT plain');
    assert.throws(()=>writeLicenses(out,[pkg(root,'unlicensed',{})]),/Missing license: unlicensed/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
