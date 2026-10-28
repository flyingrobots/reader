/* The activity transcript: agent events as shadcn AI Elements (Base UI), composed from the registry's Trace,
 * Message, Marker, Hover Card, Code Block, Collapsible, Button and Progress items as the AI Elements docs
 * describe. Text renders as text; agent messages go through the app's DOMPurify-sanitized Markdown.
 * Producer-neutral: the inbox runner and coding jobs (RW-44) pass their own `labels`; the defaults are the inbox's. */
import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode} from 'react';
import {ArrowDownIcon, BotIcon, GitPullRequestIcon, ChevronRightIcon, CircleCheckIcon, CircleDotIcon, CircleIcon, CircleXIcon, FileIcon, FileMinusIcon, FilePenIcon, FilePlusIcon,
  FlaskConicalIcon, FolderIcon, GaugeIcon, GitCommitHorizontalIcon, GlobeIcon, InboxIcon, ListChecksIcon, RouteIcon, TerminalIcon, TriangleAlertIcon, WrenchIcon, XIcon, ArrowUpRightIcon} from 'lucide-react';
import {Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle} from '../components/ui/trace';
import {Message, MessageContent, MessageHeader} from '../components/ui/message';
import {Marker, MarkerContent, MarkerIcon} from '../components/ui/marker';
import {HoverCard, HoverCardContent, HoverCardTrigger} from '../components/ui/hover-card';
import {CodeBlock, CodeBlockContent} from '../components/ui/code-block';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '../components/ui/collapsible';
import {Button} from '../components/ui/button';
import {Progress} from '../components/ui/progress';
import {steps as stepsOf, queue as queueOf, type Activity, type Item, type Lines, type Usage} from './reducer';

export type RunInfo={status:string|null;startedAt:string|null;finishedAt:string|null;arrivals:string[];remaining:string[]|null;titles:Record<string,string>;
  message?:string|null;stderr?:string|null;commit?:{hash:string;short:string;subject:string}|null};
/** Wording that names the producer. `logHint` says where a full log is kept, or null. */
export type Labels={title:string;speaker:string;tool:string;log:string;waiting:string;logHint:string|null};
export const INBOX_LABELS:Labels={title:'Activity',speaker:'Librarian',tool:'Codex',log:'Librarian activity',waiting:'Waiting for the librarian’s first step…',
  logHint:'.reader/inbox-runner/events.jsonl'};
type Props={activity:Activity;run:RunInfo;live:boolean;html:(text:string)=>string;onOpen:(path:string)=>void;onReport?:()=>void;labels?:Partial<Labels>};
const FAILED=['failed','interrupted','blocked','needs_reconciliation'];
const ENDED:Record<string,string>={failed:'Failed',interrupted:'Interrupted',stopped:'Stopped',cancelled:'Stopped',blocked:'Blocked',needs_reconciliation:'Stopped for reconciliation'};

const tokens=(n:number)=>n<1000?String(n):n<1e6?(n/1000).toFixed(n<1e4?1:0).replace(/\.0$/,'')+'k':(n/1e6).toFixed(1).replace(/\.0$/,'')+'M';
const seconds=(start?:number,end?:number)=>start&&end&&end-start>=1000?Math.round((end-start)/1000):null;
const clock=(s:number)=>s>=3600?`${Math.floor(s/3600)} h ${Math.floor(s%3600/60)} min`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
const openable=(path:string)=>/^(library|inbox)\//.test(path);
const plural=(n:number,word:string)=>`${n.toLocaleString()} ${word}${n===1?'':'s'}`;

function Output({output,omittedBytes,failed,logHint}:{output:Lines;omittedBytes:number;failed:boolean;logHint:string|null}){
  const [all,setAll]=useState(false);
  if(!output.full)return <p className="activity-quiet">No output.</p>;
  return <div className="activity-output">
    <CodeBlock size="sm" variant={failed?'destructive':'default'} data-activity-terminal="">
      <CodeBlockContent wrap className="max-h-64">{all?output.full:output.lines.join('\n')}</CodeBlockContent>
    </CodeBlock>
    {output.omitted&&!all?<Button variant="ghost" size="xs" data-activity-full="" onClick={()=>setAll(true)}>Show all {plural(output.omitted+output.lines.length,'line')}</Button>:null}
    {omittedBytes?<p className="activity-quiet">The server kept the first and last 64 KiB of {tokens(omittedBytes)} characters{logHint?`; the full log stays in ${logHint}`:''}.</p>:null}
  </div>;
}

