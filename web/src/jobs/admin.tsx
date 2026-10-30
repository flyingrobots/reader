/* Shared helpers for Reader Admin's coding-job, LLM log and repository pages (RW-44, now in admin/pages/). The
   pages serve the admin shell's routes (#admin/jobs, #admin/jobs/<uuid>, #admin/logs, #admin/logs/<kind>/<date>/<run-id>, #admin/repositories);
   the shell owns layout, headings and focus. Every list reads bounded pages; nothing here starts a job, prunes a
   log or changes a repository except the explicit registration controls, which the server accepts only from this Mac.
   A failed request shows as unavailable, never as an empty healthy list. */
import * as React from 'react';
import {type JobViewOptions} from './job-detail';
import {Notice} from '../theme/molecules/notice';
import {needsReader, NEEDS_READER} from '../static-demo';

/** `go`/`href` are the admin shell's section navigation; `open` opens a library document. */
export type AdminPanelProps={options:JobViewOptions;go:(section?:string,...params:string[])=>void;href:(section?:string,...params:string[])=>string;open:(path:string)=>void};
/** A log run's route parameters: `logs/llm/<kind>/YYYY/MM/DD/<run-id>` ⇄ [kind, YYYY-MM-DD, run-id]. */
export function logParams(path:string){const [kind,y,m,d,run]=path.replace(/^logs\/llm\//,'').split('/');return [kind,`${y}-${m}-${d}`,run];}
export function logPath(params:string[]){const [kind,date,run]=params;return `logs/llm/${kind}/${date.replace(/-/g,'/')}/${run}`;}
type Load<T>={data:T|null;error:string|null;loading:boolean};
export function useLoad<T>(path:string|null,api:JobViewOptions['api'],deps:unknown[]=[]):[Load<T>,()=>void]{
  const [state,setState]=React.useState<Load<T>>({data:null,error:null,loading:!!path});
  const [tick,setTick]=React.useState(0);
  React.useEffect(()=>{
    if(!path){setState({data:null,error:null,loading:false});return;}
    let live=true;setState(s=>({...s,loading:true}));
    api(path).then(data=>{if(live)setState({data,error:null,loading:false});},error=>{if(live)setState({data:null,error:error instanceof Error?error.message:String(error),loading:false});});
    return ()=>{live=false;};
  },[path,tick,...deps]);
  return [state,()=>setTick(t=>t+1)];
}
/** A failed read as a destructive Alert (role alert); in the static demo, the honest "needs Reader" message instead. */
export function Unavailable({what,error}:{what:string;error:string|null}){
  return needsReader('jobs')?<Notice role="alert" title={`${what} ${NEEDS_READER.toLowerCase()}.`}/>:<Notice tone="error" role="alert" data-unavailable="" title={`${what} unavailable`}>{error||'No answer.'}</Notice>;
}
/** A full local date and time, or an em dash for none. */
export const dateTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString():'—';
