/* Admin › Inbox: what is waiting, and You got mail, which starts the existing librarian inbox runner.
   Design sheet: docs/admin-design/inbox.md. The run card holds the one primary action; the list below is read-only
   (opening an arrival previews it and writes nothing for the librarian). */
import {Fragment, useState} from 'react';
import {ChevronRightIcon, InboxIcon, MailIcon, SquareIcon} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Spinner} from '@/components/ui/spinner';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle} from '@/components/ui/item';
import {StatusBadge, type Tone} from '@/theme/atoms/status-badge';
import {Elapsed, RelativeTime} from '@/theme/atoms/time';
import {Notice} from '@/theme/molecules/notice';
import {EmptyState, LoadingState, Unavailable} from '@/theme/molecules/states';
import {StatusCard} from '@/theme/organisms/status-card';
import {ActivityTranscript} from '../../activity/transcript';
import type {Arrival, InboxStatus} from '../../backstage';
import type {ActivityModel} from '../../reader-controls';
import {plural} from '../../plural';
import {localOnly, needsReader} from '../../static-demo';

const ACTIVE_RUN=['starting','running'];
const RUN_STATES:Record<string,{label:string;tone:Tone}>={
  starting:{label:'Starting…',tone:'active'},running:{label:'Librarian reading',tone:'active'},finished:{label:'Filed',tone:'ok'},
  empty:{label:'Nothing to file',tone:'neutral'},stopped:{label:'Stopped',tone:'neutral'},failed:{label:'Failed',tone:'error'},interrupted:{label:'Interrupted',tone:'error'}};
export function size(bytes:number){return bytes<1024?bytes+' B':bytes<1024**2?(bytes/1024).toFixed(1)+' KB':(bytes/1024**2).toFixed(1)+' MB';}

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

/** One arrival: a button-rendered shadcn Item. Its receipt status is the badge; files, size and arrival time follow. */
function ArrivalItem({arrival,onOpen}:{arrival:Arrival;onOpen:(path:string)=>void}){
  const meta=[arrival.author,arrival.project,arrival.report_date].filter(Boolean).join(' · ');
  return <Item size="sm" role="listitem" render={<button type="button"/>} data-arrival={arrival.id} onClick={()=>onOpen(arrival.document)} className="cursor-pointer text-left hover:bg-muted">
    <ItemContent className="min-w-0">
      <ItemTitle data-arrival-title="" className="font-serif text-base font-normal [overflow-wrap:anywhere]">{arrival.title}</ItemTitle>
      {meta||arrival.source?<ItemDescription className="[overflow-wrap:anywhere]">{meta}{arrival.source?<span className="text-muted-foreground/80"> via {arrival.source}</span>:null}</ItemDescription>:null}
      <ItemDescription className="text-xs tabular-nums">{plural(arrival.files,'file')} · {size(arrival.bytes)}{arrival.received_at?<> · <RelativeTime value={arrival.received_at}/></>:null}</ItemDescription>
    </ItemContent>
    <ItemActions className="max-sm:basis-full">
      {arrival.integrity?<StatusBadge tone={arrival.integrity==='intact'?'ok':'error'} data-integrity={arrival.integrity}>{arrival.integrity==='intact'?'Receipt intact':'Changed since delivery'}</StatusBadge>
        :<StatusBadge tone="neutral" data-integrity="none" title={arrival.receipt_error||undefined}>{arrival.receipt_error?'Unreadable receipt':'No receipt'}</StatusBadge>}
      <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground max-sm:hidden"/>
    </ItemActions>
  </Item>;
}

