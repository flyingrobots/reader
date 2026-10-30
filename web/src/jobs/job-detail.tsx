/* One coding job (RW-44), as the article's prompt card and Reader Admin both show it: the same run ID, cursor, trace
   and outcome. The compact form (in an article) is a status line, the deterministic phases, Stop and the result;
   its full trace opens on request, and on its own when a check failed. The full form (Admin) adds branch/head
   details and the run's archived artifacts with bounded previews. */
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowUpRightIcon, CopyIcon, DownloadIcon, SquareIcon} from 'lucide-react';
import {ActivityTranscript, type Labels, type RunInfo} from '../activity/transcript';
import {steps} from '../activity/reducer';
import {StatusBadge, type Tone} from '../theme/atoms/status-badge';
import {Button} from '../components/ui/button';
import {CodeBlock, CodeBlockContent} from '../components/ui/code-block';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '../components/ui/collapsible';
import {Item, ItemActions, ItemContent, ItemDescription} from '../components/ui/item';
import {Spinner} from '../components/ui/spinner';
import {Notice} from '../theme/molecules/notice';
import {LoadingState} from '../theme/molecules/states';
import {stopJob, statusLabel, useJob, type JobRun} from './store';

export const ARTIFACTS=['request.json','prompt.txt','system.txt','stdout.jsonl','stderr.log','events.jsonl','verify.log','git.log','last-message.md','result.json','meta.json'];
const GOOD=['pr_opened','already_fixed'];
export const jobLabels=(run:JobRun|null):Partial<Labels>=>({title:'Trace',speaker:run?.agent_label||'Agent',tool:run?.agent_label||'Agent',log:'Coding job trace',
  waiting:'Waiting for the first step…',logHint:run?.log?'the run archive ('+run.log+')':null});
export type JobViewOptions={html:(text:string)=>string;onOpen:(path:string)=>void;api:(path:string,payload?:unknown)=>Promise<any>;notify?:(message:string,kind?:string)=>void};

export function runInfo(run:JobRun|null):RunInfo{
  return {status:run?run.outcome||run.status:null,startedAt:run?.started_at||run?.created_at||null,finishedAt:run?.finished_at||null,arrivals:[],remaining:null,titles:{},
    message:run?.message||null,stderr:null,commit:null};
}

export function OutcomeBadge({run}:{run:JobRun}){
  const tone:Tone=run.outcome?GOOD.includes(run.outcome)?'ok':run.outcome==='cancelled'?'neutral':'error':run.status==='running'?'active':'neutral';
  return <StatusBadge tone={tone} busy={!run.outcome&&run.status==='running'} data-job-outcome={run.outcome||run.status}>{statusLabel(run)}</StatusBadge>;
}

/** A job's GitHub results (pull request, issue, existing pull request) as outline link Buttons. */
export function GitHubLinks({run}:{run:JobRun}){
  const links=[run.pr&&{href:run.pr.url,label:`Pull request #${run.pr.number}`},run.issue&&{href:run.issue.url,label:`Issue #${run.issue.number}${run.issue.created?' (created)':''}`},
    run.existing_pr&&{href:run.existing_pr.url,label:`Existing pull request #${run.existing_pr.number}`}].filter(Boolean) as {href:string;label:string}[];
  if(!links.length)return null;
  return <div className="flex flex-wrap gap-2" aria-label="On GitHub" role="group" data-job-links="">{links.map(link=><Button key={link.href} variant="outline" size="sm" nativeButton={false} render={<a href={link.href} target="_blank" rel="noreferrer noopener"/>}>
    {link.label}<ArrowUpRightIcon data-icon="inline-end" aria-hidden/><span className="sr-only"> (opens GitHub in a new tab)</span></Button>)}</div>;
}

export function StopButton({run,notify}:{run:JobRun;notify?:JobViewOptions['notify']}){
  const [busy,setBusy]=useState(false);
  if(!run.active)return null;
  return <Button size="sm" variant="outline" disabled={busy||!run.can_stop} title={run.can_stop?undefined:'Another Reader server owns this job'} data-job-stop=""
    onClick={async()=>{setBusy(true);try{await stopJob(run.id);notify?.('Stop requested. Completed effects stay recorded.');}catch(error){notify?.(error instanceof Error?error.message:String(error),'error');}finally{setBusy(false);}}}>
    {busy?<Spinner/>:<SquareIcon/>}Stop</Button>;
}

