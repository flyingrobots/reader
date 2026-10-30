/* The reading queue: Up next (now reading, your queue, suggestions) and History.
   A view only. queue.mjs owns state, requests and keys, and passes flat, indexed rows. Design sheet:
   docs/ui-design/queue.md. Rows are shadcn Items in an aria-activedescendant listbox, so j/k move without moving focus. */
import {CheckIcon, CircleCheckIcon, CircleDashedIcon, CircleDotIcon, CircleIcon, PlayIcon, PlusIcon, XIcon} from 'lucide-react';
import {Alert, AlertDescription} from './components/ui/alert';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from './components/ui/item';
import {Kbd, KbdGroup} from './components/ui/kbd';
import {Progress} from './components/ui/progress';
import {Tabs, TabsList, TabsTrigger, TabsContent} from './components/ui/tabs';
import {ToggleGroup, ToggleGroupItem} from './components/ui/toggle-group';
import {localOnly} from './static-demo';

export type QueueRow={index:number;path:string;title:string;byline:string;read:boolean;time:string;progress:number|null;finished:boolean;reason?:string;voice?:string;changed?:boolean;when?:string;kind:'now'|'queued'|'suggested'|'history';position?:number;resume?:boolean};
export type QueueSection={id:string;label:string;count?:number;action?:{label:string;onClick:()=>void};rows:QueueRow[];empty?:string};
export type QueueProps={
  tab:'next'|'history';active:number;loading:boolean;
  next:QueueSection[];history:QueueSection[];historyEmpty:string|null;historyMore:boolean;queuedCount:number;
  filter:'all'|'finished';confirm:{message:string;action:string}|null;
  onTab:(tab:'next'|'history')=>void;onFilter:(filter:'all'|'finished')=>void;onOpen:(index:number)=>void;onActive:(index:number)=>void;
  onRemove:(index:number)=>void;onPin:(index:number)=>void;onMore:()=>void;onConfirm:(yes:boolean)=>void;onClose:()=>void;
};

