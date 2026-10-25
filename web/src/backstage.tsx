/* Behind the scenes: index freshness, on-demand rebuilds and settings. */
import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Loader2Icon, MailIcon, SquareIcon} from 'lucide-react';
import {toast} from 'sonner';
import {ActivityTranscript} from './activity/transcript';
import type {ActivityModel} from './reader-controls';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';
import {Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter} from './components/ui/card';
import {plural} from './plural';

export type Job={id:string;kind:string;label:string;quiet?:boolean;state:'running'|'succeeded'|'failed';started_at:string;finished_at:string|null;elapsed_seconds:number|null;result:Record<string,unknown>|null;error:string|null};
export type Check={state:string;message?:string;checked_at:string;built_at?:string|null;[key:string]:unknown};
export type MaintenanceStatus={running:Job|null;jobs:Job[];checks:Record<string,Check>;checking:boolean;kinds:Record<string,string>;local_model?:{running:boolean;runs:import('./local-model').Run[];labels:Record<string,string>}};

type Fact=[label:string,value:(check:Check)=>unknown];
const count=(v:unknown)=>typeof v==='number'?v.toLocaleString():null;
/** "61,204 of 400,000" from a [used, limit] pair. */
export function of(pair:unknown){return Array.isArray(pair)&&typeof pair[0]==='number'?`${count(pair[0])} of ${count(pair[1])}`:null;}
/** "0.4 of 2 GiB" (or MiB below a GiB budget) from a [bytes, limit] pair. */
export function budget(pair:unknown){
  if(!Array.isArray(pair)||typeof pair[0]!=='number'||typeof pair[1]!=='number')return null;
  const [unit,div]=pair[1]>=2**30?['GiB',2**30]:['MiB',2**20],fmt=(b:number)=>{const v=b/div;return v>=10||Number.isInteger(v)?String(Math.round(v)):v.toFixed(1);};
  return `${fmt(pair[0])} of ${fmt(pair[1])} ${unit}`;
}
const usage=(key:string,format:(pair:unknown)=>string|null)=>(c:Check)=>format((c.usage as Record<string,unknown>|undefined)?.[key]);
const item=(key:string)=>(c:Check)=>{const found=(c.items as {key:string;used:number|null;limit:number}[]|undefined)?.find(i=>i.key===key);return found?(found.used===null?'Unknown':of([found.used,found.limit])):null;};
type Index={key:string;title:string;description:string;note?:string;facts:Fact[];actions:{kind:string;label:string;primary?:boolean}[]};
const INDEXES:Index[]=[
  {key:'search',title:'Search index',description:'Contents and Semantic search, and the Read next suggestions at the end of an article.',
   facts:[['Built',c=>when(c.built_at)],['Library files',c=>c.files],['Indexed',c=>c.documents],['Passages',usage('passages',of)],
     ['Database',usage('database',budget)],['Embedding cache',usage('cache',budget)],
     ['Machine files',c=>typeof c.path_only_machine==='number'?`${count(c.path_only_machine)} indexed by path only`:null],['Text without embeddings',c=>c.unembedded]],
   actions:[{kind:'search',label:'Rebuild with embeddings',primary:true},{kind:'search-keyword',label:'Keywords only'}]},
  {key:'browse',title:'Browse indexes',description:'Grouped Markdown indexes, the README dashboard, and the work inventory this app lists.',
   note:'Refreshing writes indexes/ and README.md in the vault; commit them afterwards.',
   facts:[['Built',c=>c.built_at],['Works',c=>c.works],['Files that would change',c=>c.changed]],
   actions:[{kind:'browse',label:'Refresh',primary:true}]},
  {key:'catalog',title:'Catalog SQL mirror',description:'A SQLite copy of catalog frontmatter, for queries and integrity checks.',
   facts:[['Built',c=>when(c.built_at)],['Records',c=>c.documents],['Library files',usage('files',of)],['Sources',usage('sources',budget)]],
   actions:[{kind:'catalog',label:'Sync',primary:true}]},
  {key:'links',title:'Link graph',description:'Link previews and the Linked from list at the end of an article.',
   note:'Builds itself the first time you open a document. Refresh re-reads only files whose size or time changed.',
   facts:[['Built',c=>when(c.built_at)],['Documents read',c=>c.documents],['Links',c=>c.links],['Unresolved',c=>c.unresolved]],
   actions:[{kind:'links',label:'Refresh',primary:true}]},
  {key:'limits',title:'Other inventories',description:'Collections Reader reads in full. Each refuses clearly at its limit instead of slowing down.',
   facts:[['Works',item('works')],['Inbox files',item('inbox')],['Reading participants',item('participants')],['Annotation threads',item('threads')]],
   actions:[]},
];
const INDEX_OF:Record<string,string>={search:'search','search-keyword':'search','remove-legacy-search':'search',browse:'browse',catalog:'catalog',links:'links'};
const STATES:Record<string,{label:string;variant:'secondary'|'outline'|'destructive'|'default'}>={
  current:{label:'Current',variant:'secondary'},stale:{label:'Needs rebuild',variant:'outline'},partial:{label:'Partial',variant:'outline'},
  missing:{label:'Not built',variant:'outline'},unconfigured:{label:'Not configured',variant:'outline'},error:{label:'Error',variant:'destructive'},
  ok:{label:'Within limits',variant:'secondary'},near:{label:'Near a limit',variant:'outline'},over:{label:'Over a limit',variant:'destructive'}};

