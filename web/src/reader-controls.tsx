import {useState, useSyncExternalStore, useEffect, type ReactNode} from 'react';
import {ReadingLog, type ReadingLogActions, type ReadingLogModel} from './reading-log';
import {LinkPreview, type LinkPreviewState} from './link-preview';
import {VersionsTimeline, type TimelineModel} from './versions-timeline';
import {AnnotationDialog, PickerDialog, ScratchSaveDialog, ShellDialog, SpeakMenu, type AnnotationOptions, type PickerControl, type ScratchSaveOptions, type ShellDialogOptions, type SpeakOptions} from './shell-dialog';
import {createRoot, type Root} from 'react-dom/client';
import {createPortal, flushSync} from 'react-dom';
import {Progress} from './components/ui/progress';
import {Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverDescription} from './components/ui/popover';
import {Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis} from './components/ui/pagination';
import {Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem} from './components/ui/select';
import {Switch} from './components/ui/switch';
import {PaletteIcon} from 'lucide-react';
import {Skeleton} from './components/ui/skeleton';
import {Field, FieldGroup, FieldLabel, FieldDescription, FieldSeparator} from './components/ui/field';
import {Item, ItemActions, ItemContent, ItemDescription} from './components/ui/item';
import {Kbd} from './components/ui/kbd';
import {Label} from './components/ui/label';
import {Spinner} from './components/ui/spinner';
import {StatusCard} from './theme/organisms/status-card';
import type {LibraryActions} from './admin/pages/library';
import {Input} from './components/ui/input';
import {Button} from './components/ui/button';
import {Badge} from './components/ui/badge';
import {decorateCodeBlocks, installCodeCopy, type CodeBlockOptions} from './code-blocks';
export {decorateCodeBlocks};
import {Toaster} from './components/ui/sonner';
import {toast} from 'sonner';
import {notify} from './notify';
import {needsReader, NEEDS_READER} from './static-demo';
export {needsReader, NEEDS_READER};
import {type MaintenanceStatus, type Job, type InboxStatus} from './backstage';
import {AdminShell} from './admin/admin-shell';
import type {AdminContext, AdminRoute} from './admin/sections';
import {SpeechControl, setSpeechApi} from './speech-control';
export {trackSpeech} from './speech-control';
import {ChatPanel} from './chat/chat-panel';
import {runSummary, type LocalModelStatus, type Run} from './local-model';
import {emptyActivity, fromCodex, reduce, type Activity} from './activity/reducer';
import type {RunInfo} from './activity/transcript';
import {PromptCard, type PromptBlock, type PromptContext} from './jobs/prompt-card';
import {setJobsApi} from './jobs/store';
import type {JobViewOptions} from './jobs/job-detail';
export {type AdminPanelProps} from './jobs/admin';
export {RepositoriesPage as RepositoriesPanel} from './admin/pages/repositories';
export {LogsPage as LogsPanel, LogPage as LogPanel} from './admin/pages/logs';
export {JobsPage as JobsPanel, JobPage as JobPanel} from './admin/pages/jobs';
import {CompanionPrompt, focusCompanion, isDismissed, type Companion, type CompanionsStatus} from './companions';
import {useArtProducers} from './art-studio';
import {ArtRegenerate, type ArtRegenerateOptions} from './art-regenerate';
import {DocumentTree, revealDocumentNode, type DocumentRow} from './document-tree';
import {ChangesPanel, type ChangesOptions} from './changes-panel';
import {SearchPage, type SearchModel, type SearchActions} from './search-page';
export {flatPassages} from './search-page';
import {QueuePanel, type QueueProps} from './queue-panel';
export {visibleDocumentNodes} from './document-tree';
export {mountCallouts} from './callouts';
export {mountQuiz} from './quiz';
export {mountWritingPrompt} from './writing-prompt';
export {mountScratchQuestion} from './scratch-question';
import {ThemeEditor} from './theme/theme-editor';
import {applyThemes, ensureProseTokens, themeId, type InstalledFont} from './theme/theme-css';
import type {Theme} from './theme/color';
export {applyThemes};
import {observeButtons} from './vanilla-buttons';
import {OutlineControl, type OutlineModel, type OutlineActions} from './outline';
import {FAMOUS, famousId} from './theme/famous';
import {plural} from './plural';
export const famousThemeIds=FAMOUS.flatMap(t=>[famousId(t.id,'light'),famousId(t.id,'dark')]);

type Preferences={participant:string;theme:string;recent:number;pace:number;layout:string;pageTurn:string;proseColors:string;atlas:boolean;activity:boolean;smooth:boolean;nextReads:boolean;backlinks:boolean;outline:boolean;shapes?:boolean;art?:boolean;artHero?:boolean;artBy?:string;artAuto?:string;inboxSandbox?:string;issueExclude:string};
export type ProseStatus={available:boolean;version:string|null;path:string|null;origin:string|null;message:string|null;install:string};
type Pip={id:string;owner:string;quote:string;kind:string;own:boolean;fraction:number};
type Model={value:number;words:number;pdfPages:number|null;pace:number;spread:number;spreads:number;pages:number;columns:number;theme:string;pips:Pip[];prefs:Preferences;participants:string[];themeEditorOpen:boolean;customThemes:Theme[];fonts:InstalledFont[];maintenance:MaintenanceStatus|null;prose:ProseStatus|null;outline:OutlineModel;outlineActive:number;inbox:InboxStatus|null;inboxStarting:boolean;chat:{open:boolean;path:string|null;title:string;participant:string;initialId?:string};localModel:LocalModelStatus|null;activity:ActivityModel;companions:CompanionsStatus|null;
  // Reader Admin: the shown route, and the last failed read of each status (cleared by the next good one).
  admin:AdminRoute|null;maintenanceError:string|null;inboxError:string|null;localModelError:string|null;companionsError:string|null};
export type ActivityModel={runId:string|null;offset:number;activity:Activity;run:RunInfo|null;done:boolean};
type Actions={seek:(fraction:number)=>void;spread:(index:number)=>void;thread:(id:string)=>void;theme:()=>void;save:(prefs:Preferences)=>Promise<void>;error:(error:unknown)=>void;themeEditor:(open:boolean)=>void;themeEditorClosed:()=>void;api:(path:string,payload?:unknown)=>Promise<any>;themesChanged:(themes:Theme[],fonts:InstalledFont[])=>void;useTheme:(dataTheme:string)=>void;previewFont:(href:string)=>void;open:(path:string)=>void;libraryChanged:()=>Promise<void>;markdown:(text:string)=>string;chatMarkdown:(text:string)=>string;openPath:(path:string)=>void;chatChanged:(open:boolean)=>void;
  /** Reader Admin routes (web_ui/admin-routes.mjs): a section's hash, navigation to it, and the way back. */
  adminHref:(section?:string,...params:string[])=>string;adminGo:(section?:string,...params:string[])=>void;backToLibrary:()=>void}&OutlineActions;
