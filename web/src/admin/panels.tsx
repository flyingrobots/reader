/* Reader Admin section bodies. Each wraps an existing Behind the scenes panel unchanged (its handlers, busy states,
   local-only restrictions and error displays), and starts only the status reads that panel already relied on. */
import {useEffect, useLayoutEffect, useRef} from 'react';
import {Button} from '../components/ui/button';
import {Card} from '../components/ui/card';
import {EditionLinks, Indexes} from '../backstage';
import {InboxPage} from './pages/inbox';
import {LocalModelSection} from '../local-model';
import {CompanionsSection, AgentsCard} from '../companions';
import {ServerCard} from '../server-card';
import {ArtStudio} from '../art-studio';
import type {AdminContext} from './sections';

type Props={context:AdminContext};

/** The page a section that needs Reader on this computer shows in the static web demo (the shell decides). */
export function NeedsReader({what}:{what:string}){
  return <p className="backstage-note admin-needs-reader" id="backstage-local-only" data-state="unavailable">{what} needs Reader on your computer. The web demo shows recorded reading data only; rebuilds, checks, the service and companion tools run there.</p>;
}

/** A DOM slot React renders once and never touches again: the vanilla dashboard owns its contents. */
function Slot({id,mount}:{id:string;mount:(element:HTMLElement)=>void}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(ref.current)mount(ref.current);},[mount]);
  return <div id={id} ref={ref}/>;
}

export function InboxPanel({context:c}:Props){
  return <section id="backstage-inbox" aria-label="Inbox">
    <InboxPage status={c.inbox} error={c.inboxError} starting={c.inboxStarting} onMail={c.startInbox} onStop={c.stopInbox} onOpen={c.open} html={c.markdown} activity={c.activity}/>
  </section>;
}

export function IndexesPanel({context:c}:Props){
  // Opening Indexes reads its status and, as Behind the scenes did, refreshes a freshness check older than two minutes.
  useEffect(()=>{c.checkIndexes();},[]);  // Once per visit.
  return <Indexes status={c.maintenance} error={c.maintenanceError} onStart={c.startJob} editions={<EditionLinks api={c.api}/>}/>;
}

export function ArtworkPanel({context:c}:Props){return <ArtStudio api={c.api} open={c.open}/>;}

export function LibraryPanel({context:c}:Props){
  return <section className="backstage-section backstage-library" id="backstage-library" aria-label="Library statistics">
    {c.library?<Slot id="backstage-library-mount" mount={c.library}/>:<p className="backstage-message">Library statistics are unavailable here.</p>}
  </section>;
}

export function ServicePanel({context:c}:Props){
  useEffect(()=>{if(!c.local)c.refreshCompanions();},[]);
  return <>
    <section className="backstage-section" id="backstage-server" aria-labelledby="server-title">
      <div className="backstage-section-head"><h2 id="server-title">Service</h2></div><ServerCard api={c.api}/></section>
    <CompanionsSection api={c.api} status={c.companions} busy={!!c.maintenance?.running} onRefresh={()=>{c.api('/api/companions',{action:'check',name:'colorful'}).catch(()=>{}).finally(c.refreshCompanions);}}
      act={(name,action,extra)=>c.companionAction(name,action,extra)}/>
    {!c.companions&&c.companionsError?<p className="backstage-message backstage-error" role="status">Couldn’t look for companion tools: {c.companionsError}</p>:null}
  </>;
}

export function VoicesPanel({context:c}:Props){
  useEffect(()=>{if(!c.local)c.refreshCompanions();},[]);
  return <section className="backstage-section" id="backstage-voices" aria-label="Agents and models"><AgentsCard status={c.companions} error={c.companionsError}/></section>;
}

export function ModelsPanel({context:c}:Props){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!c.local&&ref.current)c.watchLocalModel(ref.current);},[]);
  return <div ref={ref} id="backstage-models">
    {!c.localModel&&c.localModelError?<p className="backstage-message backstage-error" id="local-model-unavailable" role="status">Couldn’t read the local-model status: {c.localModelError}</p>
      :<LocalModelSection status={c.localModel} act={c.localModelAction}/>}
  </div>;
}

export function SettingsPanel({context:c}:Props){
  return <section className="backstage-section" id="backstage-settings" aria-label="Settings">
    <div className="backstage-section-head"><span className="backstage-checked">Theme colours, fonts and contrast checks</span><Button id="theme-editor-open" variant="outline" size="sm" onClick={c.themeEditor}>Theme Editor…</Button></div>
    <Card size="sm" className="backstage-card">{c.settings}</Card>
  </section>;
}