export function InboxPage({status,error=null,starting,onMail,onStop,onOpen,html,activity}:{status:InboxStatus|null;error?:string|null;starting:boolean;onMail:()=>void;onStop:()=>void;onOpen:(path:string)=>void;html:(text:string)=>string;activity:ActivityModel|null}){
  const arrivals=status?.arrivals||[],run=status?.runner,active=starting||ACTIVE_RUN.includes(run?.status||''),blocked=status?.blocked;
  const state=starting&&!active?RUN_STATES.starting:run?RUN_STATES[run.status]||{label:run.status,tone:'neutral' as const}:null;
  const [reportOpen,setReportOpen]=useState<boolean|null>(null),showReport=reportOpen??run?.status==='finished';
  const report=()=>{setReportOpen(true);requestAnimationFrame(()=>document.getElementById('inbox-report-wrap')?.scrollIntoView({block:'start',behavior:'smooth'}));};
  const transcript=activity?.run?<ActivityTranscript activity={activity.activity} run={activity.run} live={active||!activity.done} html={html} onOpen={onOpen} onReport={run?.report_md?report:undefined}/>:null;
  const finished=run&&!ACTIVE_RUN.includes(run.status)&&!active;
  const note=active?'The librarian is reading the mail.':needsReader()?`Filing ${plural(arrivals.length,'arrival')} needs Reader on your computer, where a librarian voice reads the mail.`:blocked?'Filing is paused; see why above.':`Ask the librarian to file ${plural(arrivals.length,'arrival')}.`;
  return <div id="inbox" className="flex flex-col gap-6" data-run-state={starting?'starting':run?.status||'none'} data-state={status?'ready':error?'unavailable':'loading'}>
    <StatusCard title="Librarian run" titleId="inbox-title" description="A librarian voice reads each arrival, files it with its receipt and commits the result."
      badge={state?<StatusBadge tone={state.tone} busy={active} data-inbox-badge="">{state.label}</StatusBadge>:null}
      footer={<>
        <Button id="inbox-mail" disabled={!status||active||!!blocked} {...localOnly()} onClick={onMail} aria-describedby="inbox-mail-note">{active?<Spinner data-icon="inline-start" aria-hidden/>:<MailIcon data-icon="inline-start" aria-hidden/>}You got mail</Button>
        {active?<Button id="inbox-stop" variant="destructive" disabled={starting&&!run?.started_at} onClick={onStop}><SquareIcon data-icon="inline-start" aria-hidden/>Stop</Button>:null}
        <span id="inbox-mail-note" className="min-w-48 flex-1 text-sm text-muted-foreground">{note}</span>
      </>}>
      {!status?(error?<Unavailable id="inbox-unavailable" what="The inbox" error={error}/>:<LoadingState>Looking in the inbox…</LoadingState>):null}
      {blocked&&!active?<Notice id="inbox-blocked" data-reason={blocked.reason} tone={['interrupted','error','codex'].includes(blocked.reason)?'error':'info'}>{blocked.message}</Notice>:null}
      {active?<div className="flex min-w-0 flex-col gap-3" data-inbox-run="" aria-live="polite">
        {!transcript?<span className="text-sm text-muted-foreground" data-run-clock="">{starting&&!run?.started_at?'Starting the librarian…':<>Running for {run?.started_at?<Elapsed since={run.started_at} clock/>:'…'}{run?.arrivals?<> · {plural(run.arrivals,'arrival')}</>:null}{run?.sandbox_mode==='danger-full-access'?' · Host access':''}</>}</span>
          :run?.sandbox_mode==='danger-full-access'?<span className="text-sm text-muted-foreground">Host access</span>:null}
        {transcript||(run?.event?<span className="truncate font-mono text-xs text-muted-foreground" title={run.event}>{run.event}</span>:null)}
      </div>:finished?<div className="flex min-w-0 flex-col gap-3" data-inbox-run="" data-finished="">
        <Notice id="inbox-run-message" tone={['failed','interrupted'].includes(run.status)?'error':'info'} title={run.message}>{run.finished_at?<>Finished <RelativeTime value={run.finished_at}/></>:null}</Notice>
        {run.commit?<span className="text-sm [overflow-wrap:anywhere]" data-inbox-commit="">Commit <code className="rounded-sm bg-muted px-1 font-mono text-xs">{run.commit.short}</code> {run.commit.subject}</span>:null}
        {run.report_md?<Collapsible id="inbox-report-wrap" open={showReport} onOpenChange={setReportOpen} className="rounded-lg border border-border">
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start rounded-b-none"/>}><ChevronRightIcon data-icon="inline-start" aria-hidden className="transition-transform in-data-[panel-open]:rotate-90"/>Librarian’s report{run.report_truncated?' (last 256 KiB)':''}</CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border px-3 pb-3"><Report markdown={run.report_md} html={html} onOpen={onOpen}/></CollapsibleContent>
        </Collapsible>:null}
        {transcript}
      </div>:null}
    </StatusCard>
    <StatusCard title="Waiting to be filed" description={status&&arrivals.length?'Opening one previews it; it is not marked read.':undefined}
      badge={status?<StatusBadge tone={arrivals.length?'active':'ok'} data-arrivals={arrivals.length}>{arrivals.length?plural(arrivals.length,'arrival'):'Empty'}</StatusBadge>:null}>
      {!status?(error?null:<LoadingState/>)
        :arrivals.length?<ItemGroup role="list" aria-label="Arrivals waiting in the inbox">{arrivals.map((arrival,index)=><Fragment key={arrival.id}>{index?<ItemSeparator role="presentation"/>:null}<ArrivalItem arrival={arrival} onOpen={onOpen}/></Fragment>)}</ItemGroup>
        :<EmptyState icon={InboxIcon} title="No arrivals are waiting" description="Deliveries from other agents and dropped files appear here until the librarian files them."/>}
    </StatusCard>
  </div>;
}
