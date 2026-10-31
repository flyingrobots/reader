/* Admin › Indexes: freshness of each rebuildable index, on-demand rebuilds, this server's recent runs and the edition-link
   diagnostics. Design sheet: docs/admin-design/indexes.md. Unreadable maintenance status is shown as unavailable, never
   as a set of empty cards. */
import {useEffect, useState, type ReactNode} from 'react';
import {DatabaseIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ButtonGroup} from '@/components/ui/button-group';
import {Spinner} from '@/components/ui/spinner';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {StatusBadge, type Tone} from '@/theme/atoms/status-badge';
import {Elapsed, RelativeTime, when} from '@/theme/atoms/time';
import {FactList} from '@/theme/molecules/fact-list';
import {Notice} from '@/theme/molecules/notice';
import {RunRow} from '@/theme/molecules/run-row';
import {EmptyState, LoadingState, Unavailable} from '@/theme/molecules/states';
import {Toolbar} from '@/theme/molecules/toolbar';
import {RunList} from '@/theme/organisms/run-list';
import {StatusCard} from '@/theme/organisms/status-card';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {IndexCharts} from './index-charts';
import {INDEXES, INDEX_OF, STATES, jobOutcome, type Job, type MaintenanceStatus} from '../../backstage';
import {localOnly, needsReader} from '../../static-demo';

type EditionStats={stats:{files:number;families:number;unresolved:number;build_ms?:number;partial:boolean;header_bytes:number};unresolved:{path:string;field:string;value:string}[]};
/** Edition links: families found and the references that could not be resolved (never guessed or repaired). */
export function EditionLinks({api}:{api:(path:string)=>Promise<any>}){
  const [data,setData]=useState<EditionStats|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{let live=true;api('/api/editions/diagnostics').then(d=>{if(live)setData(d);},e=>{if(live)setError(e instanceof Error?e.message:String(e));});return ()=>{live=false;};},[api]);
  return <StatusCard id="edition-links" title="Edition links" data-state={data?(data.stats.unresolved?'unresolved':'current'):error?'error':'loading'}
    description="Originals, reading copies and numbered versions, linked from frontmatter and file names. Read-only: nothing is repaired."
    badge={<StatusBadge tone={error?'error':!data?'neutral':data.stats.unresolved?'attention':'ok'} busy={!data&&!error}>{error?'Error':!data?'Loading…':data.stats.unresolved?`${data.stats.unresolved} unresolved`:'All resolved'}</StatusBadge>}>
    {error?<Unavailable what="Edition links" error={error}/>:!data?<LoadingState/>:<>
      <FactList facts={[{label:'Families',value:data.stats.families},{label:'Markdown files',value:data.stats.files},
        {label:'Index built in',value:data.stats.build_ms!==undefined?`${Math.round(data.stats.build_ms)} ms`:null},{label:'Coverage',value:data.stats.partial?'Partial (limits reached)':null}]}/>
      {data.unresolved.length?<Table data-unresolved="">
        <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Field</TableHead><TableHead>Value</TableHead></TableRow></TableHeader>
        <TableBody>{data.unresolved.map(u=><TableRow key={u.path+u.field}><TableCell className="font-mono text-xs whitespace-normal [overflow-wrap:anywhere]">{u.path}</TableCell><TableCell>{u.field}</TableCell><TableCell className="whitespace-normal [overflow-wrap:anywhere]">{u.value}</TableCell></TableRow>)}</TableBody>
      </Table>:null}</>}
  </StatusCard>;
}

type LegacyIndex={format:number;bytes:number;removable:boolean};
/** The retired format 1 index, which Reader no longer reads. Removal is explicit. */
function Legacy({legacy,busy,onRemove}:{legacy:LegacyIndex;busy:boolean;onRemove:()=>void}){
  const mb=Math.max(1,Math.round(legacy.bytes/1e6)).toLocaleString();
  return <Notice data-legacy="retired" title="Old search index" action={<Button data-job="remove-legacy-search" variant="outline" size="xs" disabled={busy} {...localOnly()}
      title="Deletes .reader/search.sqlite3 only. Refused while an index run or another process is using it." onClick={onRemove}>Remove</Button>}>
    Format {legacy.format}, no longer read: {mb} MB.
  </Notice>;
}

