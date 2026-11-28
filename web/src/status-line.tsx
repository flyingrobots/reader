/* The status line along the bottom of every page. Plain JavaScript owns what it says and tells this store (setStatus);
   an item with nothing to say is not in the document. Its items are the direct children of #statusline, each declaring
   data-status-priority: status-priority.mjs measures them and gives way by rank. Keep that shape when adding one. */
import {Fragment, useMemo, useSyncExternalStore, type ReactElement, type ReactNode} from 'react';
import {GitBranchIcon, SettingsIcon} from 'lucide-react';
import {Badge} from './components/ui/badge';
import {Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator} from './components/ui/breadcrumb';
import {Button} from './components/ui/button';
import {DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger} from './components/ui/dropdown-menu';
import {InputGroup, InputGroupAddon, InputGroupInput, InputGroupText} from './components/ui/input-group';
import {Kbd} from './components/ui/kbd';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from './components/ui/tooltip';
import {CircleMark} from './circle-mark';
import {useSpeaking, SpeechControl} from './speech-control';
import {cn} from 'cn';
import {Card} from './components/ui/card';
import {MobileDock, ColorControl} from './mobile-dock';

type Crumb={label?:string;title?:string;folder?:string;current?:boolean;collapsed?:boolean};
export type StatusTrail={items:Crumb[];hidden:{label:string;folder:string}[];path:string|null};
export type StatusModel={mode:string;modeLive:string;keys:string;lastKey:string;keySuggestions:string;position:string;section:string;trail:StatusTrail;reading:boolean;command:boolean;pending:string;
  search:{query:string;at:number;total:number}|null;split:{label:string;title:string}|null;prose:{label:string;intensity:string}|null;quickfix:string;
  version:{text:string;newer:boolean;historical:boolean;title:string;label:string}|null;layout:string;inbox:number};
export type StatusActions={home:()=>void;quickfix:()=>void;versions:()=>void;layoutSwap:()=>void;backstage:()=>void;openFolder:(folder:string)=>void;statusChanged:()=>void;dockTool:(tool:string)=>void;dockSave:(slots:string[])=>void;proseSet:(value:string)=>void};

let status:StatusModel={mode:'NORMAL',modeLive:'',keys:'<kbd>Space e</kbd> files <kbd>/</kbd> find <kbd>?</kbd> keys',lastKey:'',keySuggestions:'',position:'',section:'',trail:{items:[],hidden:[],path:null},reading:false,command:false,pending:'',
  search:null,split:null,prose:null,quickfix:'',version:null,layout:'scroll',inbox:0};
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
export const getStatus=()=>status;
export function setStatus(patch:Partial<StatusModel>){if(Object.entries(patch).every(([key,value])=>Object.is(status[key as keyof StatusModel],value)))return;status={...status,...patch};listeners.forEach(listener=>listener());}

/** The hints arrive as `<kbd>j k</kbd> move`, from the keymap's table and the app's modes. */
function hints(keys:string){
  const template=document.createElement('template');template.innerHTML=keys;
  return [...template.content.childNodes].map((node,index)=>node.nodeName==='KBD'?<Kbd key={index} className="h-4 min-w-4 text-[9px]">{node.textContent}</Kbd>:<Fragment key={index}>{node.textContent}</Fragment>);
}
// The line's own density: a shadcn Badge at the size of the text around it.
const DENSE='text-[10px] max-[700px]:px-1.5 max-[700px]:text-xs';
const Tip=({label,children}:{label:string;children:ReactElement})=><Tooltip><TooltipTrigger render={children}/><TooltipContent>{label}</TooltipContent></Tooltip>;

function Trail({trail,actions}:{trail:StatusTrail;actions:StatusActions}){
  return <Breadcrumb id="status-location" data-status-priority="1" className="status-location" aria-label="Document breadcrumb"
    // Native button activation takes priority over Vim motions here.
    onKeyDown={event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();}}>
    <BreadcrumbList className="m-0 list-none flex-nowrap gap-1 p-0 text-[10px] whitespace-nowrap max-[700px]:text-xs">{trail.items.map((item,index)=><Fragment key={item.folder||item.label||'more'}>
      {index?<BreadcrumbSeparator/>:null}
      <BreadcrumbItem className={cn('min-w-0',item.current&&'breadcrumb-current flex-auto')}>
        {item.collapsed?<DropdownMenu onOpenChange={()=>queueMicrotask(actions.statusChanged)}>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Show parent folders"/>}><BreadcrumbEllipsis/></DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={12} className="w-auto max-w-[min(360px,calc(100vw-16px))]"><DropdownMenuGroup>{trail.hidden.map(parent=><DropdownMenuItem key={parent.folder} title={parent.folder} onClick={()=>actions.openFolder(parent.folder)}>{parent.label}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
        :item.current?<BreadcrumbPage title={item.title||trail.path||'Library'} className="block max-w-[30ch] truncate">{item.label}</BreadcrumbPage>
        :<BreadcrumbLink render={<button type="button" title={item.folder}/>} className="block max-w-[14ch] truncate" onClick={()=>actions.openFolder(item.folder!)}>{item.label}</BreadcrumbLink>}
      </BreadcrumbItem></Fragment>)}</BreadcrumbList>
  </Breadcrumb>;
}
function SpeechSlot(){return useSpeaking()?<span id="speech-slot" data-status-priority="2"><SpeechControl/></span>:null;}

