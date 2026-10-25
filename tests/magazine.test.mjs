import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isoWeek,weekRange,issueWindow,currentIssue,issueWeeks,selectIssue,interest,candidates,minutes,section,parseExcluded,DEFAULT_EXCLUDED_TYPES} from '../src/reader_mcp/web_ui/magazine.mjs';

let n=0;
const work=(fields)=>({primary:`library/p/${++n}.md`,title:'Work '+n,authors:['Ada'],projects:['P'+n],types:['Essay'],date:'2026-10-21',primary_format:'.md',primary_bytes:6000,read:false,...fields});
const W43=issueWindow([],{week:'2026-W43'});

test('ISO weeks match the calendar across year boundaries',()=>{
  assert.deepEqual(isoWeek('2026-10-24'),{id:'2026-W43',start:'2026-10-19',end:'2026-10-25'});
  assert.equal(isoWeek('2027-01-01').id,'2026-W53');assert.equal(isoWeek('2026-01-01').id,'2026-W01');
  assert.equal(weekRange('2026-W43').start,'2026-10-19');assert.equal(weekRange('2025-W53'),null);assert.equal(weekRange('nonsense'),null);
});
test('an unread essay beats a newer read note for the cover',()=>{
  const essay=work({title:'Unread essay',date:'2026-10-20',types:['Essay']}),note=work({title:'Read note',date:'2026-10-24',types:['Note'],read:true});
  const filler=()=>work({types:['Note'],date:'2026-10-19'});const issue=selectIssue([note,essay,filler(),filler(),filler()],{window:{...W43,quiet:false},today:'2026-10-24'});
  assert.equal(issue.cover.work,essay);
});
test('features never repeat a project when alternatives exist, and relax only to fill three',()=>{
  const works=[work({projects:['Echo'],title:'Cover'}),work({projects:['Echo'],title:'Echo two'}),work({projects:['Echo'],title:'Echo three'}),work({projects:['Bijou']}),work({projects:['Edict']}),work({projects:['db8']}),work({projects:['Keep']})];
  const issue=selectIssue(works,{window:W43,today:'2026-10-24'});
  const projects=[issue.cover,...issue.features].map(entry=>entry.work.projects[0]);
  assert.equal(issue.features.length,4);assert.equal(new Set(projects).size,projects.length);
  const crowded=selectIssue([work({projects:['Echo']}),work({projects:['Echo']}),work({projects:['Echo']}),work({projects:['Echo']}),work({projects:['Echo']}),work({projects:['Bijou']})],{window:W43,today:'2026-10-24'});
  assert.equal(crowded.features.length,3,'relaxed to the minimum of three');assert.equal(crowded.features[0].work.projects[0],'Bijou');
  const unnamed=[work({projects:['Unspecified project'],primary:'library/asides/a.md'}),work({projects:[],primary:'library/reactions/b.md'})];
  assert.deepEqual(unnamed.map(section),['Asides','Reactions'],'works without a project use their top folder');
});
test('near-identical pieces and repeated titles are not featured twice',()=>{
  const a=work({title:'Same idea'}),b=work({title:'Same idea, retold'}),c=work({title:'Same idea'}),d=work({}),e=work({});
  const issue=selectIssue([a,b,c,d,e],{window:W43,today:'2026-10-24',near:[[a.primary,b.primary]]});
  const chosen=[issue.cover,...issue.features].map(entry=>entry.work);
  assert.ok(!(chosen.includes(a)&&chosen.includes(b)));assert.equal(issue.count,4,'a repeated title counts once');
});
test('ties break deterministically by date and then title',()=>{
  const make=()=>[work({title:'Beta',date:'2026-10-22',projects:['A']}),work({title:'Alpha',date:'2026-10-22',projects:['B']}),work({title:'Gamma',date:'2026-10-22',projects:['C']}),work({title:'Older',date:'2026-10-20',projects:['D'],primary_bytes:6000})];
  const forward=selectIssue(make(),{window:W43,today:'2026-10-24'}),backward=selectIssue(make().reverse(),{window:W43,today:'2026-10-24'});
  assert.equal(forward.cover.work.title,'Alpha');
  assert.deepEqual([forward.cover,...forward.features].map(e=>e.work.title),[backward.cover,...backward.features].map(e=>e.work.title));
  assert.deepEqual(forward.features.map(e=>e.work.title),['Beta','Gamma','Older']);
});
test('a quiet week widens to 14 days and says so',()=>{
  const works=[work({date:'2026-10-20'}),work({date:'2026-10-13'}),work({date:'2026-10-14'})];
  const window=issueWindow(works,{week:'2026-W43'});
  assert.deepEqual([window.start,window.end,window.quiet],['2026-10-12','2026-10-25',true]);
  assert.equal(selectIssue(works,{window,today:'2026-10-24'}).count,3);
  const busy=[...works,work({date:'2026-10-21'}),work({date:'2026-10-22'}),work({date:'2026-10-23'})];
  assert.equal(issueWindow(busy,{week:'2026-W43'}).quiet,false);
});
test('the bare homepage falls back to the latest issue when two weeks are empty',()=>{
  const works=[work({date:'2026-09-02'}),work({date:'2026-08-20'})];
  const issue=currentIssue(works,{today:'2026-10-24'});
  assert.equal(issue.fallback,true);assert.equal(issue.week,'2026-W36');
  assert.deepEqual(issueWeeks(works,{through:'2026-10-25'}).map(w=>[w.id,w.count]),[['2026-W36',1],['2026-W34',1]]);
});
test('excluded types and the newsletter folder never appear',()=>{
  const works=[work({types:['Task']}),work({types:['receipt']}),work({primary:'library/newsletters/2026-10-19/packet.md'}),work({types:['Essay']}),work({types:['Handoff']})];
  const issue=selectIssue(works,{window:W43,today:'2026-10-24'});
  assert.equal(issue.count,1);assert.deepEqual(candidates(works,{...W43,exclude:''}).length,4,'an empty list excludes no type');
  assert.deepEqual(parseExcluded(undefined),DEFAULT_EXCLUDED_TYPES);assert.deepEqual(parseExcluded(' Task, Memo ,'),['Task','Memo']);
});
test('interest terms are bounded and newsletter picks count',()=>{
  const piece=work({voices:9,threads:9,inbound:99,primary_bytes:60});
  const {terms}=interest(piece,{...W43,today:'2026-10-24',picks:new Set([piece.primary])});
  assert.equal(terms.engagement,.4);assert.equal(terms.references,.3);assert.equal(terms.pick,.5);assert.ok(terms.short<0&&terms.short>=-.3);
  assert.equal(minutes(work({primary_bytes:6*440}),220),2);assert.equal(minutes(work({primary_format:'.pdf'})),null);
});
test('contents group by section, unread first, with one-piece sections gathered past six',()=>{
  const works=[work({projects:['Echo'],title:'Cover'}),...['A','B','C','D'].map(p=>work({projects:[p],types:['Note'],date:'2026-10-19'})),
    work({projects:['Echo'],title:'Echo read',read:true}),work({projects:['Echo'],title:'Echo unread',types:['Note']}),
    ...['E','F','G','H','I','J','K'].map(p=>work({projects:[p],types:['Note']}))];
  const issue=selectIssue(works,{window:W43,today:'2026-10-24'});
  assert.deepEqual(issue.contents.map(g=>g.label),['Echo','Elsewhere']);
  assert.deepEqual(issue.contents[0].items.map(e=>e.work.title),['Echo unread','Echo read']);
  assert.equal(issue.contents[1].items.length,works.length-1-issue.features.length-2);
});