const runState=(job:Job)=>job.state;
function RunMeta({job}:{job:Job}){
  return job.state==='running'?<>Started <RelativeTime value={job.started_at}/>{job.progress?<> · {job.progress}</>:null}</>:<><RelativeTime value={job.finished_at}/> · {job.elapsed_seconds} s</>;
}
/** This server's maintenance jobs since it started (the inventory Overview links to). */
export function RecentRuns({status,error}:{status:MaintenanceStatus|null;error:string|null}){
  const running=status?.running,jobs=status?[...(running?[running]:[]),...status.jobs].slice(0,10):[];
  return <StatusCard id="recent-runs" title="Recent runs" description="This server’s jobs since it started. Toasts announce each start, finish and failure.">
    {jobs.length?<RunList label="Recent runs" runs={jobs} keyOf={job=>job.id+job.state} render={job=><RunRow state={runState(job)} data-job-state={job.state} title={job.label} meta={<RunMeta job={job}/>} outcome={job.state!=='running'?jobOutcome(job):null}/>}/>
      :status?<EmptyState icon={DatabaseIcon} title="No runs yet" description="Rebuilds and checks started here or elsewhere appear as they run."/>
      :error?<Unavailable what="Recent runs" error={error}/>:<LoadingState/>}
  </StatusCard>;
}