export function StatusLine({actions,progress,pages,outline,width,theme,dock}:{actions:StatusActions;progress:ReactNode;pages:ReactNode;outline:ReactNode;width:ReactNode;theme:ReactNode;dock?:unknown}){
  const s=useSyncExternalStore(subscribe,getStatus),keys=useMemo(()=>hints(s.keys),[s.keys]),spread=s.layout==='spread',waiting=s.inbox;
  return <TooltipProvider delay={300}>
    {s.reading?<nav id="reading-progress" data-status-priority="1" className="reading-progress" aria-label="Reading position"><div id="progress-controls-slot">{progress}</div></nav>:null}
    <div id="key-feedback" data-status-priority="3" className="relative flex items-center gap-1" aria-label="Keyboard feedback">
      {s.lastKey?<Kbd title="Last recognized key">{s.lastKey}</Kbd>:null}
      {s.pending?<Kbd id="status-pending" aria-label="Current chord">{s.pending}</Kbd>:null}
      <span id="key-suggestions-live" className="sr-only" aria-live="polite" aria-atomic="true">{s.pending?hints(s.keySuggestions):null}</span>
      {s.pending&&s.keySuggestions?<Card id="key-suggestions" className="absolute bottom-full left-0 mb-8 max-h-64 w-72 flex-row flex-wrap items-center gap-2 overflow-auto p-3" aria-label="Next keys">{hints(s.keySuggestions)}</Card>:null}
    </div>
    <span id="vim-mode" data-status-priority="1" hidden aria-hidden="true">{s.mode}</span>
    <Tip label="Back to library"><Button id="reader-home" data-status-priority="1" variant="ghost" size="icon-sm" className="reader-home" aria-label="Back to library" onClick={actions.home}><CircleMark/></Button></Tip>
    {s.split?<Badge id="split-indicator" data-status-priority="1" variant="outline" className={cn('text-primary',DENSE)} role="status" title={s.split.title}>{s.split.label}</Badge>:null}
    <span id="mode-live" data-status-priority="1" className="sr-only" aria-live="polite">{s.modeLive}</span>
    {s.command?<form id="command-line" data-status-priority="1" className="command-line" role="search" aria-label="Command line">
      <InputGroup className="h-7 min-w-0 flex-auto"><InputGroupAddon><InputGroupText aria-hidden="true" className="font-mono text-primary">:</InputGroupText></InputGroupAddon><InputGroupInput id="command-input" className="font-mono" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="Command"/></InputGroup>
      <div id="command-menu" className="command-menu" role="listbox" aria-label="Command suggestions"/>
    </form>:null}
    {s.search?<Badge id="search-chip" data-status-priority="2" variant="outline" className={cn('search-chip',DENSE)} role="status">From search: <q>{s.search.query}</q> · {s.search.total?s.search.at+1:0} of {s.search.total}<span className="search-chip-hint"> · Esc to clear</span></Badge>:null}
    {s.trail.items.length?<Trail trail={s.trail} actions={actions}/>:null}
    <span id="status-keys" data-status-priority="7" className="status-keys">{keys}</span>
    {pages?<div id="pagination-slot" data-status-priority="2">{pages}</div>:null}
    {s.quickfix?<Tip label="Location list · :copen"><Button id="status-qf" data-status-priority="2" variant="ghost" size="xs" className="status-button status-qf" onClick={actions.quickfix}>{s.quickfix}</Button></Tip>:null}
    <Badge id="status-section" data-status-priority="6" variant="ghost" className={cn('status-section block leading-4',DENSE)} aria-label="Current section" title={s.section||undefined}>{s.section}</Badge>
    <Badge id="status-position" data-status-priority="5" variant="ghost" className={cn('status-position',DENSE)}>{s.position}</Badge>
    {s.prose?<span id="prose-chip" aria-label={'Prose colors: '+s.prose.label} data-status-priority="4" data-intensity={s.prose.intensity}><ColorControl intensity={s.prose.intensity} onChange={actions.proseSet}/></span>:null}
    {outline?<span id="outline-slot" data-status-priority="3">{outline}</span>:null}
    <SpeechSlot/>
    {s.version?<Tip label={s.version.title}><Button id="status-version" data-status-priority="2" variant="ghost" size="xs" className={cn('status-button status-version',s.version.newer&&'newer',s.version.historical&&'historical')} aria-label={s.version.label} onClick={actions.versions}><GitBranchIcon data-icon="inline-start" aria-hidden/><span>{s.version.text}</span></Button></Tip>:null}
    {width?<div id="article-width-slot" data-status-priority="4">{width}</div>:null}
    <Tip label="Reading layout"><Button id="layout-swap" data-status-priority="2" variant="ghost" size="xs" className="status-button" aria-label={spread?'Switch to Scroll layout':'Switch to Pages layout'} onClick={actions.layoutSwap}>{spread?'Scroll':'Pages'}</Button></Tip>
    <span id="theme-switch-slot" data-status-priority="1">{theme}</span>
    <Tip label="Behind the scenes: indexes and settings · Space p"><Button id="settings-open" data-status-priority="1" variant="ghost" size="xs" className="status-button" data-inbox={String(waiting)} aria-label={`Open Reader Admin${waiting?`; ${waiting} inbox arrival${waiting===1?'':'s'} waiting`:''}`} onClick={actions.backstage}><SettingsIcon data-icon="inline-start" aria-hidden/><span>{waiting?`Backstage · ${waiting}`:'Backstage'}</span></Button></Tip>
    <MobileDock slots={dock} reading={s.reading} chatAvailable={s.reading||!!(s.split&&s.trail.path?.startsWith('library/'))} prose={s.prose} run={actions.dockTool} save={actions.dockSave} setProse={actions.proseSet}/>
  </TooltipProvider>;
}
