/* Coding-job runs in the browser (RW-44): one shared entry per run ID, whichever view shows it (an article's prompt
   card, Reader Admin's job page). Each entry follows the server's event stream with a sequence cursor: frames at or
   below the cursor are duplicates and ignored; a frame beyond cursor+1 is a gap, filled from the archive-backed
   events endpoint before continuing. A reload starts from the run's snapshot and catches up the same way. Nothing
   here starts a run: only submitJob() posts, and only after an explicit Run. */
import {useCallback, useSyncExternalStore} from 'react';
import {applyFrames, emptyActivity, jobMapper, type Activity, type AgentEvent} from '../activity/reducer';

export type JobRun={id:string;request_id:string;predecessor:string|null;created_at:string;started_at:string|null;finished_at:string|null;
  status:'queued'|'running'|'finished';phase:string;outcome:string|null;message:string|null;agent:string;agent_label:string;
  source:{path:string;sha256:string;block_id:string;title:string;repo:string;issue:number|null;line:number};
  prompt:{edited:boolean;original_sha256:string;submitted_sha256:string};
  git:{remote:string;base:string;branch:string;base_sha:string|null;head_sha:string|null;worktree:string|null;commits:{sha:string;subject:string}[];changed_paths:string[]};
  issue:{number:number;url:string;state:string;created:boolean}|null;pr:{number:number;url:string;state:string;head_sha:string;base:string}|null;
  existing_pr:{number:number;url:string;state:string}|null;push:{sha:string;verified:boolean}|null;
  verification:{argv:string;exit_code:number|null;seconds?:number}|null;tools:Record<string,string|null>|null;log:string|null;
  seq:number;active:boolean;can_stop:boolean;read_only:boolean;recovered?:boolean;unreconciled?:boolean;archive_error?:string|null;duplicate?:boolean};
export type JobEvent={run_id:string;seq:number;at:string;type:string;[key:string]:unknown};
export type JobState={run:JobRun|null;activity:Activity;seq:number;error:string|null;live:boolean};
type Api=(path:string,payload?:unknown)=>Promise<any>;

type Entry={state:JobState;mapper:(raw:unknown)=>AgentEvent[];listeners:Set<()=>void>;source:EventSource|null;timer:ReturnType<typeof setTimeout>|undefined;
  delay:number;resyncing:boolean;loaded:boolean};
const entries=new Map<string,Entry>();
let api:Api=async()=>{throw new Error('Reader is not ready');};
export function setJobsApi(next:Api){api=next;}

function entry(id:string):Entry{
  let found=entries.get(id);
  if(!found){found={state:{run:null,activity:emptyActivity(),seq:0,error:null,live:false},mapper:jobMapper(),listeners:new Set(),source:null,timer:undefined,delay:1000,resyncing:false,loaded:false};entries.set(id,found);}
  return found;
}
function publish(item:Entry,patch:Partial<JobState>){item.state={...item.state,...patch};item.listeners.forEach(listener=>listener());}

/** Fold frames into an entry; false at a gap (see applyFrames in the reducer). */
function applyTo(item:Entry,events:JobEvent[]):boolean{
  const [next,complete]=applyFrames({activity:item.state.activity,seq:item.state.seq},events,item.mapper);
  item.state={...item.state,...next};
  return complete;
}

async function resync(id:string){
  const item=entry(id);if(item.resyncing)return;item.resyncing=true;
  try{
    for(let page=0;page<200;page++){
      const result=await api(`/api/jobs/events?id=${encodeURIComponent(id)}&after=${item.state.seq}&limit=500`);
      applyTo(item,result.events);publish(item,{run:result.run,error:null});
      if(!result.more)break;
    }
    item.loaded=true;
  }catch(error){publish(item,{error:error instanceof Error?error.message:String(error)});}
  finally{item.resyncing=false;}
}

