/* Reader Admin › Overview (design sheet: docs/admin-design/overview.md): a read-only summary of the status Reader already polls (maintenance and inbox) and of active
   coding jobs (read here every few seconds). It starts no
   check, rebuild, model or inbox run. Four summary cards answer "is anything wrong?"; the tables and cards below say why.
   Each says Loading, Unavailable (with the reason) or what is known; a status that could not be read is never shown as
   zero or as healthy. */
import {useEffect, useState, type ReactNode} from 'react';
import {ActivityIcon, ArrowRightIcon, CircleAlertIcon, CircleCheckIcon, DatabaseIcon, InboxIcon, type LucideIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle} from '@/components/ui/item';
import {Skeleton} from '@/components/ui/skeleton';
import {Spinner} from '@/components/ui/spinner';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {StatusBadge, type Tone} from '@/theme/atoms/status-badge';
import {RelativeTime} from '@/theme/atoms/time';
import {AdminDocHelp} from './documentation';
import {Notice} from '@/theme/molecules/notice';
import {EmptyState, LoadingState} from '@/theme/molecules/states';
import {StatusCard} from '@/theme/organisms/status-card';
import {AdminLink} from './link';
import {ATTENTION_CHECKS, checkState, INDEX_TITLES, jobOutcome, when} from '../backstage';
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
/** A status card under the summary: a heading with its documentation link, what is known, and optionally a way onward. */
function Tile({id,title,description,state,badge,footer,children}:{id:string;title:string;description?:ReactNode;state:TileState;badge?:ReactNode;footer?:ReactNode;children:ReactNode}){
  return <StatusCard data-overview={id} data-state={state} title={<span className="inline-flex items-center gap-1">{title}<AdminDocHelp title={title}/></span>} description={description} badge={badge} footer={footer}>
    {children}
  </StatusCard>;
}
/** A link to the page where you would act. */
function TileLink({context,section,variant='ghost',className,children}:{context:AdminContext;section:string;variant?:'ghost'|'outline';className?:string;children:ReactNode}){
  return <Button variant={variant} size="sm" className={className} nativeButton={false} render={<AdminLink context={context} section={section}/>}>{children}<ArrowRightIcon data-icon="inline-end" aria-hidden/></Button>;
}
/** One number in the summary row. Null is still loading; a status that could not be read has no number. */
function Summary({id,label,value,note,icon:Icon,alert}:{id:string;label:string;value:ReactNode;note:ReactNode;icon:LucideIcon;alert?:boolean}){
  return <Card size="sm" className="min-w-0" data-overview-summary={id}>
    <CardHeader>
      <CardDescription>{label}</CardDescription>
      <CardTitle className="text-3xl font-semibold tabular-nums group-data-[size=sm]/card:text-3xl">{value??<Skeleton className="h-9 w-12"/>}</CardTitle>
      <CardAction><Icon className={alert?'size-4 text-destructive':'size-4 text-muted-foreground'} aria-hidden/></CardAction>
    </CardHeader>
    <CardContent className="text-xs text-muted-foreground">{note}</CardContent>
  </Card>;
}
const UNREAD='—';
/** A quiet one-line answer inside a tile ("Nothing is running."). */
const Quiet=({children,...props}:{children:ReactNode}&Record<`data-${string}`,string>)=><span className="text-sm text-muted-foreground" {...props}>{children}</span>;
const Unavailable=({what,error}:{what:string;error:string})=><Notice tone="error" data-unavailable="" title={<>{what} unavailable</>}>{error}</Notice>;