export function when(value:unknown){
  if(typeof value!=='string'||!value)return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return new Date(value+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});   // a calendar date, as written
  const date=new Date(value);if(Number.isNaN(+date))return value;
  const seconds=Math.round((Date.now()-+date)/1000);
  if(seconds<45)return 'just now';if(seconds<3600)return Math.round(seconds/60)+' min ago';if(seconds<86400)return Math.round(seconds/3600)+' h ago';
  return date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function Elapsed({since}:{since:string}){
  const [, tick]=useState(0);useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),1000);return ()=>clearInterval(timer);},[]);
  return <>{Math.max(0,Math.round((Date.now()-+new Date(since))/1000))} s</>;
}
function summary(job:Job){
  if(job.state==='failed')return job.error;
  const r=job.result||{};
  if((job.kind==='search'||job.kind==='search-keyword')&&r.complete===false&&r.message)return String(r.message);
  if(job.kind==='search'||job.kind==='search-keyword')return `${r.changed} changed · ${r.removed} removed · ${plural(r.documents,'document')}${typeof r.passages==='number'?` · ${r.passages.toLocaleString()} passages`:''}${r.issues?` · ${r.issues} unreadable`:''}`;
  if(job.kind==='browse')return `${plural(r.changed,'navigation file')} updated · ${plural(r.works,'work')}`;
  if(job.kind==='catalog')return `${plural(r.documents,'record')} ${r.status}`;
  if(job.kind==='links')return `${r.parsed} read · ${r.links} links · ${r.unresolved} unresolved`;
  if(job.kind==='remove-legacy-search')return `${Math.round(Number(r.freed_bytes)/1e6).toLocaleString()} MB freed`;
  if(job.kind==='check')return Object.entries(r).map(([k,v])=>`${k} ${v}`).join(' · ');
  return null;
}

/** A DOM slot React renders once and never touches again: the vanilla dashboard owns its contents. */
function Slot({id,mount}:{id:string;mount:(element:HTMLElement)=>void}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(ref.current)mount(ref.current);},[mount]);
  return <div id={id} ref={ref}/>;
}

