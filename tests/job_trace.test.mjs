// Coding-job traces (RW-44) through the shared activity reducer: phases, job steps, GitHub rows, Codex and Claude Code
// agent events, and the event cursor (duplicates ignored, gaps stop for resynchronization).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyActivity, jobMapper, reduceJob, applyFrames, steps, claudeMapper} from '../web/src/activity/reducer.ts';

const run='00000000-0000-4000-8000-000000000001';
let n=0;const ev=(type,data)=>({run_id:run,seq:++n,at:'2026-10-26T00:00:00Z',type,...data});
function scripted(){
  n=0;
  return [
    ev('phase',{phase:'queued',state:'started',detail:'acme/widget · Codex'}),
    ev('phase',{phase:'preflight',state:'started'}),
    ev('step',{id:'step-1',title:'Check GitHub access',status:'running',output:'',exit_code:null}),
    ev('step',{id:'step-1',title:'Check GitHub access',status:'completed',output:'reader-bot can push to acme/widget',exit_code:0}),
    ev('github',{action:'issue_linked',number:277,url:'https://github.com/acme/widget/issues/277',state:'open'}),
    ev('phase',{phase:'preflight',state:'completed'}),
    ev('phase',{phase:'agent',state:'started',detail:'Codex'}),
    ev('agent',{stream:'codex',event:{type:'item.completed',item:{id:'item_1',type:'command_execution',command:"/bin/sh -lc 'pytest -q'",aggregated_output:'1 failed, 2 passed in 0.10s\n',exit_code:1,status:'failed'}}}),
    ev('agent',{stream:'codex',event:{type:'item.completed',item:{id:'item_9',type:'agent_message',text:'Done.'}}}),
    ev('agent',{stream:'codex',event:{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:10,output_tokens:20}}}),
    ev('agent',{stream:'codex',event:{type:'reader.unknown'}}),
    ev('files',{changes:[{path:'src/depth.txt',kind:'add'},{path:'README.md',kind:'update'}]}),
    ev('commit',{sha:'abcdef1234567890',subject:'Bound parser depth',branch:'reader/x-1'}),
    ev('phase',{phase:'verify',state:'started'}),
    ev('step',{id:'step-9',title:'Verify: python3 scripts/check_container.py python',status:'failed',output:'1 failed, 2 passed in 0.10s',exit_code:1}),
    ev('outcome',{outcome:'failed',message:'Verification failed with exit status 1; nothing was published.'}),
  ];
}

test('a job trace maps phases, Reader steps, agent rows, files, commits and the outcome',()=>{
  const activity=reduceJob(emptyActivity(),scripted(),jobMapper(),1000);
  assert.deepEqual(activity.phases.map(p=>[p.id,p.state]),[['queued','done'],['preflight','done'],['agent','done'],['verify','running']]);
  const kinds=activity.items.map(i=>i.kind);
  assert.deepEqual(kinds,['tool','link','tool','message','files','checkpoint','tool','error']);
  const [check,link,test_,,files,commit,verify,outcome]=activity.items;
  assert.equal(check.status,'completed');assert.equal(check.title,'Check GitHub access');
  assert.deepEqual([link.label,link.url],['Issue #277','https://github.com/acme/widget/issues/277']);
  assert.equal(test_.tests.failed,1,'the agent\'s own test command is parsed as test results');
  assert.equal(files.changes.length,2);assert.equal(commit.commit.hash,'abcdef1234567890');
  assert.equal(verify.status,'failed');assert.equal(verify.exitCode,1);assert.equal(verify.tests?.runner??null,null);
  assert.equal(outcome.fatal,true);assert.match(outcome.message,/nothing was published/);
  assert.equal(activity.usage.input,100);assert.equal(activity.ignored,1,'unknown agent events invent nothing');
  // The header steps come from the phases; a run that ended mid-phase shows that phase failed.
  assert.deepEqual(steps(activity,true).map(s=>[s.label,s.state]).at(-1),['Verify','failed']);
});

test('a successful outcome adds no error row and GitHub links stay on github.com',()=>{
  n=0;
  const activity=reduceJob(emptyActivity(),[ev('github',{action:'pull_request_opened',number:301,url:'https://github.com/acme/widget/pull/301'}),
    ev('github',{action:'issue_created',number:9,url:'javascript:alert(1)'}),ev('outcome',{outcome:'pr_opened',message:'Pull request #301 is open'})],jobMapper());
  assert.deepEqual(activity.items.map(i=>[i.kind,i.label,i.url]),[['link','Opened pull request #301','https://github.com/acme/widget/pull/301'],['link','Created issue #9','']]);
});

test('the cursor ignores duplicates, stops at a gap and resumes after resynchronization',()=>{
  const all=scripted(),mapper=jobMapper();
  let [cursor,complete]=applyFrames({activity:emptyActivity(),seq:0},all.slice(0,5),mapper);
  assert.ok(complete);assert.equal(cursor.seq,5);
  [cursor,complete]=applyFrames(cursor,[all[3],all[4]],mapper);
  assert.ok(complete);assert.equal(cursor.seq,5,'duplicates change nothing');
  const before=cursor.activity.items.length;
  [cursor,complete]=applyFrames(cursor,[all[7]],mapper);
  assert.equal(complete,false);assert.equal(cursor.seq,5);assert.equal(cursor.activity.items.length,before,'a gap applies nothing');
  [cursor,complete]=applyFrames(cursor,all.slice(5),mapper);
  assert.ok(complete);assert.equal(cursor.seq,all.length);
  const straight=reduceJob(emptyActivity(),all,jobMapper());
  assert.deepEqual(cursor.activity.items.map(i=>i.kind+':'+i.id),straight.items.map(i=>i.kind+':'+i.id),'resync yields the same trace as one pass');
});

test('Claude Code stream-json becomes messages, tool rows completed by their results, and usage',()=>{
  const map=claudeMapper();
  const events=[
    {type:'system',subtype:'init',session_id:'s-1'},
    {type:'assistant',message:{id:'m1',content:[{type:'text',text:'Looking.'},{type:'tool_use',id:'tu1',name:'Bash',input:{command:'pytest -q'}}]}},
    {type:'user',message:{content:[{type:'tool_result',tool_use_id:'tu1',content:'2 passed in 0.10s',is_error:false}]}},
    {type:'assistant',message:{id:'m2',content:[{type:'tool_use',id:'tu2',name:'Edit',input:{file_path:'src/a.py'}}]}},
    {type:'user',message:{content:[{type:'tool_result',tool_use_id:'tu2',content:[{type:'text',text:'denied'}],is_error:true}]}},
    {type:'result',subtype:'success',result:'Done',usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:4}},
  ];
  const activity=reduceJob(emptyActivity(),events.map((event,i)=>({seq:i+1,type:'agent',stream:'claude',event})),jobMapper());
  assert.equal(activity.session,'s-1');
  const tools=activity.items.filter(i=>i.kind==='tool');
  assert.deepEqual(tools.map(t=>[t.title,t.status,t.exitCode]),[['pytest -q','completed',0],['Edit src/a.py','failed',1]]);
  assert.equal(tools[0].tests.passed,2);
  assert.deepEqual(activity.usage,{input:10,cached:4,output:5,reasoning:0,turns:1});
  assert.ok(map({type:'assistant',message:{content:[{type:'tool_use',id:'x',name:'Bash',input:{command:'ls'}}]}})[0].kind==='command');
});