/** A compact job: status, phase, Stop, result links and an on-demand trace. */
export function JobSummary({id,options,onAdmin}:{id:string;options:JobViewOptions;onAdmin?:(id:string)=>void}){
  const {run,activity,error}=useJob(id);
  const failedStep=activity.items.some(i=>i.kind==='tool'&&(i.status==='failed'||i.exitCode!==null&&i.exitCode!==0)&&i.id.startsWith('job-'));
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(failedStep)setOpen(true);},[failedStep]);
  if(!run)return error?<Notice tone="error" role="status" title="Couldn’t load this job">{error}</Notice>:<LoadingState>Loading the job…</LoadingState>;
  const list=steps(activity,!run.active),current=list.find(s=>s.state==='running'||s.state==='failed');
  return <div className="job-summary flex flex-col gap-2" data-job-id={run.id} data-job-status={run.outcome||run.status}>
    <Item variant="muted" size="sm" data-job-summary-head="">
      <ItemContent className="min-w-0 flex-row flex-wrap items-center gap-2"><OutcomeBadge run={run}/>
        <ItemDescription className="line-clamp-none text-foreground [overflow-wrap:anywhere]" role="status" aria-live="polite" data-job-phase="">{run.active?(current?current.label:'Waiting to start')+'…':run.message}</ItemDescription></ItemContent>
      <ItemActions><StopButton run={run} notify={options.notify}/></ItemActions>
    </Item>
    <GitHubLinks run={run}/>
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button size="xs" variant="ghost" aria-expanded={open} data-job-trace-toggle=""/>}>{open?'Hide trace':'Show trace'}</CollapsibleTrigger>
      {onAdmin?<Button size="xs" variant="ghost" onClick={()=>onAdmin(run.id)}>Open in Reader Admin</Button>:null}
      <CollapsibleContent>
        {open?<ActivityTranscript activity={activity} run={runInfo(run)} live={run.active} html={options.html} onOpen={options.onOpen} labels={jobLabels(run)}/>:null}
      </CollapsibleContent>
    </Collapsible>
  </div>;
}

export function Artifact({run,name,api}:{run:JobRun;name:string;api:JobViewOptions['api']}){
  const [data,setData]=useState<{text:string|null;bytes:number|null;truncated:boolean;limit:number;available:boolean}|null>(null),[error,setError]=useState<string|null>(null);
  // Only the latest request may answer: a slow one for the artifact shown before never replaces the one chosen since.
  const latest=useRef(0);
  const load=(limit:number)=>{const request=++latest.current;setError(null);
    return api(`/api/jobs/artifact?id=${encodeURIComponent(run.id)}&name=${encodeURIComponent(name)}&limit=${limit}`).then(
      value=>{if(request===latest.current)setData(value);},(e:unknown)=>{if(request===latest.current)setError(String(e instanceof Error?e.message:e));});};
  useEffect(()=>{setData(null);},[run.id,name]);
  useEffect(()=>{load(256*1024);return ()=>{latest.current++;};},[run.id,name,run.seq]);
  if(error)return <Notice tone="error" title={`Couldn’t read ${name}`}>{error}</Notice>;
  if(!data)return <LoadingState>Loading {name}…</LoadingState>;
  if(!data.available)return <span className="text-sm text-muted-foreground">This run has no {name}.</span>;
  const save=()=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([data.text||''],{type:'text/plain'}));link.download=run.id.slice(0,8)+'-'+name+(data.truncated?'.preview.txt':'');link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};
  return <div className="flex flex-col gap-2" data-job-artifact={name}>
    <span className="text-sm text-muted-foreground">{data.truncated?`A preview of the first ${(data.limit/1024).toLocaleString()} KiB${data.bytes?` of ${data.bytes.toLocaleString()} bytes`:''}. The archive keeps the complete artifact.`
      :`${(data.bytes??(data.text||'').length).toLocaleString()} bytes, complete.`}</span>
    <div className="flex flex-wrap gap-2">
      <Button size="xs" variant="outline" onClick={()=>navigator.clipboard?.writeText(data.text||'')}><CopyIcon/>Copy{data.truncated?' preview':''}</Button>
      <Button size="xs" variant="outline" onClick={save}><DownloadIcon/>Download{data.truncated?' preview':''}</Button>
      {data.truncated&&data.limit<1024*1024?<Button size="xs" variant="ghost" onClick={()=>load(1024*1024)}>Show up to 1 MiB</Button>:null}
    </div>
    <CodeBlock size="sm"><CodeBlockContent wrap className="max-h-96">{data.text}</CodeBlockContent></CodeBlock>
  </div>;
}
