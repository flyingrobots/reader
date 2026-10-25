// The browser's scene validator (web_ui/art-scene.mjs) against the shared fixtures: the same verdicts and
// the very same error messages as the server's validator (src/reader_mcp/art_scene.py), case for case.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LIMITS,SceneError,parse,problems,triangles,validate} from '../src/reader_mcp/web_ui/art-scene.mjs';

const fixtures=new URL('./fixtures/art/',import.meta.url),demo=new URL('../src/reader_mcp/demo/content/art/',import.meta.url);
const read=url=>JSON.parse(readFileSync(url,'utf8'));
const sources={};
for(const name of readdirSync(new URL('valid/',fixtures)))sources[name.replace(/\.json$/,'')]=read(new URL('valid/'+name,fixtures));
for(const name of readdirSync(demo))sources[name.replace(/\.json$/,'')]=read(new URL(name,demo)).scene;

test('every valid fixture and every demo scene validates', ()=>{
  assert.ok(Object.keys(sources).length>=6);
  for(const [name,scene] of Object.entries(sources)){const {counts}=validate(scene);assert.ok(counts.nodes>=1,name);assert.ok(counts.triangles<=LIMITS.triangles,name);}
});

test('negative cases fail with the same errors as the server', ()=>{
  const cases=read(new URL('invalid.json',fixtures));assert.ok(cases.length>=40);
  for(const c of cases){const errors=problems(c.scene);assert.ok(errors.some(e=>e.includes(c.error)),`${c.name}: ${errors.join(' | ')}`);assert.deepEqual(errors,c.errors,c.name);}
});

// tests/art_fuzz.py records each mutation; this applies the same ones.
function apply(scene,m){let parent=scene;for(const step of m.path.slice(0,-1))parent=parent[step];const key=m.path.at(-1);
  if(m.op==='set')parent[key]=structuredClone(m.value);else if(m.op==='delete')delete parent[key];else if(m.op==='add')parent[m.key]=structuredClone(m.value);else parent.splice(key,0,structuredClone(parent[key]));}
test('fuzzed scenes: identical verdicts and errors in both validators, and nothing but SceneError', ()=>{
  const cases=read(new URL('fuzz.json',fixtures));assert.ok(cases.length>=300);
  for(const [i,c] of cases.entries()){const scene=structuredClone(sources[c.source]);for(const m of c.mutations)apply(scene,m);
    let errors=[];try{validate(scene);}catch(error){assert.ok(error instanceof SceneError,`case ${i} threw ${error}`);errors=error.errors;}
    assert.deepEqual(errors,c.errors,`case ${i} (${c.source})`);}
});

test('budgets the fixtures cannot carry compactly: nodes and vertices', ()=>{
  const box={type:'mesh',geometry:{type:'box'}};
  assert.match(problems({reader_scene:1,objects:Array(241).fill(box)})[0],/^objects: expected a list of 1 to 240 items/);
  const nested={reader_scene:1,objects:Array(8).fill({type:'group',children:Array(31).fill(box)})};
  assert.ok(problems(nested).includes('scene: 256 nodes exceed the budget of 240'));
  assert.match(problems({reader_scene:1,objects:[{type:'mesh',geometry:{type:'custom',vertices:Array(5000).fill([0,0,0]),faces:[[0,1,2]]}}]})[0],/vertices: expected a list of 3 to 4096 items/);
  assert.equal(problems({reader_scene:1,objects:Array(30).fill(box)}).length,0);
});

test('parse refuses oversized and malformed text; errors are capped', ()=>{
  assert.throws(()=>parse('{"reader_scene":1,"objects":[]'),/not valid JSON/);
  assert.throws(()=>parse(' '.repeat(LIMITS.bytes+1)),/bytes exceed/);
  const many={reader_scene:1,objects:Array.from({length:60},()=>({type:'mesh',geometry:{type:'sphere',radius:-1}}))};
  assert.equal(problems(many).length,LIMITS.errors);
});

test('triangle estimates are upper bounds of what the geometry factories build', ()=>{
  assert.equal(triangles({type:'sphere'}),2*32*16);
  assert.equal(triangles({type:'icosahedron',detail:2}),20*9);
  assert.equal(triangles({type:'plane',segments:[4,3]}),24);
  assert.equal(triangles({type:'custom',vertices:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,2]]}),1);
});
