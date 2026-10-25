/* Agent activity: a neutral event type, the Codex `exec --json` mapping, and a pure reducer from events to
 * transcript items. No imports, so Node's type stripping can run it directly in tests/activity.test.mjs.
 * Other producers (voice chat, local-model jobs) map their own streams to AgentEvent and reuse the reducer. */

export type Phase='started'|'updated'|'completed';
export type ChangeKind='add'|'update'|'delete';
export type AgentEvent=
  |{kind:'session';id:string}
  |{kind:'turn';phase:'started'|'completed'|'failed';error?:string}
  |{kind:'message';id:string;text:string;role:'assistant'|'user'}
  |{kind:'reasoning';id:string;phase:Phase;text:string}
  |{kind:'command';id:string;phase:Phase;command:string;output:string;exitCode:number|null;status:'running'|'completed'|'failed'|'declined';omitted?:number}
  |{kind:'files';id:string;phase:Phase;changes:{path:string;kind:ChangeKind}[];status:'running'|'completed'|'failed'}
  |{kind:'plan';id:string;phase:Phase;steps:{text:string;done:boolean}[]}
  |{kind:'mcp';id:string;phase:Phase;server:string;tool:string;args:string;result:string;error:string|null;status:'running'|'completed'|'failed'}
  |{kind:'search';id:string;phase:Phase;query:string;urls:string[]}
  |{kind:'subagent';id:string;phase:Phase;tool:string;prompt:string;agents:string[];status:'running'|'completed'|'failed'}
  |{kind:'error';id:string;message:string;detail?:string;fatal?:boolean}
  |{kind:'usage';input:number;cached:number;output:number;reasoning:number}
  |{kind:'skipped';bytes:number;reason:string};

const str=(value:unknown)=>typeof value==='string'?value:'';
const num=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:0;
const json=(value:unknown)=>value===undefined||value===null?'':typeof value==='string'?value:JSON.stringify(value,null,2);
const phaseOf=(type:string):Phase|null=>type==='item.started'?'started':type==='item.updated'?'updated':type==='item.completed'?'completed':null;
function itemStatus(value:unknown,phase:Phase):'running'|'completed'|'failed'{
  if(value==='failed'||value==='declined')return 'failed';
  return value==='completed'||phase==='completed'?'completed':'running';
}