/** The row's state as an icon: now reading, its queue position, finished, started, or not yet opened. */
function Lead({row}:{row:QueueRow}){
  if(row.kind==='queued')return <span className="w-5 text-center font-mono text-xs text-muted-foreground tabular-nums">{String(row.position).padStart(2,'0')}</span>;
  const Icon=row.kind==='now'?PlayIcon:row.kind==='history'?(row.finished?CircleCheckIcon:row.progress!==null&&row.progress>.01?CircleDashedIcon:CircleIcon):CircleDotIcon;
  return <Icon className={row.kind==='now'||row.finished?'text-primary':'text-muted-foreground'}/>;
}
function Row({row,props,tab}:{row:QueueRow;props:QueueProps;tab:string}){
  const active=row.index===props.active;
  return <Item role="option" size="sm" variant={active?'muted':'default'} id={`queue-${tab}-${row.index}`} aria-selected={active} data-active={active||undefined} data-kind={row.kind} data-path={row.path} data-queue-row=""
    className="cursor-pointer items-start" onMouseEnter={()=>props.onActive(row.index)} onClick={()=>props.onOpen(row.index)}>
    <ItemMedia variant="icon" aria-hidden="true" className="mt-0.5">{<Lead row={row}/>}</ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle data-queue-title="" className="line-clamp-2 font-serif text-[15px] font-normal">{row.title}{!row.read?<span className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" title="Unread edition" aria-label="Unread edition"/>:null}</ItemTitle>
      <ItemDescription className="text-xs" data-queue-byline="">{row.byline}</ItemDescription>
      {row.reason?<ItemDescription className="line-clamp-none text-xs" data-queue-reason="">{row.voice?<Badge variant="outline" className="mr-1">{row.voice}</Badge>:null}{row.reason}</ItemDescription>:null}
      {row.kind==='now'&&row.progress!==null?<Progress value={Math.round(row.progress*100)} aria-label="Reading progress" className="mt-1"/>:null}
    </ItemContent>
    <ItemActions className="flex-col items-end gap-1">
      {row.when?<span className="text-xs text-muted-foreground" data-queue-when="">{row.when}</span>:null}
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums" data-queue-time="">{row.finished?<><CheckIcon aria-hidden="true" className="size-3"/> Finished</>:row.time}</span>
        {row.changed?<Badge variant="outline" title="This document changed since you last opened it">Changed</Badge>:null}
        {row.kind==='suggested'?<Button variant="ghost" size="xs" tabIndex={-1} data-queue-action="" aria-label={`Add ${row.title} to your queue`} {...localOnly()} onClick={event=>{event.stopPropagation();props.onPin(row.index);}}><PlusIcon data-icon="inline-start"/>Queue</Button>:null}
        {row.kind==='queued'||row.kind==='history'?<Button variant="ghost" size="icon-xs" tabIndex={-1} data-queue-action="" aria-label={row.kind==='history'?`Remove ${row.title} from history`:`Remove ${row.title} from your queue`} {...(row.kind==='queued'?localOnly():{})} onClick={event=>{event.stopPropagation();props.onRemove(row.index);}}><XIcon/></Button>:null}
      </span>
    </ItemActions>
  </Item>;
}
const Quiet=({children}:{children:React.ReactNode})=><p data-slot="queue-empty" className="px-3 py-4 text-sm text-muted-foreground" data-queue-empty="">{children}</p>;
function Sections({sections,props,tab,empty}:{sections:QueueSection[];props:QueueProps;tab:string;empty?:string|null}){
  return <div role="listbox" data-queue-list="" id={'queue-list-'+tab} className="flex flex-col gap-4 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" tabIndex={0} aria-label={tab==='next'?'Up next':'History'} aria-activedescendant={empty?undefined:`queue-${tab}-${props.active}`}>
    {empty?<Quiet>{empty}</Quiet>:null}
    {sections.map(section=><div key={section.id} role="group" aria-labelledby={'queue-section-'+section.id} className="flex flex-col gap-1" data-section={section.id}>
      <div className="flex items-center justify-between gap-2 px-3"><span id={'queue-section-'+section.id} data-section-label="" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{section.label}{section.count!==undefined?<span className="tabular-nums"> · {section.count}</span>:null}</span>
        {section.action?<Button variant="ghost" size="xs" tabIndex={-1} {...(section.id==='queued'?localOnly():{})} onClick={section.action.onClick}>{section.action.label}</Button>:null}</div>
      {section.rows.length?section.rows.map(row=><Row key={row.kind+row.path} row={row} props={props} tab={tab}/>):section.empty?<Quiet>{section.empty}</Quiet>:null}
    </div>)}
  </div>;
}
const Keys=({keys}:{keys:[string,string][]})=><div className="flex flex-wrap gap-x-3 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground" aria-hidden="true" data-queue-keys="">
  {keys.map(([key,what])=><span key={what} className="inline-flex items-center gap-1"><KbdGroup>{key.split(' ').map(k=><Kbd key={k}>{k}</Kbd>)}</KbdGroup>{what}</span>)}</div>;
export function QueuePanel(props:QueueProps){
  return <div className="flex h-full min-h-0 flex-col font-sans" data-ui="shadcn">
    <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2"><h2 id="queue-title" data-slot="panel-title" className="font-serif text-xl font-normal">Reading queue</h2><Button variant="ghost" size="icon-sm" aria-label="Close the reading queue" onClick={props.onClose}><XIcon/></Button></div>
    <Tabs value={props.tab} onValueChange={value=>props.onTab(value as 'next'|'history')} className="min-h-0 flex-1 gap-3 px-2">
      <TabsList className="mx-2 w-auto"><TabsTrigger value="next" id="queue-tab-next">Up next{props.queuedCount?<Badge variant="secondary" className="ml-1">{props.queuedCount}</Badge>:null}</TabsTrigger><TabsTrigger value="history" id="queue-tab-history">History</TabsTrigger></TabsList>
      {props.confirm?<Alert role="alertdialog" aria-label="Confirm" aria-describedby="queue-confirm-text" data-queue-confirm="" className="mx-2 w-auto">
        <AlertDescription className="flex flex-col gap-2 text-foreground"><span id="queue-confirm-text">{props.confirm.message}</span>
          <ButtonGroup><Button size="sm" variant="destructive" id="queue-confirm-yes" onClick={()=>props.onConfirm(true)}>{props.confirm.action}</Button><Button size="sm" variant="outline" onClick={()=>props.onConfirm(false)}>Keep</Button></ButtonGroup></AlertDescription></Alert>:null}
      <TabsContent value="next" className="min-h-0 overflow-y-auto pb-2"><Sections sections={props.next} props={props} tab="next" empty={props.loading&&!props.next.length?'Lining up…':null}/></TabsContent>
      <TabsContent value="history" className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-2">
        <ToggleGroup variant="outline" size="sm" aria-label="Show" className="mx-2" data-queue-filter="" value={[props.filter]} onValueChange={values=>{if(values[0])props.onFilter(values[0] as 'all'|'finished');}}>
          <ToggleGroupItem value="all">All opens</ToggleGroupItem><ToggleGroupItem value="finished">Finished</ToggleGroupItem></ToggleGroup>
        <Sections sections={props.historyEmpty?[]:props.history} props={props} tab="history" empty={props.historyEmpty}/>
        {props.historyMore?<Button size="sm" variant="ghost" className="self-center" onClick={props.onMore}>Show earlier</Button>:null}
      </TabsContent>
    </Tabs>
    <Keys keys={props.tab==='next'?[['j k','move'],['↵','open'],['J K','reorder'],['p','queue it'],['x','remove'],['c','clear'],['Tab','history']]:[['j k','move'],['↵','resume'],['f','finished'],['x','remove'],['Tab','up next']]}/>
  </div>;
}
