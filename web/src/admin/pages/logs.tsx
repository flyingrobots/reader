/* Admin › LLM logs (#admin/logs) and one archived run (#admin/logs/<kind>/<date>/<run-id>). Design sheet:
   docs/admin-design/llm-logs.md. The archive under logs/llm/ is kept forever; these pages read it in bounded pages
   and previews and never prune. */
import * as React from 'react';
import {ChevronRightIcon, CopyIcon, RefreshCwIcon, ScrollTextIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {CodeBlock, CodeBlockContent} from '@/components/ui/code-block';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {StatusBadge} from '@/theme/atoms/status-badge';
import {FactList} from '@/theme/molecules/fact-list';
import {FilterBar, FilterSelect} from '@/theme/molecules/filter-select';
import {Pager} from '@/theme/molecules/pager';
import {EmptyState, LoadingState} from '@/theme/molecules/states';
import {StatusCard} from '@/theme/organisms/status-card';
import {Unavailable, dateTime, logParams, logPath, useLoad, type AdminPanelProps} from '../../jobs/admin';
import {needsReader} from '../../static-demo';

type LogRow={path:string;kind:string;run_id:string;status:string|null;outcome?:string|null;started_at:string|null;ended_at:string|null;agent:string|null;title:string|null;bytes:number;artifacts:string[];sealed:boolean};
const kib=(bytes:number)=>bytes?(bytes/1024).toLocaleString(undefined,{maximumFractionDigits:1})+' KiB':'—';

export function LogsPage({options,go,href}:AdminPanelProps){
  const [kind,setKind]=React.useState(''),[pages,setPages]=React.useState<(string|null)[]>([null]);
  const cursor=pages.at(-1);
  const query=new URLSearchParams({...(kind?{kind}:{}),...(cursor?{cursor}:{}),limit:'30'});
  const [page,reload]=useLoad<{runs:LogRow[];next:string|null;kinds:string[];retention:string}>(needsReader('logs')?null:'/api/logs?'+query,options.api);
  if(page.error||needsReader('logs'))return <Unavailable what="The LLM log archive" error={page.error}/>;
  return <div className="flex flex-col gap-4" data-admin-panel="logs">
    <FilterBar label="Filter LLM logs" actions={<Button size="sm" variant="outline" onClick={reload}><RefreshCwIcon data-icon="inline-start" aria-hidden/>Refresh</Button>}>
      <FilterSelect id="logs-kind" label="Kind" value={kind} onChange={value=>{setKind(value);setPages([null]);}} choices={(page.data?.kinds||[]).map(k=>({value:k,label:k}))}/>
    </FilterBar>
    {page.loading&&!page.data?<LoadingState>Reading the archive…</LoadingState>:null}
    {page.data?page.data.runs.length||kind||pages.length>1?<StatusCard title="Archived runs" description="Newest first."
        footer={<div className="w-full"><Pager newer={pages.length>1} older={!!page.data.next} onNewer={()=>setPages(pages.slice(0,-1))} onOlder={()=>setPages([...pages,page.data!.next])}/></div>}>
      <Table><TableCaption className="sr-only">Archived LLM runs, newest first</TableCaption>
        <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Kind</TableHead><TableHead>Status</TableHead><TableHead>Agent</TableHead><TableHead>Started</TableHead><TableHead className="text-right">Size</TableHead></TableRow></TableHeader>
        <TableBody>{page.data.runs.length?page.data.runs.map(row=><TableRow key={row.path} data-log-row={row.run_id}>
          <TableCell className="max-w-64 whitespace-normal [overflow-wrap:anywhere]"><a className="font-medium text-primary underline-offset-4 hover:underline" href={href('logs',...logParams(row.path))} onClick={e=>{e.preventDefault();go('logs',...logParams(row.path));}}>{row.title||row.run_id}</a></TableCell>
          <TableCell>{row.kind}</TableCell>
          <TableCell><StatusBadge tone={!row.sealed?'active':['failed','error'].includes(row.outcome||row.status||'')?'error':'neutral'}>{row.outcome||row.status||'unknown'}{row.sealed?'':' · open'}</StatusBadge></TableCell>
          <TableCell>{row.agent||'—'}</TableCell><TableCell className="tabular-nums">{dateTime(row.started_at)}</TableCell><TableCell className="text-right tabular-nums">{kib(row.bytes)}</TableCell></TableRow>)
          :<TableRow><TableCell colSpan={6} className="text-muted-foreground">No archived runs{kind?` of kind ${kind}`:''}.</TableCell></TableRow>}</TableBody>
      </Table>
    </StatusCard>:<EmptyState icon={ScrollTextIcon} title="No archived runs yet" description="Runs appear here as soon as Reader starts a model or agent."/>:null}
  </div>;
}

export function LogPage({params,options}:AdminPanelProps&{params:string[]}){
  const relative=logPath(params);
  const [detail]=useLoad<{run:LogRow;meta:Record<string,unknown>;artifacts:string[]}>(needsReader('logs')?null:'/api/logs/run?path='+encodeURIComponent(relative),options.api);
  const [name,setName]=React.useState<string|null>(null);
  const chosen=name||detail.data?.artifacts.find(a=>a.startsWith('prompt'))||detail.data?.artifacts[0]||null;
  const [artifact]=useLoad<{text:string|null;bytes:number|null;truncated:boolean;limit:number;available:boolean}>(chosen?`/api/logs/artifact?path=${encodeURIComponent(relative)}&name=${encodeURIComponent(chosen)}`:null,options.api,[relative]);
  if(detail.error||needsReader('logs'))return <Unavailable what="This LLM run" error={detail.error}/>;
  if(!detail.data)return <LoadingState>Reading the run…</LoadingState>;
  const run=detail.data.run;
  return <article className="flex flex-col gap-4" data-admin-panel="log">
    <StatusCard title={run.title||run.run_id} badge={<StatusBadge tone={run.sealed?'neutral':'active'}>{run.status||'unknown'}{run.sealed?'':' · open'}</StatusBadge>}
      description={run.sealed?undefined:'Still open: artifacts end in .partial until the run is sealed.'}>
      <FactList layout="rows" facts={[{label:'Kind',value:run.kind},{label:'Agent',value:run.agent},{label:'Started',value:dateTime(run.started_at)},{label:'Ended',value:run.ended_at?dateTime(run.ended_at):null},
        {label:'Size',value:kib(run.bytes)},{label:'Archive',value:<span className="font-mono text-xs">{relative}</span>}]}/>
      <Collapsible className="rounded-lg border">
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start"/>}><ChevronRightIcon data-icon="inline-start" aria-hidden className="transition-transform in-data-[panel-open]:rotate-90"/>Run metadata</CollapsibleTrigger>
        <CollapsibleContent className="border-t px-3 py-3"><CodeBlock size="sm"><CodeBlockContent wrap className="max-h-96">{JSON.stringify(detail.data.meta,null,2)}</CodeBlockContent></CodeBlock></CollapsibleContent>
      </Collapsible>
    </StatusCard>
    <StatusCard title="Artifacts" description="Bounded previews; the archive keeps every artifact complete.">
      {detail.data.artifacts.length?<Tabs value={chosen} onValueChange={value=>setName(String(value))}>
        <TabsList variant="line" aria-label="Artifacts" className="h-auto w-full flex-wrap justify-start">{detail.data.artifacts.map(a=><TabsTrigger key={a} value={a} className="flex-none">{a}</TabsTrigger>)}</TabsList>
        <TabsContent value={chosen||''} className="flex flex-col gap-3 pt-3">
          {artifact.data?<>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm text-muted-foreground">{artifact.data.truncated?`A preview of the first ${(artifact.data.limit/1024).toLocaleString()} KiB; the archive keeps the complete artifact.`:'Complete.'}</span>
              <Button size="xs" variant="outline" onClick={()=>navigator.clipboard?.writeText(artifact.data!.text||'')}><CopyIcon data-icon="inline-start" aria-hidden/>Copy{artifact.data.truncated?' preview':''}</Button>
            </div>
            <CodeBlock size="sm"><CodeBlockContent wrap className="max-h-[32rem]">{artifact.data.text??'Missing from the archive.'}</CodeBlockContent></CodeBlock></>
            :artifact.error?<Unavailable what={chosen||'Artifact'} error={artifact.error}/>:<LoadingState/>}
        </TabsContent>
      </Tabs>:<span className="text-sm text-muted-foreground">This run archived no artifacts.</span>}
    </StatusCard>
  </article>;
}
