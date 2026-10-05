import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelationshipIndex, editorialKind, recordedDate, sortRows, filterRows, inboxItems, matchingParts } from '../src/model.ts';
import type { DocumentRecord, Citation } from '../src/model.ts';
const a = 'library/project/a.md', b = 'library/project/b.md';
const uuid = '12345678-1234-1234-1234-123456789abc';
const citation = (target: string | null, label = 'Reference'): Citation => ({ target, label, link: target ?? 'missing.md', line: 4, excerpt: 'This source distinguishes retention from permission.' });
const doc = (path: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({ path, title: path.split('/').pop()!, links: [], ...extra });
const connection = (path: string, targets: (string | null)[]) => doc(path, { kind: 'Connection', links: targets.map(t => citation(t)) });
test('connection provides the exact evidence; a reaction does not create co-citation edges', () => {
  const c = connection('library/connections/c.md', [a,b]);
  const r = doc('library/reactions/r.md', { kind: 'Reaction', readingScope: 'Pages 1–6', links: [citation(a),citation('library/project/unrelated.md')] });
  const result = new RelationshipIndex([doc(a),doc(b),c,r]).query(a);
  assert.equal(result.notes.length, 2); assert.deepEqual(result.related.map(x => x.path), [b]);
  assert.equal(result.related[0].evidence[0].note,c.path);
  assert.equal(result.notes.find(x => x.path === r.path)?.evidence[0].readingScope, 'Pages 1–6');
});
test('multiple connections combine evidence while distinct editions keep distinct identities', () => {
  const c = connection('library/connections/c.md',[a,b]);
  const d = connection('library/connections/d.md',[a,b,'library/project/b-v2.md']);
  const result = new RelationshipIndex([doc(a),doc(b),doc('library/project/b-v2.md'),c,d]).query(a);
  assert.equal(result.related.length,2); assert.equal(result.related.find(x=>x.path===b)?.evidence.length,2);
});
test('primary receipt context does not leak into attachments', () => {
  const wrapper = 'library/project/package/index.md', source = 'library/project/package/report.pdf', attachment = 'library/project/package/chart.png';
  const note = connection('library/connections/c.md',[wrapper,b]);
  const index = new RelationshipIndex([doc(wrapper),doc(source),doc(attachment),doc(b),note],[{wrapper,original:source}]);
  assert.equal(index.query(source).notes[0].evidence[0].context,'About this document’s catalog');
  assert.equal(index.query(attachment).notes.length,0);
});
test('placeholder and explicit reading original resolve, without merging catalog identity', () => {
  const sidecar = 'catalog/metadata/project/a.md.md', wrapper = 'library/project/index-entry.md', reading = 'library/project/reading/a.md';
  const index = new RelationshipIndex([doc(a),doc(sidecar,{id:uuid,ownerTarget:a}),doc(wrapper),doc(reading,{original:a}),connection('library/connections/c.md',[a,b]),doc(b)],[{wrapper,original:a}]);
  assert.equal(index.query(sidecar).subject,a);
  assert.equal(index.query(reading).related[0].path,b);
  assert.notEqual(index.resolver.key(wrapper),index.resolver.key(a));
});
test('duplicate identities remain exact-file results with conflict evidence', () => {
  const c=connection('library/connections/c.md',[a,b]);
  const index=new RelationshipIndex([doc(a,{id:uuid}),doc(b,{id:uuid}),c]);
  assert.equal(index.query(a).problems.length,2);
  assert.notEqual(index.resolver.key(a),index.resolver.key(b));
});
test('conflicting placeholders never pick a winner', () => {
  const p='catalog/metadata/a.md', q='catalog/metadata/b.md';
  const index=new RelationshipIndex([doc(a),doc(p,{ownerTarget:a,id:uuid}),doc(q,{ownerTarget:a,id:'22345678-1234-1234-1234-123456789abc'})]);
  assert.deepEqual(index.query(p).problems.sort(),[p,q]);
  assert.equal(index.query(p).subject,p);
});
test('deleted targets retain recorded evidence, and collection navigation is excluded', () => {
  const c=connection('library/connections/c.md',[a,null,'library/index.md','library/project/index.md']);
  const result=new RelationshipIndex([doc(a),c]).query(a);
  assert.equal(result.related.length,1); assert.equal(result.related[0].path,null);
  assert.equal(result.related[0].evidence[0].link,'missing.md');
});
test('authorship and editorial location are required', () => {
  assert.equal(editorialKind('library/connections/c.md','Reader librarian'),'Connection');
  assert.equal(editorialKind('library/connections/c.md','Source author'),undefined);
  assert.equal(editorialKind('library/connections/index.md','Reader librarian'),undefined);
  assert.equal(editorialKind('library/project/source.md','Reader librarian'),undefined);
});
test('changed graph removes stale relationships and updates renamed targets', () => {
  const c=connection('library/connections/c.md',[a,b]);
  assert.equal(new RelationshipIndex([doc(a),doc(b),c]).query(a).related.length,1);
  const renamed='library/project/new.md';c.links=[citation(a),citation(renamed)];
  const updated=new RelationshipIndex([doc(a),doc(renamed),c]);
  assert.equal(updated.query(a).related[0].path,renamed);
  assert.equal(updated.query(b).notes.length,0);
  assert.equal(new RelationshipIndex([doc(a)]).query(a).notes.length,0);
});
test('a connection itself exposes the documents it explicitly cites', () => {
  const c=connection('library/connections/c.md',[a,b]);
  const result=new RelationshipIndex([doc(a),doc(b),c]).query(c.path);
  assert.equal(result.notes.length,0); assert.equal(result.related.length,2);
});

test('date order uses UTC days and timestamps, unknown times last within day, undated last', () => {
  const row = (key: string, value?: string) => ({ key, path: key, title: key, evidence: [], date: recordedDate(value) });
  const rows = [row('unknown'), row('day', '2026-10-03'), row('later','2026-10-03T02:00:00Z'), row('earlier','2026-10-02T18:00:00-07:00'),row('first','2026-10-01')];
  assert.deepEqual(sortRows(rows).map(r=>r.key), ['first','earlier','later','day','unknown']);
  assert.equal(recordedDate('2026-02-30'),undefined);
  assert.equal(recordedDate('2026-10-03T12:00:00'),undefined);
});
test('ingestion dates remain distinct from document and modified dates', () => {
  const index = new RelationshipIndex([doc(a,{arrivalDate:'2026-10-04T01:00:00Z',documentDate:'2020-01-01',modified:'2026-10-05T00:00:00Z'})]);
  assert.equal(index.resolver.date(a,'arrival')?.day,'2026-10-04');
  assert.equal(index.resolver.date(a,'document')?.day,'2020-01-01');
  assert.equal(index.resolver.date(a,'modified')?.day,'2026-10-05');
});
test('name and path filtering covers hidden rows without changing their order', () => {
  const rows = ['Zebra','Alpha','Beta'].map(title=>({title,key:title,path:`library/project/${title}.md`,evidence:[]}));
  assert.deepEqual(filterRows(rows,'PROJECT a').map(r=>r.title),['Zebra','Alpha','Beta']);
  assert.deepEqual(filterRows(rows,'alpha').map(r=>r.title),['Alpha']);
  assert.deepEqual(filterRows(rows,'absent'),[]);
  assert.deepEqual(filterRows(rows,'  '),rows);
});

test('inbox counts arrivals once and ignores guide, hidden files, and other folders',()=>{
 assert.deepEqual(inboxItems(['inbox/README.md','inbox/.DS_Store','inbox/bundle/report.md','inbox/bundle/assets/a.png','inbox/direct.pdf','library/x.md','inbox/.staging/x.md']),['bundle','direct.pdf']);
});

test('search marks preserve text, ignore case, and treat regex characters literally',()=>{
 const parts=matchingParts('A C++ engine uses <tags> and c++ again.','c++ <tags>');
 assert.equal(parts.map(p=>p.text).join(''),'A C++ engine uses <tags> and c++ again.');
 assert.deepEqual(parts.filter(p=>p.match).map(p=>p.text),['C++','<tags>','c++']);
 assert(!matchingParts('Meaning without literal words','paraphrase').some(p=>p.match));
});
