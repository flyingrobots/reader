import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weeklyArrivals,groupWorks,sizeBand} from '../src/reader_mcp/web_ui/dashboard.mjs';

test('weekly arrivals use UTC filing dates and exclude undated and older holdings',()=>{
  const works=[{primary:'a',date:'2026-10-19'},{primary:'b',date:'2026-10-18'},{primary:'c',date:null},{primary:'d',date:'2025-01-01'}];
  const bins=weeklyArrivals(works,'2026-10-23',2);
  assert.deepEqual(bins.map(bin=>[bin.key,bin.value,bin.works.map(work=>work.primary)]),[['2026-10-12',1,['b']],['2026-10-19',1,['a']]]);
});
test('coauthors are credited separately without repeating a work or inventing an author',()=>{
  const works=[{primary:'a',authors:['Ada','Bo','Ada']},{primary:'b',authors:['Ada']},{primary:'c',authors:[]}];
  assert.deepEqual(groupWorks(works,'authors',{multiple:true}).map(row=>[row.label,row.value]),[['Ada',2],['Bo',1],['Unspecified',1]]);
  assert.equal(groupWorks(works,'authors').reduce((n,row)=>n+row.value,0),3);
});
test('source byte sizes keep unknown data distinct from an empty source',()=>{
  assert.equal(sizeBand({primary_bytes:0}),'Under 10 KiB');assert.equal(sizeBand({}),'Unknown');assert.equal(sizeBand({primary_bytes:1048576}),'1 MiB or more');
});