function ToolRow({item,logHint}:{item:Extract<Item,{kind:'tool'}>;logHint:string|null}){
  const running=item.status==='running',failed=item.status==='failed'||item.status==='declined'||item.exitCode!==null&&item.exitCode!==0;
  const took=seconds(item.startedAt,item.endedAt),tests=item.tests;
  const title=running?<>Running <code>{item.title}</code></>:item.status==='declined'?<>Declined <code>{item.title}</code></>:failed?<><code>{item.title}</code> exited with code {item.exitCode??'?'}</>:<>Ran <code>{item.title}</code></>;
  return <TraceCollapsible defaultOpen={failed}>
    <TraceCollapsibleTrigger aria-label={(running?'Running ':failed?'Failed: ':'Ran ')+item.title}>
      <TraceLine status={running?'running':failed?'error':undefined}>
        <TraceIcon>{running?<span className="activity-spinner" aria-hidden/>:failed?<XIcon/>:<TerminalIcon/>}</TraceIcon>
        <TraceTitle>{title}</TraceTitle>
        {running?<span className="sr-only">(running)</span>:null}
        {took!==null?<TraceDescription>{took} s</TraceDescription>:null}
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <div className="activity-tool">
        <p className="activity-command"><span aria-hidden>$ </span>{item.title}</p>
        {tests?<TestResults tests={tests}/>:null}
        <Output output={item.output} omittedBytes={item.omittedBytes} failed={failed} logHint={logHint}/>
      </div>
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}

function TestResults({tests}:{tests:NonNullable<Extract<Item,{kind:'tool'}>['tests']>}){
  const total=tests.passed+tests.failed+tests.skipped;
  return <Trace data-activity-tests={tests.runner}>
    <TraceCollapsible defaultOpen={tests.failed>0}>
      <TraceCollapsibleTrigger>
        <TraceLine status={tests.failed?'error':undefined}>
          <TraceIcon><FlaskConicalIcon/></TraceIcon>
          <TraceTitle>Ran {plural(total,'test')}{tests.failed?`, ${tests.failed} failed`:''}</TraceTitle>
          <TraceDescription>{tests.passed} passed{tests.skipped?` · ${tests.skipped} skipped`:''}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>{tests.failures.length?tests.failures.map(f=><TraceLine key={f.name} status="error"><TraceIcon><XIcon/></TraceIcon><TraceTitle title={f.detail||f.name}>{f.name}{f.detail?<span className="activity-quiet"> — {f.detail}</span>:null}</TraceTitle></TraceLine>)
          :<TraceLine><TraceIcon><CircleCheckIcon/></TraceIcon><TraceTitle>{tests.failed?'Failures are listed in the output below.':'Every test passed.'}</TraceTitle></TraceLine>}</Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>;
}

