/* Behind the scenes · Local model: LM Studio's server, the supervised queue, recent items, cached outputs and task settings. */
import {useEffect, useState} from 'react';
import {Loader2Icon, ChevronRightIcon} from 'lucide-react';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';
import {Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter} from './components/ui/card';
import {Collapsible, CollapsibleTrigger, CollapsibleContent} from './components/ui/collapsible';
import {Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem} from './components/ui/select';
import {Switch} from './components/ui/switch';
import {Field, FieldGroup, FieldLabel, FieldDescription} from './components/ui/field';

type Control={id:string;action:string;model:string|null;label:string;state:'running'|'succeeded'|'failed';error:string|null;started_at:string;finished_at:string|null};
type Loaded={id:string;size_bytes?:number|null;loaded_by_reader?:boolean;context_length?:number|null};
type Available={key:string;type:'llm'|'embedding';name:string;size_bytes?:number|null;params?:string|null};
type Server={state:'not-installed'|'off'|'starting'|'ready'|'busy'|'error';label:string;running:boolean;url:string;port:number;cli:string|null;loaded:Loaded[];available:Available[];available_error:string|null;control:Control|null;error:string|null};
type Now={id:string;task:string;task_label:string;path:string;title:string;model:string;started_at:string;preview:string;thinking:string;tokens:number;tokens_per_second:number|null};
type QueueRow={label:string;waiting:number;active:boolean;running:boolean;next:{id:string;title:string;path:string}[]};
export type Item={id:string;task:string;task_label:string;path:string;title:string;model:string;prompt_version:string;state:'done'|'rejected'|'failed'|'cancelled';error:string|null;output:string|null;display:string|null;finished_at:string|null;duration_seconds:number|null;tokens_per_second:number|null;truncated?:boolean};
type Sample={path:string;model:string;prompt_version:string;text:string;created_at:string};
type Outputs={tasks:Record<string,{label:string;cached:number;current:number;stale:number;samples:Sample[]}>;bytes:number;limit_bytes:number};
type TaskSetting={enabled:boolean;model:string;trigger:string};
export type Settings={tasks:Record<string,TaskSetting>;embedding_backend:string};
export type Run={id:string;state:'running'|'finished'|'paused'|'stopped'|'failed';started_at:string;finished_at:string|null;counts:Record<string,Record<string,number>>;warning:string|null;error:string|null};
export type LocalModelStatus={server:Server;now:Now|null;queue:Record<string,QueueRow>;recent:Item[];outputs:Outputs;settings:Settings;tasks:Record<string,{label:string;noun:string;prompt_version:string}>;limits:Record<string,number>;active:string[];running:boolean;runs:Run[];labels:Record<string,string>};
export type Act=(action:string,payload?:Record<string,unknown>)=>Promise<unknown>;

const SERVER_BADGE:Record<string,'secondary'|'outline'|'destructive'|'default'>={ready:'secondary',busy:'default',starting:'default',off:'outline','not-installed':'outline',error:'destructive'};
const OUTCOME:Record<string,{mark:string;label:string}>={done:{mark:'✓',label:'Done'},rejected:{mark:'!',label:'Rejected by validation'},failed:{mark:'✕',label:'Failed'},cancelled:{mark:'–',label:'Cancelled'}};

export const shortModel=(model:string)=>model.split('/').pop()||model;
export const bytes=(n?:number|null)=>n==null?null:n>=1e9?`${(n/1e9).toFixed(1)} GB`:n>=1e6?`${Math.round(n/1e6)} MB`:`${Math.round(n/1e3)} kB`;
const mib=(n:number)=>n>=1024**2?`${(n/1024**2).toFixed(n>=10*1024**2?0:1)} MiB`:`${Math.max(1,Math.round(n/1024))} KiB`;
/** Every piece of machine-written text carries this mark. */
export function MachineMark({model}:{model:string}){return <span className="lm-mark" data-reader-decoration="">local model · {shortModel(model)}</span>;}
/** A plural-aware batch summary for the run toast: "Standfirsts: 20 done, 2 rejected". */
export function runSummary(run:Run,labels:Record<string,string>){
  return Object.entries(run.counts).map(([task,c])=>`${labels[task]||task}: ${[['done',c.done],['rejected',c.rejected],['failed',c.failed],['cancelled',c.cancelled]].filter(([,n])=>n).map(([k,n])=>`${n} ${k}`).join(', ')||'nothing finished'}`).join('; ')||'Nothing finished.';
}
function seconds(since:string){return Math.max(0,Math.round((Date.now()-+new Date(since))/1000));}
function Ticking({since}:{since:string}){const [, tick]=useState(0);useEffect(()=>{const t=setInterval(()=>tick(n=>n+1),1000);return ()=>clearInterval(t);},[]);const s=seconds(since);return <>{s<60?`${s} s`:`${Math.floor(s/60)} min ${s%60} s`}</>;}
function ago(value?:string|null){if(!value)return '';const s=seconds(value);return s<45?'just now':s<3600?`${Math.round(s/60)} min ago`:s<86400?`${Math.round(s/3600)} h ago`:new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});}

