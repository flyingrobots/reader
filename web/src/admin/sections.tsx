/* Reader Admin's section registry: the one list the sidebar, the routes and the page header read.
 *
 * Extension point. A feature adds administration by appending one AdminSection here: its id becomes the route
 * `#admin/<id>` (and `#admin/<id>/<param>…` when `params` accepts them), its place in the array is its place in the
 * sidebar, and `render` draws the page body under the shell's own heading. Nothing else in the shell changes. RW-44
 * adds `jobs` (accepting `jobs/<uuid>`), `logs` (accepting `logs/<kind>/<YYYY-MM-DD>/<run-id>`) and `repositories` this way, after
 * Overview, as the design's sidebar lists them. A section whose backend needs Reader on this computer sets `needsReader`, and the static
 * web demo shows an honest unavailable page for it instead of empty controls. */
import type {ReactNode} from 'react';
import {BotIcon, CpuIcon, DatabaseIcon, FolderGitIcon, GitPullRequestArrowIcon, ScrollTextIcon, ImageIcon, InboxIcon, LayoutDashboardIcon, LibraryIcon, ServerIcon, SettingsIcon, type LucideIcon} from 'lucide-react';
import type {MaintenanceStatus, InboxStatus} from '../backstage';
import type {ActivityModel} from '../reader-controls';
import type {LocalModelStatus} from '../local-model';
import type {CompanionsStatus} from '../companions';
import {ArtworkPanel, IndexesPanel, InboxPanel, LibraryPanel, ModelsPanel, ServicePanel, SettingsPanel, VoicesPanel} from './panels';
import {Overview} from './overview';
import {LogPanel, LogsPanel, RepositoriesPanel, type AdminPanelProps} from '../jobs/admin';
import {JobPage, JobsPage} from './pages/jobs';
import {jobViewOptions} from '../reader-controls';

export type AdminRoute={section:string;params:string[]};
type Api=(path:string,payload?:unknown)=>Promise<any>;
/** What a section page can read and do. Status comes from the polls Reader already runs; actions are the existing
 *  handlers, unchanged. Errors are kept beside each status so a failed read shows as unavailable, not empty. */
export type AdminContext={
  route:AdminRoute;
  /** The static web demo: there is no Reader on this computer to run anything. */
  local:boolean;
  maintenance:MaintenanceStatus|null;maintenanceError:string|null;
  inbox:InboxStatus|null;inboxError:string|null;inboxStarting:boolean;activity:ActivityModel|null;
  localModel:LocalModelStatus|null;localModelError:string|null;
  companions:CompanionsStatus|null;companionsError:string|null;
  api:Api;markdown:(text:string)=>string;
  /** Open a document or another view (a library path or a ':' route), as links elsewhere do. */
  open:(path:string)=>void;
  /** The hash of an admin section, and navigation to it (a new history entry). */
  href:(section?:string,...params:string[])=>string;
  go:(section?:string,...params:string[])=>void;
  /** Leave Admin for the library view it was opened from (a document at its saved place, or a split layout). */
  backToLibrary:()=>void;
  startJob:(kind:string)=>void;startInbox:()=>void;stopInbox:()=>void;
  localModelAction:(action:string,payload?:Record<string,unknown>)=>Promise<unknown>;
  companionAction:(name:string,action:string,extra?:Record<string,unknown>)=>Promise<unknown>;
  refreshCompanions:()=>void;
  /** Index freshness: read the status, and run the light freshness check when the last one is old (Indexes only). */
  checkIndexes:()=>void;
  /** Keep the local-model status polled while `element` is on screen. */
  watchLocalModel:(element:HTMLElement)=>void;
  settings:ReactNode;themeEditor:()=>void;
  library?:(element:HTMLElement)=>void;
};
export type AdminSection={
  id:string;title:string;icon:LucideIcon;
  /** One line under the page heading. */
  description:string;
  needsReader?:boolean;
  /** Route parameters this section accepts after its id; none by default, so `#admin/inbox/x` is not found. */
  params?:(params:string[])=>boolean;
  render:(context:AdminContext)=>ReactNode;
};

export const OVERVIEW='overview';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** RW-44's panels take the shell's navigation and the shared job view options. */
const panelProps=(context:AdminContext):AdminPanelProps=>({options:jobViewOptions(),go:context.go,href:context.href,open:context.open});

export const ADMIN_SECTIONS:AdminSection[]=[
  {id:OVERVIEW,title:'Overview',icon:LayoutDashboardIcon,description:'What is running, what is waiting and what needs attention. Read-only: opening it starts nothing.',render:context=><Overview context={context}/>},
  {id:'jobs',title:'Coding jobs',icon:GitPullRequestArrowIcon,needsReader:true,description:'Article prompts run as coding jobs: their queue, history, traces and pull requests. Opening a job starts nothing.',
    params:params=>params.length===1&&UUID.test(params[0]),
    render:context=>context.route.params.length?<JobPage id={context.route.params[0]} {...panelProps(context)}/>:<JobsPage {...panelProps(context)}/>},
  {id:'logs',title:'LLM logs',icon:ScrollTextIcon,needsReader:true,description:'Every archived LLM run, kept forever: prompts, captured output, events and results. Read in pages; nothing is pruned.',
    params:params=>params.length===3&&/^[a-z-]+$/.test(params[0])&&/^\d{4}-\d{2}-\d{2}$/.test(params[1]),
    render:context=>context.route.params.length?<LogPanel params={context.route.params} {...panelProps(context)}/>:<LogsPanel {...panelProps(context)}/>},
  {id:'repositories',title:'Repositories',icon:FolderGitIcon,needsReader:true,description:'Which local checkouts article prompts may run in, with their base branch, agents and verification command.',
    render:context=><RepositoriesPanel {...panelProps(context)}/>},
  {id:'voices',title:'Voices',icon:BotIcon,needsReader:true,description:'The agent command lines chat voices and the librarian run. Reader finds them; you install and sign in.',render:context=><VoicesPanel context={context}/>},
  {id:'models',title:'Models',icon:CpuIcon,needsReader:true,description:'A local model for bulk, private work: its provider, server, queue and outputs.',render:context=><ModelsPanel context={context}/>},
  {id:'inbox',title:'Inbox',icon:InboxIcon,description:'Arrivals waiting to be filed, their receipts, and the librarian run that files them.',render:context=><InboxPanel context={context}/>},
  {id:'indexes',title:'Indexes',icon:DatabaseIcon,description:'Rebuildable copies of what the vault holds: check whether they have drifted and rebuild one when it has.',render:context=><IndexesPanel context={context}/>},
  {id:'artwork',title:'Artwork',icon:ImageIcon,description:'Commissioned art for featured articles: running and recent jobs.',render:context=><ArtworkPanel context={context}/>},
  {id:'library',title:'Library',icon:LibraryIcon,description:'Holdings, arrivals, reading and the margins.',render:context=><LibraryPanel context={context}/>},
  {id:'service',title:'Service & tools',icon:ServerIcon,needsReader:true,description:'The Reader service, its updater, and companion tools such as Colorful Language and AI-TTS.',render:context=><ServicePanel context={context}/>},
  {id:'settings',title:'Settings',icon:SettingsIcon,description:'Your reading preferences, saved on this device, and the Theme Editor.',render:context=><SettingsPanel context={context}/>},
];

/** The registered section a route names, or null when it names none (or parameters it does not accept). */
export function sectionFor(route:AdminRoute,sections:AdminSection[]=ADMIN_SECTIONS){
  const section=sections.find(s=>s.id===route.section);if(!section)return null;
  if(route.params.length&&!section.params?.(route.params))return null;
  return section;
}