type Node={name:string;path:string;children:Map<string,Node>;kind?:'add'|'update'|'delete'};
function tree(changes:{path:string;kind:'add'|'update'|'delete'}[]){
  const root:Node={name:'',path:'',children:new Map()};
  for(const change of changes){
    let node=root;const parts=change.path.split('/').filter(Boolean);
    parts.forEach((part,index)=>{let next=node.children.get(part);if(!next){next={name:part,path:parts.slice(0,index+1).join('/'),children:new Map()};node.children.set(part,next);}node=next;});
    node.kind=change.kind;
  }
  // Collapse single-child folder chains (library/reader/2026-… reads as one row).
  const squash=(node:Node):Node=>{
    let current=node;
    while(!current.kind&&current.children.size===1){const [only]=current.children.values();if(only.kind)break;current={...only,name:current.name?current.name+'/'+only.name:only.name};}
    return {...current,children:new Map([...current.children].map(([k,v])=>[k,squash(v)]))};
  };
  return [...squash(root).children.values()].map(squash);
}
const KIND={add:{icon:<FilePlusIcon/>,label:'Added'},update:{icon:<FilePenIcon/>,label:'Modified'},delete:{icon:<FileMinusIcon/>,label:'Deleted'}};
function FileNode({node,onOpen}:{node:Node;onOpen:(path:string)=>void}){
  if(node.kind){
    const kind=KIND[node.kind],can=node.kind!=='delete'&&openable(node.path);
    return <Button variant="ghost" size="sm" className="activity-file w-full justify-start font-normal" data-change={node.kind} disabled={!can} title={node.path}
      aria-label={`${kind.label} ${node.path}${can?'. Open':''}`} onClick={()=>can&&onOpen(node.path)}>{kind.icon}<span className="truncate">{node.name}</span><span className="activity-change">{kind.label}</span></Button>;
  }
  return <Collapsible defaultOpen>
    <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start font-normal aria-expanded:bg-transparent aria-expanded:hover:bg-muted"/>}>
      <ChevronRightIcon className="transition-transform group-data-panel-open/button:rotate-90"/><FolderIcon/><span className="truncate">{node.name}</span>
    </CollapsibleTrigger>
    <CollapsibleContent><div className="ml-4 flex flex-col">{[...node.children.values()].map(child=><FileNode key={child.path} node={child} onOpen={onOpen}/>)}</div></CollapsibleContent>
  </Collapsible>;
}
function FilesRow({item,onOpen}:{item:Extract<Item,{kind:'files'}>;onOpen:(path:string)=>void}){
  const nodes=useMemo(()=>tree(item.changes),[item.changes]);
  const counts=(['add','update','delete'] as const).map(k=>[k,item.changes.filter(c=>c.kind===k).length] as const).filter(([,n])=>n);
  return <TraceCollapsible defaultOpen>
    <TraceCollapsibleTrigger>
      <TraceLine status={item.running?'running':item.failed?'error':undefined}>
        <TraceIcon><FilePenIcon/></TraceIcon>
        <TraceTitle>{item.running?'Changing':item.failed?'Failed to change':'Changed'} {plural(item.changes.length,'file')}</TraceTitle>
        <TraceDescription>{counts.map(([k,n])=>`${n} ${KIND[k].label.toLowerCase()}`).join(' · ')}</TraceDescription>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent className="pl-1"><div className="activity-tree" data-activity-file-tree="">{nodes.map(node=><FileNode key={node.path} node={node} onOpen={onOpen}/>)}</div></TraceCollapsibleContent>
  </TraceCollapsible>;
}

function PlanRow({item,live}:{item:Extract<Item,{kind:'plan'}>;live:boolean}){
  const done=item.steps.filter(s=>s.done).length,current=item.steps.findIndex(s=>!s.done);
  return <TraceCollapsible defaultOpen>
    <TraceCollapsibleTrigger>
      <TraceLine status={live&&current>=0?'running':undefined}><TraceIcon><RouteIcon/></TraceIcon><TraceTitle>Plan</TraceTitle><TraceDescription>{done} of {item.steps.length} done</TraceDescription></TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <Trace data-activity-plan="">{item.steps.map((step,index)=><TraceLine key={index} data-done={step.done||undefined} status={step.done?undefined:index===current&&live?'running':'pending'}>
        <TraceIcon>{step.done?<CircleCheckIcon/>:index===current?<CircleDotIcon/>:<CircleIcon/>}</TraceIcon><TraceTitle>{step.text}</TraceTitle>
        <span className="sr-only">{step.done?'(done)':index===current?'(in progress)':'(to do)'}</span></TraceLine>)}</Trace>
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}

function Citation({path,onOpen}:{path:string;onOpen:(path:string)=>void}){
  const name=path.split('/').pop()!;
  return <HoverCard>
    <HoverCardTrigger delay={150} closeDelay={100} render={<Button variant="outline" size="xs" className="activity-cite" data-cite={path} onClick={()=>onOpen(path)}/>}><FileIcon/>{name}</HoverCardTrigger>
    <HoverCardContent className="flex w-72 flex-col gap-2" data-reader-decoration="">
      <div className="font-medium break-all">{name}</div>
      <div className="activity-quiet break-all">{path}</div>
      <Button size="xs" variant="outline" className="self-start" onClick={()=>onOpen(path)}>Open in the reader</Button>
    </HoverCardContent>
  </HoverCard>;
}