function ServerCard({server,act}:{server:Server;act:Act}){
  const [confirm,setConfirm]=useState(false);
  useEffect(()=>{if(!confirm)return;const t=setTimeout(()=>setConfirm(false),8000);return ()=>clearTimeout(t);},[confirm]);
  const controlling=server.control?.state==='running',loaded=(key:string)=>server.loaded.find(m=>m.id===key||m.id.split('/').pop()===key.split('/').pop());
  const working=server.state==='busy';
  return <Card size="sm" className="backstage-card lm-server" data-server-state={server.state}>
    <CardHeader><CardTitle>LM Studio server</CardTitle><CardDescription>{server.url} · loopback only. Other tools on this Mac may share it.</CardDescription>
      <CardAction><Badge variant={SERVER_BADGE[server.state]} className="backstage-badge" id="lm-server-state">{server.state==='starting'||controlling?<Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden/>:null}{controlling&&server.state!=='starting'?server.control!.label+'…':server.label}</Badge></CardAction></CardHeader>
    <CardContent>
      {server.state==='not-installed'?<p className="backstage-message">LM Studio’s <code>lms</code> command was not found on PATH or in <code>~/.lmstudio/bin</code>. Install LM Studio, or set <code>READER_LMS</code>.</p>
       :server.state==='off'?<p className="backstage-message">The server is off. Start it to run local-model tasks; it binds to 127.0.0.1:{server.port}.</p>
       :server.state==='error'?<p className="backstage-message backstage-error" role="alert">{server.error}</p>:null}
      <dl className="backstage-facts"><div><dt>CLI</dt><dd title={server.cli||undefined}>{server.cli?'Found':'Missing'}</dd></div><div><dt>Port</dt><dd>{server.port}</dd></div>
        <div><dt>Loaded</dt><dd>{server.running?server.loaded.length:'—'}</dd></div>
        {server.running&&server.loaded.length?<div><dt>Memory</dt><dd>{bytes(server.loaded.reduce((n,m)=>n+(m.size_bytes||0),0))||'—'}</dd></div>:null}</dl>
      {server.available.length?<ul className="lm-models" aria-label="Models on disk">{server.available.map(m=>{const on=loaded(m.key);return <li key={m.key} data-model={m.key} data-loaded={on?'true':'false'}>
        <span className="lm-model-name"><strong>{m.name}</strong><small>{[m.type==='embedding'?'Embedding':m.params,bytes(m.size_bytes),on?(on.loaded_by_reader?'loaded by Reader':'loaded'):null].filter(Boolean).join(' · ')}</small></span>
        {on?<Button size="xs" variant="outline" data-unload={m.key} disabled={!server.running||controlling||working} onClick={()=>act('unload',{model:on.id})}>Unload</Button>
          :<Button size="xs" variant="outline" data-load={m.key} disabled={!server.running||controlling} onClick={()=>act('load',{model:m.key})}>Load</Button>}</li>;})}</ul>
       :server.available_error?<p className="backstage-note">Couldn’t list models: {server.available_error}</p>:null}
    </CardContent>
    <CardFooter><ButtonGroup>
      {!server.running?<Button id="lm-server-start" size="sm" disabled={!server.cli||controlling||server.state==='starting'} onClick={()=>act('server-start')}>{server.state==='starting'?'Starting…':'Start server'}</Button>
       :confirm?<><Button id="lm-server-stop-confirm" size="sm" variant="destructive" onClick={()=>{setConfirm(false);act('server-stop');}}>Stop for every tool</Button><Button size="sm" variant="outline" onClick={()=>setConfirm(false)}>Keep running</Button></>
       :<Button id="lm-server-stop" size="sm" variant="outline" disabled={!server.cli||controlling||working} title={working?'Pause the queue first':undefined} onClick={()=>setConfirm(true)}>Stop server…</Button>}
    </ButtonGroup>{confirm?<span className="lm-confirm" role="status">Other apps using LM Studio will lose it too.</span>:null}</CardFooter>
  </Card>;
}

