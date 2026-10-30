/* "Show raw output": one voice turn's CLI stdout events and stderr, collapsed by default, live while it runs.
   Reads the permanent archive through /api/chat/raw and appends `raw` frames from the chat's event stream. */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ChevronRightIcon} from 'lucide-react';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '../components/ui/collapsible';
import {Item, ItemContent, ItemDescription, ItemGroup, ItemTitle} from '../components/ui/item';
import {ToggleGroup, ToggleGroupItem} from '../components/ui/toggle-group';
import {Notice} from '../theme/molecules/notice';
import {LogBlock} from '../log-block';
import {eventLines, rawSteps, type RawStep} from './raw-steps';

export type RawFrame={turn_id:string;stream:'stdout'|'stderr';n:number;text:string;cut?:boolean};
type Listener=(frame:RawFrame)=>void;
export type RawBus={subscribe:(turnId:string,listener:Listener)=>()=>void;publish:(frame:RawFrame)=>void};
type RawData={turn_id:string;log:string|null;running:boolean;limit:number;stdout:string|null;stderr:string|null;prompt:string|null;system:string|null;
  stdout_truncated?:boolean;stderr_truncated?:boolean;prompt_truncated?:boolean;meta:Record<string,any>|null};

export function createRawBus():RawBus{
  const listeners=new Map<string,Set<Listener>>();
  return {subscribe(turnId,listener){let set=listeners.get(turnId);if(!set)listeners.set(turnId,set=new Set());set.add(listener);
      return ()=>{set!.delete(listener);if(!set!.size)listeners.delete(turnId);};},
    publish(frame){listeners.get(frame.turn_id)?.forEach(listener=>listener(frame));}};
}
const split=(text:string|null)=>{if(!text)return [];const lines=text.split('\n');if(lines[lines.length-1]==='')lines.pop();return lines;};
const stateClass=(state?:string)=>state==='ERROR'||state==='FAILED'?'error':state==='ACTIVE'?'active':state?'done':'';

/** A disclosure inside the raw output: a ghost trigger with a turning chevron, then its content. */
function Disclosure({label,children,...props}:{label:React.ReactNode;children:React.ReactNode}&Record<`data-${string}`,string>){
  return <Collapsible className="rounded-md border" {...props}>
    <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="w-full justify-start"/>}><ChevronRightIcon data-icon="inline-start" aria-hidden className="transition-transform in-data-[panel-open]:rotate-90"/>{label}</CollapsibleTrigger>
    <CollapsibleContent className="border-t p-2">{children}</CollapsibleContent>
  </Collapsible>;
}
const STATE_VARIANT={error:'destructive',active:'default',done:'secondary','':'outline'} as const;
function Step({step}:{step:RawStep}){
  const state=stateClass(step.state);
  return <Item size="xs" role="listitem" variant="outline" className="flex-col items-stretch gap-1.5" data-raw-kind={step.kind} data-raw-state={state}>
    <ItemContent className="min-w-0 gap-1">
      <ItemTitle className="flex-wrap">{step.kind==='tool'?<code className="font-mono text-xs">{step.label}</code>:step.label}
        {step.state?<Badge variant={STATE_VARIANT[state]}>{step.state.toLowerCase()}</Badge>:null}
        {step.seconds!=null?<span className="text-xs font-normal text-muted-foreground tabular-nums">{step.seconds.toFixed(1)} s</span>:null}</ItemTitle>
      {step.detail?<ItemDescription className="line-clamp-none font-mono text-xs [overflow-wrap:anywhere]">{step.detail}</ItemDescription>:null}
    </ItemContent>
    {step.kind==='text'&&step.body?<Disclosure label={`${step.body.length} characters`} data-raw-text=""><LogBlock text={step.body}/></Disclosure>
      :step.body?<LogBlock text={step.body} contentClassName="chat-raw-body"/>:null}
    {step.error?<LogBlock text={step.error} destructive contentClassName="chat-raw-error"/>:null}
  </Item>;
}