export function IndexesPage({status,error,onStart,editions}:{status:MaintenanceStatus|null;error:string|null;onStart:(kind:string)=>void;editions?:ReactNode}){
  const [selected,setSelected]=useState('search');
  const running=status?.running,busy=!!running||!!status?.checking,checkedAt=Object.values(status?.checks||{})[0]?.checked_at,local=needsReader();
  const unavailable=!status&&!!error,checking=!!status?.checking||running?.kind==='check';
  const measured=INDEXES.filter(index=>status?.checks[index.key]),current=measured.filter(index=>['current','ok'].includes(status!.checks[index.key].state));
  const attention=measured.filter(index=>!['current','ok','unconfigured'].includes(status!.checks[index.key].state));
  const lastCheck=status?.jobs.find(job=>job.kind==='check');
  const index=INDEXES.find(index=>index.key===selected)!,check=status?.checks[selected];
  const facts=check?index.facts.map(([label,value])=>({label,value:value(check) as ReactNode})).filter(f=>f.value!==null&&f.value!==undefined):[];
  return <section className="flex min-w-0 flex-col gap-5" id="backstage-indexes" aria-label="Indexes" data-state={unavailable?'unavailable':status?'ready':'loading'}>
    <Toolbar media={checking?<Spinner aria-hidden/>:null} status={checking?<span role="status">{running?.kind==='check'?<>Checking freshness · <Elapsed since={running.started_at}/></>:'Verifying freshness after the rebuild'}</span>:unavailable?'Index status is unavailable':checkedAt?'Last checked '+when(checkedAt):local?'Checks need Reader on your computer':'Waiting for the first freshness check'}>
      <Button id="maintenance-check" variant="outline" size="sm" disabled={busy||unavailable} {...localOnly()} onClick={()=>onStart('check')}>Check again</Button>
    </Toolbar>
    {unavailable?<Unavailable id="indexes-unavailable" what="Index status" error={error!}/>:null}
    {status&&error?<Notice id="indexes-stale" role="status" title="The last status refresh failed">{error}. Showing the previous measurements.</Notice>:null}
    {busy?<Notice data-index-busy="" title={running?.kind==='check'?'A full freshness audit is running':running?running.label+' is running':'The rebuild finished; verification is running'}>
      {running?.progress||'The current measurements stay visible while this completes.'} Reader currently runs one maintenance job at a time; rebuild controls return when it is finished. You can keep reading.
    </Notice>:null}
    <div className="grid gap-4 sm:grid-cols-3" data-index-summary="">
      <Card size="sm"><CardHeader><CardDescription>Current</CardDescription><CardTitle className="tabular-nums">{measured.length?`${current.length} / ${INDEXES.length}`:'—'}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Indexes and inventories with a current check.</p></CardContent></Card>
      <Card size="sm"><CardHeader><CardDescription>Needs attention</CardDescription><CardTitle className="tabular-nums">{measured.length?attention.length:'—'}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Stale, partial, missing, over budget, or failed.</p></CardContent></Card>
      <Card size="sm"><CardHeader><CardDescription>Latest full check</CardDescription><CardTitle className="tabular-nums">{lastCheck?.elapsed_seconds!==null&&lastCheck?.elapsed_seconds!==undefined?`${lastCheck.elapsed_seconds} s`:'—'}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{lastCheck?.state==='failed'?'The last audit failed.':lastCheck?'Measured audit duration, excluding polling delay.':'No completed audit in this server session yet.'}</p></CardContent></Card>
    </div>
    <IndexCharts status={status} selected={selected} onSelect={setSelected}/>
    <Card data-index-fleet="" className="min-w-0">
      <CardHeader><CardTitle>Index health</CardTitle><CardDescription>Choose an index to inspect its measurements. Rebuilds update derived data; they do not file or read documents.</CardDescription></CardHeader>
      <CardContent><Table>
        <TableHeader><TableRow><TableHead>Index</TableHead><TableHead>State</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
        <TableBody>{INDEXES.map(row=>{
          const result=status?.checks?.[row.key],active=!!running&&INDEX_OF[running.kind]===row.key;
          const state:{label:string;tone:Tone}=active?{label:'Rebuilding…',tone:'active'}:result?STATES[result.state]||{label:result.state,tone:'neutral'}:{label:unavailable?'Unavailable':local?'Not checked':'Not measured',tone:unavailable?'error':'neutral'};
          return <TableRow key={row.key} data-index={row.key} data-state={active?'running':result?.state||(unavailable?'unavailable':'unknown')} data-selected={row.key===selected||undefined}>
            <TableCell><Button variant="ghost" size="sm" aria-pressed={selected===row.key} className="justify-start" onClick={()=>setSelected(row.key)}>{row.title}</Button></TableCell>
            <TableCell><StatusBadge tone={state.tone} busy={active}>{state.label}</StatusBadge></TableCell>
            <TableCell><ButtonGroup className="flex-wrap">{row.actions.map(action=><Button key={action.kind} data-job={action.kind} variant="outline" size="sm" disabled={busy||unavailable} {...localOnly()} onClick={()=>onStart(action.kind)}>{action.label}</Button>)}</ButtonGroup></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></CardContent>
    </Card>
    <StatusCard id="index-inspector" title={index.title} description={index.description} data-inspected-index={selected}
      badge={check?<StatusBadge tone={(STATES[check.state]||{tone:'neutral' as Tone}).tone}>{(STATES[check.state]||{label:check.state}).label}</StatusBadge>:undefined}>
      {check?.message?<p className="text-sm [overflow-wrap:anywhere]" data-check-message="">{check.message}</p>:<p className="text-sm text-muted-foreground">No measurements yet. The full audit publishes its results together.</p>}
      {facts.length?<Table><TableHeader><TableRow><TableHead>Measurement</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{facts.map(fact=><TableRow key={fact.label} data-fact={fact.label.toLowerCase()}><TableCell>{fact.label}</TableCell><TableCell data-fact-value="" className="tabular-nums">{fact.value}</TableCell></TableRow>)}</TableBody></Table>:null}
      {index.note?<p className="text-sm text-muted-foreground" data-index-note="">{index.note}</p>:null}
      {selected==='search'&&check?.legacy?<Legacy legacy={check.legacy as LegacyIndex} busy={busy} onRemove={()=>onStart('remove-legacy-search')}/>:null}
    </StatusCard>
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2"><RecentRuns status={status} error={error}/>{editions}</div>
  </section>;
}