type EditionStats={stats:{files:number;families:number;unresolved:number;build_ms?:number;partial:boolean;header_bytes:number};unresolved:{path:string;field:string;value:string}[]};
/** Edition links: families found and the references that could not be resolved (never guessed or repaired). */
export function EditionLinks({api}:{api:(path:string)=>Promise<any>}){
  const [data,setData]=useState<EditionStats|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{let live=true;api('/api/editions/diagnostics').then(d=>{if(live)setData(d);},e=>{if(live)setError(e instanceof Error?e.message:String(e));});return ()=>{live=false;};},[api]);
  return <Card size="sm" className="backstage-card" id="edition-links" data-state={data?(data.stats.unresolved?'unresolved':'current'):error?'error':'loading'}>
    <CardHeader><CardTitle>Edition links</CardTitle><CardDescription>Originals, reading copies and numbered versions, linked from frontmatter and file names. Read-only: nothing is repaired.</CardDescription>
      <CardAction><Badge variant={error?'destructive':data?.stats.unresolved?'outline':'secondary'} className="backstage-badge">{error?'Error':!data?'Loading…':data.stats.unresolved?`${data.stats.unresolved} unresolved`:'All resolved'}</Badge></CardAction></CardHeader>
    <CardContent>{error?<p className="backstage-message backstage-error">{error}</p>:data?<>
      <dl className="backstage-facts"><div><dt>Families</dt><dd>{data.stats.families.toLocaleString()}</dd></div><div><dt>Markdown files</dt><dd>{data.stats.files.toLocaleString()}</dd></div>{data.stats.build_ms!==undefined?<div><dt>Index built in</dt><dd>{Math.round(data.stats.build_ms)} ms</dd></div>:null}{data.stats.partial?<div><dt>Coverage</dt><dd>Partial (limits reached)</dd></div>:null}</dl>
      {data.unresolved.length?<ul className="backstage-unresolved">{data.unresolved.map(u=><li key={u.path+u.field}><code>{u.path}</code><small>{u.field}: {u.value}</small></li>)}</ul>:null}</>:null}</CardContent></Card>;
}

type LegacyIndex={format:number;bytes:number;serving:boolean;removable:boolean};
/** The format 1 index older Reader processes still use. Removal is explicit and refused while it serves search. */
function Legacy({legacy,busy,onRemove}:{legacy:LegacyIndex;busy:boolean;onRemove:()=>void}){
  const mb=Math.max(1,Math.round(legacy.bytes/1e6)).toLocaleString();
  return <p className="backstage-note backstage-legacy" data-legacy={legacy.serving?'serving':'idle'}>
    Legacy index (format {legacy.format}, used by older Reader processes): {mb} MB
    {legacy.serving?<> · serving search until a format 2 build completes</>:<> · <Button data-job="remove-legacy-search" variant="link" size="xs" className="backstage-legacy-remove" disabled={busy}
      title="Deletes .reader/search.sqlite3 only. Refused while an index run or another process is using it." onClick={onRemove}>Remove</Button></>}
  </p>;
}

