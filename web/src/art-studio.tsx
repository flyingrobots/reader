/* Bespoke article art (RW-43): Admin › Artwork's Art studio (design sheet: docs/admin-design/artwork.md), and the producer list for Settings.
   Commissions are background jobs on the server (/api/art/jobs); this card shows what runs, what waited,
   what it cost as far as the producer reported, and lets you cancel. art.mjs toasts the transitions. */
import {useEffect, useState} from 'react';
import {ImageIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {Kbd} from './components/ui/kbd';
import {SectionHeading} from './theme/atoms/section-heading';
import {StatusBadge, type Tone} from './theme/atoms/status-badge';
import {Notice} from './theme/molecules/notice';
import {RunRow} from './theme/molecules/run-row';
import {EmptyState, LoadingState, Unavailable} from './theme/molecules/states';
import {RunList} from './theme/organisms/run-list';
import {StatusCard} from './theme/organisms/status-card';

export type ArtProducer={id:string;kind:'voice'|'local';label:string;available:boolean;cli:string|null;model:string|null;provider?:string|null;estimate_seconds:number|null};
export type ArtJob={id:string;path:string;title:string|null;producer:string;producer_label:string;model:string|null;state:string;stage:string|null;message:string|null;queued_at:string;started_at:string|null;finished_at:string|null;
  seconds:number|null;elapsed?:number;ahead?:number;usage:{input_tokens:number;output_tokens:number;usd:number|null}|null;log:string|null;error:string|null;auto:boolean;warning:string|null;foreign:boolean};
export type ArtStatus={jobs:ArtJob[];active:number;producers:ArtProducer[];default:string|null;error:string|null;ownership?:{owner:boolean;writable:boolean;message:string|null}};
type Api=(path:string,payload?:unknown)=>Promise<any>;
const ACTIVE=['queued','waiting','running'];
const STATES:Record<string,{label:string;tone:Tone}>={queued:{label:'Queued',tone:'neutral'},waiting:{label:'Waiting',tone:'neutral'},running:{label:'Making',tone:'active'},
  done:{label:'Ready',tone:'ok'},failed:{label:'Failed',tone:'error'},timeout:{label:'Timed out',tone:'error'},cancelled:{label:'Cancelled',tone:'neutral'}};
const duration=(s:number|null|undefined)=>s==null?null:s<60?`${Math.round(s)} s`:`${Math.floor(s/60)} min ${String(Math.round(s%60)).padStart(2,'0')} s`;
export function costLine(job:{usage:ArtJob['usage'];producer:string}){
  const u=job.usage;if(!u)return job.producer==='local'?'local GPU':'cost not reported';
  const tokens=u.input_tokens+u.output_tokens;return [tokens?`${tokens.toLocaleString()} tokens`:null,u.usd!=null?`$${u.usd.toFixed(2)}`:job.producer==='local'?'local GPU':'no price reported'].filter(Boolean).join(' · ');
}

/** The producers the server offers (voices with a CLI, the local model) for "Art made by". */
export function useArtProducers(api:Api){
  const [status,setStatus]=useState<ArtStatus|null>(null);
  useEffect(()=>{let live=true;api('/api/art/jobs').then(s=>{if(live)setStatus(s);},()=>{});
    const listen=(event:Event)=>{if(live)setStatus((event as CustomEvent<ArtStatus>).detail);};document.addEventListener('reader:art-jobs',listen);
    return ()=>{live=false;document.removeEventListener('reader:art-jobs',listen);};},[api]);
  return status;
}

export function ArtStudio({api,open}:{api:Api;open:(path:string)=>void}){
  const [status,setStatus]=useState<ArtStatus|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let live=true,timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{clearTimeout(timer);try{const s=await api('/api/art/jobs');if(!live)return;setStatus(s);setError(null);timer=setTimeout(poll,s.active?2000:10000);}catch(e){if(live){setError(e instanceof Error?e.message:String(e));timer=setTimeout(poll,10000);}}};
    const listen=(event:Event)=>{if(live)setStatus((event as CustomEvent<ArtStatus>).detail);};
    document.addEventListener('reader:art-jobs',listen);poll();
    return ()=>{live=false;clearTimeout(timer);document.removeEventListener('reader:art-jobs',listen);};
  },[api]);
  const cancel=async(id:string)=>{try{await api('/api/art',{action:'cancel',job:id});setStatus(await api('/api/art/jobs'));}catch(e){setError(e instanceof Error?e.message:String(e));}};
  const available=status?.producers.filter(p=>p.available)||[],active=status?.jobs.filter(j=>ACTIVE.includes(j.state))||[];
  return <section className="flex flex-col gap-4" id="backstage-art" aria-labelledby="art-title">
    <SectionHeading id="art-title">Art studio</SectionHeading>
    {error?<Unavailable what="Art commissions" error={error}/>:null}
    {status?.ownership&&!status.ownership.writable?<Notice data-art-read-only="" title={status.ownership.message}>Its commissions show here as they run there.</Notice>:null}
    <StatusCard data-state={active.length?'running':'idle'} title="Commissions"
      description="An agent reads the article, writes an art brief, then composes a scene in Reader’s scene language; Reader validates it and draws it itself. Every run is archived under logs/llm/art; each version is committed under art/."
      badge={<StatusBadge tone={active.length?'active':'neutral'} busy={!!active.length}>{active.length?`${active.length} running or waiting`:status?'Idle':'Loading…'}</StatusBadge>}
      footer={status?<span className="text-xs text-muted-foreground">{available.length?<>Art can be made by {available.map(p=>p.label+(p.model?` (${p.model})`:'')).join(', ')}. Choose one in Settings (Art made by); the default is {status.producers.find(p=>p.id===status.default)?.label||'none'}.</>:'No voice with an installed CLI and no local model: add a voice to voices.json or set up a local model to make art.'}</span>:undefined}>
      {!status&&!error?<LoadingState/>:null}
      {status?.jobs.length?<RunList label="Art commissions" runs={status.jobs.slice(0,12)} keyOf={job=>job.id} render={job=>{const live=ACTIVE.includes(job.state);
        return <RunRow data-art-job={job.id} data-job-state={job.state} state={live?(job.state==='running'?'running':'waiting'):job.state==='done'?'succeeded':job.state==='cancelled'?'waiting':'failed'}
          title={job.title||job.path}
          meta={<><StatusBadge tone={STATES[job.state]?.tone||'neutral'} className="mr-1">{STATES[job.state]?.label||job.state}</StatusBadge>{job.producer_label}{job.model?` · ${job.model}`:''}{job.auto?' · automatic':''}
            <span className="block">{live?<>{job.message}{job.elapsed?` · ${duration(job.elapsed)}`:''}{job.ahead?` · ${job.ahead} ahead`:''}</>:<>{duration(job.seconds)||'—'} · {costLine(job)}</>}</span>
            {job.log?<code className="block font-mono text-xs [overflow-wrap:anywhere]">{job.log}</code>:null}</>}
          outcome={job.error||job.warning?<span className="text-destructive">{[job.error,job.warning].filter(Boolean).join(' · ')}</span>:null}
          actions={live&&!job.foreign?<Button variant="outline" size="xs" onClick={()=>cancel(job.id)}>Cancel</Button>:job.state==='done'?<Button variant="ghost" size="xs" onClick={()=>open(job.path)}>Open</Button>:null}/>;}}/>
        :status?<EmptyState icon={ImageIcon} title="No commissions yet" description={<>Open an article and press <Kbd>Space</Kbd> <Kbd>g</Kbd>, then Generate art; or let Settings make art for the issue automatically.</>}/>:null}
    </StatusCard>
  </section>;
}
