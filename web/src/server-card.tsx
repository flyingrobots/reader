/* Behind the scenes: the always-on service — running commit, updater, Tailscale address and identity. */
import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';
import {Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter} from './components/ui/card';
import {when} from './backstage';

type Update={at:string;outcome:string;from?:string|null;to?:string;error?:string;busy?:{label:string}[];steps?:{step:string;ok:boolean;detail:unknown}[]};
export type ServiceInfo={
  service:{installed:boolean;error?:string;web?:{loaded:boolean;pid?:number};updater?:{loaded:boolean};paused?:boolean;source?:string;source_commit?:string|null;
    commit?:string|null;commit_facts?:{date?:string;subject?:string};last_update?:Update|null;last_check_at?:string|null;next_check_at?:string|null;
    update_requested_at?:string|null;tailscale?:{state:string;url?:string;enabled?:boolean;error?:string}};
  identity:{via:'local'|'tailscale';login:string|null;name:string|null};
  health:{commit:string|null;started_at:string;busy:{label:string}[]};
};
type Api=(path:string,payload?:unknown)=>Promise<any>;

function until(value?:string|null){
  if(!value)return null;const seconds=Math.round((+new Date(value)-Date.now())/1000);
  if(Number.isNaN(seconds))return value;if(seconds<=30)return 'Due now';return seconds<3600?`In ${Math.round(seconds/60)} min`:`In ${Math.round(seconds/3600)} h`;
}
const short=(commit?:string|null)=>commit?commit.slice(0,7):null;
const OUTCOMES:Record<string,string>={updated:'Updated',current:'Up to date','smoke-failed':'Smoke test failed','rolled-back':'Rolled back',
  'rollback-failed':'Rollback failed',deferred:'Waiting for work to finish','checkout-failed':'Checkout failed',unhealthy:'Unhealthy after restart','source-missing':'Source branch missing'};
function outcome(update:Update){
  if(update.outcome==='updated')return {type:'success' as const,title:`Updated to ${short(update.to)}`,description:'Reader restarted on the new commit.'};
  if(update.outcome==='deferred')return {type:'info' as const,title:'Update waiting',description:`${(update.busy||[]).map(b=>b.label).join(', ')||'Work'} is still running; the updater retries on its next check.`};
  const failed=update.steps?.find(step=>!step.ok);
  return {type:'error' as const,title:OUTCOMES[update.outcome]||update.outcome,description:update.error||(failed?`${failed.step}: ${failed.detail}`:undefined)};
}