export function Backstage({status,onStart,settings,themeEditor,library,inbox,inboxFirst,editions,localModel,server}:{status:MaintenanceStatus|null;onStart:(kind:string)=>void;settings:ReactNode;themeEditor:()=>void;server?:ReactNode;library?:(element:HTMLElement)=>void;inbox:ReactNode;inboxFirst:boolean;editions?:ReactNode;localModel?:ReactNode}){
  const running=status?.running,busy=!!running||!!status?.checking,checkedAt=Object.values(status?.checks||{})[0]?.checked_at;
  const mail=<section className="backstage-section" id="backstage-inbox" aria-label="Inbox">{inbox}</section>;
  return <div className="backstage" id="backstage">
    <header className="backstage-header"><div className="eyebrow">Behind the scenes</div><h1 id="backstage-title">How the library is kept.</h1>
      <p>Indexes are rebuildable copies of what the vault already holds. Check whether they have drifted, rebuild one when it has, look over the library’s statistics, and keep your reading settings here.</p></header>
    {inboxFirst?mail:null}
    <section className="backstage-section" aria-labelledby="indexes-title">
      <div className="backstage-section-head"><h2 id="indexes-title">Indexes</h2><span className="backstage-checked" aria-live="polite">{status?.checking||running?.kind==='check'?<><Loader2Icon className="size-3 animate-spin" aria-hidden/> Checking…</>:checkedAt?'Checked '+when(checkedAt):'Not checked yet'}</span>
        <Button id="maintenance-check" variant="outline" size="sm" disabled={busy} onClick={()=>onStart('check')}>Check again</Button></div>
      <div className="backstage-grid">{INDEXES.map(index=>{
        const check=status?.checks?.[index.key],active=running&&INDEX_OF[running.kind]===index.key;
        const state=active?{label:'Rebuilding…',variant:'default' as const}:check?STATES[check.state]||{label:check.state,variant:'outline' as const}:{label:status?'Checking…':'Loading…',variant:'outline' as const};
        return <Card key={index.key} size="sm" className="backstage-card" data-index={index.key} data-state={active?'running':check?.state||'unknown'}>
          <CardHeader><CardTitle>{index.title}</CardTitle><CardDescription>{index.description}</CardDescription>
            <CardAction><Badge variant={state.variant} className="backstage-badge">{active?<Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden/>:null}{state.label}</Badge></CardAction></CardHeader>
          <CardContent>
            {active?<p className="backstage-message">{running!.label} running for <Elapsed since={running!.started_at}/>.</p>:check?.message?<p className="backstage-message">{check.message}</p>:null}
            {check?<dl className="backstage-facts">{index.facts.map(([label,value])=>{const v=value(check);return v===undefined||v===null?null:<div key={label} data-fact={label}><dt>{label}</dt><dd>{typeof v==='number'?v.toLocaleString():String(v)}</dd></div>;})}</dl>:null}
            {index.note?<p className="backstage-note">{index.note}</p>:null}
            {index.key==='search'&&check?.legacy?<Legacy legacy={check.legacy as LegacyIndex} busy={busy} onRemove={()=>onStart('remove-legacy-search')}/>:null}
          </CardContent>
          {index.actions.length?<CardFooter><ButtonGroup>{index.actions.map(action=><Button key={action.kind} data-job={action.kind} variant={action.primary?'default':'outline'} size="sm" disabled={busy} onClick={()=>onStart(action.kind)}>{action.label}</Button>)}</ButtonGroup></CardFooter>:null}
        </Card>;})}</div>
      <Card size="sm" className="backstage-card"><CardHeader><CardTitle>Recent runs</CardTitle><CardDescription>This server’s jobs since it started. Toasts announce each start, finish and failure.</CardDescription></CardHeader>
        <CardContent>{status?.jobs.length||running?<ol className="backstage-jobs">{[...(running?[running]:[]),...status!.jobs].slice(0,10).map(job=><li key={job.id+job.state} data-job-state={job.state}>
          <span className="backstage-job-state">{job.state==='running'?<Loader2Icon className="size-3 animate-spin" aria-label="Running"/>:job.state==='succeeded'?'✓':'✕'}</span>
          <span><strong>{job.label}</strong><small>{job.state==='running'?<>Started {when(job.started_at)}</>:<>{when(job.finished_at)} · {job.elapsed_seconds} s</>}</small>{job.state!=='running'&&summary(job)?<small className={job.state==='failed'?'backstage-error':''}>{summary(job)}</small>:null}</span></li>)}</ol>
          :<p className="backstage-message">No runs yet.</p>}</CardContent></Card>
      {editions}
    </section>
    {/* The running service sits beside the indexes it serves. */}
    {server?<section className="backstage-section" id="backstage-server" aria-labelledby="server-title">
      <div className="backstage-section-head"><h2 id="server-title">Service</h2></div>{server}</section>:null}
    {inboxFirst?null:mail}
    {localModel}
    {library?<section className="backstage-section backstage-library" id="backstage-library" aria-labelledby="library-title">
      <div className="backstage-section-head"><h2 id="library-title">Library</h2><span className="backstage-checked">Holdings, arrivals, reading and the margins</span></div>
      <Slot id="backstage-library-mount" mount={library}/>
    </section>:null}
    <section className="backstage-section" id="backstage-settings" aria-labelledby="settings-title">
      <div className="backstage-section-head"><h2 id="settings-title">Settings</h2><Button id="theme-editor-open" variant="outline" size="sm" onClick={themeEditor}>Theme Editor…</Button></div>
      <Card size="sm" className="backstage-card">{settings}</Card>
    </section>
  </div>;
}

