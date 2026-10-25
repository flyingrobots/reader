/* "Show raw output": one voice turn's CLI stdout events and stderr, collapsed by default, live while it runs.
   Reads the permanent archive through /api/chat/raw and appends `raw` frames from the chat's event stream. */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '../components/ui/button';
import {ButtonGroup} from '../components/ui/button-group';
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

function Step({step}:{step:RawStep}){
  return <li className="chat-raw-step" data-raw-kind={step.kind} data-raw-state={stateClass(step.state)}>
    <div className="chat-raw-step-head"><span className="chat-raw-label">{step.kind==='tool'?<code>{step.label}</code>:step.label}</span>
      {step.state?<span className="chat-raw-state">{step.state.toLowerCase()}</span>:null}
      {step.seconds!=null?<span className="chat-raw-seconds">{step.seconds.toFixed(1)} s</span>:null}</div>
    {step.detail?<code className="chat-raw-detail">{step.detail}</code>:null}
    {step.kind==='text'&&step.body?<details className="chat-raw-text"><summary>{step.body.length} characters</summary><pre>{step.body}</pre></details>
      :step.body?<pre className="chat-raw-body">{step.body}</pre>:null}
    {step.error?<pre className="chat-raw-error">{step.error}</pre>:null}
  </li>;
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
  return <details className={label?'chat-raw chat-raw-compact':'chat-raw'} open={open} onToggle={event=>{const next=(event.currentTarget as HTMLDetailsElement).open;if(next!==open)onOpenChange(next);}}
    data-chat-raw={turnId} data-reader-decoration="">
    <summary>{label||'Show raw output'}{running?' (live)':''}</summary>
    {open?<div className="chat-raw-body-wrap">
      {error?<p className="chat-raw-note" role="status">Couldn’t read the raw output: {error}</p>:null}
      {data&&!data.log?<p className="chat-raw-note">No raw output was archived for this turn.</p>:null}
      {data?.log?<>
        <div className="chat-raw-tools">
          <ButtonGroup aria-label="Raw output view">
            <Button variant={view==='steps'?'secondary':'ghost'} size="xs" aria-pressed={view==='steps'} onClick={()=>setView('steps')} data-raw-view="steps">Steps</Button>
            <Button variant={view==='events'?'secondary':'ghost'} size="xs" aria-pressed={view==='events'} onClick={()=>setView('events')} data-raw-view="events">Events</Button>
          </ButtonGroup>
          <span className="chat-raw-count">{lines.current.stdout.length} stdout lines{stderr.length?` · ${stderr.length} stderr`:''}</span>
        </div>
        {view==='steps'?(steps.length?<ol className="chat-raw-steps">{steps.map(step=><Step key={step.key} step={step}/>)}</ol>:<p className="chat-raw-note">{running?'Waiting for output…':'The CLI printed nothing on stdout.'}</p>)
          :<pre className="chat-raw-events">{events.join('\n')}</pre>}
        {data.stdout_truncated?<p className="chat-raw-note">Showing the first {Math.round(data.limit/1048576)} MiB; the archive holds all of it.</p>:null}
        {stderr.length?<div className="chat-raw-stderr"><div className="chat-raw-heading">stderr</div><pre>{stderr.join('\n')}</pre></div>:null}
        {data.prompt?<details className="chat-raw-prompt"><summary>Prompt sent ({data.prompt.length} characters)</summary><pre>{data.prompt}</pre></details>:null}
        {data.system?<details className="chat-raw-prompt"><summary>System prompt ({data.system.length} characters)</summary><pre>{data.system}</pre></details>:null}
        <p className="chat-raw-note">Archived in <code>{data.log}</code>{meta?.status?` · ${meta.status}`:''}{meta?.exit_code!=null?` · exit ${meta.exit_code}`:''}{Array.isArray(meta?.argv)?<> · <code title={meta!.argv.join(' ')}>{meta!.argv.slice(0,3).join(' ')}{meta!.argv.length>3?' …':''}</code></>:null}</p>
      </>:null}
    </div>:null}
  </details>;
}
