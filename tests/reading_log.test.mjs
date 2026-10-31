import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LOG_NAMES, logEntries, readWhen, readingLogModel, withYou} from '../src/reader_mcp/web_ui/reading-log.mjs';

const now=new Date('2026-10-24T18:00:00Z');
const reader=(participant,group,state,at,extra={})=>({participant,group,state,at,version:'v-'+participant,threads:0,folded:false,...extra});

test('relative read times within a week, then dates',()=>{
  assert.equal(readWhen('2026-10-24T17:59:30Z',now),'just now');
  assert.equal(readWhen('2026-10-24T17:20:00Z',now),'40 min ago');
  assert.equal(readWhen(new Date(now-3*864e5).toISOString(),now),'3 days ago');
  assert.equal(readWhen('2026-10-12T09:00:00Z',now),'Oct 12');
});
test('collapsed line: up to four entries, folded agents as one, then +N more',()=>{
  const data={participant:'You',version:'v',one_off_threshold:5,folded:3,readers:[
    reader('Agy','voice','current','2026-10-24T14:00:00Z',{threads:2}),reader('Reader librarian','voice','earlier','2026-10-12T09:00:00Z'),
    reader('You','you','current','2026-10-24T17:00:00Z'),reader('Steady','agent','current','2026-10-20T09:00:00Z'),reader('Late','agent','earlier','2026-10-01T09:00:00Z'),
    ...['a','b','c'].map(n=>reader(n,'agent','current','2026-10-02T09:00:00Z',{folded:true}))]};
  assert.equal(logEntries(data).length,6);assert.equal(LOG_NAMES,4);
  const model=readingLogModel(data,now);
  const agy=model.entries[0];assert.equal(agy.label,'Agy');assert.equal(agy.state,'current');assert.match(agy.when,/hours ago|today/);
  const librarian=model.entries[1];assert.equal(librarian.label,'Reader librarian');assert.ok(librarian.earlier);assert.equal(librarian.when,'Oct 12');
  assert.equal(model.more,4,'one named entry plus three folded agents remain');
  assert.equal(model.agents.title,'3 task agents');
  assert.equal(model.groups.flatMap(g=>g.rows).find(r=>r.participant==='Agy').threads,2);
  assert.equal(model.groups.find(g=>g.state==='earlier').rows[0].against,'v-Reader librarian','earlier rows carry the hook for the change view');
  assert.deepEqual(model.groups.map(g=>g.title),['Read this edition','Read an earlier edition']);
  assert.match(model.summary,/^Reading log: Agy, Reader librarian, earlier edition, You, Steady, and 4 more$/);
});
test('empty log, and your own read appears without reloading',()=>{
  const empty={participant:'You',version:'v',one_off_threshold:5,folded:0,readers:[]};
  assert.equal(readingLogModel(empty,now).empty,true);
  const mine=withYou(empty,now.toISOString());assert.deepEqual(mine.readers.map(r=>[r.group,r.state]),[['you','current']]);
  const you=readingLogModel(mine,now).entries[0];assert.deepEqual([you.label,you.when],['You','just now']);
  const after=withYou({...empty,readers:[reader('Agy','voice','current','2026-10-24T14:00:00Z'),reader('X','agent','current','2026-10-24T14:00:00Z'),reader('You','you','earlier','2026-10-01T00:00:00Z',{threads:1})]},now.toISOString());
  assert.deepEqual(after.readers.map(r=>r.participant+':'+r.state),['Agy:current','You:current','X:current']);assert.equal(after.readers[1].threads,1);
});
test('names stay plain text for React to escape',()=>{
  const model=readingLogModel({participant:'You',version:'v',one_off_threshold:5,folded:0,readers:[reader('<img src=x>','agent','current','2026-10-24T14:00:00Z')]},now);
  assert.equal(model.entries[0].label,'<img src=x>');
});
