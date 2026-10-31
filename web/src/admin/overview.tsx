/* Reader Admin › Overview (design sheet: docs/admin-design/overview.md): a read-only summary of the status Reader already polls (maintenance and inbox) and of active
   coding jobs (read here every few seconds). It starts no
   check, rebuild, model or inbox run. Each tile says Loading, Unavailable (with the reason) or what is known; a status
   that could not be read is never shown as zero or as healthy. */
import {useEffect, useState, type ReactNode} from 'react';
import {ArrowRightIcon, ChevronRightIcon, CircleAlertIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle} from '@/components/ui/item';
import {Spinner} from '@/components/ui/spinner';
import {StatusBadge} from '@/theme/atoms/status-badge';
import {RelativeTime} from '@/theme/atoms/time';
import {HelpTip} from '@/theme/molecules/help-tip';
import {Notice} from '@/theme/molecules/notice';
import {LoadingState} from '@/theme/molecules/states';
import {StatusCard} from '@/theme/organisms/status-card';
import {CardGrid} from '@/theme/templates/card-grid';
import {AdminLink} from './link';
import {checkState, INDEX_TITLES, jobOutcome, when} from '../backstage';
import {plural} from '../plural';
import type {AdminContext} from './sections';
import {activeJobs, statusLabel, type JobRun} from '../jobs/store';
import {needsReader} from '../static-demo';

const JOBS_EVERY=5000;
/** Active coding jobs, read every few seconds while the Overview is open (null until the first answer). */
function useActiveJobs(){
  const [jobs,setJobs]=useState<{runs:JobRun[]}|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    if(needsReader('jobs'))return;
    let live=true,timer:ReturnType<typeof setTimeout>|undefined;
    const read=()=>activeJobs().then(result=>{if(live){setJobs(result);setError(null);}},(cause:unknown)=>{if(live)setError(cause instanceof Error?cause.message:String(cause));})
      .finally(()=>{if(live)timer=setTimeout(read,JOBS_EVERY);});
    read();
    return ()=>{live=false;clearTimeout(timer);};
  },[]);
  return {jobs,error};
}