function connect(id:string){
  const item=entry(id);
  if(item.source||!item.listeners.size||typeof EventSource==='undefined')return;
  if(item.state.run&&!item.state.run.active&&item.loaded&&item.state.seq>=item.state.run.seq)return;
  const source=new EventSource(`/api/jobs/stream?id=${encodeURIComponent(id)}&after=${item.state.seq}`);item.source=source;
  publish(item,{live:true});
  source.addEventListener('hello',message=>{const data=JSON.parse((message as MessageEvent).data);publish(item,{run:data.run,error:null});item.delay=1000;});
  source.addEventListener('event',message=>{
    const event=JSON.parse((message as MessageEvent).data) as JobEvent;
    if(applyTo(item,[event]))publish(item,{});else resync(id).then(()=>{applyTo(item,[event]);publish(item,{});});
  });
  source.addEventListener('ping',message=>{const data=JSON.parse((message as MessageEvent).data);if(item.state.run)publish(item,{run:{...item.state.run,status:data.status,phase:data.phase}});});
  source.addEventListener('end',message=>{const data=JSON.parse((message as MessageEvent).data);item.loaded=true;close(item);publish(item,{run:data.run,live:false});});
  source.onerror=()=>{
    close(item);publish(item,{live:false});
    if(item.state.run&&!item.state.run.active&&item.loaded)return;
    clearTimeout(item.timer);item.timer=setTimeout(()=>{resync(id).then(()=>connect(id));},item.delay);item.delay=Math.min(item.delay*2,30000);
  };
}
function close(item:Entry){item.source?.close();item.source=null;}

/** Follow a run: the snapshot first (archive-backed), then the live stream while it is active. */
export function subscribeJob(id:string,listener:()=>void){
  const item=entry(id);item.listeners.add(listener);
  if(item.listeners.size===1){if(item.loaded)connect(id);else resync(id).then(()=>connect(id));}
  return ()=>{item.listeners.delete(listener);if(!item.listeners.size){close(item);clearTimeout(item.timer);}};
}
const EMPTY:JobState={run:null,activity:emptyActivity(),seq:0,error:null,live:false};
export function useJob(id:string|null):JobState{
  // Stable per run: a new subscribe function each render would resubscribe every render, and a loaded run's
  // resubscription publishes at once (connect), so React would re-render without end (#185).
  const subscribe=useCallback((listener:()=>void)=>id?subscribeJob(id,listener):()=>{},[id]);
  const snapshot=useCallback(()=>id?entry(id).state:EMPTY,[id]);
  return useSyncExternalStore(subscribe,snapshot);
}
/** Seed an entry with a run the server just returned (an admission), so its card shows it at once. */
export function seedJob(run:JobRun){const item=entry(run.id);if(!item.state.run)publish(item,{run});}

/** Active coding jobs (queued or running), for Reader Admin's Overview. Read-only. */
export function activeJobs():Promise<{runs:JobRun[]}>{return api('/api/jobs?state=active');}

export async function submitJob(body:{request_id:string;path:string;sha256:string;block_id:string;prompt:string;agent:string;predecessor?:string|null}):Promise<JobRun>{
  const run=await api('/api/jobs',{action:'submit',...body,...(body.predecessor?{}:{predecessor:undefined})});
  seedJob(run);return run;
}
export async function stopJob(id:string):Promise<JobRun>{const run=await api('/api/jobs',{action:'stop',id});const item=entry(id);publish(item,{run});resync(id).then(()=>connect(id));return run;}

export type BlockInfo={id:string;title:string;repo:string;issue:number|null;line:number;prompt_sha256:string;registered:boolean;problem:string|null;base:string|null;
  agents:{name:string;label:string;mode:string;available:boolean}[];issue_url:string|null;runs:JobRun[]};
export type ArticleActions={path:string;sha256:string;blocks:BlockInfo[];configured:boolean;enabled:boolean;read_only:boolean};
const actionsCache=new Map<string,Promise<ArticleActions>>();
/** The server's view of an article's prompt blocks (registration, agents, history). Read-only; cached per edition. */
export function articleActions(path:string,sha256:string,refresh=false):Promise<ArticleActions>{
  const key=path+'@'+sha256;
  if(refresh||!actionsCache.has(key)){const loading=api('/api/jobs/actions?path='+encodeURIComponent(path));actionsCache.set(key,loading);loading.catch(()=>actionsCache.delete(key));}
  return actionsCache.get(key)!;
}

export const OUTCOME_LABELS:Record<string,string>={pr_opened:'PR opened',already_fixed:'Already fixed',blocked:'Blocked',failed:'Failed',cancelled:'Stopped',
  interrupted:'Interrupted',needs_reconciliation:'Needs reconciliation'};
export function statusLabel(run:JobRun){return run.outcome?OUTCOME_LABELS[run.outcome]||run.outcome:run.status==='queued'?'Queued':'Running';}
