/* Reader Admin section bodies. Each wraps an existing Behind the scenes panel unchanged (its handlers, busy states,
   local-only restrictions and error displays), and starts only the status reads that panel already relied on. */
import {useEffect, useLayoutEffect, useRef} from 'react';
import {PaletteIcon} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Toolbar} from '../theme/molecules/toolbar';
import {EditionLinks, IndexesPage} from './pages/indexes';
import {InboxPage} from './pages/inbox';
import {LocalModelSection} from '../local-model';
import {CompanionsSection} from '../companions';
import {VoicesPage} from './pages/voices';
import {ServerCard} from '../server-card';
import {SectionHeading} from '../theme/atoms/section-heading';
import {Unavailable} from '../theme/molecules/states';
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
  return <IndexesPage status={c.maintenance} error={c.maintenanceError} onStart={c.startJob} editions={<EditionLinks api={c.api}/>}/>;
}

export function ArtworkPanel({context:c}:Props){return <ArtStudio api={c.api} open={c.open}/>;}

export function LibraryPanel({context:c}:Props){
  return <section className="backstage-section backstage-library" id="backstage-library" aria-label="Library statistics">
    {c.library?<Slot id="backstage-library-mount" mount={c.library}/>:<p className="backstage-message">Library statistics are unavailable here.</p>}
  </section>;
}

export function ServicePanel({context:c}:Props){
  useEffect(()=>{if(!c.local)c.refreshCompanions();},[]);
  return <div className="flex flex-col gap-10">
    <section className="flex flex-col gap-4" id="backstage-server" aria-labelledby="server-title">
      <SectionHeading id="server-title">Service</SectionHeading><ServerCard api={c.api}/></section>
    {!c.companions&&c.companionsError?<Unavailable what="Companion tools" error={c.companionsError}/>:null}
    <CompanionsSection api={c.api} status={c.companions} busy={!!c.maintenance?.running} onRefresh={()=>{c.api('/api/companions',{action:'check',name:'colorful'}).catch(()=>{}).finally(c.refreshCompanions);}}
      act={(name,action,extra)=>c.companionAction(name,action,extra)}/>
  </div>;
}

export function VoicesPanel({context:c}:Props){
  useEffect(()=>{if(!c.local)c.refreshCompanions();},[]);
  return <section id="backstage-voices" aria-label="Agents and models"><VoicesPage status={c.companions} error={c.companionsError}/></section>;
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
  return <section className="flex flex-col gap-6" id="backstage-settings" aria-label="Settings">
    <Toolbar status="Theme colours, fonts and contrast checks are in the Theme Editor."><Button id="theme-editor-open" variant="outline" size="sm" onClick={c.themeEditor}><PaletteIcon data-icon="inline-start" aria-hidden/>Theme Editor…</Button></Toolbar>
    {c.settings}
  </section>;
}
