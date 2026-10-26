import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UNDECLARED,givingOrder,rank} from '../src/reader_mcp/web_ui/status-priority.mjs';

const item=(id,priority)=>({id,dataset:priority===undefined?{}:{statusPriority:String(priority)}});

test('a status item without a usable priority ranks below every declared one', () => {
  assert.equal(rank(item('a',3)),3);
  for(const bad of [undefined,'',0,-2,'soon'])assert.equal(rank(item('x',bad)),UNDECLARED);
});

test('items give way largest priority first, rightmost first within a priority, and priority 1 never', () => {
  const line=[item('mode',1),item('crumb',1),item('pages',2),item('section',6),item('loose'),item('layout',2),item('prose',4),item('theme',4),item('backstage',1)];
  assert.deepEqual(givingOrder(line).map(element=>element.id),['loose','section','theme','prose','layout','pages']);
});
