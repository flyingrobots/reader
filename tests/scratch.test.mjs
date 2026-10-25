import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slugify,titleOf,wordCount,citation,blockAt} from '../src/reader_mcp/web_ui/scratch.mjs';

test('slugs and titles for a draft',()=>{
  assert.equal(slugify('On splits: two panes, één idee!'),'on-splits-two-panes-een-idee');
  assert.equal(slugify('—'),'untitled');assert.equal(slugify('x'.repeat(80)).length,60);
  assert.match(slugify('a-'.repeat(40)),/^[a-z0-9-]{1,60}$/);assert.ok(!slugify('a-'.repeat(40)).endsWith('-'));
  assert.equal(titleOf('Intro line\n\n## The real title ##\n'),'The real title');
  assert.equal(titleOf('> quoted start\nmore'),'quoted start');assert.equal(titleOf('\n\n'),'Untitled');
  assert.equal(wordCount('Two panes, one idea — isn’t it? 42'),7);
});

test('a citation quotes the passage and links it from the notebook',()=>{
  assert.equal(citation({quote:'a precise\npassage',path:'library/essays/x y.md',title:'An [odd] title'}),'> a precise\n> passage\n>\n> — [An odd title](../essays/x%20y.md)\n\n');
  assert.equal(citation({quote:'loose',path:null,title:null}),'> loose\n>\n> — Source\n\n');
});

test('the preview block for a cursor offset is the innermost one, else the next',()=>{
  const blocks=[{id:'quote',start:'10',end:'60'},{id:'para',start:'12',end:'30'},{id:'tail',start:'70',end:'90'}];
  assert.equal(blockAt(blocks,15).id,'para');assert.equal(blockAt(blocks,40).id,'quote');
  assert.equal(blockAt(blocks,65).id,'tail');assert.equal(blockAt(blocks,95),null);
});