function MessageRow({item,html,onOpen,speaker}:{item:Extract<Item,{kind:'message'}>;html:(text:string)=>string;onOpen:(path:string)=>void;speaker:string}){
  const click=(event:React.MouseEvent<HTMLDivElement>)=>{
    const link=(event.target as HTMLElement).closest('a');if(!link)return;event.preventDefault();
    const href=link.getAttribute('href')||'',path=decodeURIComponent(href.split('#')[0]);
    if(/^https?:/i.test(href))window.open(href,'_blank','noopener,noreferrer');else if(openable(path))onOpen(path);
  };
  return <Message className="activity-message">
    <MessageContent>
      <MessageHeader className="px-0">{speaker}</MessageHeader>
      <div className="activity-prose" onClick={click} dangerouslySetInnerHTML={{__html:html(item.text)}}/>
      {item.cites.length?<div className="activity-cites" aria-label="Documents mentioned">{item.cites.map(path=><Citation key={path} path={path} onOpen={onOpen}/>)}</div>:null}
    </MessageContent>
  </Message>;
}

function ReasoningRow({item}:{item:Extract<Item,{kind:'reasoning'}>}){
  const took=seconds(item.startedAt,item.endedAt);
  const line=<TraceLine status={item.running?'running':undefined}><TraceTitle>{item.running?'Thinking…':took!==null?`Thought for ${took} s`:'Thought'}</TraceTitle></TraceLine>;
  if(!item.text)return line;
  return <TraceCollapsible><TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger><TraceCollapsibleContent className="whitespace-pre-wrap">{item.text.replace(/\*\*(.+?)\*\*/g,'$1')}</TraceCollapsibleContent></TraceCollapsible>;
}

function StackTrace({message,detail}:{message:string;detail?:string|null}){
  const [first,...rest]=(detail||'').trimEnd().split('\n');
  return <TraceCollapsible defaultOpen={!!detail}>
    <TraceCollapsibleTrigger><TraceLine status="error"><TraceIcon><CircleXIcon/></TraceIcon><TraceTitle>Failed: {message}</TraceTitle></TraceLine></TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <div className="activity-stack" data-activity-stack="">
        <p className="activity-stack-error">{message}</p>
        {detail?<ol>{[first,...rest].slice(-40).map((frame,index)=><li key={index}>{frame}</li>)}</ol>:null}
      </div>
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}

function LinkRow({item}:{item:Extract<Item,{kind:'link'}>}){
  const line=<TraceLine><TraceIcon><GitPullRequestIcon/></TraceIcon><TraceTitle>{item.label}{item.url?<span className="sr-only"> (opens GitHub in a new tab)</span>:null}</TraceTitle>
    {item.detail?<TraceDescription>{item.detail}</TraceDescription>:null}{item.url?<TraceIcon><ArrowUpRightIcon/></TraceIcon>:null}</TraceLine>;
  return item.url?<a href={item.url} target="_blank" rel="noreferrer noopener" className="activity-link" data-activity-github="">{line}</a>:<div data-activity-github="">{line}</div>;
}

