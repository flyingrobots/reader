/* Reader Admin: maintenance and inbox status types, the index catalogue and the helpers the pages under admin/pages/
   share. No components live here. */
import {plural} from './plural';
import type {Tone} from './theme/atoms/status-badge';
import {when} from './theme/atoms/time';
export {when};

export type Job={id:string;kind:string;label:string;quiet?:boolean;state:'running'|'succeeded'|'failed';started_at:string;finished_at:string|null;elapsed_seconds:number|null;result:Record<string,unknown>|null;error:string|null;progress?:string|null};
export type Check={state:string;message?:string;checked_at:string;built_at?:string|null;[key:string]:unknown};
export type MaintenanceStatus={running:Job|null;jobs:Job[];checks:Record<string,Check>;checking:boolean;kinds:Record<string,string>;local_model?:{running:boolean;runs:import('./local-model').Run[];labels:Record<string,string>}};

export type Fact=[label:string,value:(check:Check)=>unknown];
const count=(v:unknown)=>typeof v==='number'?v.toLocaleString():null;
/** "61,204 of 400,000" from a [used, limit] pair. */
export function of(pair:unknown){return Array.isArray(pair)&&typeof pair[0]==='number'?`${count(pair[0])} of ${count(pair[1])}`:null;}
/** "0.4 of 2 GiB" (or MiB below a GiB budget) from a [bytes, limit] pair. */
export function budget(pair:unknown){
  if(!Array.isArray(pair)||typeof pair[0]!=='number'||typeof pair[1]!=='number')return null;
  const [unit,div]=pair[1]>=2**30?['GiB',2**30]:['MiB',2**20],fmt=(b:number)=>{const v=b/div;return v>=10||Number.isInteger(v)?String(Math.round(v)):v.toFixed(1);};
  return `${fmt(pair[0])} of ${fmt(pair[1])} ${unit}`;
}
const usage=(key:string,format:(pair:unknown)=>string|null)=>(c:Check)=>format((c.usage as Record<string,unknown>|undefined)?.[key]);
const item=(key:string)=>(c:Check)=>{const found=(c.items as {key:string;used:number|null;limit:number}[]|undefined)?.find(i=>i.key===key);return found?(found.used===null?'Unknown':of([found.used,found.limit])):null;};
export type Index={key:string;title:string;description:string;note?:string;facts:Fact[];actions:{kind:string;label:string;primary?:boolean}[]};
export const INDEXES:Index[]=[
  {key:'search',title:'Search index',description:'Contents and Semantic search, and the Read next suggestions at the end of an article.',
   facts:[['Built',c=>when(c.built_at)],['Library files',c=>c.files],['Indexed',c=>c.documents],['Passages',usage('passages',of)],
     ['Database',usage('database',budget)],['Embedding cache',usage('cache',budget)],
     ['Machine files',c=>typeof c.path_only_machine==='number'?`${count(c.path_only_machine)} indexed by path only`:null],['Text without embeddings',c=>c.unembedded]],
   actions:[{kind:'search',label:'Rebuild with embeddings',primary:true},{kind:'search-keyword',label:'Keywords only'}]},
  {key:'browse',title:'Browse indexes',description:'Grouped Markdown indexes, the README dashboard, and the work inventory this app lists.',
   note:'Refreshing writes indexes/ and README.md in the vault; commit them afterwards.',
   facts:[['Built',c=>c.built_at],['Works',c=>c.works],['Files that would change',c=>c.changed]],
   actions:[{kind:'browse',label:'Refresh',primary:true}]},
  {key:'catalog',title:'Catalog SQL mirror',description:'A SQLite copy of catalog frontmatter, for queries and integrity checks.',
   facts:[['Built',c=>when(c.built_at)],['Records',c=>c.documents],['Library files',usage('files',of)],['Sources',usage('sources',budget)]],
   actions:[{kind:'catalog',label:'Sync',primary:true}]},
  {key:'links',title:'Link graph',description:'Link previews and the Linked from list at the end of an article.',
   note:'Builds itself the first time you open a document. Refresh re-reads only files whose size or time changed.',
   facts:[['Built',c=>when(c.built_at)],['Documents read',c=>c.documents],['Links',c=>c.links],['Unresolved',c=>c.unresolved]],
   actions:[{kind:'links',label:'Refresh',primary:true}]},
  {key:'limits',title:'Other inventories',description:'Collections Reader reads in full. Each refuses clearly at its limit instead of slowing down.',
   facts:[['Works',item('works')],['Inbox files',item('inbox')],['Reading participants',item('participants')],['Annotation threads',item('threads')]],
   actions:[]},
];
export const INDEX_OF:Record<string,string>={search:'search','search-keyword':'search','remove-legacy-search':'search',browse:'browse',catalog:'catalog',links:'links'};
export const STATES:Record<string,{label:string;tone:Tone}>={
  current:{label:'Current',tone:'ok'},stale:{label:'Needs rebuild',tone:'attention'},partial:{label:'Partial',tone:'attention'},
  missing:{label:'Not built',tone:'attention'},unconfigured:{label:'Not configured',tone:'neutral'},error:{label:'Error',tone:'error'},
  ok:{label:'Within limits',tone:'ok'},near:{label:'Near a limit',tone:'attention'},over:{label:'Over a limit',tone:'error'}};