type Attention={key:string;subject:string;status:string;tone:Tone;detail?:string|null;section:string};
/** Attention items from known status only; an unreadable source is reported as its own item. */
function attention(c:AdminContext){
  const items:Attention[]=[];
  const m=c.maintenance,inbox=c.inbox;
  if(!m&&c.maintenanceError)items.push({key:'maintenance',subject:'Index status',status:'Unavailable',tone:'error',detail:c.maintenanceError,section:'indexes'});
  if(!inbox&&c.inboxError)items.push({key:'inbox',subject:'Inbox status',status:'Unavailable',tone:'error',detail:c.inboxError,section:'inbox'});
  for(const [key,check] of Object.entries(m?.checks||{})){
    if(ATTENTION_CHECKS.includes(check.state)){const state=checkState(check)!;items.push({key:'check-'+key,subject:INDEX_TITLES[key]||key,status:state.label,tone:state.tone,detail:check.message,section:'indexes'});}
  }
  for(const job of (m?.jobs||[]).slice(0,10))if(job.state==='failed')items.push({key:'job-'+job.id,subject:job.label,status:'Failed',tone:'error',detail:jobOutcome(job),section:'indexes'});
  if(inbox?.blocked&&['interrupted','error','codex'].includes(inbox.blocked.reason))items.push({key:'inbox-blocked',subject:'Inbox',status:'Blocked',tone:'error',detail:inbox.blocked.message,section:'inbox'});
  if(inbox?.runner&&['failed','interrupted'].includes(inbox.runner.status))items.push({key:'inbox-run',subject:'Last inbox run',status:inbox.runner.status==='failed'?'Failed':'Interrupted',tone:'error',detail:inbox.runner.message,section:'inbox'});
  for(const error of inbox?.errors||[])items.push({key:'inbox-error-'+error,subject:'Inbox',status:'Error',tone:'error',detail:error,section:'inbox'});
  return items;
}

