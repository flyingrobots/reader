/* Reader Admin › Overview: a read-only summary of the status Reader already polls (maintenance and inbox). It starts no
   check, rebuild, model or inbox run. Each tile says Loading, Unavailable (with the reason) or what is known; a status
   that could not be read is never shown as zero or as healthy. */
import type {ReactNode} from 'react';
import {Loader2Icon} from 'lucide-react';
import {Badge} from '../components/ui/badge';
import {Card, CardAction, CardContent, CardHeader, CardTitle} from '../components/ui/card';
import {AdminLink} from './link';
import {checkState, INDEX_TITLES, jobOutcome, when} from '../backstage';
import {plural} from '../plural';
import type {AdminContext} from './sections';

type TileState='loading'|'unavailable'|'ready';
function Tile({id,title,state,badge,context,section,linkLabel,children}:{id:string;title:string;state:TileState;badge?:ReactNode;context:AdminContext;section:string;linkLabel:string;children:ReactNode}){
  return <Card size="sm" className="backstage-card admin-tile" data-overview={id} data-state={state}>
    <CardHeader><CardTitle role="heading" aria-level={2}>{title}</CardTitle>{badge?<CardAction>{badge}</CardAction>:null}</CardHeader>
    <CardContent>{children}<p className="admin-tile-link"><AdminLink context={context} section={section}>{linkLabel}</AdminLink></p></CardContent>
  </Card>;
}
const Unavailable=({what,error}:{what:string;error:string})=><p className="backstage-message backstage-error" data-unavailable="">{what} unavailable: {error}</p>;
const Loading=()=><p className="backstage-message"><Loader2Icon className="size-3 animate-spin inline" aria-hidden/> Loading…</p>;

/** Attention items from known status only; an unreadable source is reported as its own item. */
function attention(c:AdminContext){
  const items:{key:string;text:string;section:string}[]=[];
  const m=c.maintenance,inbox=c.inbox;
  if(!m&&c.maintenanceError)items.push({key:'maintenance',text:'Index status is unavailable: '+c.maintenanceError,section:'indexes'});
  if(!inbox&&c.inboxError)items.push({key:'inbox',text:'Inbox status is unavailable: '+c.inboxError,section:'inbox'});
  for(const [key,check] of Object.entries(m?.checks||{})){
    if(['error','stale','partial','missing','over','near'].includes(check.state))items.push({key:'check-'+key,text:`${INDEX_TITLES[key]||key}: ${checkState(check)!.label}${check.message?' · '+check.message:''}`,section:'indexes'});
  }
  for(const job of (m?.jobs||[]).slice(0,10))if(job.state==='failed')items.push({key:'job-'+job.id,text:`${job.label} failed${jobOutcome(job)?': '+jobOutcome(job):''}`,section:'indexes'});
  if(inbox?.blocked&&['interrupted','error','codex'].includes(inbox.blocked.reason))items.push({key:'inbox-blocked',text:inbox.blocked.message,section:'inbox'});
  if(inbox?.runner&&['failed','interrupted'].includes(inbox.runner.status))items.push({key:'inbox-run',text:'Last inbox run '+inbox.runner.status+': '+inbox.runner.message,section:'inbox'});
  for(const error of inbox?.errors||[])items.push({key:'inbox-error-'+error,text:error,section:'inbox'});
  return items;
}