// Inbox: what is waiting, and You got mail, which starts the existing librarian inbox runner.
export type Arrival={id:string;path:string;bundle:boolean;document:string;title:string;source:string|null;project:string|null;author:string|null;report_date:string|null;request_id:string|null;integrity:'intact'|'changed'|null;receipt_error:string|null;files:number;bytes:number;received_at:string|null};
export type InboxRun={status:string;run_id:string|null;started_at:string|null;updated_at:string|null;finished_at:string|null;message:string;arrivals:number|null;remaining:number|null;exit_code:number|null;sandbox_mode:string|null;event?:string|null;report_md?:string|null;report_truncated?:boolean;commit?:{hash:string;short:string;subject:string}|null};
export type InboxStatus={arrivals:Arrival[];runner:InboxRun|null;claims_held:string[];codex:string|null;errors:string[];blocked:{reason:string;message:string}|null};
const ACTIVE_RUN=['starting','running'];
const RUN_STATES:Record<string,{label:string;variant:'secondary'|'outline'|'destructive'|'default'}>={
  starting:{label:'Starting…',variant:'default'},running:{label:'Librarian reading',variant:'default'},finished:{label:'Filed',variant:'secondary'},
  empty:{label:'Nothing to file',variant:'outline'},stopped:{label:'Stopped',variant:'outline'},failed:{label:'Failed',variant:'destructive'},interrupted:{label:'Interrupted',variant:'destructive'}};