function Row({item,live,html,onOpen,onReport,labels}:{item:Item;live:boolean;html:Props['html'];onOpen:Props['onOpen'];onReport?:()=>void;labels:Labels}):ReactNode{
  switch(item.kind){
    case 'message':return <MessageRow item={item} html={html} onOpen={onOpen} speaker={labels.speaker}/>;
    case 'reasoning':return <Trace><ReasoningRow item={item}/></Trace>;
    case 'tool':return <Trace><ToolRow item={item} logHint={labels.logHint}/></Trace>;
    case 'link':return <Trace><LinkRow item={item}/></Trace>;
    case 'files':return <Trace><FilesRow item={item} onOpen={onOpen}/></Trace>;
    case 'plan':return <Trace><PlanRow item={item} live={live}/></Trace>;
    case 'mcp':{
      const failed=item.status==='failed'||!!item.error,running=item.status==='running';
      return <Trace><TraceCollapsible defaultOpen={failed}>
        <TraceCollapsibleTrigger><TraceLine status={running?'running':failed?'error':undefined}><TraceIcon><WrenchIcon/></TraceIcon><TraceTitle>{running?'Calling':failed?'Failed to call':'Called'} <code>{item.server}.{item.tool}</code></TraceTitle></TraceLine></TraceCollapsibleTrigger>
        <TraceCollapsibleContent><div className="activity-tool">
          {item.args?<><p className="activity-label">Arguments</p><CodeBlock size="sm"><CodeBlockContent wrap className="max-h-48">{item.args}</CodeBlockContent></CodeBlock></>:null}
          {item.error?<p className="activity-stack-error">{item.error}</p>:item.result?<><p className="activity-label">Result</p><CodeBlock size="sm"><CodeBlockContent wrap className="max-h-48">{item.result.length>20000?item.result.slice(0,20000)+'\n…':item.result}</CodeBlockContent></CodeBlock></>:null}
        </div></TraceCollapsibleContent>
      </TraceCollapsible></Trace>;
    }
    case 'sources':return <Trace><TraceCollapsible>
      <TraceCollapsibleTrigger><TraceLine status={item.running?'running':undefined}><TraceIcon><GlobeIcon/></TraceIcon><TraceTitle>{item.running?'Searching the web for':'Searched the web for'} {item.queries.at(-1)?.query?`“${item.queries.at(-1)!.query}”`:''}</TraceTitle>{item.queries.length>1?<TraceDescription>{plural(item.queries.length,'search')}</TraceDescription>:null}</TraceLine></TraceCollapsibleTrigger>
      <TraceCollapsibleContent><Trace data-activity-sources="">{item.queries.map(q=><div key={q.id} className="activity-source">
        <TraceLine><TraceIcon><GlobeIcon/></TraceIcon><TraceTitle>{q.query||'Search'}</TraceTitle></TraceLine>
        {q.urls.map(url=><a key={url} href={url} target="_blank" rel="noreferrer noopener" className="activity-link"><TraceLine><TraceTitle>{(()=>{try{return new URL(url).hostname+new URL(url).pathname.replace(/\/$/,'');}catch{return url;}})()}<span className="sr-only"> (opens in a new tab)</span></TraceTitle><TraceIcon><ArrowUpRightIcon/></TraceIcon></TraceLine></a>)}
      </div>)}</Trace></TraceCollapsibleContent>
    </TraceCollapsible></Trace>;
    case 'subagent':return <Trace><TraceCollapsible>
      <TraceCollapsibleTrigger><TraceLine status={item.status==='running'?'running':item.status==='failed'?'error':undefined}><TraceIcon><BotIcon/></TraceIcon><TraceTitle>{item.status==='running'?'Working with':'Worked with'} {plural(Math.max(1,item.agents.length),'subagent')}</TraceTitle><TraceDescription>{item.tool}</TraceDescription></TraceLine></TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{item.prompt||'No prompt recorded.'}</TraceCollapsibleContent>
    </TraceCollapsible></Trace>;
    case 'error':return <Trace>{item.fatal?<StackTrace message={item.message} detail={item.detail}/>
      :<TraceLine data-activity-notice=""><TraceIcon><TriangleAlertIcon/></TraceIcon><TraceTitle title={item.message}>{labels.tool}: {item.message}</TraceTitle></TraceLine>}</Trace>;
    case 'checkpoint':return <Checkpoint hash={item.commit.hash} subject={item.commit.subject} onReport={onReport}/>;
    case 'skipped':return <Trace><TraceLine status="pending"><TraceIcon><TriangleAlertIcon/></TraceIcon><TraceTitle>Skipped an event ({item.reason}, {tokens(item.bytes)} bytes)</TraceTitle></TraceLine></Trace>;
  }
}

function Checkpoint({hash,subject,onReport}:{hash:string;subject:string;onReport?:()=>void}){
  return <Marker variant="separator" className="activity-checkpoint" data-activity-checkpoint={hash}>
    <MarkerContent className="inline-flex flex-wrap items-center justify-center gap-2">
      <MarkerIcon><GitCommitHorizontalIcon/></MarkerIcon>
      <span>Committed <code>{hash.slice(0,8)}</code> · {subject}</span>
      {onReport?<Button size="xs" variant="outline" onClick={onReport}>Report</Button>:null}
    </MarkerContent>
  </Marker>;
}

