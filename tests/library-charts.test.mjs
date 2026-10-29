import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrivalCalendar,readingTopics,shelfHierarchy} from '../src/reader_mcp/web_ui/library-charts.mjs';
import {localizeLibrary} from '../src/reader_mcp/web_ui/logic.mjs';

test('calendar conserves current-window works across Monday, year and leap-day boundaries',()=>{
  const works=['2024-02-26','2024-02-29','2024-03-03','2024-03-04','2024-02-25',null,'bad','2024-02-30'].map((date,i)=>({primary:String(i),date}));
  const rows=arrivalCalendar(works,'2024-03-03',1);
  assert.equal(rows.length,7);assert.equal(rows[0].weekday,0);assert.equal(rows.at(-1).weekday,6);
  assert.deepEqual(rows.filter(row=>row.value).map(row=>row.key),['2024-02-26','2024-02-29','2024-03-03']);
  assert.equal(arrivalCalendar(works,'2024-02-30').length,0);
  assert.equal(arrivalCalendar([],'2027-01-01',1)[0].key,'2026-12-28');
});
test('arrival instants use the reader’s local day before calendar grouping',()=>{
  const data=localizeLibrary({today:'2026-10-24',works:[{primary:'one',date:'2026-10-24',arrival_time:'2026-10-24T01:00:00Z'}]},new Date('2026-10-24T01:00:00Z'),'America/Los_Angeles');
  const rows=arrivalCalendar(data.works,data.today);
  assert.equal(data.today,'2026-10-23');assert.equal(rows.at(-1).value,1);assert.equal(rows.at(-1).key,'2026-10-23');
});
test('topic stacks count every grouped work exactly once including missing topics and remainder collisions',()=>{
  const works=Array.from({length:12},(_,i)=>({primary:String(i),topics:i===0?[]:[i===1?'Other topics':'Topic '+i,'Secondary'],read:i%2===0}));
  const rows=readingTopics(works,4);
  assert.equal(rows.length,4);assert.equal(rows.reduce((n,row)=>n+row.value,0),works.length);
  assert.deepEqual(rows.flatMap(row=>row.segments.flatMap(segment=>segment.works)).map(w=>w.primary).sort(),works.map(w=>w.primary).sort());
  for(const row of rows){assert.equal(row.segments.reduce((n,segment)=>n+segment.value,0),row.value);}
  assert.equal(new Set(rows.map(row=>row.key)).size,4);
});
test('shelves preserve duplicate titles, unusual labels, and unspecified metadata as distinct works',()=>{
  const works=[{primary:'a',title:'Same',topics:['__proto__'],projects:['<b>']},{primary:'b',title:'Same',topics:['__proto__'],projects:['<b>']},{primary:'c',title:'No labels',topics:[],projects:[]}];
  const tree=shelfHierarchy(works),leaves=tree.children.flatMap(topic=>topic.children.flatMap(project=>project.children));
  assert.deepEqual(leaves.map(leaf=>leaf.work.primary).sort(),['a','b','c']);assert.equal(leaves.every(leaf=>leaf.value===1),true);
  assert.equal(tree.children.some(topic=>topic.name==='Unspecified topic'),true);
  assert.deepEqual(shelfHierarchy([]),{name:'All shelves',children:[]});
});