export function ServerCard({api}:{api:Api}){
  const [info,setInfo]=useState<ServiceInfo|null>(null);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState<string|null>(null);const [pending,setPending]=useState(false);
  const seen=useRef<string|null|undefined>(undefined);const restartFrom=useRef<string|null>(null);
  async function refresh(){
    try{const next:ServiceInfo=await api('/api/service');setInfo(next);setError(null);
      const last=next.service.last_update?.at||null;
      if(seen.current!==undefined&&last&&last!==seen.current){const o=outcome(next.service.last_update!);toast.dismiss('service-update');
        setPending(false);if(o.type==='success')toast.success(o.title,{description:o.description,duration:8000});else if(o.type==='error')toast.error(o.title,{description:o.description,duration:12000});else toast(o.title,{description:o.description});}
      seen.current=last;
      if(restartFrom.current&&next.health.started_at!==restartFrom.current){restartFrom.current=null;setPending(false);toast.dismiss('service-restart');toast.success('Reader restarted');}
    }catch(e){if(restartFrom.current)return;setError(e instanceof Error?e.message:String(e));}
  }
  // Poll every 10 s on this page; every 2 s while an update or restart is pending.
  useEffect(()=>{refresh();},[]);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},pending?2000:10000);return ()=>clearInterval(timer);},[pending]);
  async function act(action:'update'|'restart'|'pause'|'resume'){
    setBusy(action);
    try{await api('/api/service',{action});if(action==='update'||action==='restart')setPending(true);
      if(action==='update')toast.loading('Checking for an update…',{id:'service-update',description:'The updater smoke-tests a newer commit before switching to it.',duration:120000,cancel:{label:'Dismiss'}});
      else if(action==='restart'){restartFrom.current=info?.health.started_at||null;toast.loading('Restarting Reader…',{id:'service-restart',duration:30000,cancel:{label:'Dismiss'}});}
      else toast.success(action==='pause'?'Updates paused':'Updates resumed');
      await refresh();
    }catch(e){toast.error(`Couldn’t ${action==='update'?'start the update':action}`,{description:e instanceof Error?e.message:String(e),duration:8000});}
    finally{setBusy(null);}
  }
  const s=info?.service,installed=!!s?.installed,ts=s?.tailscale,identity=info?.identity;
  const state=!info?{label:'Loading…',variant:'outline' as const}:!installed?{label:'Not installed',variant:'outline' as const}:s!.paused?{label:'Updates paused',variant:'outline' as const}:s!.web?.loaded?{label:'Running',variant:'secondary' as const}:{label:'Stopped',variant:'destructive' as const};
  const facts:[string,string|null|undefined,string?][]=installed?[
    ['Commit',short(s!.commit)?`${short(s!.commit)}${s!.commit_facts?.date?' · '+when(s!.commit_facts.date):''}`:null,'commit'],
    ['Source',s!.source,'source'],
    ['Last update',s!.last_update?`${OUTCOMES[s!.last_update.outcome]||s!.last_update.outcome} · ${when(s!.last_update.at)}`:'None yet','last-update'],
    ['Next check',s!.paused?'Paused':s!.update_requested_at?'Now':s!.next_check_at?until(s!.next_check_at):'Within 10 min','next-check'],
  ]:[];
  return <Card size="sm" className="backstage-card server-card" data-card="service" data-installed={installed?'true':'false'}>
    <CardHeader><CardTitle>Server</CardTitle>
      <CardDescription>Reader as an always-on service on this Mac, kept current from its source branch and reachable on your tailnet.</CardDescription>
      <CardAction><Badge variant={state.variant} className="backstage-badge">{state.label}</Badge></CardAction></CardHeader>
    <CardContent>
      {error?<p className="backstage-message backstage-error">{error}</p>:null}
      {info&&!installed?<p className="backstage-message">This server is not running as a service. Install it with <code>scripts/reader_service.py install</code>; see the web guide.</p>:null}
      {s?.commit_facts?.subject?<p className="backstage-message" data-fact="subject">{s.commit_facts.subject}</p>:null}
      <dl className="backstage-facts">
        {facts.map(([label,value,key])=>value?<div key={label} data-fact={key}><dt>{label}</dt><dd>{value}</dd></div>:null)}
        {installed?<div data-fact="tailscale" className="server-wide"><dt>Tailscale</dt><dd>{ts?.state==='on'&&ts.url?<a href={ts.url} rel="noreferrer">{ts.url.replace('https://','')}</a>:ts?.state==='unavailable'?'Unavailable':'Off'}</dd></div>:null}
        {identity?<div data-fact="identity" className="server-wide"><dt>Signed in as</dt><dd>{identity.via==='tailscale'?identity.name?`${identity.name} (${identity.login})`:identity.login:'This Mac (local)'}</dd></div>:null}
      </dl>
      {info?.health.busy.length?<p className="backstage-note">Running now: {info.health.busy.map(b=>b.label).join(', ')}. Updates wait until it finishes.</p>:null}
    </CardContent>
    <CardFooter><ButtonGroup>
      <Button id="service-update" variant="default" size="sm" disabled={!installed||!!busy} onClick={()=>act('update')}>Update now</Button>
      <Button id="service-restart" variant="outline" size="sm" disabled={!installed||!!busy} onClick={()=>act('restart')}>Restart</Button>
      <Button id="service-pause" variant="outline" size="sm" disabled={!installed||!!busy} onClick={()=>act(s?.paused?'resume':'pause')}>{s?.paused?'Resume updates':'Pause updates'}</Button>
    </ButtonGroup></CardFooter>
  </Card>;
}