function Context({usage,elapsed,tool}:{usage:Usage|null;elapsed:number|null;tool:string}){
  if(!usage&&elapsed===null)return null;
  const cached=usage&&usage.input?Math.round(usage.cached/usage.input*100):0;
  const rows=usage?[['Input',usage.input],['Cached input',usage.cached],['Output',usage.output],['Reasoning',usage.reasoning]] as const:[];
  return <HoverCard>
    <HoverCardTrigger delay={10} closeDelay={100} render={<Button variant="outline" size="xs" className="activity-context" data-activity-context=""/>}>
      <GaugeIcon/>{usage?`${tokens(usage.input)} in · ${tokens(usage.output)} out`:'Elapsed'}{elapsed!==null?<> · <time dateTime={`PT${elapsed}S`}>{clock(elapsed)}</time></>:null}
    </HoverCardTrigger>
    <HoverCardContent className="flex w-64 flex-col gap-3" data-reader-decoration="">
      <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">Context</span>{elapsed!==null?<span className="text-muted-foreground">{clock(elapsed)}</span>:null}</div>
      {usage?<><Progress value={cached} aria-label="Share of input served from cache"/><p className="activity-quiet">{cached}% of input tokens came from the cache over {plural(usage.turns,'turn')}.</p>
        <div className="flex flex-col gap-1 text-sm tabular-nums">{rows.map(([label,value])=><div key={label} className="flex justify-between gap-3"><span className="text-muted-foreground">{label}</span><span>{value.toLocaleString()}</span></div>)}</div></>
        :<p className="activity-quiet">{tool} has not reported token usage yet.</p>}
    </HoverCardContent>
  </HoverCard>;
}

function Steps({activity,finished,status}:{activity:Activity;finished:boolean;status:string|null}){
  const list=stepsOf(activity,finished),current=list.findIndex(s=>s.state==='running'),done=list.filter(s=>s.state==='done').length;
  const ended=ENDED[status||'']||'Finished';
  const label=finished?(done===list.length&&ended==='Finished'?`Finished all ${plural(done,'step')}`:done?`${ended} after ${done} of ${list.length} steps`:`${ended} before the first step`)
    :current>=0?`Step ${current+1} of ${list.length}: ${list[current].label}`:'Getting started';
  return <Trace className="activity-steps"><TraceCollapsible>
    <TraceCollapsibleTrigger><TraceLine status={!finished&&current>=0?'running':undefined}><TraceIcon><ListChecksIcon/></TraceIcon><TraceTitle data-activity-step-label="">{label}</TraceTitle></TraceLine></TraceCollapsibleTrigger>
    <TraceCollapsibleContent keepMounted><Trace>{list.map(step=><TraceLine key={step.label} status={step.state==='pending'?'pending':step.state==='running'?'running':step.state==='failed'?'error':undefined} data-step={step.state}>
      <TraceIcon>{step.state==='done'?<CircleCheckIcon/>:step.state==='running'?<CircleDotIcon/>:step.state==='failed'?<CircleXIcon/>:<CircleIcon/>}</TraceIcon><TraceTitle>{step.label}</TraceTitle></TraceLine>)}</Trace></TraceCollapsibleContent>
  </TraceCollapsible>
  <ol className="activity-dots" aria-hidden>{list.map(step=><li key={step.label} data-step={step.state} title={step.label}/>)}</ol></Trace>;
}

function Queue({run,activity}:{run:RunInfo;activity:Activity}){
  if(!run.arrivals.length)return null;
  const rows=queueOf(activity,run.arrivals,run.remaining),filed=rows.filter(r=>r.filed).length;
  return <Trace className="activity-queue"><TraceCollapsible defaultOpen={rows.length<=5}>
    <TraceCollapsibleTrigger><TraceLine><TraceIcon><InboxIcon/></TraceIcon><TraceTitle>{plural(rows.length,'arrival')}{filed?` · ${filed} filed`:''}</TraceTitle></TraceLine></TraceCollapsibleTrigger>
    <TraceCollapsibleContent><Trace data-activity-queue="">{rows.map(row=><TraceLine key={row.name} data-filed={row.filed||undefined} status={row.filed?undefined:'pending'}>
      <TraceIcon>{row.filed?<CircleCheckIcon/>:<CircleIcon/>}</TraceIcon><TraceTitle>{run.titles[row.name]||row.name}</TraceTitle><span className="sr-only">{row.filed?'(filed)':'(waiting)'}</span></TraceLine>)}</Trace></TraceCollapsibleContent>
  </TraceCollapsible></Trace>;
}