const dark=(theme:string)=>theme==='ink'||theme.endsWith('-dark');
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const builtInThemes=[{value:'ink',label:'Ink'},{value:'paper',label:'Paper'},{value:'orchid',label:'Orchid · Light'},{value:'orchid-dark',label:'Orchid · Dark'},{value:'harvest',label:'Harvest · Light'},{value:'harvest-dark',label:'Harvest · Dark'},...FAMOUS.flatMap(t=>(['light','dark'] as const).map(v=>({value:famousId(t.id,v),label:`${t.name} · ${t.labels[v]}`})))];
const themeChoices=(themes:Theme[])=>[...builtInThemes,...themes.flatMap(t=>[{value:themeId(t,'light'),label:t.name+' · Light'},{value:themeId(t,'dark'),label:t.name+' · Dark'}])];

function QuickThemePicker({model,actions}:{model:Model;actions:Actions}){
  const items=themeChoices(model.customThemes);
  // A saved custom theme can paint from the local cache before its metadata arrives.
  if(!items.some(item=>item.value===model.theme))items.push({value:model.theme,label:'Saved theme'});
  return <div className="quick-theme-controls">
    <Select items={items} value={model.theme} onValueChange={value=>{if(value!==null)actions.useTheme(value);}}>
      <SelectTrigger id="quick-theme" size="sm" aria-label="Switch theme" title="Switch theme · Space Shift+T">
        <PaletteIcon aria-hidden="true"/><SelectValue/>
      </SelectTrigger>
      <SelectContent side="top" align="end" alignItemWithTrigger={false} className="min-w-56">
        <SelectGroup>{items.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
    <Label className="shrink-0 cursor-pointer gap-0 px-1.5 text-[10px] font-normal max-[700px]:hidden" data-theme-toggle=""><Switch id="theme-swap" size="sm" aria-label="Dark mode" checked={dark(model.theme)} onCheckedChange={checked=>{if(checked!==dark(model.theme))actions.theme();}}/><span className="ml-[7px]">Dark</span></Label>
  </div>;
}

function Choice({id,label,value,items,onChange}:{id:string;label:string;value:string;items:{label:string;value:string}[];onChange:(value:string)=>void}){
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={items} value={value} onValueChange={v=>{if(v!==null)onChange(v);}}><SelectTrigger id={id} className="w-full"><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{items.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
}
function SettingsForm({model,actions}:{model:Model;actions:Actions}){
  const [draft,setDraft]=useState({...model.prefs,participant:model.prefs.participant||''}),[busy,setBusy]=useState(false),producers=useArtProducers(actions.api);
  useEffect(()=>{setDraft({...model.prefs,participant:model.prefs.participant||''});},[model.prefs]);
  const set=(key:keyof Preferences,value:string|number|boolean)=>setDraft(old=>({...old,[key]:value}));
  return <form id="preferences-form" className="flex flex-col gap-6" onSubmit={async event=>{event.preventDefault();const form=event.currentTarget;setBusy(true);try{await actions.save({...draft,participant:draft.participant.trim()});}catch(error){actions.error(error);}finally{setBusy(false);
    // The Save button is disabled while saving, which drops focus to <body>; give it back once it is enabled again (#59).
    setTimeout(()=>{const active=document.activeElement;if(!active||active===document.body)(form.isConnected?form:document.getElementById('preferences-form'))?.querySelector<HTMLElement>('button[type=submit]')?.focus({preventScroll:true});},0);}}}>
    <StatusCard title="You and the page" description="Who is reading here, and how Reader looks.">
      <FieldGroup className="max-w-2xl">
      <Field><FieldLabel htmlFor="profile-name">Reading as</FieldLabel><Input id="profile-name" name="participant" value={draft.participant} required maxLength={100} list="participant-list" onChange={event=>set('participant',event.target.value)}/><datalist id="participant-list">{model.participants.map(name=><option key={name} value={name}/>)}</datalist><FieldDescription>Names identify local reading receipts. They are not authenticated accounts.</FieldDescription></Field>
      <Choice id="theme-choice" label="Palette" value={draft.theme} items={themeChoices(model.customThemes)} onChange={value=>set('theme',value)}/>
      <FieldDescription>Create, edit or delete your own light/dark themes with the Theme Editor: <Kbd>Space</Kbd> <Kbd>,</Kbd> <Kbd>t</Kbd> or <Kbd>F10</Kbd>.</FieldDescription>
      </FieldGroup>
    </StatusCard>
    <StatusCard title="Reading" description="Layout, pace and what appears around an article.">
      <FieldGroup className="max-w-2xl">
      <Choice id="reading-mode" label="Reading layout" value={draft.layout} items={[{value:'scroll',label:'Continuous'},{value:'spread',label:'Two pages'}]} onChange={value=>set('layout',value)}/>
      <Choice id="page-turn" label="Page turn (two pages)" value={draft.pageTurn||'curl'} items={[{value:'curl',label:'Turn the page (3D)'},{value:'slide',label:'Slide'}]} onChange={value=>set('pageTurn',value)}/>
      <Choice id="reading-speed" label="Reading pace" value={String(draft.pace)} items={[160,220,300].map(n=>({value:String(n),label:`${n} words / min`}))} onChange={value=>set('pace',+value)}/>
      <Choice id="recent-count" label="Recent files" value={String(draft.recent)} items={[10,20,30,50].map(n=>({value:String(n),label:String(n)}))} onChange={value=>set('recent',+value)}/>
      <Choice id="prose-colors" label="Prose colors" value={({skim:'subtle',full:'vivid'} as Record<string,string>)[draft.proseColors]??draft.proseColors??'clear'} items={[{value:'off',label:'Off'},{value:'subtle',label:'Subtle: function words fade a little'},{value:'clear',label:'Clear: the skeleton recedes, names stand out'},{value:'vivid',label:'Vivid: every role its own color, like an editor'}]} onChange={value=>set('proseColors',value)}/>
      <FieldDescription id="prose-status">Grammar highlighting from Colorful Language for Markdown and PDF text. <Kbd>Space</Kbd> <Kbd>c</Kbd> steps the open document through Off, Subtle, Clear and Vivid. Vivid colors nouns, verbs, adjectives and adverbs only for the few words Colorful's lexicon knows; most content words keep the body ink. {model.prose===null?'Checking for Colorful…':model.prose.available?`Using Colorful ${model.prose.version} (${model.prose.path}).`:model.prose.message}</FieldDescription>
        <FieldSeparator/>
      {(['atlas','activity','smooth','nextReads','backlinks','outline'] as const).map((key,index)=><Field key={key} orientation="horizontal"><FieldLabel htmlFor={'setting-'+key}>{['Library atlas','Reading activity','Smooth scrolling','Read next at the end of articles','Linked from at the end of articles','Outline beside long documents'][index]}</FieldLabel><Switch id={'setting-'+key} checked={draft[key]!==false} onCheckedChange={value=>set(key,value)}/></Field>)}
      </FieldGroup>
    </StatusCard>
    <StatusCard title="The issue and article art" description="What the homepage issue features, and the art made for it.">
      <FieldGroup className="max-w-2xl">
      <Field><FieldLabel htmlFor="issue-exclude">Leave out of the issue</FieldLabel><Input id="issue-exclude" name="issueExclude" value={draft.issueExclude??''} maxLength={500} onChange={event=>set('issueExclude',event.target.value)}/><FieldDescription>Kinds of writing the homepage issue never features, separated by commas, such as Task, Receipt, Manifest, Handoff.</FieldDescription></Field>
      <Field orientation="horizontal"><FieldLabel htmlFor="setting-art">Article art</FieldLabel><Switch id="setting-art" aria-describedby="setting-art-note" checked={draft.art!==false} onCheckedChange={value=>set('art',value)}/></Field>
      <FieldDescription id="setting-art-note">Bespoke art for featured articles: an agent reads the piece, writes an art brief (the Artist’s note) and composes a scene that Reader draws itself. It shows on the cover, on features and, with <Kbd>Space</Kbd> <Kbd>g</Kbd>, above an open article. <code>:shape</code> shows the older data view.</FieldDescription>
      <Field orientation="horizontal"><FieldLabel htmlFor="setting-art-hero">Open articles with their art</FieldLabel><Switch id="setting-art-hero" aria-describedby="setting-art-hero-note" checked={draft.artHero!==false} disabled={draft.art===false} onCheckedChange={value=>set('artHero',value)}/></Field>
      <FieldDescription id="setting-art-hero-note">An article with art opens on it, like a magazine feature: full width above the title, or the whole first spread in two-page reading. <Kbd>Space</Kbd> <Kbd>g</Kbd> hides it for this session.</FieldDescription>
      <Choice id="art-by" label="Art made by" value={draft.artBy||'default'} items={[{value:'default',label:'Default'+(producers?.default?` (${producers.producers.find(p=>p.id===producers.default)?.label||producers.default})`:'')},...(producers?.producers||[]).map(p=>({value:p.id,label:p.label+(p.model?` · ${p.model}`:'')+(p.available?'':' (unavailable)')}))]} onChange={value=>set('artBy',value==='default'?'':value)}/>
      <Choice id="art-auto" label="Make art automatically" value={draft.artAuto||'off'} items={[{value:'off',label:'Off: only when I ask (Generate art)'},{value:'cover',label:'For each issue’s cover story'},{value:'issue',label:'For the cover story and features'}]} onChange={value=>set('artAuto',value)}/>
      <FieldDescription id="art-auto-note">Each piece of art is a background run of the chosen voice’s CLI (its subscription) or the local model: usually a few minutes, never more than one at a time. Every run is archived in the vault’s LLM logs, and each version is committed beside its edition under <code>art/</code>.</FieldDescription>
      </FieldGroup>
    </StatusCard>
    <StatusCard title="Inbox" description="How the librarian runs when you press You got mail.">
      <FieldGroup className="max-w-2xl">
      <Choice id="inbox-sandbox" label="Inbox job permissions" value={draft.inboxSandbox==='danger-full-access'?'danger-full-access':'workspace-write'} items={[{value:'workspace-write',label:'Sandboxed workspace'},{value:'danger-full-access',label:'Host access'}]} onChange={value=>set('inboxSandbox',value)}/>
      <FieldDescription id="inbox-sandbox-note">For You got mail. Host access supports git-locks process control and guarded indexing. It allows writes beyond the vault; use only for trusted librarian jobs. Runtime resource limits still apply.</FieldDescription>
      </FieldGroup>
    </StatusCard>
    <Item variant="outline" size="sm" className="sticky bottom-12 z-10 bg-background">
      <ItemContent><ItemDescription>Saved on this device.</ItemDescription></ItemContent>
      <ItemActions><Button type="submit" disabled={busy||!draft.participant.trim()}>{busy?<Spinner data-icon="inline-start" aria-hidden/>:null}{busy?'Saving…':'Save preferences'}</Button></ItemActions>
    </Item>
  </form>;
}
function ReadingProgress({model,actions}:{model:Model;actions:Actions}){
  const estimate=(value:number)=>`${Math.round(value*100)}% · ${model.pdfPages===null?`${Math.ceil(model.words*(1-value)/model.pace)} min remaining`:`${plural(Math.ceil(model.pdfPages*(1-value)),'page')} remaining`}`;
  const fraction=(event:React.MouseEvent<HTMLElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return clamp((event.clientX-rect.left)/rect.width);};
  return <><Popover><PopoverTrigger nativeButton={false} render={<div/>} id="progress-slider" className="progress-slider" role="slider" tabIndex={0} aria-label="Seek reading position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(model.value*100)} aria-valuetext={estimate(model.value)} openOnHover delay={120} onClick={event=>actions.seek(fraction(event))} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Home')actions.seek(0);else if(event.key==='End')actions.seek(1);else if(model.spreads)actions.spread(model.spread+(event.key==='ArrowRight'?1:-1));else actions.seek(clamp(model.value+(event.key==='ArrowRight'?.05:-.05)));}}}>
    <Progress value={model.value*100} aria-label="Reading progress" className="reader-progress"/>
  </PopoverTrigger><PopoverContent id="progress-popover" side="top" initialFocus={false}><PopoverTitle>Reading position</PopoverTitle><PopoverDescription>{estimate(model.value)}</PopoverDescription></PopoverContent></Popover>
  <div id="progress-pips" className="progress-pips">{model.pips.map(pip=><Popover key={pip.id}><PopoverTrigger className={'progress-pip'+(pip.kind==='warning'?' warning':pip.own?' own':'')} style={{left:`${pip.fraction*100}%`}} aria-label={`${pip.owner}’s ${pip.kind==='warning'?'warning':'highlight'} at ${Math.round(pip.fraction*100)} percent`} openOnHover delay={120} onClick={()=>actions.thread(pip.id)}/><PopoverContent side="top" initialFocus={false}><PopoverTitle>{pip.owner} · {estimate(model.value)}</PopoverTitle><PopoverDescription>{pip.quote}</PopoverDescription></PopoverContent></Popover>)}</div></>;
}
function Pages({model,actions}:{model:Model;actions:Actions}){
  if(!model.spreads)return null;
  const label=(i:number)=>{const first=i*model.columns+1,last=Math.min(model.pages,first+model.columns-1);return first===last?String(first):`${first}–${last}`;};
  const indices=[...new Set([0,model.spread-1,model.spread,model.spread+1,model.spreads-1])].filter(i=>i>=0&&i<model.spreads).sort((a,b)=>a-b);
  const click=(index:number)=>(event:React.MouseEvent)=>{event.preventDefault();actions.spread(index);};
  return <Pagination aria-label="Document pages"><PaginationContent><PaginationItem><PaginationPrevious text="" size="icon-sm" href="#" aria-disabled={model.spread===0} tabIndex={model.spread===0?-1:0} onClick={click(Math.max(0,model.spread-1))}/></PaginationItem>{indices.map((i,index)=><PaginationItem key={i} className={i!==model.spread?'page-neighbor':''}>{index>0&&i>indices[index-1]+1?<PaginationEllipsis/>:null}<PaginationLink href="#" size="sm" isActive={i===model.spread} aria-label={`Pages ${label(i)}`} onClick={click(i)}>{label(i)}</PaginationLink></PaginationItem>)}<PaginationItem><PaginationNext text="" size="icon-sm" href="#" aria-disabled={model.spread===model.spreads-1} tabIndex={model.spread===model.spreads-1?-1:0} onClick={click(Math.min(model.spreads-1,model.spread+1))}/></PaginationItem></PaginationContent></Pagination>;
}
// One store shared by the global controls root and route-owned islands (Reader Admin).
let model:Model;let controlActions:Actions;
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
const snapshot=()=>model;
function update(patch:Partial<Model>){if(Object.entries(patch).every(([key,value])=>Object.is(model[key as keyof Model],value)))return;model={...model,...patch};listeners.forEach(listener=>listener());}

export {notify};
/** A failed read's reason, for an unavailable state. */
const message=(error:unknown)=>error instanceof Error?error.message:String(error);

// Maintenance jobs: poll fast while one runs, slowly otherwise, and toast each transition.
let pollTimer:ReturnType<typeof setTimeout>|undefined,polled=false;const started=new Set<string>(),finished=new Set<string>(),dismissed=new Set<string>();
const dismissAction=(id:string)=>({label:'Dismiss',onClick:()=>dismissed.add(id)});
function jobSummary(job:Job){const r=job.result||{};
  if((job.kind==='search'||job.kind==='search-keyword')&&r.complete===false&&r.message)return String(r.message);
  if(job.kind==='search'||job.kind==='search-keyword')return `${r.changed} changed, ${r.removed} removed, ${plural(r.documents,'document')} indexed.`;
  if(job.kind==='browse')return `${plural(r.changed,'navigation file')} updated for ${plural(r.works,'work')}.`;
  if(job.kind==='catalog')return `${plural(r.documents,'catalog record')} ${r.status}.`;
  if(job.kind==='links')return `${r.parsed} documents read, ${r.links} links, ${r.unresolved} unresolved.`;
  if(job.kind==='remove-legacy-search')return `Removed the format 1 index; ${Math.round(Number(r.freed_bytes)/1e6).toLocaleString()} MB freed.`;
  if(COMPANION_JOBS.has(job.kind)&&r.message)return String(r.message);
  return undefined;}
const progressShown=new Map<string,string>();
function announce(status:MaintenanceStatus){
  const run=status.running;
  if(run&&run.kind!=='check'&&!run.quiet&&!started.has(run.id)){started.add(run.id);if(!dismissed.has(run.id))toast.loading(`${run.label} running…`,{id:run.id,description:'You can keep reading. This updates when it finishes.',duration:Infinity,cancel:dismissAction(run.id)});}
  // Companion installs report each step; the loading toast follows them.
  if(run?.progress&&started.has(run.id)&&progressShown.get(run.id)!==run.progress){progressShown.set(run.id,run.progress);if(!dismissed.has(run.id))toast.loading(`${run.label} running…`,{id:run.id,description:run.progress,duration:Infinity,cancel:dismissAction(run.id)});}
  for(const job of status.jobs){
    if(finished.has(job.id))continue;finished.add(job.id);dismissed.delete(job.id);
    if(COMPANION_JOBS.has(job.kind))refreshCompanions();
    if(!polled||job.kind==='check'||job.quiet)continue;
    if(job.state==='succeeded')toast.success(`${job.label} finished`,{id:job.id,description:jobSummary(job),duration:6000});
    else toast.error(`${job.label} failed`,{id:job.id,description:job.error||undefined,duration:12000});
  }
  if(status.local_model)announceRuns(status.local_model.runs,status.local_model.labels);
  polled=true;
}
// Local-model runs: one toast per run, batched ("Standfirsts: 20 done, 2 rejected"), never one per item.
const runsSeen=new Map<string,string>();let runsPolled=false;
function announceRuns(runs:Run[],labels:Record<string,string>){
  for(const run of runs){
    const before=runsSeen.get(run.id);if(before===run.state)continue;runsSeen.set(run.id,run.state);
    if(!runsPolled&&run.state!=='running')continue;
    const id='local-model-'+run.id;
    if(run.state==='running'){if(!dismissed.has(id))toast.loading('Local model running…',{id,description:'Reader Admin, Models, shows the live output. You can keep reading.',duration:Infinity,cancel:dismissAction(id)});continue;}
    dismissed.delete(id);
    if(run.warning==='server-stopped')toast.warning('LM Studio stopped while the queue was running',{id,description:runSummary(run,labels)+'. The queue is paused; start the server and press Run to continue.',duration:15000});
    else if(run.state==='failed')toast.error('Local model run failed',{id,description:(run.error||'')+(Object.keys(run.counts).length?' · '+runSummary(run,labels):''),duration:12000});
    else toast.success(run.state==='finished'?'Local model finished':'Local model paused',{id,description:runSummary(run,labels),duration:8000});
  }
  runsPolled=true;
}
async function pollMaintenance(){
  clearTimeout(pollTimer);let status:MaintenanceStatus|null=null;
  try{status=await controlActions.api('/api/maintenance');update({maintenance:status,maintenanceError:null});announce(status!);}catch(error){update({maintenanceError:message(error)});/* The next poll retries. */}
  const fast=!!(status?.running||status?.checking||status?.local_model?.running);
  pollTimer=setTimeout(()=>{if(document.visibilityState==='visible'||fast)pollMaintenance();else document.addEventListener('visibilitychange',pollMaintenance,{once:true});},fast?1500:15000);
}
export async function startJob(kind:string){
  if(needsReader())return;   // The web demo has no server to run a job; its controls say so.
  try{const job:Job=await controlActions.api('/api/maintenance',{action:'start',kind});
    update({maintenance:model.maintenance?{...model.maintenance,running:job}:model.maintenance});
    if(job.kind!=='check'){started.add(job.id);dismissed.delete(job.id);toast.loading(`${job.label} running…`,{id:job.id,description:'You can keep reading. This updates when it finishes.',duration:Infinity,cancel:dismissAction(job.id)});}
  }catch(error){if(!(error as {offline?:boolean})?.offline)toast.error('Couldn’t start that job',{description:error instanceof Error?error.message:String(error),duration:8000});}
  pollMaintenance();
}

// Companions: optional tools, their setup jobs and the "not installed" prompt.
const COMPANION_JOBS=new Set(['install-colorful','update-colorful','install-wide-md','update-wide-md','start-ai-tts']);
export async function refreshCompanions(){
  try{update({companions:await controlActions.api('/api/companions'),companionsError:null});}catch(error){update({companionsError:message(error)});/* The card keeps its last status. */}
}
function mergeCompanion(result:CompanionsStatus){
  const current=model.companions,item=result.companions?.[0];if(!current||!item)return;
  update({companions:{...current,checked_at:result.checked_at,companions:current.companions.map(c=>c.name===item.name?item:c)}});
}
/** check, set-path (returns status) or install, update, start (returns a maintenance job, announced like any other). */
export async function companionAction(name:string,action:string,extra:Record<string,unknown>={}){
  const result=await controlActions.api('/api/companions',{action,name,...extra});
  if(result?.kind&&result?.id){
    started.add(result.id);dismissed.delete(result.id);toast.loading(`${result.label} running…`,{id:result.id,description:'Progress and the log are in Reader Admin, Service & tools.',duration:Infinity,cancel:dismissAction(result.id)});
    update({maintenance:model.maintenance?{...model.maintenance,running:result}:model.maintenance});pollMaintenance();refreshCompanions();
  }else{mergeCompanion(result);if(action==='set-path')toast.success(extra.path?'Path saved.':'Path cleared.');}
  return result;
}
/** A missing feature: a calm prompt naming what is missing, what it adds, its repo, Install when safe and Don't show again. */
export async function promptCompanion(name:string,fallback?:string){
  if(needsReader()){toast(fallback||'That feature needs Reader on your computer.',{description:NEEDS_READER+': companion tools install there.',id:'companion-'+name});return;}
  let item:Companion|undefined;
  try{item=(await controlActions.api('/api/companions?name='+encodeURIComponent(name))).companions[0];}
  catch{toast.error(fallback||'That feature is unavailable.',{duration:8000});return;}
  if(!item)return;
  if(item.state==='installed'&&!item.job){if(fallback)toast.error(fallback,{duration:8000});return;}
  if(item.job){toast(`${item.label}: ${item.job.label} is running.`,{description:item.job.progress||undefined});return;}
  const heading=item.state==='not-running'?`${item.title} isn’t running.`:`${item.feature} needs ${item.title}.`;
  if(isDismissed(name)){toast(heading,{description:'Setup is in Reader Admin, Service & tools.',id:'companion-'+name});return;}
  const setup=(panel:string)=>{focusCompanion(name,panel);controlActions.adminGo('service');};
  toast.custom(id=><CompanionPrompt item={item!} id={id} onSetup={setup}
    onInstall={()=>companionAction(name,item!.actions.includes('install')?'install':'update').catch(error=>toast.error('Couldn’t start the install',{description:error instanceof Error?error.message:String(error),duration:8000}))}/>,
    {id:'companion-'+name,duration:20000});
}

// Inbox runs: the same supervisor the Obsidian plugin starts. Poll every 2 s while one runs, 15 s otherwise
// (for the footer count), and toast each run's start and end, including runs started elsewhere.
let inboxTimer:ReturnType<typeof setTimeout>|undefined,inboxPolled=false;const runSeen=new Map<string,string>(),ownRuns=new Set<string>();
const ACTIVE=['starting','running'];
function inboxBadge(status:InboxStatus|null){
  const button=document.getElementById('settings-open'),label=button?.querySelector('span');if(!button||!label)return;
  const count=status?.arrivals.length||0;label.textContent=count?`Backstage · ${count}`:'Backstage';
  button.dataset.inbox=String(count);button.setAttribute('aria-label',`Open Reader Admin${count?`; ${count} inbox arrival${count===1?'':'s'} waiting`:''}`);
}
function announceInbox(status:InboxStatus){
  const run=status.runner;
  if(run?.run_id){
    const previous=runSeen.get(run.run_id),id='inbox-'+run.run_id;runSeen.set(run.run_id,run.status);
    if(previous!==run.status){
      if(ACTIVE.includes(run.status)){if(!previous&&!dismissed.has(id))toast.loading('The librarian is reading the mail…',{id,description:run.arrivals?`${run.arrivals} arrival${run.arrivals===1?'':'s'}. You can keep reading.`:'You can keep reading.',duration:Infinity,cancel:dismissAction(id)});}
      else if(previous&&ACTIVE.includes(previous)||ownRuns.has(run.run_id)||inboxPolled&&!previous){
        dismissed.delete(id);
        const filed=Math.max(0,(run.arrivals||0)-(run.remaining||0)),report={label:'Report',onClick:()=>controlActions.adminGo('inbox')};
        if(run.status==='finished')toast.success(`Mail filed: ${filed} arrival${filed===1?'':'s'}`,{id,description:run.commit?`Commit ${run.commit.short}. ${run.message}`:run.message,duration:12000,action:report});
        else if(run.status==='stopped'||run.status==='empty')toast(run.status==='stopped'?'Inbox run stopped':'Nothing to file',{id,description:run.message,duration:8000});
        else toast.error('The librarian couldn’t file the mail',{id,description:run.message,duration:15000,action:report});
        controlActions.libraryChanged().catch(()=>{});startJob('check');
      }
    }
  }
  inboxPolled=true;
}
// The activity transcript: /api/inbox/events pages (256 KiB each) folded into transcript items, every second
// while a run is live; one catch-up read for a finished run. Arrival titles are remembered from the inbox listing.
let activityTimer:ReturnType<typeof setTimeout>|undefined,activityBusy=false;const arrivalTitles:Record<string,string>={};
const newActivity=(runId:string|null=null):ActivityModel=>({runId,offset:0,activity:emptyActivity(),run:null,done:false});
export async function pollActivity(){
  clearTimeout(activityTimer);if(activityBusy)return;activityBusy=true;let current=model.activity;
  try{
    for(let page=0;page<64;page++){
      const after=current.offset,result=await controlActions.api('/api/inbox/events?after='+after);
      if(result.run_id!==current.runId||result.reset){current=newActivity(result.run_id);if(after>0)continue;}
      const at=Date.now(),runner=model.inbox?.runner;let activity=current.activity;
      for(const raw of result.events)activity=reduce(activity,fromCodex(raw),at);
      current={...current,offset:result.next_offset,activity,done:result.done,run:{status:result.status,startedAt:result.started_at,finishedAt:result.finished_at,
        arrivals:result.arrivals||current.run?.arrivals||[],remaining:result.remaining,titles:{...arrivalTitles},message:result.message,stderr:result.stderr_tail,
        commit:runner?.run_id===result.run_id?runner!.commit:current.run?.commit}};
      update({activity:current});
      if(result.done||result.next_offset>=result.size||result.next_offset===after)break;
    }
  }catch{/* The next poll retries. */}
  finally{activityBusy=false;}
  if(!current.done)activityTimer=setTimeout(pollActivity,1000);
}
async function pollInbox(){
  clearTimeout(inboxTimer);let status:InboxStatus|null=null;
  try{status=await controlActions.api('/api/inbox');
    for(const arrival of status!.arrivals)arrivalTitles[arrival.id]=arrival.title;
    const run=status!.runner;
    if(run?.run_id&&(run.run_id!==model.activity.runId||ACTIVE.includes(run.status)&&model.activity.done))pollActivity();
    else if(run?.commit&&model.activity.run&&model.activity.runId===run.run_id&&!model.activity.run.commit)update({activity:{...model.activity,run:{...model.activity.run,commit:run.commit}}});const own=model.inboxStarting&&ACTIVE.includes(status!.runner?.status||'')&&ownRuns.has(status!.runner!.run_id||'');update({inbox:status,inboxError:null,...(own?{inboxStarting:false}:{})});inboxBadge(status);announceInbox(status!);}catch(error){update({inboxError:message(error)});/* The next poll retries. */}
  const fast=model.inboxStarting||ACTIVE.includes(status?.runner?.status||'');
  inboxTimer=setTimeout(()=>{if(document.visibilityState==='visible'||fast)pollInbox();else document.addEventListener('visibilitychange',pollInbox,{once:true});},fast?2000:15000);
}
export async function startInbox(){
  if(model.inboxStarting||needsReader())return;update({inboxStarting:true});
  try{const result=await controlActions.api('/api/inbox',{action:'start',sandbox_mode:model.prefs.inboxSandbox==='danger-full-access'?'danger-full-access':'workspace-write'});
    ownRuns.add(result.run_id);
    const id='inbox-'+result.run_id;dismissed.delete(id);
    if(!result.state||ACTIVE.includes(result.state.status))toast.loading('The librarian is reading the mail…',{id,description:'You can keep reading. This updates when the librarian finishes.',duration:Infinity,cancel:dismissAction(id)});
  }catch(error){
    // Another tab or client may have started a run since our last poll (a 409): show that run instead of an error.
    const status:InboxStatus|null=await controlActions.api('/api/inbox').catch(()=>null);
    if(status&&ACTIVE.includes(status.runner?.status||'')){update({inbox:status});toast('The librarian is already reading the mail',{description:'Showing the run that is in progress.'});}
    else toast.error('Couldn’t start the librarian',{description:error instanceof Error?error.message:String(error),duration:10000});}
  finally{update({inboxStarting:false});}
  pollInbox();
}
export async function stopInbox(){
  try{await controlActions.api('/api/inbox',{action:'stop'});toast('Stop requested',{description:'The runner stops the librarian’s process group; partial changes stay for inspection.'});}
  catch(error){toast.error('Couldn’t stop the run',{description:error instanceof Error?error.message:String(error)});}
  pollInbox();
}

export function installControls(actions:Actions,prefs:Preferences){
  controlActions=actions;setSpeechApi(actions.api);setJobsApi(actions.api);
  model={value:0,words:0,pdfPages:null,pace:220,spread:0,spreads:0,pages:0,columns:2,theme:prefs.theme,pips:[],prefs,participants:[],themeEditorOpen:false,customThemes:[],fonts:[],maintenance:null,prose:null,chat:{open:false,path:null,title:'',participant:''},outline:{mode:null,open:false,title:'',entries:[],folded:false,railOpen:false},outlineActive:-1,inbox:null,inboxStarting:false,activity:newActivity(),localModel:null,companions:null,admin:null,maintenanceError:null,inboxError:null,localModelError:null,companionsError:null};
  function View(){const current=useSyncExternalStore(subscribe,snapshot);return <>{createPortal(<ReadingProgress model={current} actions={actions}/>,document.getElementById('progress-controls-slot')!)}{createPortal(<Pages model={current} actions={actions}/>,document.getElementById('pagination-slot')!)}{createPortal(<OutlineControl outline={current.outline} active={current.outlineActive} actions={actions}/>,document.getElementById('outline-slot')!)}{createPortal(<SpeechControl/>,document.getElementById('speech-slot')!)}{createPortal(<QuickThemePicker model={current} actions={actions}/>,document.getElementById('theme-switch-slot')!)}<ThemeEditor open={current.themeEditorOpen} onOpenChange={actions.themeEditor} onClosed={actions.themeEditorClosed} themes={current.customThemes} fonts={current.fonts} current={current.theme} api={actions.api} onChanged={actions.themesChanged} onUse={actions.useTheme} onPreviewFont={actions.previewFont} error={actions.error}/><ChatPanel open={current.chat.open} path={current.chat.path} title={current.chat.title} participant={current.chat.participant} initialId={current.chat.initialId} api={actions.api} markdown={actions.chatMarkdown} openPath={actions.openPath} onClose={()=>closeChat()} notify={notify}/><Toaster theme={dark(current.theme)?'dark':'light'} position="bottom-center" offset={{bottom:44}} mobileOffset={{bottom:56}}/></>;}
  ensureProseTokens();new MutationObserver(()=>ensureProseTokens()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  observeButtons();installCodeCopy();
  const root=createRoot(document.getElementById('reader-controls-root')!);flushSync(()=>root.render(<View/>));
  pollMaintenance();pollInbox();
  // A tab coming back into view refreshes the shared inbox state instead of waiting for its idle poll.
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pollInbox();});
  return {update};
}
/** Open the chat panel for a document; the panel keeps its stream while turns are pending. */
export function openChat(path:string,title:string,participant:string,initialId?:string){update({chat:{open:true,path,title,participant,initialId}});controlActions.chatChanged(true);requestAnimationFrame(()=>document.getElementById('chat-input')?.focus());}
export function closeChat(){if(!model.chat.open)return;update({chat:{...model.chat,open:false}});controlActions.chatChanged(false);}
export function chatOpen(){return model.chat.open;}
// Local model: poll every second while something runs (for the streaming preview), every 6 s otherwise,
// and only while Reader Admin's Models page is on screen and visible.
let localTimer:ReturnType<typeof setTimeout>|undefined,localHost:HTMLElement|null=null;
async function pollLocalModel(){
  clearTimeout(localTimer);if(!localHost?.isConnected){localHost=null;return;}
  let status:LocalModelStatus|null=null;
  try{status=await controlActions.api('/api/local-model');update({localModel:status,localModelError:null});announceRuns(status!.runs,status!.labels);}catch(error){update({localModelError:message(error)});/* The next poll retries. */}
  const fast=!!(status?.now||status?.running||status?.server.control?.state==='running');
  localTimer=setTimeout(()=>{if(document.visibilityState==='visible')pollLocalModel();else document.addEventListener('visibilitychange',pollLocalModel,{once:true});},fast?1000:6000);
}
const ACTION_DONE:Record<string,(result:any)=>string|null>={
  enqueue:r=>r.added?`Queued ${r.added} ${r.added===1?'item':'items'}${r.skipped?`; ${r.skipped} already current or waiting`:''}.`:r.skipped?`Nothing new to queue; ${r.skipped} already current or waiting.`:'No eligible works to queue.',
  clear:r=>`Cleared ${r.removed} waiting ${r.removed===1?'item':'items'}.`,prune:r=>`Removed ${r.removed} stale ${r.removed===1?'output':'outputs'}.`,
  settings:()=>'Local-model settings saved.',pause:()=>'Paused. The current item finishes first.',
};
export async function localModelAction(action:string,payload:Record<string,unknown>={}){
  try{const result=await controlActions.api('/api/local-model',{action,...payload});const message=ACTION_DONE[action]?.(result);if(message)toast.success(message);
    if(action==='run'&&result?.run)announceRuns([result.run],model.localModel?.labels||{});
    return result;}
  catch(error){toast.error('Local model: that didn’t work',{description:error instanceof Error?error.message:String(error),duration:8000});}
  finally{await pollLocalModel();}
}
/** Index freshness for Admin › Indexes: read the status and, as Behind the scenes did, run the light freshness check
 *  when the last one is over two minutes old. Never in the web demo, and never from Overview. */
async function checkIndexes(){
  if(needsReader()){if(!model.maintenance)pollMaintenance();return;}
  if(!model.maintenance)await pollMaintenance();
  const status=model.maintenance,checked=Object.values(status?.checks||{})[0]?.checked_at;
  if(status&&!status.running&&!status.checking&&(!checked||Date.now()-+new Date(checked)>120000))startJob('check');
}
function watchLocalModel(element:HTMLElement){localHost=element;pollLocalModel();}
function AdminView({library}:{library?:LibraryActions}){
  const current=useSyncExternalStore(subscribe,snapshot);
  const inbox=current.inbox,route=current.admin||{section:'overview',params:[]};
  const context:AdminContext={route,local:needsReader(),
    maintenance:current.maintenance,maintenanceError:current.maintenanceError,
    inbox,inboxError:current.inboxError,inboxStarting:current.inboxStarting,
    activity:current.activity.runId&&current.activity.runId===inbox?.runner?.run_id?current.activity:null,
    localModel:current.localModel,localModelError:current.localModelError,companions:current.companions,companionsError:current.companionsError,
    api:controlActions.api,markdown:controlActions.markdown,open:controlActions.open,
    href:controlActions.adminHref,go:controlActions.adminGo,backToLibrary:controlActions.backToLibrary,
    startJob,startInbox,stopInbox,localModelAction,companionAction,refreshCompanions,checkIndexes,watchLocalModel,
    settings:<SettingsForm model={current} actions={controlActions}/>,themeEditor:()=>controlActions.themeEditor(true),library};
  return <AdminShell context={context}/>;
}
/** Reader Admin, as a route-owned island in #main: the shell mounts once and section changes re-render it in place.
 *  Entering reads the inbox and maintenance status (reads only; no check, rebuild, model or inbox run starts here). */
export function mountAdmin(container:HTMLElement,route:AdminRoute,{library}:{library?:LibraryActions}={}){
  update({admin:route});
  mount(container,<AdminView library={library}/>);
  pollInbox();pollMaintenance();
}
/** Show another admin route in the mounted shell (Back/Forward and sidebar navigation), without remounting it. */
export function setAdminRoute(route:AdminRoute){flushSync(()=>update({admin:route}));}

// Route-owned roots are always disposed before the vanilla renderer replaces DOM.
const islands=new Map<HTMLElement,Root>();
function mount(container:HTMLElement,content:ReactNode){clearControlsWithin(container);const root=createRoot(container);islands.set(container,root);flushSync(()=>root.render(content));}
/** The search page, as a route-owned island; search-page.mjs owns its state and calls update(). */
export function mountSearchPage(container:HTMLElement,initial:SearchModel,actions:SearchActions){
  let current=initial;const watchers=new Set<()=>void>();
  const watch=(listener:()=>void)=>{watchers.add(listener);return ()=>{watchers.delete(listener);};};
  function View(){const value=useSyncExternalStore(watch,()=>current);return <SearchPage model={value} actions={actions}/>;}
  mount(container,<View/>);
  return {update(patch:Partial<SearchModel>){current={...current,...patch};watchers.forEach(listener=>listener());}};
}
/** The options job views share: the app's API, sanitized Markdown, document opening and toasts. */
export function jobViewOptions():JobViewOptions{
  return {api:controlActions.api,html:controlActions.chatMarkdown,onOpen:controlActions.openPath,notify:(message,kind)=>kind==='error'?toast.error(message):toast(message)};
}
/** Article prompt cards (RW-44): one island per wrapper app.mjs found with its render's nonce (prompt-blocks.mjs). */
export function mountPromptCards(mounts:{element:HTMLElement;block:PromptBlock}[],context:Omit<PromptContext,'options'>){
  const options=jobViewOptions();
  for(const {element,block} of mounts)mount(element,<PromptCard block={block} context={{...context,options}}/>);
}
/** Regenerate this (#147): the Prompt Input island inside the art focus view; `close` unmounts it. */
export function mountArtRegenerate(container:HTMLElement,options:ArtRegenerateOptions){
  mount(container,<ArtRegenerate {...options} close={()=>{options.close();}}/>);
  return {unmount(){clearControlsWithin(container);}};
}
export function mountDocumentTree(container:HTMLElement,rows:DocumentRow[],onOpen:(index:number)=>void,onActive:(element:HTMLElement)=>void){mount(container,<DocumentTree rows={rows} onOpen={onOpen} onActive={onActive}/>);}
/** What changed, as a Sheet island; closing unmounts it. */
export function mountChangesPanel(container:HTMLElement,options:Omit<ChangesOptions,'onClose'>){
  // Unmount after the close animation, unless a newer panel has been mounted here meanwhile.
  let root:Root|undefined;
  mount(container,<ChangesPanel key={Date.now()} {...options} onClose={()=>setTimeout(()=>{if(root&&islands.get(container)===root)clearControlsWithin(container);},250)}/>);
  root=islands.get(container);
}
/** Open an app dialog (see shell-dialog.tsx): it mounts in its own container and removes itself once closed. Opening one
    with an id that is already open closes that first. Returns {close}. */
const appDialogs=new Map<string,{close:()=>void}>();
function openAppDialog(id:string,onClosed:()=>void,render:(props:{register:(close:()=>void)=>void;onClosed:()=>void})=>ReactNode){
  appDialogs.get(id)?.close();
  const container=document.createElement('div');document.body.append(container);
  const entry={close:()=>{}};appDialogs.set(id,entry);
  const closed=()=>{if(appDialogs.get(id)===entry)appDialogs.delete(id);clearControlsWithin(container);container.remove();onClosed();};
  mount(container,render({register:close=>{entry.close=close;},onClosed:closed}));
  return {close:()=>entry.close()};
}
/** Close every open app dialog (navigation, Escape out of a context); the picker too. */
export function closeAppDialogs(){for(const entry of [...appDialogs.values()])entry.close();picker?.close();}
let picker:PickerControl|null=null;
/** Mount the Documents picker around #picker-content (once); app.mjs opens and closes it through the returned control. */
export function mountPicker(content:HTMLElement,escape:()=>boolean,onOpenChange:(open:boolean)=>void):PickerControl{
  if(picker)return picker;
  const container=document.createElement('div');document.body.append(container);
  let control:PickerControl={open:()=>{},close:()=>{},isOpen:()=>false};
  mount(container,<PickerDialog content={content} escape={escape} onOpenChange={onOpenChange} register={next=>{control=next;}}/>);
  picker={open:()=>flushSync(()=>control.open()),close:()=>control.close(),isOpen:()=>control.isOpen()};
  return picker;
}
export function openShellDialog(options:ShellDialogOptions){
  const handle=openAppDialog(options.id,options.onClosed,({register,onClosed})=><ShellDialog options={{...options,onClosed}} register={register}/>);
  return {...handle,body:()=>document.getElementById(options.bodyId)};
}
export function openAnnotationDialog(options:AnnotationOptions){
  return openAppDialog('annotation-dialog',options.onClosed,({register,onClosed})=><AnnotationDialog options={{...options,onClosed}} register={register}/>);
}
export function openScratchSave(options:ScratchSaveOptions){
  return openAppDialog('scratch-save',options.onClosed,({register,onClosed})=><ScratchSaveDialog options={{...options,onClosed}} register={register}/>);
}
export function openSpeakMenu(options:SpeakOptions){
  return openAppDialog('speak-menu',options.onClosed,({register,onClosed})=><SpeakMenu options={{...options,onClosed}} register={register}/>);
}
/** The versions timeline in #versions-body: one persistent root, re-rendered by versions.mjs; `doc` keys it so a new
    document starts with its own history disclosures. */
export function renderVersionsTimeline(container:HTMLElement,model:TimelineModel|null,doc=''){
  container.dataset.ui='shadcn';
  const root=islands.get(container),view=<VersionsTimeline key={doc} model={model}/>;
  if(root)flushSync(()=>root.render(view));else mount(container,view);
}
/** The link preview card: one persistent root in its own container; links.mjs passes null to close it. */
let linkPreviewRoot:HTMLElement|null=null;
export function renderLinkPreview(preview:LinkPreviewState,onLeave:(next:EventTarget|null)=>void){
  if(!linkPreviewRoot){linkPreviewRoot=document.createElement('div');linkPreviewRoot.id='link-preview-root';document.body.append(linkPreviewRoot);}
  const root=islands.get(linkPreviewRoot),view=<LinkPreview preview={preview} onLeave={onLeave}/>;
  if(root)flushSync(()=>root.render(view));else mount(linkPreviewRoot,view);
}
/** The reading log in an article's `.reading-log` slot: one persistent root per slot, so an open log stays open when
    app.mjs repaints it (your own read arriving, a refresh). A null model shows that the log is unavailable. */
export function renderReadingLog(container:HTMLElement,model:ReadingLogModel|null,actions:ReadingLogActions){
  container.dataset.ui='shadcn';
  const root=islands.get(container);
  if(root)flushSync(()=>root.render(<ReadingLog model={model} actions={actions}/>));else mount(container,<ReadingLog model={model} actions={actions}/>);
}
/** The reading queue panel: one persistent root, re-rendered with fresh props from queue.mjs. */
export function renderQueuePanel(container:HTMLElement,props:QueueProps){
  const root=islands.get(container);
  if(root)flushSync(()=>root.render(<QueuePanel {...props}/>));else mount(container,<QueuePanel {...props}/>);
}
export function revealDocumentRow(container:HTMLElement,path:string){revealDocumentNode(container,path,flushSync);}
export function clearControlsWithin(container:HTMLElement){for(const [element,root] of islands){if(element===container||container.contains(element)){root.unmount();islands.delete(element);}}container.removeAttribute('aria-busy');}
export function mountSkeleton(container:HTMLElement,kind='document'){
  mount(container,<div className={'reader-skeleton '+kind} role="status" aria-label={kind==='search'?'Searching documents':'Loading '+kind}><span className="sr-only">{kind==='search'?'Searching documents…':'Loading '+kind+'…'}</span><Skeleton className="h-5 w-28"/><Skeleton className="h-12 w-3/4"/><div className="grid gap-4">{Array.from({length:kind==='search'?3:8},(_,i)=><Skeleton key={i} className={i%3===2?'h-4 w-3/4':'h-4 w-full'}/>)}</div></div>);container.setAttribute('aria-busy','true');
}
/** Fenced code in a rendered container becomes the shadcn Code Block (see code-blocks.ts). */
export function mountCodeBlocks(container:HTMLElement,options?:CodeBlockOptions){decorateCodeBlocks(container,options);}
