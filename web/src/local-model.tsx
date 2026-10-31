/* Admin › Models (#admin/models): a local model for bulk, private work. The OpenAI-compatible provider (LM Studio, Ollama,
   llama.cpp or any other), its server, the supervised queue, recent items, cached outputs and task settings.
   Design sheet: docs/admin-design/models.md. Tests find parts by data-lm hooks; the only classes left are the
   machine-text styles (lm-mark, lm-preview, lm-output) that the magazine shares. */
import {Fragment, useEffect, useState} from 'react';
import {ChevronRightIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';
import {Collapsible, CollapsibleTrigger, CollapsibleContent} from './components/ui/collapsible';
import {Item as UiItem, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemSeparator, ItemTitle} from './components/ui/item';
import {Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem} from './components/ui/select';
import {Spinner} from './components/ui/spinner';
import {Switch} from './components/ui/switch';
import {Field, FieldGroup, FieldLabel, FieldDescription} from './components/ui/field';
import {Input} from './components/ui/input';
import {RunStateIcon, type RunState} from './theme/atoms/run-state-icon';
import {StatusBadge, type Tone} from './theme/atoms/status-badge';
import {FactList} from './theme/molecules/fact-list';
import {Notice} from './theme/molecules/notice';
import {LoadingState} from './theme/molecules/states';
import {Toolbar} from './theme/molecules/toolbar';
import {ConfirmAction} from './theme/organisms/confirm-action';
import {StatusCard} from './theme/organisms/status-card';
import {CardGrid} from './theme/templates/card-grid';

type Control={id:string;action:string;model:string|null;label:string;state:'running'|'succeeded'|'failed';error:string|null;started_at:string;finished_at:string|null};
type Loaded={id:string;size_bytes?:number|null;loaded_by_reader?:boolean;context_length?:number|null};
type Available={key:string;type:'llm'|'embedding';name:string;size_bytes?:number|null;params?:string|null};
export type Provider={preset:string;label:string;base_url:string;saved_base_url:string|null;model:string;allow_remote:boolean;loopback:boolean;host:string|null;remote_notice:string|null;api_key:{set:boolean;source:'file'|'environment'|null;env:string};start:string|null;hint:string;presets:Record<string,{label:string;base_url:string|null}>};
type Server={state:'not-installed'|'off'|'starting'|'ready'|'busy'|'error';label:string;running:boolean;url:string;port:number|null;cli:{name:string;installed:boolean}|null;lms:boolean;loaded:Loaded[];available:Available[];available_error:string|null;control:Control|null;error:string|null;provider:Provider};
type Now={id:string;task:string;task_label:string;path:string;title:string;model:string;started_at:string;preview:string;thinking:string;tokens:number;tokens_per_second:number|null};
type QueueRow={label:string;waiting:number;active:boolean;running:boolean;next:{id:string;title:string;path:string}[]};
export type Item={id:string;task:string;task_label:string;path:string;title:string;model:string;prompt_version:string;state:'done'|'rejected'|'failed'|'cancelled';error:string|null;output:string|null;display:string|null;finished_at:string|null;duration_seconds:number|null;tokens_per_second:number|null;truncated?:boolean};
type Sample={path:string;model:string;prompt_version:string;text:string;created_at:string};
type Outputs={tasks:Record<string,{label:string;cached:number;current:number;stale:number;samples:Sample[]}>;bytes:number;limit_bytes:number};
type TaskSetting={enabled:boolean;model:string;trigger:string};
type ProviderSetting={preset:string;base_url:string|null;model:string;allow_remote:boolean};
export type Settings={tasks:Record<string,TaskSetting>;embedding_backend:string;provider:ProviderSetting};
export type Run={id:string;state:'running'|'finished'|'paused'|'stopped'|'failed';started_at:string;finished_at:string|null;counts:Record<string,Record<string,number>>;warning:string|null;error:string|null};
export type LocalModelStatus={server:Server;provider:Provider;now:Now|null;queue:Record<string,QueueRow>;recent:Item[];outputs:Outputs;settings:Settings;tasks:Record<string,{label:string;noun:string;prompt_version:string}>;limits:Record<string,number>;active:string[];running:boolean;runs:Run[];labels:Record<string,string>;gpu?:{mode:string;label:string;message:string}|null};
export type Act=(action:string,payload?:Record<string,unknown>)=>Promise<unknown>;

const SERVER_TONE:Record<string,Tone>={ready:'ok',busy:'active',starting:'active',off:'neutral','not-installed':'attention',error:'error'};
const OUTCOME:Record<string,{state:RunState;label:string}>={done:{state:'succeeded',label:'Done'},rejected:{state:'failed',label:'Rejected by validation'},failed:{state:'failed',label:'Failed'},cancelled:{state:'waiting',label:'Cancelled'}};

export const shortModel=(model:string)=>model.split('/').pop()||model;
export const bytes=(n?:number|null)=>n==null?null:n>=1e9?`${(n/1e9).toFixed(1)} GB`:n>=1e6?`${Math.round(n/1e6)} MB`:`${Math.round(n/1e3)} kB`;
const mib=(n:number)=>n>=1024**2?`${(n/1024**2).toFixed(n>=10*1024**2?0:1)} MiB`:`${Math.max(1,Math.round(n/1024))} KiB`;
/** Every piece of machine-written text carries this mark. */
export function MachineMark({model}:{model:string}){return <span className="lm-mark" data-lm="mark" data-reader-decoration="">local model · {shortModel(model)}</span>;}
/** A plural-aware batch summary for the run toast: "Standfirsts: 20 done, 2 rejected". */
export function runSummary(run:Run,labels:Record<string,string>){
  return Object.entries(run.counts).map(([task,c])=>`${labels[task]||task}: ${[['done',c.done],['rejected',c.rejected],['failed',c.failed],['cancelled',c.cancelled]].filter(([,n])=>n).map(([k,n])=>`${n} ${k}`).join(', ')||'nothing finished'}`).join('; ')||'Nothing finished.';
}
function seconds(since:string){return Math.max(0,Math.round((Date.now()-+new Date(since))/1000));}
function Ticking({since}:{since:string}){const [, tick]=useState(0);useEffect(()=>{const t=setInterval(()=>tick(n=>n+1),1000);return ()=>clearInterval(t);},[]);const s=seconds(since);return <>{s<60?`${s} s`:`${Math.floor(s/60)} min ${s%60} s`}</>;}
function ago(value?:string|null){if(!value)return '';const s=seconds(value);return s<45?'just now':s<3600?`${Math.round(s/60)} min ago`:s<86400?`${Math.round(s/3600)} h ago`:new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'});}


const mono='font-mono text-xs';
function ServerCard({server,act}:{server:Server;act:Act}){
  const controlling=server.control?.state==='running',loaded=(key:string)=>server.loaded.find(m=>m.id===key||m.id.split('/').pop()===key.split('/').pop());
  const working=server.state==='busy',provider=server.provider,lms=server.lms;
  return <StatusCard data-lm="server" data-server-state={server.state} data-provider={provider.preset} title={`${provider.label} server`}
    description={<>{server.url} · {provider.loopback?'on this machine':'on another machine'}{lms?'. Other tools on this Mac may share it.':''}</>}
    badge={<StatusBadge id="lm-server-state" tone={SERVER_TONE[server.state]||'neutral'} busy={server.state==='starting'||controlling}>{controlling&&server.state!=='starting'?server.control!.label+'…':server.label}</StatusBadge>}
    footer={lms?<ButtonGroup>
      {!server.running?<Button id="lm-server-start" size="sm" disabled={!server.cli?.installed||controlling||server.state==='starting'} onClick={()=>act('server-start')}>{server.state==='starting'?'Starting…':'Start server'}</Button>
        :<ConfirmAction id="lm-server-stop" confirmId="lm-server-stop-confirm" cancel="Keep running" size="sm" variant="outline" label="Stop server…" disabled={!server.cli?.installed||controlling||working} title="Stop the LM Studio server?"
          description="Other apps using LM Studio will lose it too. Pause the queue first if an item is running." confirm="Stop for every tool" onConfirm={()=>act('server-stop')}/>}
    </ButtonGroup>:undefined}>
    {server.state==='not-installed'?<Notice tone="error" title="LM Studio’s lms command was not found">Looked on PATH and in <code className={mono}>~/.lmstudio/bin</code>. Install LM Studio, set <code className={mono}>READER_LMS</code>, or pick another provider.</Notice>
      :server.state==='off'&&lms?<Notice title="The server is off">Start it to run local-model tasks; it binds to 127.0.0.1:{server.port}.</Notice>
      :server.state==='off'?<Notice id="lm-start-yourself" title={`Nothing answers at ${server.url}`}>Reader does not start {provider.label}; start it yourself.
          {provider.start?<code className={mono+' mt-1 block w-fit max-w-full rounded-sm bg-muted px-1.5 py-0.5 [overflow-wrap:anywhere]'}>{provider.start}</code>:null}<span className="mt-1 block">{provider.hint}</span></Notice>
      :server.state==='error'?<Notice tone="error" role="alert" title="Server error">{server.error}</Notice>:null}
    <FactList facts={[lms?{label:'CLI',value:server.cli?.installed?'Found':'Missing'}:{label:'Control',value:'Start it yourself'},{label:'Port',value:server.port==null?'—':String(server.port)},
      {label:lms?'Loaded':'Models',value:server.running?(lms?server.loaded.length:server.available.length):'—'},
      {label:'Memory',value:lms&&server.running&&server.loaded.length?bytes(server.loaded.reduce((n,m)=>n+(m.size_bytes||0),0))||'—':null}]}/>
    {server.available.length?<ItemGroup data-lm="models" aria-label={lms?'Models on disk':'Models the server lists'} className="gap-0">{server.available.map((m,index)=>{const on=lms?loaded(m.key):undefined;return <Fragment key={m.key}>{index?<ItemSeparator role="presentation" className="my-0"/>:null}
      <UiItem size="xs" role="listitem" className="px-0" data-model={m.key} data-loaded={on?'true':'false'}>
        <ItemContent className="min-w-0"><ItemTitle className="[overflow-wrap:anywhere]">{m.name}{on?<StatusBadge tone="ok" className="ml-1">{on.loaded_by_reader?'Loaded by Reader':'Loaded'}</StatusBadge>:null}</ItemTitle>
          <ItemDescription className="text-xs">{[m.type==='embedding'?'Embedding':m.params,bytes(m.size_bytes),lms?null:'served'].filter(Boolean).join(' · ')}</ItemDescription></ItemContent>
        {!lms?null:<ItemActions>{on?<Button size="xs" variant="outline" data-unload={m.key} disabled={!server.running||controlling||working} onClick={()=>act('unload',{model:on.id})}>Unload</Button>
          :<Button size="xs" variant="outline" data-load={m.key} disabled={!server.running||controlling} onClick={()=>act('load',{model:m.key})}>Load</Button>}</ItemActions>}
      </UiItem></Fragment>;})}</ItemGroup>
      :server.available_error?<span className="text-xs text-muted-foreground">Couldn’t list models: {server.available_error}</span>:null}
  </StatusCard>;
}

const PRESET_ORDER=['lmstudio','ollama','llamacpp','custom'];
function ProviderCard({status,act}:{status:LocalModelStatus;act:Act}){
  const provider=status.provider,saved=status.settings.provider;
  const initial=()=>({preset:saved.preset,base_url:saved.base_url||provider.presets[saved.preset]?.base_url||'',model:saved.model,allow_remote:saved.allow_remote,api_key:''});
  const [draft,setDraft]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const savedKey=JSON.stringify(saved)+provider.base_url+JSON.stringify(provider.api_key);useEffect(()=>{setDraft(initial());setError(null);},[savedKey]);
  const presets=PRESET_ORDER.filter(k=>provider.presets[k]).map(k=>({value:k,label:provider.presets[k].label==='OpenAI-compatible'?'Other OpenAI-compatible server':provider.presets[k].label}));
  const remoteDraft=(()=>{try{const host=new URL(draft.base_url).hostname.replace(/^\[|\]$/g,'');return !(host==='localhost'||host==='::1'||/^127\./.test(host));}catch{return false;}})();
  const models=status.server.available.filter(m=>m.type==='llm').map(m=>m.key);
  const changed=draft.api_key!==''||JSON.stringify({...initial(),api_key:''})!==JSON.stringify({...draft,api_key:''});
  const save=async(extra:Record<string,unknown>={})=>{setBusy(true);setError(null);
    const preset=provider.presets[draft.preset]?.base_url;
    const body:Record<string,unknown>={preset:draft.preset,base_url:draft.base_url&&draft.base_url!==preset?draft.base_url:(draft.preset==='custom'?draft.base_url:null),model:draft.model.trim(),allow_remote:draft.allow_remote,...extra};
    if(draft.api_key)body.api_key=draft.api_key;
    try{const result=await act('settings',{settings:{provider:body}});if(!result)setError('Not saved; see the message.');else setDraft(d=>({...d,api_key:''}));}finally{setBusy(false);}};
  return <form id="lm-provider-form" className="contents" onSubmit={e=>{e.preventDefault();save();}}>
    <StatusCard data-lm="provider" data-provider={provider.preset} data-remote={provider.loopback?'false':'true'} title="Provider"
      description={<>Any OpenAI-compatible server: LM Studio, Ollama, llama.cpp, vLLM, LocalAI, Jan and others. Reader talks to it at its <code className={mono}>/v1</code> base URL and finds models with <code className={mono}>GET /v1/models</code>.</>}
      badge={<StatusBadge id="lm-provider-scope" tone={provider.loopback?'ok':'error'}>{provider.loopback?'This machine only':'Leaves this machine'}</StatusBadge>}
      footer={<Button type="submit" size="sm" id="lm-provider-save" disabled={busy||!changed}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}{busy?'Saving…':'Save provider'}</Button>}>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="lm-preset">Server</FieldLabel><Select items={presets} value={draft.preset} onValueChange={v=>{if(v)setDraft(d=>({...d,preset:v,base_url:provider.presets[v]?.base_url||(v==='custom'?d.base_url:'')}));}}><SelectTrigger id="lm-preset" className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{presets.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="lm-model">Model</FieldLabel><Input id="lm-model" list="lm-model-options" value={draft.model} spellCheck={false} autoComplete="off" placeholder="e.g. llama3.2:3b" onChange={e=>setDraft(d=>({...d,model:e.target.value}))}/>
            <datalist id="lm-model-options">{models.map(m=><option key={m} value={m}/>)}</datalist></Field>
        </div>
        <Field><FieldLabel htmlFor="lm-base-url">Base URL</FieldLabel><Input id="lm-base-url" value={draft.base_url} spellCheck={false} autoComplete="off" inputMode="url" placeholder="http://127.0.0.1:1234/v1" onChange={e=>setDraft(d=>({...d,base_url:e.target.value}))}/>
          <FieldDescription>{provider.presets[draft.preset]?.base_url?`Default for ${provider.presets[draft.preset].label}: ${provider.presets[draft.preset].base_url}`:'The server’s OpenAI-compatible base URL, ending in /v1.'}</FieldDescription></Field>
        <Field><FieldLabel htmlFor="lm-api-key">API key <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
          <Input id="lm-api-key" type="password" value={draft.api_key} autoComplete="off" spellCheck={false} disabled={provider.api_key.source==='environment'} placeholder={provider.api_key.source==='environment'?`Set by ${provider.api_key.env}`:provider.api_key.set?'Saved · type to replace':'Most local servers need none'} onChange={e=>setDraft(d=>({...d,api_key:e.target.value}))}/>
          <FieldDescription>Kept in <code className={mono}>.reader/local-model/api-key</code> (git-ignored, owner-only) or <code className={mono}>{provider.api_key.env}</code>; never shown, logged or written to settings.{provider.api_key.source==='file'?<> <Button type="button" variant="link" size="xs" className="h-auto p-0" id="lm-api-key-clear" onClick={()=>save({api_key:null})}>Remove saved key</Button></>:null}</FieldDescription></Field>
        <Field orientation="horizontal"><FieldLabel htmlFor="lm-allow-remote">Allow a server on another machine</FieldLabel><Switch id="lm-allow-remote" checked={draft.allow_remote} onCheckedChange={v=>setDraft(d=>({...d,allow_remote:v}))}/></Field>
        {draft.allow_remote||remoteDraft?<Notice id="lm-remote-warning" role="note" data-lm={remoteDraft&&!draft.allow_remote?'remote-refused':'remote-warning'} tone={remoteDraft&&!draft.allow_remote?'error':'info'}
          title={remoteDraft&&!draft.allow_remote?'This URL is not on this machine':'Text leaves this machine'}>{remoteDraft&&!draft.allow_remote?'Reader refuses it unless you allow a server on another machine.'
          :'With this on, a non-loopback URL is accepted, and the text of every queued document, its title and the prompt are sent to that server. They leave this machine. Use a server you trust, over https where you can.'}</Notice>:null}
        {error?<Notice tone="error" title={error}/>:null}
      </FieldGroup>
    </StatusCard>
  </form>;
}

function NowCard({status,act}:{status:LocalModelStatus;act:Act}){
  const now=status.now,waiting=Object.values(status.queue).reduce((n,q)=>n+q.waiting,0),last=status.runs.find(r=>r.state!=='running');
  return <StatusCard data-lm="now" data-now={now?'running':'idle'} title="Now"
    description={now?`${now.task_label} · ${waiting.toLocaleString()} more waiting`:status.provider.loopback?`One item at a time; the GPU lock (${status.gpu?.mode==='local'?'this Reader only':'workstation'}) is held per batch of up to ${status.limits.batch}.`:'One item at a time, sent to the remote provider.'}
    badge={now?<StatusBadge tone="active" busy>Running</StatusBadge>:null}
    footer={now?<><ButtonGroup><Button id="lm-pause" size="sm" variant="outline" onClick={()=>act('pause')}>Pause queue</Button><Button id="lm-cancel" size="sm" variant="outline" onClick={()=>act('cancel',{id:now.id})}>Cancel item</Button></ButtonGroup><span className="text-xs text-muted-foreground">Pause finishes this item first.</span></>:undefined}>
    {now?<>
      <UiItem size="xs" className="px-0"><ItemContent className="min-w-0"><ItemTitle className="[overflow-wrap:anywhere]">{now.title}</ItemTitle><ItemDescription className={mono+' [overflow-wrap:anywhere]'}>{now.path}</ItemDescription></ItemContent></UiItem>
      <FactList facts={[{label:'Model',value:shortModel(now.model)},{label:'Elapsed',value:<Ticking since={now.started_at}/>},{key:'Speed',label:'Speed',value:<span id="lm-rate">{now.tokens_per_second?`${now.tokens_per_second} tok/s`:'—'}</span>},{label:'Tokens',value:now.tokens}]}/>
      <UiItem variant="muted" size="sm" className="lm-preview" id="lm-preview" aria-live="off" data-reader-decoration=""><ItemContent className="min-w-0">{now.preview?<p>{now.preview}<span className="lm-caret" aria-hidden/></p>:<p className="lm-thinking" data-lm="thinking">{now.thinking?'Thinking… '+now.thinking.slice(-160):'Waiting for the first token…'}</p>}<MachineMark model={now.model}/></ItemContent></UiItem>
    </>:<>
      <span className="text-sm text-muted-foreground">{waiting?`Nothing running. ${waiting.toLocaleString()} waiting; press Run on a task below.`:'Nothing running and nothing waiting.'}</span>
      {last?<UiItem size="xs" variant="muted" data-last-run={last.state}><ItemContent><ItemDescription className="text-xs">Last run · {ago(last.finished_at)}</ItemDescription>
        <ItemTitle className="line-clamp-none font-normal">{runSummary(last,status.labels)}{last.error?<span className="text-destructive"> · {last.error}</span>:null}</ItemTitle></ItemContent></UiItem>:null}</>}
  </StatusCard>;
}

function QueueCard({status,act}:{status:LocalModelStatus;act:Act}){
  const ready=status.server.running;
  return <StatusCard data-lm="queue" title="Queue" description="Waiting items, grouped by task. Queue recent works or the whole library; works with a current output are skipped.">
    <ItemGroup className="gap-0">{Object.entries(status.queue).map(([task,row],index)=>{const enabled=status.settings.tasks[task]?.enabled!==false;
      return <Fragment key={task}>{index?<ItemSeparator role="presentation"/>:null}<UiItem size="xs" role="listitem" className="px-0" data-queue={task} data-active={row.active?'true':'false'}>
        <ItemContent className="min-w-0">
          <ItemTitle>{row.label} <span className="font-normal text-muted-foreground tabular-nums" data-lm="count" data-waiting={row.waiting}>{row.waiting.toLocaleString()} waiting</span></ItemTitle>
          <ItemDescription className="text-xs">{row.running?'Running':row.active&&row.waiting?'Up next':row.waiting?'Held until you press Run':enabled?'Idle':'Turned off in settings'}</ItemDescription>
          {row.next.length?<ItemDescription className="text-xs [overflow-wrap:anywhere]">Next: {row.next.map(n=>n.title).join(' · ')}</ItemDescription>:null}
        </ItemContent>
        <ItemFooter className="flex-wrap justify-start gap-2">
          <ButtonGroup aria-label={`${row.label} queue`}>
            <Button size="xs" data-run={task} disabled={!row.waiting||(row.active&&status.running)||!ready} title={!ready?'Start the server first':undefined} onClick={()=>act('run',{task})}>Run</Button>
            <Button size="xs" variant="outline" data-pause={task} disabled={!row.active} onClick={()=>act('pause',{task})}>Pause</Button>
            <Button size="xs" variant="outline" data-clear={task} disabled={!row.waiting} onClick={()=>act('clear',{task})}>Clear</Button></ButtonGroup>
          <ButtonGroup aria-label={`Queue ${row.label}`}><Button size="xs" variant="outline" data-enqueue={task} data-scope="recent" disabled={!enabled} onClick={()=>act('enqueue',{task,scope:'recent'})}>Queue 20 recent</Button>
            <Button size="xs" variant="outline" data-enqueue={task} data-scope="all" disabled={!enabled} onClick={()=>act('enqueue',{task,scope:'all'})}>Queue all</Button></ButtonGroup>
        </ItemFooter></UiItem></Fragment>;})}</ItemGroup>
  </StatusCard>;
}

function RecentCard({items}:{items:Item[]}){
  return <StatusCard data-lm="recent" title="Recent" description={`The last ${items.length||50} finished items. Open one for its prompt version, output and any rejection reason.`}>
    {items.length?<ItemGroup data-lm="items" className="gap-0">{items.map((item,index)=><Fragment key={item.id}>{index?<ItemSeparator role="presentation" className="my-0"/>:null}
      <Collapsible role="listitem" data-item-state={item.state} data-item={item.id}>
        <CollapsibleTrigger data-lm="item-trigger" render={<UiItem size="xs" className="cursor-pointer px-0 text-left hover:bg-muted/50" render={<button type="button"/>}/>}>
          <ItemMedia variant="icon"><RunStateIcon state={OUTCOME[item.state]?.state||'waiting'}/></ItemMedia>
          <ItemContent className="min-w-0"><ItemTitle className="[overflow-wrap:anywhere]">{item.title}</ItemTitle>
            <ItemDescription className="text-xs">{OUTCOME[item.state]?.label} · {item.task_label} · {shortModel(item.model)}{item.duration_seconds!=null?` · ${item.duration_seconds} s`:''} · {ago(item.finished_at)}</ItemDescription></ItemContent>
          <ItemActions><ChevronRightIcon className="size-4 text-muted-foreground transition-transform in-data-[panel-open]:rotate-90" aria-hidden/></ItemActions>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pb-3 pl-8">
          <FactList facts={[{label:'Prompt',value:item.prompt_version},{label:'Source',value:<span className={mono+' [overflow-wrap:anywhere]'}>{item.path}</span>},{label:'Speed',value:item.tokens_per_second?`${item.tokens_per_second} tok/s`:null},{label:'Input',value:item.truncated?'Truncated at a heading':null}]}/>
          {item.error?<Notice data-lm="reason" tone={item.state==='cancelled'?'info':'error'} title={(item.state==='rejected'?'Rejected: ':'')+item.error}/>:null}
          {item.display||item.output?<UiItem variant="muted" size="sm" render={<blockquote/>} className="lm-output m-0" data-lm="output" data-reader-decoration=""><ItemContent className="min-w-0">{item.display||item.output}<MachineMark model={item.model}/></ItemContent></UiItem>:null}
        </CollapsibleContent>
      </Collapsible></Fragment>)}</ItemGroup>:<span className="text-sm text-muted-foreground">No local-model items have finished yet.</span>}
  </StatusCard>;
}

function OutputsCard({outputs,act}:{outputs:Outputs;act:Act}){
  return <StatusCard data-lm="outputs" title="Outputs in use" description="A rebuildable cache in .reader/local-model/, keyed by source hash, model and prompt version. Never written into vault files."
    footer={<span className="text-xs text-muted-foreground">Cache {outputs.bytes?mib(outputs.bytes):'empty'} of {mib(outputs.limit_bytes)}. Stale outputs belong to an older edition of their source and are never shown as current.</span>}>
    <ItemGroup className="gap-4">{Object.entries(outputs.tasks).map(([task,o])=><div key={task} role="listitem" className="flex flex-col gap-2" data-outputs={task}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{o.label}</span>{o.stale?<Button size="xs" variant="outline" data-prune={task} onClick={()=>act('prune',{task})}>Remove {o.stale} stale</Button>:null}</div>
      <FactList facts={[{label:'Current',value:<span data-current={o.current}>{o.current.toLocaleString()}</span>},{label:'Stale',value:<span data-stale={o.stale}>{o.stale.toLocaleString()}</span>},{label:'Cached',value:o.cached}]}/>
      {o.samples.slice(0,2).map(s=><UiItem key={s.path+s.created_at} variant="muted" size="sm" render={<blockquote/>} className="lm-output m-0" data-lm="sample" data-reader-decoration=""><ItemContent className="min-w-0"><ItemDescription className="font-mono text-[10px]">{s.path}</ItemDescription>{s.text}<MachineMark model={s.model}/></ItemContent></UiItem>)}</div>)}</ItemGroup>
  </StatusCard>;
}

function SettingsCard({status,act}:{status:LocalModelStatus;act:Act}){
  const [draft,setDraft]=useState<Settings>(status.settings),[busy,setBusy]=useState(false);
  const saved=JSON.stringify(status.settings);useEffect(()=>{setDraft(JSON.parse(saved));},[saved]);
  const llms=status.server.available.filter(m=>m.type==='llm').map(m=>m.key),embeds=status.server.available.filter(m=>m.type==='embedding').map(m=>m.key);
  const fallback=status.settings.provider.model,providerLabel=status.provider.label;
  const options=(current:string,keys:string[])=>[{value:'',label:fallback?`Provider model (${shortModel(fallback)})`:'Provider model (none set)'},...[...new Set([current,...keys])].filter(Boolean).map(key=>({value:key,label:shortModel(key)}))];
  const setTask=(task:string,patch:Partial<TaskSetting>)=>setDraft(d=>({...d,tasks:{...d.tasks,[task]:{...d.tasks[task],...patch}}}));
  const legacy=draft.embedding_backend.startsWith('lmstudio:')?[{value:draft.embedding_backend,label:shortModel(draft.embedding_backend.slice(9))+' (provider, older setting)'}]:[];
  const chosen=draft.embedding_backend.startsWith('openai:')?[draft.embedding_backend.slice(7)]:[];
  const embedItems=[{value:'fastembed',label:'bge-small (built in)'},...legacy,...[...new Set([...chosen,...embeds])].map(key=>({value:'openai:'+key,label:`${shortModel(key)} (${providerLabel})`}))];
  return <form id="lm-settings-form" className="contents" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await act('settings',{settings:draft});}finally{setBusy(false);}}}>
    <StatusCard data-lm="settings" title="Tasks" description="Which tasks may run, on which model. Runs start only when you press Run."
      footer={<Button type="submit" size="sm" disabled={busy||JSON.stringify(draft)===saved}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}{busy?'Saving…':'Save task settings'}</Button>}>
      <FieldGroup>
        {Object.entries(draft.tasks).map(([task,t])=><FieldGroup key={task} className="gap-3 border-b pb-4" data-setting={task}>
          <Field orientation="horizontal"><FieldLabel htmlFor={'lm-enabled-'+task}>{status.tasks[task]?.label||task}</FieldLabel><Switch id={'lm-enabled-'+task} checked={t.enabled} onCheckedChange={v=>setTask(task,{enabled:v})}/></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor={'lm-model-'+task}>Model</FieldLabel><Select items={options(t.model,llms)} value={t.model} onValueChange={v=>{if(v!=null)setTask(task,{model:v});}}><SelectTrigger id={'lm-model-'+task} className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{options(t.model,llms).map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor={'lm-trigger-'+task}>Trigger</FieldLabel><Select items={[{value:'manual',label:'On request'}]} value={t.trigger} onValueChange={v=>{if(v)setTask(task,{trigger:v});}}><SelectTrigger id={'lm-trigger-'+task} className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup><SelectItem value="manual">On request</SelectItem><SelectItem value="nightly" disabled>Nightly (not yet)</SelectItem><SelectItem value="idle" disabled>When idle (not yet)</SelectItem></SelectGroup></SelectContent></Select></Field>
          </div></FieldGroup>)}
        <Field><FieldLabel htmlFor="lm-embedding">Search embeddings</FieldLabel><Select items={embedItems} value={draft.embedding_backend} onValueChange={v=>{if(v)setDraft(d=>({...d,embedding_backend:v}));}}><SelectTrigger id="lm-embedding" className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{embedItems.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
          <FieldDescription>Switching re-embeds the whole library at the next search-index rebuild. Provider embeddings need the server running for every search{status.provider.loopback?'':', and send every query to it'}.</FieldDescription></Field>
      </FieldGroup>
    </StatusCard>
  </form>;
}

export function LocalModelSection({status,act}:{status:LocalModelStatus|null;act:Act}){
  return <section className="flex flex-col gap-6" id="local-model" aria-label="Local model">
    <Toolbar media={status?.running?<Spinner aria-hidden/>:null} status={<>{status?status.running?'Working through the queue':status.server.label:'Loading…'}<span className="mt-1 block text-muted-foreground">Bulk, private, judgment-light language work on a model you run. Outputs are suggestions labelled with their model; filing, catalog writes and anything signed by a voice stay with the voices.</span></>}/>
    {status?.gpu&&status.provider?.loopback?<Notice id="lm-gpu" data-gpu={status.gpu.mode} title={`GPU coordination: ${status.gpu.label}.`}>{status.gpu.message}</Notice>:null}
    {status?.provider?.remote_notice?<Notice id="lm-remote-notice" tone="error" role="alert" title="Text leaves this machine.">{status.provider.remote_notice}</Notice>:null}
    {status?<>
      <CardGrid><ProviderCard status={status} act={act}/><ServerCard server={status.server} act={act}/></CardGrid>
      <CardGrid><NowCard status={status} act={act}/><QueueCard status={status} act={act}/></CardGrid>
      <CardGrid><RecentCard items={status.recent}/><OutputsCard outputs={status.outputs} act={act}/></CardGrid>
      <SettingsCard status={status} act={act}/></>
     :<LoadingState>Loading local-model status…</LoadingState>}
  </section>;
}