export function RawOutput({chatId,turnId,running,open,onOpenChange,api,bus,label}:{chatId:string;turnId:string;running:boolean;open:boolean;
  onOpenChange:(open:boolean)=>void;api:(path:string,payload?:unknown)=>Promise<any>;bus:RawBus;label?:string}){
  const [data,setData]=useState<RawData|null>(null),[error,setError]=useState<string|null>(null),[view,setView]=useState<'steps'|'events'>('steps');
  const lines=useRef<{stdout:string[];stderr:string[]}>({stdout:[],stderr:[]});
  const queued=useRef<RawFrame[]|null>(null);
  const [version,setVersion]=useState(0);
  const load=useCallback(async()=>{
    queued.current=[];
    try{const result:RawData=await api(`/api/chat/raw?id=${encodeURIComponent(chatId)}&turn=${encodeURIComponent(turnId)}`);
      const next={stdout:split(result.stdout),stderr:split(result.stderr)};
      for(const frame of queued.current||[])if(frame.n===next[frame.stream].length)next[frame.stream].push(frame.text);
      queued.current=null;lines.current=next;setData(result);setError(null);
    }catch(failure){queued.current=null;setError(failure instanceof Error?failure.message:String(failure));}
    setVersion(v=>v+1);
  },[api,chatId,turnId]);
  // A frame extends the stream it belongs to; a gap means we missed lines, so the archive is read again.
  const apply=useCallback((frame:RawFrame)=>{
    if(queued.current){queued.current.push(frame);return;}
    const target=lines.current[frame.stream];
    if(frame.n===target.length){target.push(frame.text);setVersion(v=>v+1);}
    else if(frame.n>target.length)load();
  },[load]);
  useEffect(()=>{if(!open)return;load();return bus.subscribe(turnId,apply);},[open,turnId,bus,load,apply]);
  // When the turn finishes, read the complete archive (live frames cut long lines).
  const wasRunning=useRef(running);
  useEffect(()=>{if(wasRunning.current&&!running&&open)load();wasRunning.current=running;},[running,open,load]);
  const steps=useMemo(()=>open?rawSteps(lines.current.stdout):[],[open,version]);
  const events=useMemo(()=>open&&view==='events'?eventLines(lines.current.stdout):[],[open,view,version]);
  const stderr=lines.current.stderr;
  const meta=data?.meta;
  const Note=({children}:{children:React.ReactNode})=><span className="text-xs text-muted-foreground" data-raw-note="">{children}</span>;
  return <Collapsible open={open} onOpenChange={onOpenChange} className="flex w-full max-w-full min-w-0 basis-full flex-col gap-2 font-sans" data-chat-raw={turnId} data-compact={label?'':undefined} data-reader-decoration="" data-ui="shadcn">
    <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="self-start text-muted-foreground"/>}><ChevronRightIcon data-icon="inline-start" aria-hidden className="transition-transform in-data-[panel-open]:rotate-90"/>{label||'Show raw output'}{running?' (live)':''}</CollapsibleTrigger>
    <CollapsibleContent className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg border p-3">{open?<>
      {error?<Notice tone="error" role="status" title="Couldn’t read the raw output">{error}</Notice>:null}
      {data&&!data.log?<Note>No raw output was archived for this turn.</Note>:null}
      {data?.log?<>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup size="sm" variant="outline" aria-label="Raw output view" value={[view]} onValueChange={v=>{if(v[0])setView(v[0] as 'steps'|'events');}}>
            <ToggleGroupItem value="steps" data-raw-view="steps">Steps</ToggleGroupItem><ToggleGroupItem value="events" data-raw-view="events">Events</ToggleGroupItem></ToggleGroup>
          <Note>{lines.current.stdout.length} stdout lines{stderr.length?` · ${stderr.length} stderr`:''}</Note>
        </div>
        {view==='steps'?(steps.length?<ItemGroup className="gap-1.5" aria-label="Raw steps">{steps.map(step=><Step key={step.key} step={step}/>)}</ItemGroup>:<Note>{running?'Waiting for output…':'The CLI printed nothing on stdout.'}</Note>)
          :<LogBlock text={events.join('\n')} contentClassName="chat-raw-events"/>}
        {data.stdout_truncated?<Note>Showing the first {Math.round(data.limit/1048576)} MiB; the archive holds all of it.</Note>:null}
        {stderr.length?<div className="flex flex-col gap-1" data-raw-stderr=""><span className="text-xs font-medium text-muted-foreground">stderr</span><LogBlock text={stderr.join('\n')}/></div>:null}
        {data.prompt?<Disclosure label={`Prompt sent (${data.prompt.length} characters)`} data-raw-prompt=""><LogBlock text={data.prompt}/></Disclosure>:null}
        {data.system?<Disclosure label={`System prompt (${data.system.length} characters)`} data-raw-prompt=""><LogBlock text={data.system}/></Disclosure>:null}
        <Note>Archived in <code className="font-mono">{data.log}</code>{meta?.status?` · ${meta.status}`:''}{meta?.exit_code!=null?` · exit ${meta.exit_code}`:''}{Array.isArray(meta?.argv)?<> · <code className="font-mono" title={meta!.argv.join(' ')}>{meta!.argv.slice(0,3).join(' ')}{meta!.argv.length>3?' …':''}</code></>:null}</Note>
      </>:null}
    </>:null}</CollapsibleContent>
  </Collapsible>;
}