export function ActivityTranscript({activity,run,live,html,onOpen,onReport,labels:given}:Props){
  const labels={...INBOX_LABELS,...given},titleId=useId();
  const log=useRef<HTMLDivElement>(null),[follow,setFollow]=useState(true),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(!live)return;const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[live]);
  useLayoutEffect(()=>{const el=log.current;if(el&&follow)el.scrollTop=el.scrollHeight;},[activity,follow]);
  const finished=!live&&!!run.status&&!['starting','running','queued'].includes(run.status);
  const start=run.startedAt?+new Date(run.startedAt):null,end=run.finishedAt?+new Date(run.finishedAt):live?now:null;
  const elapsed=start&&end?Math.max(0,Math.round((end-start)/1000)):null;
  const commit=run.commit&&!activity.items.some(i=>i.kind==='checkpoint'&&run.commit!.hash.startsWith(i.commit.hash))?run.commit:null;
  const failed=finished&&FAILED.includes(run.status||'');
  const move=(event:KeyboardEvent<HTMLDivElement>)=>{
    if(event.metaKey||event.ctrlKey||event.altKey||!['j','k'].includes(event.key))return;
    if((event.target as HTMLElement).closest('input,textarea'))return;
    const rows=[...log.current!.querySelectorAll<HTMLElement>('[data-activity-item]')];if(!rows.length)return;
    event.preventDefault();
    const at=rows.findIndex(row=>row.contains(document.activeElement)),next=at<0?(event.key==='j'?0:rows.length-1):Math.max(0,Math.min(rows.length-1,at+(event.key==='j'?1:-1)));
    const target=rows[next].querySelector<HTMLElement>('[data-slot=trace-collapsible-trigger],button,a')||rows[next];
    target.focus();target.scrollIntoView({block:'nearest'});
    setFollow(next===rows.length-1);
  };
  const empty=!activity.items.length;
  return <section className="activity" aria-labelledby={titleId} data-reader-decoration="" data-activity-live={live||undefined}>
    <div className="activity-head">
      <h3 id={titleId}>{labels.title}</h3>
      {live?<Context usage={activity.usage} elapsed={elapsed} tool={labels.tool}/>:null}
    </div>
    <div className="activity-meta"><Steps activity={activity} finished={finished} status={run.status}/><Queue run={run} activity={activity}/></div>
    <div ref={log} className="activity-log" role="log" aria-live="polite" aria-relevant="additions" aria-label={`${labels.log}. j and k move between items; Enter opens one.`} tabIndex={0}
      onKeyDown={move} onScroll={()=>{const el=log.current!;const atEnd=el.scrollHeight-el.scrollTop-el.clientHeight<48;if(atEnd!==follow)setFollow(atEnd);}}>
      {empty?<p className="activity-quiet" data-activity-empty="">{live?labels.waiting:'No activity was recorded for this run.'}</p>:null}
      {activity.items.map(item=><div key={item.kind+item.id} className="activity-item" data-activity-item={item.kind} data-item-id={item.id} tabIndex={-1}><Row item={item} live={live} html={html} onOpen={onOpen} onReport={onReport} labels={labels}/></div>)}
      {failed?<div className="activity-item" data-activity-item="error" tabIndex={-1}><Trace><StackTrace message={run.message||'The run failed.'} detail={run.stderr}/></Trace></div>:null}
      {commit?<div className="activity-item" data-activity-item="checkpoint" tabIndex={-1}><Checkpoint hash={commit.hash} subject={commit.subject} onReport={onReport}/></div>:null}
      {live?<p className="activity-working" aria-hidden><span className="activity-spinner"/>Working…</p>
        :activity.usage||elapsed!==null?<div className="activity-item activity-end" data-activity-item="context" tabIndex={-1}><Marker variant="separator"><MarkerContent><Context usage={activity.usage} elapsed={elapsed} tool={labels.tool}/></MarkerContent></Marker></div>:null}
    </div>
    {!follow?<div className="activity-foot"><Button variant="outline" size="xs" data-activity-jump="" onClick={()=>{setFollow(true);const el=log.current!;el.scrollTop=el.scrollHeight;}}><ArrowDownIcon/>Jump to latest</Button></div>:null}
  </section>;
}