/** One Codex `exec --json` event (as served by /api/inbox/events) to AgentEvent, or null when unknown. */
export function fromCodex(raw:unknown):AgentEvent|null{
  if(!raw||typeof raw!=='object')return null;
  const event=raw as Record<string,any>,type=str(event.type);
  if(type==='thread.started')return {kind:'session',id:str(event.thread_id)};
  if(type==='turn.started')return {kind:'turn',phase:'started'};
  if(type==='turn.completed'){const usage=event.usage||{};return {kind:'usage',input:num(usage.input_tokens),cached:num(usage.cached_input_tokens),output:num(usage.output_tokens),reasoning:num(usage.reasoning_output_tokens)};}
  if(type==='turn.failed')return {kind:'turn',phase:'failed',error:str(event.error?.message)||'The turn failed.'};
  if(type==='error')return {kind:'error',id:'error-'+str(event.message).slice(0,40),message:str(event.message)||'Codex reported an error.'};
  if(type==='reader.skipped')return {kind:'skipped',bytes:num(event.bytes),reason:str(event.reason)};
  const phase=phaseOf(type),item=event.item;
  if(!phase||!item||typeof item!=='object'||!str(item.id))return null;
  const id=str(item.id),omitted=event.reader_truncated?.['item.aggregated_output'];
  switch(item.type){
    case 'agent_message':return {kind:'message',id,text:str(item.text),role:'assistant'};
    case 'reasoning':return {kind:'reasoning',id,phase,text:str(item.text)};
    case 'command_execution':{
      const status=item.status==='declined'?'declined':item.status==='failed'?'failed':item.status==='completed'||phase==='completed'?'completed':'running';
      return {kind:'command',id,phase,command:str(item.command),output:str(item.aggregated_output),exitCode:typeof item.exit_code==='number'?item.exit_code:null,status,...(omitted?{omitted:num(omitted)}:{})};
    }
    case 'file_change':return {kind:'files',id,phase,status:itemStatus(item.status,phase),
      changes:(Array.isArray(item.changes)?item.changes:[]).filter((c:any)=>c&&typeof c.path==='string').slice(0,2000)
        .map((c:any)=>({path:c.path,kind:c.kind==='delete'||c.kind==='add'?c.kind:'update'}))};
    case 'todo_list':return {kind:'plan',id,phase,steps:(Array.isArray(item.items)?item.items:[]).slice(0,200).map((s:any)=>({text:str(s?.text),done:!!s?.completed}))};
    case 'mcp_tool_call':return {kind:'mcp',id,phase,server:str(item.server),tool:str(item.tool),args:json(item.arguments),
      result:json(item.result?.content??item.result),error:item.error?str(item.error.message)||json(item.error):null,status:itemStatus(item.status,phase)};
    case 'web_search':{
      const action=item.action||{},urls=[action.url,...(Array.isArray(action.urls)?action.urls:[])].filter((u:unknown)=>typeof u==='string'&&/^https?:\/\//i.test(u as string));
      return {kind:'search',id,phase,query:str(item.query)||str(action.query)||str(action.pattern),urls};
    }
    case 'collab_tool_call':return {kind:'subagent',id,phase,tool:str(item.tool),prompt:str(item.prompt),
      agents:Array.isArray(item.receiver_thread_ids)?item.receiver_thread_ids.map(String).slice(0,20):[],status:itemStatus(item.status,phase)};
    case 'error':return {kind:'error',id,message:str(item.message)||'Codex reported an error.'};
    default:return null;
  }
}

// Output parsers ---------------------------------------------------------------------------------

export type TestSummary={runner:'pytest'|'node';passed:number;failed:number;skipped:number;failures:{name:string;detail:string}[]};
const TEST_COMMAND=/\b(pytest|py\.test|node\s+--test)\b/;

/** pytest's final summary line, or node --test's `ℹ pass/fail` lines. Null for anything else. */
export function parseTests(command:string,output:string):TestSummary|null{
  if(!TEST_COMMAND.test(command))return null;
  const lines=output.split('\n');
  const pytest=[...lines].reverse().find(line=>/^=*\s*\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)\b.* in [\d.]+s\b/.test(line.trim()));
  if(pytest){
    const count=(word:string)=>+(pytest.match(new RegExp('(\\d+) '+word))?.[1]||0);
    const failures=lines.filter(line=>/^(FAILED|ERROR) /.test(line)).slice(0,50).map(line=>{const [name,...rest]=line.replace(/^(FAILED|ERROR) /,'').split(' - ');return {name,detail:rest.join(' - ')};});
    return {runner:'pytest',passed:count('passed'),failed:count('failed')+count('errors?'),skipped:count('skipped'),failures};
  }
  const tap=(name:string)=>{const line=lines.find(l=>new RegExp('^[ℹ#]\\s*'+name+'\\s+\\d+').test(l.trim()));return line?+line.trim().split(/\s+/).pop()!:null;};
  const pass=tap('pass'),fail=tap('fail');
  if(pass===null||fail===null)return null;
  const failures=lines.filter(line=>/^\s*✖ /.test(line)&&!/^\s*✖ failing tests/.test(line)).map(line=>line.trim().replace(/^✖ /,'').replace(/\s*\([\d.]+m?s\)$/,''))
    .filter((name,index,all)=>all.indexOf(name)===index).slice(0,50).map(name=>({name,detail:''}));
  return {runner:'node',passed:pass,failed:fail,skipped:(tap('skipped')||0)+(tap('todo')||0),failures};
}