type TileState='loading'|'unavailable'|'ready';
/** A tile: a StatusCard whose footer is one ghost link to the page where you would act. */
function Tile({id,title,state,badge,context,section,linkLabel,children}:{id:string;title:string;state:TileState;badge?:ReactNode;context:AdminContext;section:string;linkLabel:string;children:ReactNode}){
  return <StatusCard data-overview={id} data-state={state} title={<span className="inline-flex items-center gap-1">{title}<HelpTip title={title}>{id==='indexes'?'This summarizes saved freshness checks. Opening Indexes may check drift, but only an explicit rebuild updates a stale projection.':id==='active'?'Maintenance, model and librarian work have separate runners. A task can be running while you continue reading. This overview starts no jobs.':id==='inbox'?'Delivered documents wait here until an authorized librarian files them. Delivery does not automatically index or record them as read.':'Warnings come from the last available status and recent failures. Follow a warning to inspect its reason; this list does not automatically repair it.'}</HelpTip></span>} badge={badge}
    footer={<Button variant="ghost" size="sm" className="-ml-2" nativeButton={false} render={<AdminLink context={context} section={section}/>}>{linkLabel}<ArrowRightIcon data-icon="inline-end" aria-hidden/></Button>}>
    {children}
  </StatusCard>;
}
/** A quiet one-line answer inside a tile ("Nothing is running."). */
const Quiet=({children,...props}:{children:ReactNode}&Record<`data-${string}`,string>)=><span className="text-sm text-muted-foreground" {...props}>{children}</span>;
const Unavailable=({what,error}:{what:string;error:string})=><Notice tone="error" data-unavailable="" title={<>{what} unavailable</>}>{error}</Notice>;

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
  const m=c.maintenance,inbox=c.inbox,lm=m?.local_model,coding=useActiveJobs();
  const link=(section:string)=>({context:c,section});
  // Active work: maintenance jobs, the local model and the librarian, from the two status reads.
  const active:{key:string;text:ReactNode}[]=[];
  if(m?.running)active.push({key:'job',text:<>{m.running.label}{m.running.progress?<> · {m.running.progress}</>:null} · started {when(m.running.started_at)}</>});
  else if(m?.checking)active.push({key:'check',text:'Checking index freshness'});
  if(lm?.running)active.push({key:'local-model',text:'Local model working through its queue'});
  const run=inbox?.runner;
  if(c.inboxStarting||run&&['starting','running'].includes(run.status))active.push({key:'inbox',text:<>The librarian is filing the mail{run?.arrivals?<> · {plural(run.arrivals,'arrival')}</>:null}</>});
  for(const job of coding.jobs?.runs||[])active.push({key:'coding-'+job.id,text:<><AdminLink context={c} section="jobs" params={[job.id]}>{job.source.title}</AdminLink> · {statusLabel(job)} in {job.source.repo}</>});
  // A tile is ready once both reads have answered (with status or an error); unavailable when neither has status.
  const known=!!(m||c.maintenanceError)&&!!(inbox||c.inboxError),combined:TileState=!known?'loading':!m&&!inbox?'unavailable':'ready';
  const activeState=combined,issues=attention(c),attentionState=combined;
  const checks=Object.entries(m?.checks||{});
  return <div className="flex flex-col gap-4" id="admin-overview">
    <CardGrid>
      <Tile id="attention" title="Attention needed" state={attentionState} linkLabel="Indexes and recent runs" {...link('indexes')}
        badge={attentionState!=='loading'?<StatusBadge tone={issues.length?'error':'ok'}>{issues.length?plural(issues.length,'item'):'None'}</StatusBadge>:null}>
        {attentionState==='loading'?<LoadingState/>:issues.length?<ItemGroup>{issues.map(item=><Item key={item.key} size="xs" variant="outline" role="listitem" render={<AdminLink context={c} section={item.section}/>}>
            <ItemMedia variant="icon"><CircleAlertIcon className="text-destructive" aria-hidden/></ItemMedia>
            <ItemContent className="min-w-0"><ItemTitle className="line-clamp-none font-normal [overflow-wrap:anywhere]">{item.text}</ItemTitle></ItemContent>
            <ItemActions><ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden/></ItemActions></Item>)}</ItemGroup>
          :<Quiet>Nothing needs attention{m&&!checks.length?' that Reader has checked':''}.</Quiet>}
      </Tile>
      <Tile id="active" title="Active work" state={activeState} linkLabel="Recent runs" {...link('indexes')}
        badge={active.length?<StatusBadge tone="active" busy>{active.length} running</StatusBadge>:null}>
        {activeState==='loading'?<LoadingState/>:<>
          {active.length?<ItemGroup>{active.map(item=><Item key={item.key} size="xs" role="listitem" className="px-0">
              <ItemMedia><Spinner aria-hidden/></ItemMedia><ItemContent className="min-w-0"><ItemDescription className="line-clamp-none text-foreground [overflow-wrap:anywhere]">{item.text}</ItemDescription></ItemContent></Item>)}</ItemGroup>
            :m&&inbox&&(coding.jobs||needsReader('jobs'))&&!coding.error?<Quiet>Nothing is running.</Quiet>:null}
          {!m&&c.maintenanceError?<Unavailable what="Index jobs" error={c.maintenanceError}/>:null}
          {!inbox&&c.inboxError?<Unavailable what="Inbox runs" error={c.inboxError}/>:null}
          {coding.error?<Unavailable what="Coding jobs" error={coding.error}/>:null}</>}
      </Tile>
      <Tile id="inbox" title="Inbox" state={inbox?'ready':c.inboxError?'unavailable':'loading'} linkLabel="Open the inbox" {...link('inbox')}
        badge={inbox?<StatusBadge tone={inbox.arrivals.length?'active':'ok'} data-arrivals={inbox.arrivals.length}>{inbox.arrivals.length?plural(inbox.arrivals.length,'arrival'):'Empty'}</StatusBadge>:null}>
        {inbox?<>
            <span className="text-sm">{inbox.arrivals.length?`${plural(inbox.arrivals.length,'arrival')} waiting to be filed.`:'No arrivals are waiting.'}</span>
            {run?.finished_at&&!['starting','running'].includes(run.status)?<Quiet>Last run <RelativeTime value={run.finished_at}/>: {run.message}</Quiet>:null}</>
          :c.inboxError?<Unavailable what="The inbox" error={c.inboxError}/>:<LoadingState/>}
      </Tile>
      <Tile id="indexes" title="Index health" state={m?'ready':c.maintenanceError?'unavailable':'loading'} linkLabel="Open Indexes" {...link('indexes')}>
        {m?checks.length?<>
            <ItemGroup className="gap-1">{checks.map(([key,check])=>{const state=checkState(check)!;return <Item key={key} size="xs" role="listitem" className="px-0 py-1" data-check={key} data-state={check.state}>
              <ItemContent><ItemTitle className="font-normal">{INDEX_TITLES[key]||key}</ItemTitle></ItemContent>
              <ItemActions><StatusBadge tone={state.tone}>{state.label}</StatusBadge></ItemActions></Item>;})}</ItemGroup>
            <Quiet>Checked <RelativeTime value={Object.values(m.checks)[0]?.checked_at}/>.</Quiet></>
          :<Quiet data-unchecked="">{c.local?'Index checks need Reader on your computer.':'Not checked yet. Indexes runs a freshness check when you open it.'}</Quiet>
          :c.maintenanceError?<Unavailable what="Index status" error={c.maintenanceError}/>:<LoadingState/>}
      </Tile>
    </CardGrid>
    {m&&c.maintenanceError||inbox&&c.inboxError?<Notice id="admin-stale" role="status" title="A status refresh failed">The last refresh of {[m&&c.maintenanceError?'index status':null,inbox&&c.inboxError?'the inbox':null].filter(Boolean).join(' and ')} failed; these tiles show what was read before it.</Notice>:null}
    <Quiet>Library holdings and reading statistics are in <AdminLink context={c} section="library" className="text-primary underline-offset-4 hover:underline">Library</AdminLink>.</Quiet>
  </div>;
}
