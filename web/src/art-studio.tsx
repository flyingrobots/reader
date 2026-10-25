/* Bespoke article art (RW-43): the Art studio card behind the scenes, and the producer list for Settings.
   Commissions are background jobs on the server (/api/art/jobs); this card shows what runs, what waited,
   what it cost as far as the producer reported, and lets you cancel. art.mjs toasts the transitions. */
import {useEffect, useState} from 'react';
import {Loader2Icon} from 'lucide-react';
import {Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent} from './components/ui/card';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';

export type ArtProducer={id:string;kind:'voice'|'local';label:string;available:boolean;cli:string|null;model:string|null;provider?:string|null;estimate_seconds:number|null};
export type ArtJob={id:string;path:string;title:string|null;producer:string;producer_label:string;model:string|null;state:string;stage:string|null;message:string|null;queued_at:string;started_at:string|null;finished_at:string|null;
  seconds:number|null;elapsed?:number;ahead?:number;usage:{input_tokens:number;output_tokens:number;usd:number|null}|null;log:string|null;error:string|null;auto:boolean;warning:string|null;foreign:boolean};
export type ArtStatus={jobs:ArtJob[];active:number;producers:ArtProducer[];default:string|null;error:string|null};
type Api=(path:string,payload?:unknown)=>Promise<any>;
const ACTIVE=['queued','waiting','running'];
const STATES:Record<string,{label:string;variant:'default'|'secondary'|'outline'|'destructive'}>={queued:{label:'Queued',variant:'outline'},waiting:{label:'Waiting',variant:'outline'},running:{label:'Making',variant:'default'},
  done:{label:'Ready',variant:'secondary'},failed:{label:'Failed',variant:'destructive'},timeout:{label:'Timed out',variant:'destructive'},cancelled:{label:'Cancelled',variant:'outline'}};
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
  return <section className="backstage-section" id="backstage-art" aria-labelledby="art-title">
    <div className="backstage-section-head"><h2 id="art-title">Art studio</h2><span className="backstage-checked">Bespoke art for featured articles</span></div>
    <Card size="sm" className="backstage-card" data-state={active.length?'running':'idle'}>
      <CardHeader><CardTitle>Commissions</CardTitle>
        <CardDescription>An agent reads the article, writes an art brief, then composes a scene in Reader’s scene language; Reader validates it and draws it itself. Every run is archived under logs/llm/art; each version is committed under art/.</CardDescription>
        <CardAction><Badge variant={active.length?'default':'outline'} className="backstage-badge">{active.length?<><Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden/>{active.length} running or waiting</>:status?'Idle':'Loading…'}</Badge></CardAction></CardHeader>
      <CardContent>
        {error?<p className="backstage-message backstage-error">{error}</p>:null}
        {status?<p className="backstage-message">{available.length?<>Art can be made by {available.map(p=>p.label+(p.model?` (${p.model})`:'')).join(', ')}. Choose one in Settings (Art made by); the default is {status.producers.find(p=>p.id===status.default)?.label||'none'}.</>:'No voice with an installed CLI and no local model: add a voice to voices.json or set up a local model to make art.'}</p>:null}
        {status?.jobs.length?<ol className="backstage-jobs art-jobs">{status.jobs.slice(0,12).map(job=><li key={job.id} data-art-job={job.id} data-job-state={job.state}>
          <span className="backstage-job-state">{ACTIVE.includes(job.state)?<Loader2Icon className="size-3 animate-spin" aria-label={STATES[job.state]?.label}/>:job.state==='done'?'✓':'✕'}</span>
          <span><strong>{job.title||job.path}</strong>
            <small><Badge variant={STATES[job.state]?.variant||'outline'} className="backstage-badge">{STATES[job.state]?.label||job.state}</Badge> {job.producer_label}{job.model?` · ${job.model}`:''}{job.auto?' · automatic':''}</small>
            <small>{ACTIVE.includes(job.state)?<>{job.message}{job.elapsed?` · ${duration(job.elapsed)}`:''}{job.ahead?` · ${job.ahead} ahead`:''}</>:<>{duration(job.seconds)||'—'} · {costLine(job)}</>}</small>
            {job.error?<small className="backstage-error">{job.error}</small>:null}{job.warning?<small className="backstage-error">{job.warning}</small>:null}
            {job.log?<small><code>{job.log}</code></small>:null}</span>
          <span className="art-job-actions">{ACTIVE.includes(job.state)&&!job.foreign?<Button variant="outline" size="xs" onClick={()=>cancel(job.id)}>Cancel</Button>:null}
            {job.state==='done'?<Button variant="ghost" size="xs" onClick={()=>open(job.path)}>Open</Button>:null}</span></li>)}</ol>
          :status?<p className="backstage-message">No commissions yet. Open an article and press <kbd>Space</kbd> <kbd>g</kbd>, then Generate art; or let Settings make art for the issue automatically.</p>:null}
      </CardContent></Card>
  </section>;
}