export type Commit={hash:string;subject:string;branch:string};
/** A `git commit` the agent ran, from its `[branch abc1234] subject` output line. */
export function parseCommit(command:string,output:string):Commit|null{
  if(!/\bgit\b[^\n]*\bcommit\b/.test(command))return null;
  const match=output.match(/^\[([^\]\s]+)(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/m);
  return match?{branch:match[1],hash:match[2],subject:match[3].slice(0,300)}:null;
}

/** A short title for a shell command: drop the `/bin/zsh -lc '…'` wrapper Codex adds. */
export function commandTitle(command:string){
  let text=command.trim();
  const wrapped=text.match(/^\/bin\/(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/);
  if(wrapped)text=wrapped[2].replace(/'"'"'/g,"'").replace(/\\"/g,'"');
  return text.replace(/\s+/g,' ').trim();
}

const VAULT_FILE=/(?<![\w/.-])((?:library|inbox)\/[^\s)`'"<>\],;]+?\.(?:md|markdown|txt|pdf|png|jpe?g|gif|svg|webp))(?![\w/-])/g;
/** Vault-relative document paths a message mentions, for Inline Citation chips. */
export function citations(text:string){return [...new Set([...text.matchAll(VAULT_FILE)].map(m=>m[1]))].slice(0,30);}

// Reducer ----------------------------------------------------------------------------------------

export const MAX_LINES=200;
export type Lines={lines:string[];omitted:number;full:string};
/** The last 200 lines of output; `full` keeps everything the server returned for "Show all". */
export function truncate(output:string,limit=MAX_LINES):Lines{
  const lines=output.replace(/\n$/,'').split('\n');
  if(output==='')return {lines:[],omitted:0,full:''};
  return lines.length>limit?{lines:lines.slice(-limit),omitted:lines.length-limit,full:output}:{lines,omitted:0,full:output};
}

export type Item=
  |{kind:'message';id:string;text:string;role:'assistant'|'user';cites:string[]}
  |{kind:'reasoning';id:string;text:string;running:boolean;startedAt?:number;endedAt?:number}
  |{kind:'tool';id:string;command:string;title:string;status:'running'|'completed'|'failed'|'declined';exitCode:number|null;output:Lines;omittedBytes:number;tests:TestSummary|null;startedAt?:number;endedAt?:number}
  |{kind:'files';id:string;changes:{path:string;kind:ChangeKind}[];running:boolean;failed:boolean}
  |{kind:'plan';id:string;steps:{text:string;done:boolean}[]}
  |{kind:'mcp';id:string;server:string;tool:string;args:string;result:string;error:string|null;status:'running'|'completed'|'failed'}
  |{kind:'sources';id:string;queries:{id:string;query:string;urls:string[]}[];running:boolean}
  |{kind:'subagent';id:string;tool:string;prompt:string;agents:string[];status:'running'|'completed'|'failed'}
  |{kind:'error';id:string;message:string;detail?:string;fatal:boolean}
  |{kind:'checkpoint';id:string;commit:Commit}
  |{kind:'skipped';id:string;bytes:number;reason:string};

export type Usage={input:number;cached:number;output:number;reasoning:number;turns:number};
export type Activity={items:Item[];usage:Usage|null;session:string|null;turnFailed:string|null;events:number;ignored:number};
export const emptyActivity=():Activity=>({items:[],usage:null,session:null,turnFailed:null,events:0,ignored:0});

function upsert(state:Activity,item:Item,merge?:(old:Item)=>Item){
  const index=state.items.findIndex(old=>old.id===item.id&&old.kind===item.kind);
  if(index<0)return {...state,items:[...state.items,item]};
  const items=state.items.slice();items[index]=merge?merge(items[index]):item;return {...state,items};
}

/** Fold one event into the transcript. `at` is when the client received it, for durations seen live. */
export function reduce(state:Activity,event:AgentEvent|null,at?:number):Activity{
  if(!event)return {...state,ignored:state.ignored+1};
  state={...state,events:state.events+1};
  switch(event.kind){
    case 'session':return {...state,session:event.id};
    case 'turn':return event.phase==='failed'?{...upsert(state,{kind:'error',id:'turn-failed-'+state.events,message:event.error||'The turn failed.',fatal:true}),turnFailed:event.error||'failed'}:state;
    case 'usage':{const u=state.usage;return {...state,usage:{input:(u?.input||0)+event.input,cached:(u?.cached||0)+event.cached,output:(u?.output||0)+event.output,reasoning:(u?.reasoning||0)+event.reasoning,turns:(u?.turns||0)+1}};}
    case 'message':return upsert(state,{kind:'message',id:event.id,text:event.text,role:event.role,cites:citations(event.text)});
    case 'reasoning':return upsert(state,{kind:'reasoning',id:event.id,text:event.text,running:event.phase!=='completed',startedAt:at,endedAt:event.phase==='completed'?at:undefined},
      old=>({...(old as Extract<Item,{kind:'reasoning'}>),text:event.text||(old as any).text,running:event.phase!=='completed',endedAt:event.phase==='completed'?at:undefined}));
    case 'command':{
      const tests=event.status==='running'?null:parseTests(event.command,event.output);
      const item:Item={kind:'tool',id:event.id,command:event.command,title:commandTitle(event.command),status:event.status,exitCode:event.exitCode,
        output:truncate(event.output),omittedBytes:event.omitted||0,tests,startedAt:at,endedAt:event.status==='running'?undefined:at};
      let next=upsert(state,item,old=>({...item,startedAt:(old as any).startedAt??at}));
      const commit=event.status==='completed'&&event.exitCode===0?parseCommit(event.command,event.output):null;
      if(commit&&!next.items.some(i=>i.kind==='checkpoint'&&i.commit.hash===commit.hash))next=upsert(next,{kind:'checkpoint',id:'commit-'+commit.hash,commit});
      return next;
    }
    case 'files':return upsert(state,{kind:'files',id:event.id,changes:event.changes,running:event.status==='running',failed:event.status==='failed'});
    case 'plan':return upsert(state,{kind:'plan',id:event.id,steps:event.steps});
    case 'mcp':return upsert(state,{kind:'mcp',id:event.id,server:event.server,tool:event.tool,args:event.args,result:event.result,error:event.error,status:event.status});
    case 'search':{
      // A search updates its own Sources item; consecutive searches share one.
      const query={id:event.id,query:event.query,urls:event.urls},running=event.phase!=='completed';
      const own=state.items.findIndex(i=>i.kind==='sources'&&i.queries.some(q=>q.id===event.id));
      const index=own>=0?own:state.items[state.items.length-1]?.kind==='sources'?state.items.length-1:-1;
      if(index<0)return {...state,items:[...state.items,{kind:'sources',id:'sources-'+event.id,queries:[query],running}]};
      const items=state.items.slice(),old=items[index] as Extract<Item,{kind:'sources'}>;
      items[index]={...old,queries:own>=0?old.queries.map(q=>q.id===event.id?query:q):[...old.queries,query].slice(-50),running};
      return {...state,items};
    }
    case 'subagent':return upsert(state,{kind:'subagent',id:event.id,tool:event.tool,prompt:event.prompt,agents:event.agents,status:event.status});
    // Codex reports retries and notices as `error` events; only a failed turn (or run) is fatal.
    case 'error':return upsert(state,{kind:'error',id:event.id+'-'+state.events,message:event.message,detail:event.detail,fatal:!!event.fatal});
    case 'skipped':return upsert(state,{kind:'skipped',id:'skipped-'+state.events,bytes:event.bytes,reason:event.reason});
  }
}

export const reduceAll=(events:unknown[],state=emptyActivity(),at?:number)=>events.reduce<Activity>((s,raw)=>reduce(s,fromCodex(raw),at),state);

// Derived views -----------------------------------------------------------------------------------

export type Step={label:string;state:'done'|'running'|'pending'};
// [label, a command that reaches the stage, a changed path that reaches it]. Words must be followed by an
// argument, so a grep pattern such as 'intake|reading-copy' does not count as doing the work.
const STAGES:[string,RegExp,RegExp|null][]=[
  ['Read the arrivals',/\binbox\/|\breceipt\.json\b/,null],
  ['File the documents',/\b(?:git mv|mv|ingest)\s/,/^library\//],
  ['Reading copies',/\breading-copy\s/,/\.reading\.md$/],
  ['Catalog',/\b(?:catalog|browse)\s/,/(?:^|\/)(?:index\.md|catalog\.md)$/],
  ['Validate',/\b(?:pytest|node --test|validate|verify)\s|\s--check\b/,null],
  ['Commit',/\bgit\b[^\n]*\bcommit\b/,null]];
/** The header timeline: the agent's own plan when it wrote one, otherwise intake stages inferred from tools. */
export function steps(activity:Activity,finished:boolean):Step[]{
  const plan=[...activity.items].reverse().find(i=>i.kind==='plan') as Extract<Item,{kind:'plan'}>|undefined;
  if(plan){const first=plan.steps.findIndex(s=>!s.done);return plan.steps.map((s,i)=>({label:s.text,state:s.done?'done':i===first&&!finished?'running':'pending'}));}
  let reached=-1;
  for(const item of activity.items)STAGES.forEach(([,command,path],index)=>{
    if(index>reached&&(item.kind==='tool'&&command.test(item.title)||item.kind==='files'&&!!path&&item.changes.some(c=>path.test(c.path))))reached=index;
  });
  if(activity.items.some(i=>i.kind==='checkpoint'))reached=STAGES.length-1;
  return STAGES.map(([label],index)=>({label,state:index<reached||index===reached&&finished?'done':index===reached?'running':'pending'}));
}

/** Arrivals of this run with filed state: their path appeared in a file change, or the run left them out of `remaining`. */
export function queue(activity:Activity,arrivals:string[],remaining:string[]|null){
  const touched=activity.items.flatMap(i=>i.kind==='files'?i.changes.map(c=>c.path):[]);
  return arrivals.map(name=>({name,filed:remaining?!remaining.includes(name):touched.some(p=>p.includes(name)&&!p.startsWith('inbox/'))}));
}