function NowCard({status,act}:{status:LocalModelStatus;act:Act}){
  const now=status.now,waiting=Object.values(status.queue).reduce((n,q)=>n+q.waiting,0),last=status.runs.find(r=>r.state!=='running');
  return <Card size="sm" className="backstage-card lm-now" data-now={now?'running':'idle'}>
    <CardHeader><CardTitle>Now</CardTitle><CardDescription>{now?`${now.task_label} · ${waiting.toLocaleString()} more waiting`:`One item at a time; the workstation GPU lock is held per batch of up to ${status.limits.batch}.`}</CardDescription>
      {now?<CardAction><Badge variant="default" className="backstage-badge"><Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden/>Running</Badge></CardAction>:null}</CardHeader>
    <CardContent>{now?<>
      <p className="lm-now-title"><strong>{now.title}</strong><small>{now.path}</small></p>
      <dl className="backstage-facts"><div><dt>Model</dt><dd>{shortModel(now.model)}</dd></div><div><dt>Elapsed</dt><dd><Ticking since={now.started_at}/></dd></div>
        <div><dt>Speed</dt><dd id="lm-rate">{now.tokens_per_second?`${now.tokens_per_second} tok/s`:'—'}</dd></div><div><dt>Tokens</dt><dd>{now.tokens}</dd></div></dl>
      <div className="lm-preview" id="lm-preview" aria-live="off" data-reader-decoration="">{now.preview?<p>{now.preview}<span className="lm-caret" aria-hidden/></p>:<p className="lm-thinking">{now.thinking?'Thinking… '+now.thinking.slice(-160):'Waiting for the first token…'}</p>}<MachineMark model={now.model}/></div>
    </>:<><p className="backstage-message">{waiting?`Nothing running. ${waiting.toLocaleString()} waiting; press Run on a task below.`:'Nothing running and nothing waiting.'}</p>
      {last?<p className="lm-last" data-last-run={last.state}><small>Last run · {ago(last.finished_at)}</small>{runSummary(last,status.labels)}{last.error?<span className="backstage-error"> · {last.error}</span>:null}</p>:null}</>}</CardContent>
    {now?<CardFooter><ButtonGroup><Button id="lm-pause" size="sm" variant="outline" onClick={()=>act('pause')}>Pause queue</Button><Button id="lm-cancel" size="sm" variant="outline" onClick={()=>act('cancel',{id:now.id})}>Cancel item</Button></ButtonGroup><span className="lm-confirm">Pause finishes this item first.</span></CardFooter>:null}
  </Card>;
}

function QueueCard({status,act}:{status:LocalModelStatus;act:Act}){
  const ready=status.server.running;
  return <Card size="sm" className="backstage-card lm-queue"><CardHeader><CardTitle>Queue</CardTitle><CardDescription>Waiting items, grouped by task. Queue recent works or the whole library; works with a current output are skipped.</CardDescription></CardHeader>
    <CardContent><ul className="lm-tasks">{Object.entries(status.queue).map(([task,row])=>{const enabled=status.settings.tasks[task]?.enabled!==false;
      return <li key={task} data-queue={task} data-active={row.active?'true':'false'}>
        <div className="lm-task-head"><span><strong>{row.label}</strong> · <span className="lm-count" data-waiting={row.waiting}>{row.waiting.toLocaleString()} waiting</span></span>
          <small>{row.running?'Running':row.active&&row.waiting?'Up next':row.waiting?'Held until you press Run':enabled?'Idle':'Turned off in settings'}</small></div>
        {row.next.length?<small className="lm-next">Next: {row.next.map(n=>n.title).join(' · ')}</small>:null}
        <div className="lm-task-actions"><ButtonGroup aria-label={`${row.label} queue`}>
          <Button size="xs" data-run={task} disabled={!row.waiting||(row.active&&status.running)||!ready} title={!ready?'Start the server first':undefined} onClick={()=>act('run',{task})}>Run</Button>
          <Button size="xs" variant="outline" data-pause={task} disabled={!row.active} onClick={()=>act('pause',{task})}>Pause</Button>
          <Button size="xs" variant="outline" data-clear={task} disabled={!row.waiting} onClick={()=>act('clear',{task})}>Clear</Button></ButtonGroup>
          <ButtonGroup aria-label={`Queue ${row.label}`}><Button size="xs" variant="outline" data-enqueue={task} data-scope="recent" disabled={!enabled} onClick={()=>act('enqueue',{task,scope:'recent'})}>Queue 20 recent</Button>
          <Button size="xs" variant="outline" data-enqueue={task} data-scope="all" disabled={!enabled} onClick={()=>act('enqueue',{task,scope:'all'})}>Queue all</Button></ButtonGroup></div></li>;})}</ul></CardContent></Card>;
}

