/* One coding job (RW-44), as the article's prompt card and Reader Admin both show it: the same run ID, cursor, trace
   and outcome. The compact form (in an article) is a status line, the deterministic phases, Stop and the result;
   its full trace opens on request, and on its own when a check failed. The full form (Admin) adds branch/head
   details and the run's archived artifacts with bounded previews. */
import {useEffect, useState, type ReactNode} from 'react';
import {ArrowUpRightIcon, CopyIcon, DownloadIcon, GitBranchIcon, LoaderCircleIcon, SquareIcon} from 'lucide-react';
import {ActivityTranscript, type Labels, type RunInfo} from '../activity/transcript';
import {steps} from '../activity/reducer';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {CodeBlock, CodeBlockContent} from '../components/ui/code-block';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '../components/ui/collapsible';
import {stopJob, statusLabel, useJob, type JobRun} from './store';

export const ARTIFACTS=['request.json','prompt.txt','system.txt','stdout.jsonl','stderr.log','events.jsonl','verify.log','git.log','last-message.md','result.json','meta.json'];
const GOOD=['pr_opened','already_fixed'];
export const jobLabels=(run:JobRun|null):Partial<Labels>=>({title:'Trace',speaker:run?.agent_label||'Agent',tool:run?.agent_label||'Agent',log:'Coding job trace',
  waiting:'Waiting for the first step…',logHint:run?.log?'the run archive ('+run.log+')':null});
export type JobViewOptions={html:(text:string)=>string;onOpen:(path:string)=>void;api:(path:string,payload?:unknown)=>Promise<any>;notify?:(message:string,kind?:string)=>void};

function runInfo(run:JobRun|null):RunInfo{
  return {status:run?run.outcome||run.status:null,startedAt:run?.started_at||run?.created_at||null,finishedAt:run?.finished_at||null,arrivals:[],remaining:null,titles:{},
    message:run?.message||null,stderr:null,commit:null};
}

export function OutcomeBadge({run}:{run:JobRun}){
  const tone:'secondary'|'outline'|'destructive'=run.outcome?GOOD.includes(run.outcome)?'secondary':run.outcome==='cancelled'?'outline':'destructive':'outline';
  return <Badge variant={tone} data-job-outcome={run.outcome||run.status}>{!run.outcome&&run.status==='running'?<LoaderCircleIcon className="animate-spin" aria-hidden/>:null}{statusLabel(run)}</Badge>;
}

function Links({run}:{run:JobRun}){
  const links=[run.pr&&{href:run.pr.url,label:`Pull request #${run.pr.number}`},run.issue&&{href:run.issue.url,label:`Issue #${run.issue.number}${run.issue.created?' (created)':''}`},
    run.existing_pr&&{href:run.existing_pr.url,label:`Existing pull request #${run.existing_pr.number}`}].filter(Boolean) as {href:string;label:string}[];
  if(!links.length)return null;
  return <ul className="job-links" aria-label="On GitHub">{links.map(link=><li key={link.href}>
    <a href={link.href} target="_blank" rel="noreferrer noopener" className="job-link">{link.label}<ArrowUpRightIcon aria-hidden/><span className="sr-only"> (opens GitHub in a new tab)</span></a></li>)}</ul>;
}

function StopButton({run,notify}:{run:JobRun;notify?:JobViewOptions['notify']}){
  const [busy,setBusy]=useState(false);
  if(!run.active)return null;
  return <Button size="sm" variant="outline" disabled={busy||!run.can_stop} title={run.can_stop?undefined:'Another Reader server owns this job'} data-job-stop=""
    onClick={async()=>{setBusy(true);try{await stopJob(run.id);notify?.('Stop requested. Completed effects stay recorded.');}catch(error){notify?.(error instanceof Error?error.message:String(error),'error');}finally{setBusy(false);}}}>
    {busy?<LoaderCircleIcon className="animate-spin"/>:<SquareIcon/>}Stop</Button>;
}

/** A compact job: status, phase, Stop, result links and an on-demand trace. */
export function JobSummary({id,options,onAdmin}:{id:string;options:JobViewOptions;onAdmin?:(id:string)=>void}){
  const {run,activity,error}=useJob(id);
  const failedStep=activity.items.some(i=>i.kind==='tool'&&(i.status==='failed'||i.exitCode!==null&&i.exitCode!==0)&&i.id.startsWith('job-'));
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(failedStep)setOpen(true);},[failedStep]);
  if(!run)return <p className="job-quiet" role="status">{error?`Couldn’t load this job: ${error}`:'Loading the job…'}</p>;
  const list=steps(activity,!run.active),current=list.find(s=>s.state==='running'||s.state==='failed');
  return <div className="job-summary" data-job-id={run.id} data-job-status={run.outcome||run.status}>
    <div className="job-summary-head">
      <OutcomeBadge run={run}/>
      <span className="job-phase" role="status" aria-live="polite">{run.active?(current?current.label:'Waiting to start')+'…':run.message}</span>
      <StopButton run={run} notify={options.notify}/>
    </div>
    <Links run={run}/>
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button size="xs" variant="ghost" className="job-trace-toggle" aria-expanded={open}/>}>{open?'Hide trace':'Show trace'}</CollapsibleTrigger>
      {onAdmin?<Button size="xs" variant="ghost" onClick={()=>onAdmin(run.id)}>Open in Reader Admin</Button>:null}
      <CollapsibleContent>
        {open?<ActivityTranscript activity={activity} run={runInfo(run)} live={run.active} html={options.html} onOpen={options.onOpen} labels={jobLabels(run)}/>:null}
      </CollapsibleContent>
    </Collapsible>
  </div>;
}

