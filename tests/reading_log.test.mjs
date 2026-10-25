import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LOG_NAMES, logEntries, readWhen, readingLogHTML, withYou} from '../src/reader_mcp/web_ui/reading-log.mjs';

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
  const html=readingLogHTML(data,now);
  assert.match(html,/◉<\/span> Agy 4 hours ago|◉<\/span> Agy today/);
  assert.match(html,/Reader librarian <span class="reading-log-earlier">\(earlier edition\)<\/span> Oct 12/);
  assert.match(html,/\+4 more/,'one named entry plus three folded agents remain');
  assert.match(html,/3 task agents/);assert.match(html,/data-reader-threads="Agy">2 threads/);
  assert.match(html,/data-against="v-Reader librarian"/,'earlier rows carry the hook for the change view');
  assert.ok(html.indexOf('Read this edition<')<html.indexOf('Read an earlier edition<'));
});
test('empty log, and your own read appears without reloading',()=>{
  const empty={participant:'You',version:'v',one_off_threshold:5,folded:0,readers:[]};
  assert.match(readingLogHTML(empty,now),/Not yet read by anyone\. You’ll be first\./);
  const mine=withYou(empty,now.toISOString());assert.deepEqual(mine.readers.map(r=>[r.group,r.state]),[['you','current']]);
  assert.match(readingLogHTML(mine,now),/You just now/);
  const after=withYou({...empty,readers:[reader('Agy','voice','current','2026-10-24T14:00:00Z'),reader('X','agent','current','2026-10-24T14:00:00Z'),reader('You','you','earlier','2026-10-01T00:00:00Z',{threads:1})]},now.toISOString());
  assert.deepEqual(after.readers.map(r=>r.participant+':'+r.state),['Agy:current','You:current','X:current']);assert.equal(after.readers[1].threads,1);
});
test('names are escaped',()=>{
  const html=readingLogHTML({participant:'You',version:'v',one_off_threshold:5,folded:0,readers:[reader('<img src=x>','agent','current','2026-10-24T14:00:00Z')]},now);
  assert.ok(!html.includes('<img'));
});