function RecentCard({items}:{items:Item[]}){
  return <Card size="sm" className="backstage-card lm-recent"><CardHeader><CardTitle>Recent</CardTitle><CardDescription>The last {items.length||50} finished items. Open one for its prompt version, output and any rejection reason.</CardDescription></CardHeader>
    <CardContent>{items.length?<ol className="backstage-jobs lm-items">{items.map(item=><li key={item.id} data-item-state={item.state} data-item={item.id}>
      <span className="backstage-job-state" aria-hidden>{OUTCOME[item.state]?.mark}</span>
      <Collapsible><CollapsibleTrigger className="lm-item-trigger"><span><strong>{item.title}</strong><small>{OUTCOME[item.state]?.label} · {item.task_label} · {shortModel(item.model)}{item.duration_seconds!=null?` · ${item.duration_seconds} s`:''} · {ago(item.finished_at)}</small></span><ChevronRightIcon className="lm-chevron size-3.5" aria-hidden/></CollapsibleTrigger>
        <CollapsibleContent className="lm-item-detail">
          <dl className="backstage-facts"><div><dt>Prompt</dt><dd>{item.prompt_version}</dd></div><div><dt>Source</dt><dd className="lm-path">{item.path}</dd></div>{item.tokens_per_second?<div><dt>Speed</dt><dd>{item.tokens_per_second} tok/s</dd></div>:null}{item.truncated?<div><dt>Input</dt><dd>Truncated at a heading</dd></div>:null}</dl>
          {item.error?<p className={'backstage-message lm-reason'+(item.state==='cancelled'?'':' backstage-error')}>{item.state==='rejected'?'Rejected: ':''}{item.error}</p>:null}
          {item.display||item.output?<blockquote className="lm-output" data-reader-decoration="">{item.display||item.output}<MachineMark model={item.model}/></blockquote>:null}
        </CollapsibleContent></Collapsible></li>)}</ol>:<p className="backstage-message">No local-model items have finished yet.</p>}</CardContent></Card>;
}

function OutputsCard({outputs,act}:{outputs:Outputs;act:Act}){
  return <Card size="sm" className="backstage-card lm-outputs"><CardHeader><CardTitle>Outputs in use</CardTitle><CardDescription>A rebuildable cache in .reader/local-model/, keyed by source hash, model and prompt version. Never written into vault files.</CardDescription></CardHeader>
    <CardContent><ul className="lm-tasks">{Object.entries(outputs.tasks).map(([task,o])=><li key={task} data-outputs={task}>
      <div className="lm-task-head"><strong>{o.label}</strong>{o.stale?<Button size="xs" variant="outline" data-prune={task} onClick={()=>act('prune',{task})}>Remove {o.stale} stale</Button>:null}</div>
      <dl className="backstage-facts"><div><dt>Current</dt><dd data-current={o.current}>{o.current.toLocaleString()}</dd></div><div><dt>Stale</dt><dd data-stale={o.stale}>{o.stale.toLocaleString()}</dd></div><div><dt>Cached</dt><dd>{o.cached.toLocaleString()}</dd></div></dl>
      {o.samples.slice(0,2).map(s=><blockquote key={s.path+s.created_at} className="lm-output lm-sample" data-reader-decoration=""><small>{s.path}</small>{s.text}<MachineMark model={s.model}/></blockquote>)}</li>)}</ul>
      <p className="backstage-note">Cache {outputs.bytes?mib(outputs.bytes):'empty'} of {mib(outputs.limit_bytes)}. Stale outputs belong to an older edition of their source and are never shown as current.</p></CardContent></Card>;
}