export function Overview({context:c}:{context:AdminContext}){
  const m=c.maintenance,inbox=c.inbox,lm=m?.local_model,coding=useActiveJobs();
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
  const checks=Object.entries(m?.checks||{}),passing=checks.filter(([,check])=>checkState(check)!.tone==='ok').length;
  const finished=run?.finished_at&&!['starting','running'].includes(run.status)?run.finished_at:null;
  const allActive=!!m&&!!inbox&&!!(coding.jobs||needsReader('jobs'))&&!coding.error,activeRead=known&&!!(coding.jobs||coding.error||needsReader('jobs'));
  const calm=<>Nothing needs attention{m&&!checks.length?' that Reader has checked':''}.</>;
  return <div className="flex flex-col gap-4" id="admin-overview">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Summary id="attention" label="Needs attention" icon={CircleAlertIcon} alert={issues.length>0} value={attentionState==='loading'?null:issues.length} note={attentionState==='loading'?'Reading status':issues.length?'Listed below':calm}/>
      <Summary id="running" label="Running now" icon={ActivityIcon} value={!activeRead?null:allActive?active.length:UNREAD} note={!activeRead?'Reading status':allActive?(active.length?'Listed below':'Nothing is running.'):'Some status is unavailable'}/>
      <Summary id="inbox" label="Inbox arrivals" icon={InboxIcon} value={inbox?inbox.arrivals.length:c.inboxError?UNREAD:null} note={inbox?(finished?<>Last run <RelativeTime value={finished}/></>:'No run recorded'):c.inboxError?'Inbox status is unavailable':'Reading status'}/>
      <Summary id="indexes" label="Index checks passing" icon={DatabaseIcon} value={m?(checks.length?`${passing} of ${checks.length}`:UNREAD):c.maintenanceError?UNREAD:null}
        note={m?(checks.length?<>Checked <RelativeTime value={Object.values(m.checks)[0]?.checked_at}/></>:c.local?'Needs Reader on your computer':'Not checked yet'):c.maintenanceError?'Index status is unavailable':'Reading status'}/>
    </div>
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
        <Tile id="attention" title="Attention needed" description="Known problems from the latest status" state={attentionState}
          footer={attentionState==='ready'&&!issues.length?<TileLink context={c} section="indexes" className="-ml-2">Indexes and recent runs</TileLink>:null}>
          {attentionState==='loading'?<LoadingState/>:issues.length?<Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="max-sm:hidden">Details</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
            <TableBody>{issues.map(item=><TableRow key={item.key} data-attention={item.key}>
              <TableCell className="font-medium whitespace-normal"><span data-attention-subject="">{item.subject}</span>{item.detail?<span className="mt-1 block font-normal text-muted-foreground [overflow-wrap:anywhere] sm:hidden">{item.detail}</span>:null}</TableCell>
              <TableCell className="min-w-48 whitespace-normal text-muted-foreground [overflow-wrap:anywhere] max-sm:hidden">{item.detail}</TableCell>
              <TableCell><StatusBadge tone={item.tone}>{item.status}</StatusBadge></TableCell>
              <TableCell className="text-right"><Button variant="outline" size="xs" nativeButton={false} aria-label={'Open '+item.subject} render={<AdminLink context={c} section={item.section}/>}>Open</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>:<Quiet>{calm}</Quiet>}
        </Tile>
        <Tile id="indexes" title="Index health" description={m&&checks.length?<>Checked <RelativeTime value={Object.values(m.checks)[0]?.checked_at}/></>:undefined} state={m?'ready':c.maintenanceError?'unavailable':'loading'}
          badge={<TileLink context={c} section="indexes" variant="outline">Open Indexes</TileLink>}>
          {m?checks.length?<Table>
              <TableHeader><TableRow><TableHead>Index</TableHead><TableHead className="text-right">Status</TableHead></TableRow></TableHeader>
              <TableBody>{checks.map(([key,check])=>{const state=checkState(check)!;return <TableRow key={key} data-check={key} data-state={check.state}>
                <TableCell>{INDEX_TITLES[key]||key}</TableCell><TableCell className="text-right"><StatusBadge tone={state.tone}>{state.label}</StatusBadge></TableCell></TableRow>;})}</TableBody>
            </Table>
            :<Quiet data-unchecked="">{c.local?'Index checks need Reader on your computer.':'Not checked yet. Indexes runs a freshness check when you open it.'}</Quiet>
            :c.maintenanceError?<Unavailable what="Index status" error={c.maintenanceError}/>:<LoadingState/>}
        </Tile>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Tile id="active" title="Active work" state={activeState} badge={<TileLink context={c} section="indexes">Recent runs</TileLink>}>
          {activeState==='loading'?<LoadingState/>:<>
            {active.length?<ItemGroup>{active.map(item=><Item key={item.key} size="xs" role="listitem" className="px-0">
                <ItemMedia><Spinner aria-hidden/></ItemMedia><ItemContent className="min-w-0"><ItemDescription className="line-clamp-none text-foreground [overflow-wrap:anywhere]">{item.text}</ItemDescription></ItemContent></Item>)}</ItemGroup>
              :allActive?<EmptyState icon={CircleCheckIcon} className="border-0 p-4 md:p-4" title="Nothing is running." description="Jobs, the local model and the librarian appear here while they work."/>:null}
            {!m&&c.maintenanceError?<Unavailable what="Index jobs" error={c.maintenanceError}/>:null}
            {!inbox&&c.inboxError?<Unavailable what="Inbox runs" error={c.inboxError}/>:null}
            {coding.error?<Unavailable what="Coding jobs" error={coding.error}/>:null}</>}
        </Tile>
        <Tile id="inbox" title="Inbox" description="Arrivals waiting to be filed" state={inbox?'ready':c.inboxError?'unavailable':'loading'}
          badge={inbox?<StatusBadge tone={inbox.arrivals.length?'active':'ok'} data-arrivals={inbox.arrivals.length}>{inbox.arrivals.length?plural(inbox.arrivals.length,'arrival'):'Empty'}</StatusBadge>:null}
          footer={<TileLink context={c} section="inbox" variant="outline" className="w-full">Open the inbox</TileLink>}>
          {inbox?<ItemGroup>
              <Item size="sm" variant="outline" role="listitem"><ItemMedia variant="icon"><InboxIcon aria-hidden/></ItemMedia><ItemContent className="min-w-0"><ItemTitle className="line-clamp-none">{inbox.arrivals.length?`${plural(inbox.arrivals.length,'arrival')} waiting to be filed.`:'No arrivals are waiting.'}</ItemTitle></ItemContent></Item>
              {finished?<Item size="sm" variant="outline" role="listitem"><ItemMedia variant="icon"><CircleCheckIcon aria-hidden/></ItemMedia><ItemContent className="min-w-0"><ItemTitle className="line-clamp-none">Last run <RelativeTime value={finished}/></ItemTitle><ItemDescription className="line-clamp-none [overflow-wrap:anywhere]">{run?.message}</ItemDescription></ItemContent></Item>:null}
            </ItemGroup>
            :c.inboxError?<Unavailable what="The inbox" error={c.inboxError}/>:<LoadingState/>}
        </Tile>
      </div>
    </div>
    {m&&c.maintenanceError||inbox&&c.inboxError?<Notice id="admin-stale" role="status" title="A status refresh failed">The last refresh of {[m&&c.maintenanceError?'index status':null,inbox&&c.inboxError?'the inbox':null].filter(Boolean).join(' and ')} failed; these tiles show what was read before it.</Notice>:null}
    <Quiet>Library holdings and reading statistics are in <AdminLink context={c} section="library" className="text-primary underline-offset-4 hover:underline">Library</AdminLink>.</Quiet>
  </div>;
}
