import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fromCodex, reduce, reduceAll, emptyActivity, parseTests, parseCommit, commandTitle, citations, truncate, steps, queue, MAX_LINES} from '../web/src/activity/reducer.ts';

const load=name=>readFileSync(new URL('fixtures/'+name,import.meta.url),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
const real=load('codex-exec-real.jsonl'),scripted=load('codex-exec-scripted.jsonl');

test('a synthetic transcript in the shape of a Codex 0.163.0 inbox run becomes messages, tools and a file change',()=>{
  const activity=reduceAll(real);
  assert.equal(activity.session,'0199a2b3-0000-7000-8000-000000000001');
  assert.deepEqual(activity.items.map(i=>i.kind),['message','tool','message','tool','tool','tool','files','tool']);
  const tools=activity.items.filter(i=>i.kind==='tool');
  assert.deepEqual(tools.map(t=>[t.id,t.status,t.exitCode]),[['item_1','completed',0],['item_8','completed',0],['item_9','completed',0],['item_10','completed',0],['item_18','failed',125]]);
  // Interleaved starts and completions update their own items in place.
  assert.ok(tools[2].title.startsWith('/code/.venv/bin/python -m reader_mcp.cli'),tools[2].title);
  assert.match(tools[4].output.full,/"event":"with-failed"/);
  assert.deepEqual(activity.items[6].changes,[{path:'/tmp/reader-demo-intake.py',kind:'add'}]);
});

test('the scripted sequence yields every component kind, parsed tests, plan progress and a commit checkpoint',()=>{
  const activity=reduceAll(scripted);
  const kinds=new Set(activity.items.map(i=>i.kind));
  for(const kind of ['message','reasoning','tool','files','plan','mcp','sources','error','checkpoint'])assert.ok(kinds.has(kind),kind);
  const plan=activity.items.find(i=>i.kind==='plan');
  assert.deepEqual(plan.steps.map(s=>s.done),[true,true,true],'todo_list updates replace the plan in place');
  const pytest=activity.items.find(i=>i.id==='item_8');
  assert.deepEqual({...pytest.tests,failures:pytest.tests.failures.map(f=>f.name)},{runner:'pytest',passed:3,failed:1,skipped:1,failures:['tests/test_catalog.py::test_catalog_links']});
  assert.equal(pytest.status,'failed');assert.equal(pytest.exitCode,1);
  const node=activity.items.find(i=>i.id==='item_10');
  assert.deepEqual(node.tests,{runner:'node',passed:2,failed:0,skipped:0,failures:[]});
  assert.equal(activity.items.find(i=>i.id==='item_11').tests,null,'unknown output stays a Terminal');
  const checkpoint=activity.items.find(i=>i.kind==='checkpoint');
  assert.deepEqual(checkpoint.commit,{branch:'main',hash:'1a2b3c4d',subject:'File the synthetic mail'});
  assert.ok(activity.items.indexOf(checkpoint)>activity.items.findIndex(i=>i.id==='item_12'),'the checkpoint follows its commit');
  assert.deepEqual(activity.usage,{input:182340,cached:150016,output:4210,reasoning:1024,turns:1});
  const sources=activity.items.find(i=>i.kind==='sources');
  assert.deepEqual(sources.queries,[{id:'item_5',query:'shadcn trace component',urls:['https://ui.shadcn.com/docs/components/base/trace']}]);
  const last=activity.items.at(-1);
  assert.equal(last.kind,'message');assert.deepEqual(last.cites,['library/filed/loose-note.md','library/filed/index.md']);
  assert.equal(activity.items.find(i=>i.kind==='reasoning').running,false);
  assert.match(activity.items.find(i=>i.kind==='error').message,/Reconnecting/);assert.equal(activity.items.find(i=>i.kind==='error').fatal,false);
});

test('unknown events, malformed items and server skip markers are handled safely',()=>{
  let activity=emptyActivity();
  for(const raw of [null,42,'x',{type:'padding',data:'x'.repeat(10)},{type:'item.completed'},{type:'item.completed',item:{id:'i',type:'future_kind'}},{type:'item.started',item:{type:'agent_message',text:'no id'}}])
    activity=reduce(activity,fromCodex(raw));
  assert.deepEqual(activity.items,[]);assert.equal(activity.ignored,7);
  activity=reduceAll([{type:'reader.skipped',bytes:300000,reason:'line exceeds 256 KiB'},{type:'item.completed',item:{id:'c',type:'command_execution',command:'ls',aggregated_output:{not:'text'},exit_code:'0',status:'completed'}}],activity);
  assert.equal(activity.items[0].kind,'skipped');
  assert.deepEqual([activity.items[1].output.full,activity.items[1].exitCode],['',null]);
  const failed=reduceAll([{type:'turn.failed',error:{message:'Quota exceeded'}}]);assert.equal(failed.turnFailed,'Quota exceeded');assert.equal(failed.items[0].fatal,true);
});

test('long output keeps the last 200 lines and remembers the full text',()=>{
  const activity=reduceAll(scripted),tool=activity.items.find(i=>i.id==='item_7');
  assert.equal(tool.output.lines.length,MAX_LINES);assert.equal(tool.output.omitted,50);
  assert.equal(tool.output.lines[0],'line 51');assert.equal(tool.output.lines.at(-1),'line 250');
  assert.equal(tool.output.full.split('\n').length,251);
  assert.deepEqual(truncate(''),{lines:[],omitted:0,full:''});
  const omitted=reduceAll([{type:'item.completed',item:{id:'x',type:'command_execution',command:'cat big',aggregated_output:'head\n… 9 characters omitted …\ntail',exit_code:0,status:'completed'},reader_truncated:{'item.aggregated_output':70000}}]);
  assert.equal(omitted.items[0].omittedBytes,70000);
});

test('parsers recognise pytest and node summaries only for test commands',()=>{
  assert.deepEqual(parseTests('pytest -q','== 12 passed, 2 skipped in 3.10s ==').passed,12);
  assert.equal(parseTests('pytest','===== 2 failed, 5 passed, 1 error in 1.0s =====').failed,3);
  assert.equal(parseTests('cat log','1 failed, 2 passed in 0.1s'),null);
  assert.deepEqual(parseTests('node --test a.mjs','✖ breaks (2ms)\nℹ pass 3\nℹ fail 1\nℹ skipped 1\n✖ failing tests:\n✖ breaks (2ms)').failures,[{name:'breaks',detail:''}]);
  assert.equal(parseTests('node --test','no summary'),null);
  assert.equal(parseCommit('git status','[main abcdef1] nope'),null);
  assert.deepEqual(parseCommit('git commit -m x','[main (root-commit) abcdef1] First'),{branch:'main',hash:'abcdef1',subject:'First'});
  assert.equal(commandTitle(`/bin/zsh -lc 'sed -n '"'"'1,5p'"'"' docs/web.md'`),"sed -n '1,5p' docs/web.md");
  assert.equal(commandTitle('/bin/zsh -lc "cat \\"a b\\""'),'cat "a b"');
  assert.deepEqual(citations('See library/a/b.md, (inbox/x/y.pdf) and /tmp/library-notes.md or library/ dir.'),['library/a/b.md','inbox/x/y.pdf']);
});

test('the header timeline follows the plan when present, otherwise intake stages inferred from tools',()=>{
  const live=reduceAll(scripted.slice(0,9));
  assert.deepEqual(steps(live,false).map(s=>s.state),['done','running','pending']);
  const inferred=reduceAll(real);
  // Reading the inbox bundles is the furthest stage the excerpt reaches; a grep pattern naming later stages is not work.
  assert.deepEqual(steps(inferred,false).map(s=>s.state),['running','pending','pending','pending','pending','pending']);
  assert.deepEqual(steps(reduceAll(real.slice(0,5)),false).map(s=>s.state).slice(0,2),['pending','pending']);
  const filed=reduceAll(scripted.filter(e=>e.item?.type!=='todo_list'));
  assert.ok(steps(filed,true).every(s=>s.state==='done'));
  assert.deepEqual(queue(filed,['11111111-1111-4111-8111-111111111111','loose-note.md','33333333'],null),[{name:'11111111-1111-4111-8111-111111111111',filed:true},{name:'loose-note.md',filed:true},{name:'33333333',filed:false}],'a filed path names the arrival; its inbox deletion does not');
  assert.deepEqual(queue(filed,['RW-90.md','x'],['x']),[{name:'RW-90.md',filed:true},{name:'x',filed:false}]);
});