function Artifact({run,name,api}:{run:JobRun;name:string;api:JobViewOptions['api']}){
  const [data,setData]=useState<{text:string|null;bytes:number|null;truncated:boolean;limit:number;available:boolean}|null>(null),[error,setError]=useState<string|null>(null);
  const load=(limit:number)=>api(`/api/jobs/artifact?id=${encodeURIComponent(run.id)}&name=${encodeURIComponent(name)}&limit=${limit}`).then(setData,(e:unknown)=>setError(String(e instanceof Error?e.message:e)));
  useEffect(()=>{load(256*1024);},[run.id,name,run.seq]);
  if(error)return <p className="job-quiet">{error}</p>;
  if(!data)return <p className="job-quiet">Loading {name}…</p>;
  if(!data.available)return <p className="job-quiet">This run has no {name}.</p>;
  const save=()=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([data.text||''],{type:'text/plain'}));link.download=run.id.slice(0,8)+'-'+name+(data.truncated?'.preview.txt':'');link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};
  return <div className="job-artifact" data-job-artifact={name}>
    <p className="job-quiet">{data.truncated?`A preview of the first ${(data.limit/1024).toLocaleString()} KiB${data.bytes?` of ${data.bytes.toLocaleString()} bytes`:''}. The archive keeps the complete artifact.`
      :`${(data.bytes??(data.text||'').length).toLocaleString()} bytes, complete.`}</p>
    <div className="job-artifact-actions">
      <Button size="xs" variant="outline" onClick={()=>navigator.clipboard?.writeText(data.text||'')}><CopyIcon/>Copy{data.truncated?' preview':''}</Button>
      <Button size="xs" variant="outline" onClick={save}><DownloadIcon/>Download{data.truncated?' preview':''}</Button>
      {data.truncated&&data.limit<1024*1024?<Button size="xs" variant="ghost" onClick={()=>load(1024*1024)}>Show up to 1 MiB</Button>:null}
    </div>
    <CodeBlock size="sm"><CodeBlockContent wrap className="max-h-96">{data.text}</CodeBlockContent></CodeBlock>
  </div>;
}

/** The full job page (Reader Admin): facts, trace and archived artifacts. */
export function JobDetail({id,options,onArticle}:{id:string;options:JobViewOptions;onArticle?:(path:string)=>void}){
  const {run,activity,error,live}=useJob(id);
  const [artifact,setArtifact]=useState('prompt.txt');
  if(!run)return <p className="job-quiet" role="status">{error?`Couldn’t load this job: ${error}`:'Loading the job…'}</p>;
  const facts:[string,ReactNode][]=[['Repository',run.source.repo],['Article',onArticle?<Button size="xs" variant="link" onClick={()=>onArticle(run.source.path)}>{run.source.path}</Button>:run.source.path],
    ['Prompt block',run.source.block_id+(run.prompt.edited?' (edited for this run)':'')],['Agent',run.agent_label],
    ['Branch',<><GitBranchIcon aria-hidden className="job-inline-icon"/>{run.git.branch}</>],['Base',`${run.git.base}${run.git.base_sha?' @ '+run.git.base_sha.slice(0,12):''}`],
    ['Head',run.git.head_sha?run.git.head_sha.slice(0,12):'—'],['Worktree',run.git.worktree||'—'],
    ['Verification',run.verification?`${run.verification.argv} → ${run.verification.exit_code===null?'not finished':'exit '+run.verification.exit_code}`:'—'],
    ['Started',run.started_at||run.created_at],['Finished',run.finished_at||'—'],['Run ID',run.id],['Archive',run.log||'—']];
  if(run.predecessor)facts.push(['Reruns',run.predecessor]);
  return <article className="job-detail" aria-labelledby={'job-'+run.id} data-job-id={run.id}>
    <header className="job-detail-head">
      <h2 id={'job-'+run.id} className="job-title">{run.source.title}</h2>
      <OutcomeBadge run={run}/><StopButton run={run} notify={options.notify}/>
      {live?<span className="job-quiet">Live</span>:null}
    </header>
    {run.message?<p className="job-message" role="status">{run.message}</p>:null}
    {run.unreconciled?<p className="job-message">No Reader server owns this job, so it was interrupted. The next server to start reconciles it; nothing restarts it.</p>:null}
    {run.archive_error?<p className="job-message" data-job-archive-error="">{run.archive_error}</p>:null}
    <Links run={run}/>
    <dl className="job-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {run.git.commits.length?<section aria-label="Commits"><h3 className="job-section">Commits</h3><ul className="job-commits">{run.git.commits.map(c=><li key={c.sha}><code>{c.sha.slice(0,12)}</code> {c.subject}</li>)}</ul></section>:null}
    <ActivityTranscript activity={activity} run={runInfo(run)} live={run.active} html={options.html} onOpen={options.onOpen} labels={jobLabels(run)}/>
    <section aria-label="Archived artifacts" className="job-artifacts">
      <h3 className="job-section">Archive</h3>
      <div className="job-artifact-tabs" role="tablist" aria-label="Artifacts">{ARTIFACTS.map(name=><Button key={name} size="xs" variant={name===artifact?'secondary':'ghost'} role="tab" aria-selected={name===artifact} onClick={()=>setArtifact(name)}>{name}</Button>)}</div>
      <Artifact run={run} name={artifact} api={options.api}/>
    </section>
  </article>;
}