export function size(bytes:number){return bytes<1024?bytes+' B':bytes<1024**2?(bytes/1024).toFixed(1)+' KB':(bytes/1024**2).toFixed(1)+' MB';}
function Clock({since}:{since:string}){
  const [, tick]=useState(0);useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),1000);return ()=>clearInterval(timer);},[]);
  const seconds=Math.max(0,Math.round((Date.now()-+new Date(since))/1000));return <>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</>;
}
function Report({markdown,html,onOpen}:{markdown:string;html:(text:string)=>string;onOpen:(path:string)=>void}){
  // Sanitized by DOMPurify; vault links open in the reader, others in a new tab.
  const click=(event:React.MouseEvent<HTMLDivElement>)=>{
    const link=(event.target as HTMLElement).closest('a');if(!link)return;event.preventDefault();
    const href=link.getAttribute('href')||'';
    if(/^https?:/i.test(href)){window.open(href,'_blank','noopener,noreferrer');return;}
    const path=decodeURIComponent(href.split('#')[0]);
    if(/^(library|inbox)\//.test(path))onOpen(path);else toast(`${path} is outside the library; open it in the vault.`);
  };
  return <div id="inbox-report" className="inbox-report" data-reader-decoration="" onClick={click} dangerouslySetInnerHTML={{__html:html(markdown)}}/>;
}
export function Inbox({status,starting,onMail,onStop,onOpen,html,activity}:{status:InboxStatus|null;starting:boolean;onMail:()=>void;onStop:()=>void;onOpen:(path:string)=>void;html:(text:string)=>string;activity:ActivityModel|null}){
  const arrivals=status?.arrivals||[],run=status?.runner,active=starting||ACTIVE_RUN.includes(run?.status||''),blocked=status?.blocked;
  const state=starting&&!active?RUN_STATES.starting:run?RUN_STATES[run.status]||{label:run.status,variant:'outline' as const}:null;
  const disabled=!status||starting||!!blocked;
  const report=()=>{const details=document.getElementById('inbox-report-wrap') as HTMLDetailsElement|null;if(details){details.open=true;details.scrollIntoView({block:'start',behavior:'smooth'});}};
  const transcript=activity?.run?<ActivityTranscript activity={activity.activity} run={activity.run} live={active||!activity.done} html={html} onOpen={onOpen} onReport={run?.report_md?report:undefined}/>:null;
  return <Card size="sm" className="backstage-card inbox-card" id="inbox" data-run-state={starting?'starting':run?.status||'none'} aria-labelledby="inbox-title">
    <CardHeader><CardTitle id="inbox-title">Inbox</CardTitle>
      <CardDescription>{!status?'Looking in the inbox…':arrivals.length?`${plural(arrivals.length,'arrival')} waiting to be filed. Opening one previews it; it is not marked read.`:'No arrivals are waiting.'}</CardDescription>
      {state?<CardAction><Badge variant={state.variant} className="backstage-badge" data-inbox-badge="">{active?<Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden/>:null}{state.label}</Badge></CardAction>:null}</CardHeader>
    <CardContent>
      <div className="inbox-mail">
        <Button id="inbox-mail" size="lg" disabled={disabled} onClick={onMail} aria-describedby="inbox-mail-note">{active?<Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden/>:<MailIcon data-icon="inline-start" aria-hidden/>}You got mail</Button>
        <p id="inbox-mail-note" className="inbox-mail-note">{active?'The librarian is reading the mail.':blocked?<span id="inbox-blocked" data-reason={blocked.reason} className={['interrupted','error','codex'].includes(blocked.reason)?'backstage-error':''}>{blocked.message}</span>:`Ask the librarian to file ${plural(arrivals.length,'arrival')}.`}</p>
      </div>
      {active?<div className="inbox-run" aria-live="polite">
        <p className="backstage-message">{starting&&!run?.started_at?'Starting the librarian…':<>Running for {run?.started_at?<Clock since={run.started_at}/>:'…'}{run?.arrivals?<> · {plural(run.arrivals,'arrival')}</>:null}{run?.sandbox_mode==='danger-full-access'?' · Host access':''}</>}</p>
        {transcript||(run?.event?<p className="inbox-event" title={run.event}>{run.event}</p>:null)}
        <Button id="inbox-stop" variant="outline" size="sm" disabled={starting&&!run?.started_at} onClick={onStop}><SquareIcon data-icon="inline-start" aria-hidden/>Stop</Button>
      </div>:run&&!ACTIVE_RUN.includes(run.status)?<div className="inbox-run" data-finished="">
        <p className={'backstage-message'+(['failed','interrupted'].includes(run.status)?' backstage-error':'')} id="inbox-run-message">{run.message}{run.finished_at?<small> · {when(run.finished_at)}</small>:null}</p>
        {run.commit?<p className="inbox-commit">Commit <code>{run.commit.short}</code> {run.commit.subject}</p>:null}
        {run.report_md?<details className="inbox-report-wrap" id="inbox-report-wrap" open={run.status==='finished'}><summary>Librarian’s report{run.report_truncated?' (last 256 KiB)':''}</summary><Report markdown={run.report_md} html={html} onOpen={onOpen}/></details>:null}
        {transcript}
      </div>:null}
      {arrivals.length?<ol className="inbox-arrivals" aria-label="Arrivals waiting in the inbox">{arrivals.map(arrival=><li key={arrival.id}>
        <button type="button" className="inbox-arrival" data-arrival={arrival.id} onClick={()=>onOpen(arrival.document)}>
          <span className="inbox-arrival-title">{arrival.title}</span>
          <span className="inbox-arrival-meta">{[arrival.author,arrival.project,arrival.report_date].filter(Boolean).join(' · ')}{arrival.source?<span className="inbox-source"> via {arrival.source}</span>:null}</span>
          <span className="inbox-arrival-facts">{arrival.integrity?<Badge variant={arrival.integrity==='intact'?'secondary':'destructive'} data-integrity={arrival.integrity}>{arrival.integrity==='intact'?'Receipt intact':'Changed since delivery'}</Badge>:<Badge variant="outline" data-integrity="none" title={arrival.receipt_error||undefined}>{arrival.receipt_error?'Unreadable receipt':'No receipt'}</Badge>}
            <span>{plural(arrival.files,'file')} · {size(arrival.bytes)}{arrival.received_at?<> · {when(arrival.received_at)}</>:null}</span></span>
        </button></li>)}</ol>:null}
    </CardContent>
  </Card>;
}