function SettingsCard({status,act}:{status:LocalModelStatus;act:Act}){
  const [draft,setDraft]=useState<Settings>(status.settings),[busy,setBusy]=useState(false);
  const saved=JSON.stringify(status.settings);useEffect(()=>{setDraft(JSON.parse(saved));},[saved]);
  const llms=status.server.available.filter(m=>m.type==='llm').map(m=>m.key),embeds=status.server.available.filter(m=>m.type==='embedding').map(m=>m.key);
  const options=(current:string,keys:string[])=>[...new Set([current,...keys])].map(key=>({value:key,label:shortModel(key)}));
  const setTask=(task:string,patch:Partial<TaskSetting>)=>setDraft(d=>({...d,tasks:{...d.tasks,[task]:{...d.tasks[task],...patch}}}));
  const embedItems=[{value:'fastembed',label:'bge-small (built in)'},...[...new Set([...(draft.embedding_backend.startsWith('lmstudio:')?[draft.embedding_backend.slice(9)]:[]),...embeds])].map(key=>({value:'lmstudio:'+key,label:shortModel(key)+' (LM Studio)'}))];
  return <Card size="sm" className="backstage-card lm-settings"><CardHeader><CardTitle>Tasks</CardTitle><CardDescription>Which tasks may run, on which model. Runs start only when you press Run.</CardDescription></CardHeader>
    <CardContent><form id="lm-settings-form" className="lm-settings-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await act('settings',{settings:draft});}finally{setBusy(false);}}}>
      {Object.entries(draft.tasks).map(([task,t])=><FieldGroup key={task} className="lm-setting" data-setting={task}>
        <Field orientation="horizontal"><FieldLabel htmlFor={'lm-enabled-'+task}>{status.tasks[task]?.label||task}</FieldLabel><Switch id={'lm-enabled-'+task} checked={t.enabled} onCheckedChange={v=>setTask(task,{enabled:v})}/></Field>
        <div className="lm-setting-row">
          <Field><FieldLabel htmlFor={'lm-model-'+task}>Model</FieldLabel><Select items={options(t.model,llms)} value={t.model} onValueChange={v=>{if(v)setTask(task,{model:v});}}><SelectTrigger id={'lm-model-'+task} className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{options(t.model,llms).map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor={'lm-trigger-'+task}>Trigger</FieldLabel><Select items={[{value:'manual',label:'On request'}]} value={t.trigger} onValueChange={v=>{if(v)setTask(task,{trigger:v});}}><SelectTrigger id={'lm-trigger-'+task} className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup><SelectItem value="manual">On request</SelectItem><SelectItem value="nightly" disabled>Nightly (not yet)</SelectItem><SelectItem value="idle" disabled>When idle (not yet)</SelectItem></SelectGroup></SelectContent></Select></Field>
        </div></FieldGroup>)}
      <Field><FieldLabel htmlFor="lm-embedding">Search embeddings</FieldLabel><Select items={embedItems} value={draft.embedding_backend} onValueChange={v=>{if(v)setDraft(d=>({...d,embedding_backend:v}));}}><SelectTrigger id="lm-embedding" className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{embedItems.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
        <FieldDescription>Switching re-embeds the whole library at the next search-index rebuild. LM Studio embeddings need its server running for every search.</FieldDescription></Field>
      <div className="backstage-settings-foot"><Button type="submit" size="sm" disabled={busy||JSON.stringify(draft)===saved}>{busy?'Saving…':'Save task settings'}</Button></div>
    </form></CardContent></Card>;
}

export function LocalModelSection({status,act}:{status:LocalModelStatus|null;act:Act}){
  return <section className="backstage-section" id="local-model" aria-labelledby="local-model-title">
    <div className="backstage-section-head"><h2 id="local-model-title">Local model</h2><span className="backstage-checked">{status?status.running?<><Loader2Icon className="size-3 animate-spin" aria-hidden/> Working through the queue</>:status.server.label:'Loading…'}</span></div>
    <p className="lm-lede">Bulk, private, judgment-light language work on this Mac’s LM Studio models. Outputs are suggestions labelled with their model; filing, catalog writes and anything signed by a voice stay with the voices.</p>
    {status?<><div className="backstage-grid"><ServerCard server={status.server} act={act}/><NowCard status={status} act={act}/></div>
      <div className="backstage-grid"><QueueCard status={status} act={act}/><OutputsCard outputs={status.outputs} act={act}/></div>
      <div className="backstage-grid"><RecentCard items={status.recent}/><SettingsCard status={status} act={act}/></div></>
     :<p className="backstage-message">Loading local-model status…</p>}
  </section>;
}
