// reader:prompt v1 (RW-44) in the browser: the shared corpus, a generated agreement corpus, rendering and mounting.
// tests/test_prompt_blocks.py runs the same corpus and the generated cases through the server parser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {mathPlugin} from '../src/reader_mcp/web_ui/math.mjs';
import {calloutPlugin} from '../src/reader_mcp/web_ui/callouts.mjs';
import {embedPlugin} from '../src/reader_mcp/web_ui/embeds.mjs';
import {promptPlugin, findPrompts, flatJson, metadata, promptMounts, MAX_PROMPT} from '../src/reader_mcp/web_ui/prompt-blocks.mjs';
import {generate} from './fixtures/prompt-blocks/generate.mjs';

const markdownit=createRequire(import.meta.url)('../src/reader_mcp/web_ui/vendor/markdown-it.min.js');
// The app's parser (app.mjs): the same options and plugins, in the same order.
const reader=()=>markdownit({html:true,linkify:true,breaks:false}).use(mathPlugin).use(calloutPlugin).use(embedPlugin).use(promptPlugin);
const corpus=JSON.parse(readFileSync(new URL('./fixtures/prompt-blocks/corpus.json',import.meta.url),'utf8'));
const agreement=JSON.parse(readFileSync(new URL('./fixtures/prompt-blocks/agreement.json',import.meta.url),'utf8'));
function scan(markdown){const env={prompts:{}};reader().parse(markdown,env);return env.prompts;}

test('the shared corpus: exactly the authoring format makes a card; forgeries and fallbacks do not',()=>{
  for(const entry of corpus){
    const found=scan(entry.markdown);
    assert.deepEqual(found.blocks.map(b=>b.id),entry.blocks,entry.name);
    assert.deepEqual(found.rejected.map(r=>[r.line,r.reason]),entry.rejected,entry.name);
  }
});

test('the generated agreement corpus matches what the server parser recorded',()=>{
  const fresh=generate();
  assert.equal(fresh.length,agreement.length,'regenerate agreement.json with: node tests/fixtures/prompt-blocks/generate.mjs --write');
  fresh.forEach((markdown,index)=>{
    const found=scan(markdown),expected=agreement[index];
    assert.equal(markdown,expected.markdown,'generator drift at case '+index);
    assert.deepEqual(found.blocks.map(b=>[b.id,b.line,b.endLine,b.prompt]),expected.blocks,'case '+index+':\n'+markdown);
    assert.deepEqual(found.rejected.map(r=>[r.line,r.reason]),expected.rejected,'case '+index+':\n'+markdown);
  });
  assert.ok(agreement.some(e=>e.blocks.length)&&agreement.some(e=>e.rejected.length)&&agreement.some(e=>!e.blocks.length&&!e.rejected.length));
});

test('an oversized prompt stays ordinary code',()=>{
  const big='<!-- reader:prompt {"v":1,"id":"big","title":"Big","repo":"acme/widget","issue":null} -->\n```text\n'+'x'.repeat(MAX_PROMPT)+'\n```\n<!-- /reader:prompt -->\n';
  assert.deepEqual(scan(big).rejected.map(r=>r.reason),['prompt-size']);
  assert.deepEqual(scan(big.replace('x'.repeat(MAX_PROMPT)+'\n','x'.repeat(MAX_PROMPT-1)+'\n')).blocks.map(b=>b.id),['big']);
});

test('the strict metadata reader refuses what JSON.parse would accept loosely',()=>{
  assert.deepEqual(flatJson('{"a":1,"b":null,"c":"x"}'),Object.assign(Object.create(null),{a:1,b:null,c:'x'}));
  for(const bad of ['{"a":1,"a":2}','{"a":1.0}','{"a":1e3}','{"a":true}','{"a":[1]}','{"a":1,}','[1]','{"a":01}','{"__proto__":1,"__proto__":2}'])assert.equal(flatJson(bad),null,bad);
  assert.deepEqual(metadata('{"v":1,"id":"ok","title":"T","repo":"acme/widget","issue":null}')[1],null);
});

test('rendering: a valid block is wrapped with this render\'s nonce; its markers vanish; invalid blocks stay code',()=>{
  const md=reader(),env={prompts:{}};
  const html=md.render(corpus[0].markdown+'\n'+corpus.find(c=>c.name==='unknown version').markdown.replace('bound-parser-depth','other'),env);
  assert.match(env.prompts.nonce,/^[0-9a-f]{24}$/);
  assert.equal((html.match(/data-reader-prompt="/g)||[]).length,1);
  assert.ok(html.includes(`data-reader-prompt="${env.prompts.nonce}:0"`));
  assert.ok(!html.includes('reader:prompt {"v":1,"id":"bound'),'a valid marker renders as nothing');
  assert.ok(html.includes('<!-- reader:prompt {"v":2'),'an unknown version keeps its comment, hidden by the browser');
  assert.equal((html.match(/<pre>/g)||[]).length,2,'both prompts remain readable code');
  // Without env.prompts (embeds, chat, scratch) nothing is wrapped.
  assert.ok(!md.render(corpus[0].markdown,{}).includes('data-reader-prompt'));
});

test('mounting: only wrappers with the render\'s nonce mount, each once; forged attributes are ignored',()=>{
  const prompts={nonce:'abc',blocks:[{id:'a'},{id:'b'}]};
  const element=value=>({getAttribute:()=>value});
  const list=[element('abc:0'),element('abc:0'),element('zzz:1'),element('abc:7'),element('abc:1'),element('abc:x')];
  const container={querySelectorAll:()=>list};
  assert.deepEqual(promptMounts(container,prompts).map(m=>m.block.id),['a','b']);
  assert.deepEqual(promptMounts(container,{}),[]);
});

test('findPrompts works on raw tokens without the plugin',()=>{
  const md=markdownit({html:true});const src=corpus[0].markdown;
  assert.deepEqual(findPrompts(md.parse(src,{}),src).blocks.map(b=>b.id),['bound-parser-depth']);
});
