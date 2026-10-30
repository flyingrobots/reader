/* Admin › Coding jobs (#admin/jobs) and one job (#admin/jobs/<uuid>). Design sheet: docs/admin-design/coding-jobs.md.
   The list reads bounded pages; the job page follows the run's event stream. Opening either starts nothing; Stop is
   the only action, and only for an active job this server owns. */
import * as React from 'react';
import {ArrowUpRightIcon, GitBranchIcon, GitPullRequestArrowIcon, RefreshCwIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Item, ItemContent, ItemGroup, ItemTitle} from '@/components/ui/item';
import {Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {FactList} from '@/theme/molecules/fact-list';
import {FilterBar, FilterSelect} from '@/theme/molecules/filter-select';
import {Notice} from '@/theme/molecules/notice';
import {Pager} from '@/theme/molecules/pager';
import {EmptyState, LoadingState} from '@/theme/molecules/states';
import {StatusCard} from '@/theme/organisms/status-card';
import {ActivityTranscript} from '../../activity/transcript';
import {ARTIFACTS, Artifact, OutcomeBadge, StopButton, jobLabels, runInfo} from '../../jobs/job-detail';
import {OUTCOME_LABELS, useJob, type JobRun} from '../../jobs/store';
import {Unavailable, dateTime, useLoad, type AdminPanelProps} from '../../jobs/admin';
import {needsReader} from '../../static-demo';

/** A job's GitHub results as outline link Buttons. */
function GitHubLinks({run}:{run:JobRun}){
  const links=[run.pr&&{href:run.pr.url,label:`Pull request #${run.pr.number}`},run.issue&&{href:run.issue.url,label:`Issue #${run.issue.number}${run.issue.created?' (created)':''}`},
    run.existing_pr&&{href:run.existing_pr.url,label:`Existing pull request #${run.existing_pr.number}`}].filter(Boolean) as {href:string;label:string}[];
  return <>{links.map(link=><Button key={link.href} variant="outline" size="sm" nativeButton={false} render={<a href={link.href} target="_blank" rel="noreferrer noopener"/>}>
    {link.label}<ArrowUpRightIcon data-icon="inline-end" aria-hidden/><span className="sr-only"> (opens GitHub in a new tab)</span></Button>)}</>;
}

export function JobsPage({options,go,href}:AdminPanelProps){
  const [repo,setRepo]=React.useState(''),[state,setState]=React.useState(''),[path,setPath]=React.useState(''),[cursor,setCursor]=React.useState(0);
  const query=new URLSearchParams({...(repo?{repo}:{}),...(state?{state}:{}),...(path?{path}:{}),cursor:String(cursor),limit:'25'});
  const [list,reload]=useLoad<{runs:JobRun[];total:number;next:number|null;configured:boolean;read_only:boolean}>(needsReader('jobs')?null:'/api/jobs?'+query,options.api);
  const [all]=useLoad<{runs:JobRun[]}>(needsReader('jobs')?null:'/api/jobs?limit=50',options.api);
  const repos=[...new Set((all.data?.runs||[]).map(r=>r.source.repo))],paths=[...new Set((all.data?.runs||[]).map(r=>r.source.path))];
  if(list.error||needsReader('jobs'))return <Unavailable what="Coding jobs" error={list.error}/>;
  const filter=(set:(value:string)=>void)=>(value:string)=>{set(value);setCursor(0);};
  return <div className="flex flex-col gap-4" data-admin-panel="jobs">
    <FilterBar label="Filter coding jobs" actions={<Button size="sm" variant="outline" onClick={reload}><RefreshCwIcon data-icon="inline-start" aria-hidden/>Refresh</Button>}>
      <FilterSelect id="jobs-repo" label="Repository" value={repo} onChange={filter(setRepo)} choices={repos.map(r=>({value:r,label:r}))}/>
      <FilterSelect id="jobs-state" label="State" value={state} onChange={filter(setState)} choices={[{value:'active',label:'Active'},...Object.entries(OUTCOME_LABELS).map(([value,label])=>({value,label}))]}/>
      <FilterSelect id="jobs-article" label="Article" value={path} onChange={filter(setPath)} choices={paths.map(p=>({value:p,label:p}))}/>
    </FilterBar>
    {list.data&&!list.data.configured?<Notice title="No repositories are registered" action={<Button size="xs" variant="outline" onClick={()=>go('repositories')}>Repositories</Button>}>No article prompt can run until one is.</Notice>:null}
    {list.data?.read_only?<Notice title="Read-only">Another Reader server owns coding jobs for this vault.</Notice>:null}
    {list.loading&&!list.data?<LoadingState>Loading coding jobs…</LoadingState>:null}
    {list.data?list.data.runs.length||repo||state||path?<StatusCard title="Jobs" description="Newest first."
        footer={<div className="w-full"><Pager count={`${list.data.total.toLocaleString()} jobs`} newer={!!cursor} older={list.data.next!==null} onNewer={()=>setCursor(Math.max(0,cursor-25))} onOlder={()=>setCursor(list.data!.next!)}/></div>}>
      <Table><TableCaption className="sr-only">Coding jobs, newest first</TableCaption>
        <TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Repository</TableHead><TableHead>State</TableHead><TableHead>Agent</TableHead><TableHead>Started</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
        <TableBody>{list.data.runs.length?list.data.runs.map(run=><TableRow key={run.id} data-job-row={run.id}>
          <TableCell className="max-w-64 whitespace-normal"><a className="font-medium text-primary underline-offset-4 hover:underline" href={href('jobs',run.id)} onClick={e=>{e.preventDefault();go('jobs',run.id);}}>{run.source.title}</a></TableCell>
          <TableCell>{run.source.repo}</TableCell><TableCell><OutcomeBadge run={run}/></TableCell><TableCell>{run.agent_label}</TableCell><TableCell className="tabular-nums">{dateTime(run.created_at)}</TableCell>
          <TableCell className="max-w-72 whitespace-normal">{run.pr?<a className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" href={run.pr.url} target="_blank" rel="noreferrer noopener">PR #{run.pr.number}<ArrowUpRightIcon className="size-3.5" aria-hidden/></a>:<span className="text-muted-foreground">{run.message?.slice(0,120)}</span>}</TableCell>
        </TableRow>):<TableRow><TableCell colSpan={6} className="text-muted-foreground">No coding jobs match.</TableCell></TableRow>}</TableBody>
      </Table>
    </StatusCard>:<EmptyState icon={GitPullRequestArrowIcon} title="No coding jobs yet" description="Run an article’s prompt to start one. Its queue, trace and pull request appear here."/>:null}
  </div>;
}

export function JobPage({id,options,open}:AdminPanelProps&{id:string}){
  const {run,activity,error,live}=useJob(id);
  const [artifact,setArtifact]=React.useState('prompt.txt');
  if(needsReader('jobs'))return <Unavailable what="Coding jobs" error={null}/>;
  if(!run)return error?<Unavailable what="This job" error={error}/>:<LoadingState>Loading the job…</LoadingState>;
  const facts=[{label:'Repository',value:run.source.repo},{label:'Article',value:<Button size="xs" variant="link" className="h-auto p-0" onClick={()=>open(run.source.path)}>{run.source.path}</Button>},
    {label:'Prompt block',value:run.source.block_id+(run.prompt.edited?' (edited for this run)':'')},{label:'Agent',value:run.agent_label},
    {label:'Branch',value:<span className="inline-flex items-center gap-1"><GitBranchIcon className="size-3.5" aria-hidden/>{run.git.branch}</span>},{label:'Base',value:`${run.git.base}${run.git.base_sha?' @ '+run.git.base_sha.slice(0,12):''}`},
    {label:'Head',value:run.git.head_sha?run.git.head_sha.slice(0,12):'—'},{label:'Worktree',value:run.git.worktree||'—'},
    {label:'Verification',value:run.verification?`${run.verification.argv} → ${run.verification.exit_code===null?'not finished':'exit '+run.verification.exit_code}`:'—'},
    {label:'Started',value:dateTime(run.started_at||run.created_at)},{label:'Finished',value:dateTime(run.finished_at)},{label:'Run ID',value:<span className="font-mono text-xs">{run.id}</span>},
    {label:'Archive',value:run.log||'—'},...(run.predecessor?[{label:'Reruns',value:run.predecessor}]:[])];
  return <article className="flex flex-col gap-4" aria-labelledby={'job-'+run.id} data-job-id={run.id} data-admin-panel="job">
    <StatusCard title={run.source.title} titleId={'job-'+run.id} description={live?'Live':undefined} badge={<OutcomeBadge run={run}/>}
      footer={run.active||run.pr||run.issue||run.existing_pr?<><StopButton run={run} notify={options.notify}/><GitHubLinks run={run}/></>:undefined}>
      {run.message?<Notice role="status" tone={run.outcome&&!['pr_opened','already_fixed','cancelled'].includes(run.outcome)?'error':'info'} title={run.message}/>:null}
      {run.unreconciled?<Notice tone="error" title="Interrupted">No Reader server owns this job. The next server to start reconciles it; nothing restarts it.</Notice>:null}
      {run.archive_error?<Notice tone="error" title="Archive error" data-job-archive-error="">{run.archive_error}</Notice>:null}
      <FactList facts={facts} layout="rows"/>
    </StatusCard>
    {run.git.commits.length?<StatusCard title="Commits"><ItemGroup aria-label="Commits">{run.git.commits.map(c=><Item key={c.sha} size="xs" role="listitem" variant="muted">
      <ItemContent><ItemTitle className="font-normal [overflow-wrap:anywhere]"><code className="font-mono text-xs text-muted-foreground">{c.sha.slice(0,12)}</code> {c.subject}</ItemTitle></ItemContent></Item>)}</ItemGroup></StatusCard>:null}
    <ActivityTranscript activity={activity} run={runInfo(run)} live={run.active} html={options.html} onOpen={options.onOpen} labels={jobLabels(run)}/>
    <StatusCard title="Archive" description="The run’s archived artifacts, with bounded previews.">
      <Tabs value={artifact} onValueChange={value=>setArtifact(String(value))}>
        <TabsList variant="line" aria-label="Artifacts" className="h-auto w-full flex-wrap justify-start">{ARTIFACTS.map(name=><TabsTrigger key={name} value={name} className="flex-none">{name}</TabsTrigger>)}</TabsList>
        <TabsContent value={artifact} className="pt-3"><Artifact run={run} name={artifact} api={options.api}/></TabsContent>
      </Tabs>
    </StatusCard>
  </article>;
}