function summary(job:Job){
  if(job.state==='failed')return job.error;
  const r=job.result||{};
  if((job.kind==='search'||job.kind==='search-keyword')&&r.complete===false&&r.message)return String(r.message);
  if(job.kind==='search'||job.kind==='search-keyword')return `${r.changed} changed · ${r.removed} removed · ${plural(r.documents,'document')}${typeof r.passages==='number'?` · ${r.passages.toLocaleString()} passages`:''}${r.issues?` · ${r.issues} unreadable`:''}`;
  if(job.kind==='browse')return `${plural(r.changed,'navigation file')} updated · ${plural(r.works,'work')}`;
  if(job.kind==='catalog')return `${plural(r.documents,'record')} ${r.status}`;
  if(job.kind==='links')return `${r.parsed} read · ${r.links} links · ${r.unresolved} unresolved`;
  if(job.kind==='remove-legacy-search')return `${Math.round(Number(r.freed_bytes)/1e6).toLocaleString()} MB freed`;
  if(job.kind==='check')return Object.entries(r).map(([k,v])=>`${k} ${v}`).join(' · ');
  if(typeof r.message==='string')return r.message;
  return null;
}

/** The state label and badge tone of one index check, shared with Overview. */
export function checkState(check:Check|undefined){return check?STATES[check.state]||{label:check.state,tone:'neutral' as const}:null;}
export const INDEX_TITLES:Record<string,string>=Object.fromEntries(INDEXES.map(index=>[index.key,index.title]));
/** A job's one-line outcome, shared with Overview. */
export {summary as jobOutcome};

// Inbox status, read by admin/pages/inbox.tsx.
export type Arrival={id:string;path:string;bundle:boolean;document:string;title:string;source:string|null;project:string|null;author:string|null;report_date:string|null;request_id:string|null;integrity:'intact'|'changed'|null;receipt_error:string|null;files:number;bytes:number;received_at:string|null};
export type InboxRun={status:string;run_id:string|null;started_at:string|null;updated_at:string|null;finished_at:string|null;message:string;arrivals:number|null;remaining:number|null;exit_code:number|null;sandbox_mode:string|null;event?:string|null;report_md?:string|null;report_truncated?:boolean;commit?:{hash:string;short:string;subject:string}|null};
export type InboxStatus={arrivals:Arrival[];runner:InboxRun|null;claims_held:string[];codex:{name:string;installed:boolean};errors:string[];blocked:{reason:string;message:string}|null};
export {size} from './admin/pages/inbox';