export function Overview({context:c}:{context:AdminContext}){
  const m=c.maintenance,inbox=c.inbox,lm=m?.local_model;
  const link=(section:string)=>({context:c,section});
  // Active work: maintenance jobs, the local model and the librarian, from the two status reads.
  const active:{key:string;text:ReactNode}[]=[];
  if(m?.running)active.push({key:'job',text:<>{m.running.label}{m.running.progress?<> · {m.running.progress}</>:null} · started {when(m.running.started_at)}</>});
  else if(m?.checking)active.push({key:'check',text:'Checking index freshness'});
  if(lm?.running)active.push({key:'local-model',text:'Local model working through its queue'});
  const run=inbox?.runner;
  if(c.inboxStarting||run&&['starting','running'].includes(run.status))active.push({key:'inbox',text:<>The librarian is filing the mail{run?.arrivals?<> · {plural(run.arrivals,'arrival')}</>:null}</>});
  // A tile is ready once both reads have answered (with status or an error); unavailable when neither has status.
  const known=!!(m||c.maintenanceError)&&!!(inbox||c.inboxError),combined:TileState=!known?'loading':!m&&!inbox?'unavailable':'ready';
  const activeState=combined,issues=attention(c),attentionState=combined;
  const checks=Object.entries(m?.checks||{});
  return <div className="admin-overview" id="admin-overview">
    <div className="backstage-grid admin-tiles">
      <Tile id="active" title="Active work" state={activeState} linkLabel="Recent runs" {...link('indexes')}
        badge={active.length?<Badge className="backstage-badge"><Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden/>{active.length} running</Badge>:null}>
        {activeState==='loading'?<Loading/>:<>
          {active.length?<ul className="admin-list">{active.map(item=><li key={item.key}>{item.text}</li>)}</ul>
            :m&&inbox?<p className="backstage-message">Nothing is running.</p>:null}
          {!m&&c.maintenanceError?<Unavailable what="Index jobs" error={c.maintenanceError}/>:null}
          {!inbox&&c.inboxError?<Unavailable what="Inbox runs" error={c.inboxError}/>:null}</>}
      </Tile>
      <Tile id="inbox" title="Inbox" state={inbox?'ready':c.inboxError?'unavailable':'loading'} linkLabel="Open the inbox" {...link('inbox')}
        badge={inbox?<Badge variant={inbox.arrivals.length?'default':'secondary'} className="backstage-badge" data-arrivals={inbox.arrivals.length}>{inbox.arrivals.length?plural(inbox.arrivals.length,'arrival'):'Empty'}</Badge>:null}>
        {inbox?<p className="backstage-message">{inbox.arrivals.length?`${plural(inbox.arrivals.length,'arrival')} waiting to be filed.`:'No arrivals are waiting.'}{run?.finished_at&&!['starting','running'].includes(run.status)?<> Last run {when(run.finished_at)}: {run.message}</>:null}</p>
          :c.inboxError?<Unavailable what="The inbox" error={c.inboxError}/>:<Loading/>}
      </Tile>
      <Tile id="attention" title="Attention needed" state={attentionState} linkLabel="Indexes and recent runs" {...link('indexes')}
        badge={attentionState!=='loading'?<Badge variant={issues.length?'destructive':'secondary'} className="backstage-badge">{issues.length?plural(issues.length,'item'):'None'}</Badge>:null}>
        {attentionState==='loading'?<Loading/>:issues.length?<ul className="admin-list admin-attention">{issues.map(item=><li key={item.key}><AdminLink context={c} section={item.section}>{item.text}</AdminLink></li>)}</ul>
          :<p className="backstage-message">Nothing needs attention{m&&!checks.length?' that Reader has checked':''}.</p>}
      </Tile>
      <Tile id="indexes" title="Index health and capacity" state={m?'ready':c.maintenanceError?'unavailable':'loading'} linkLabel="Open Indexes" {...link('indexes')}>
        {m?checks.length?<dl className="backstage-facts admin-health">{checks.map(([key,check])=>{const state=checkState(check)!;return <div key={key} data-check={key} data-state={check.state}><dt>{INDEX_TITLES[key]||key}</dt><dd><Badge variant={state.variant} className="backstage-badge">{state.label}</Badge></dd></div>;})}</dl>
            :<p className="backstage-message" data-unchecked="">{c.local?'Index checks need Reader on your computer.':'Not checked yet. Indexes runs a freshness check when you open it.'}</p>
          :c.maintenanceError?<Unavailable what="Index status" error={c.maintenanceError}/>:<Loading/>}
        {m&&checks.length?<p className="backstage-note">Checked {when(Object.values(m.checks)[0]?.checked_at)}.</p>:null}
      </Tile>
    </div>
    {m&&c.maintenanceError||inbox&&c.inboxError?<p className="backstage-note admin-overview-note" id="admin-stale" role="status">The last refresh of {[m&&c.maintenanceError?'index status':null,inbox&&c.inboxError?'the inbox':null].filter(Boolean).join(' and ')} failed; these tiles show what was read before it.</p>:null}
    <p className="backstage-note admin-overview-note">Library holdings and reading statistics are in <AdminLink context={c} section="library">Library</AdminLink>.</p>
  </div>;
}
