/* The reading queue: Up next (now reading, your queue, suggestions) and History.
   A view only. queue.mjs owns state, requests and keys, and passes flat, indexed rows. */
import {XIcon, PlusIcon, CheckIcon} from 'lucide-react';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';
import {Tabs, TabsList, TabsTrigger, TabsContent} from './components/ui/tabs';

export type QueueRow={index:number;path:string;title:string;byline:string;read:boolean;time:string;progress:number|null;finished:boolean;reason?:string;voice?:string;changed?:boolean;when?:string;kind:'now'|'queued'|'suggested'|'history';position?:number;resume?:boolean};
export type QueueSection={id:string;label:string;count?:number;action?:{label:string;onClick:()=>void};rows:QueueRow[];empty?:string};
export type QueueProps={
  tab:'next'|'history';active:number;loading:boolean;
  next:QueueSection[];history:QueueSection[];historyEmpty:string|null;historyMore:boolean;queuedCount:number;
  filter:'all'|'finished';confirm:{message:string;action:string}|null;
  onTab:(tab:'next'|'history')=>void;onFilter:(filter:'all'|'finished')=>void;onOpen:(index:number)=>void;onActive:(index:number)=>void;
  onRemove:(index:number)=>void;onPin:(index:number)=>void;onMore:()=>void;onConfirm:(yes:boolean)=>void;onClose:()=>void;
};

function Row({row,props,tab}:{row:QueueRow;props:QueueProps;tab:string}){
  const active=row.index===props.active;
  const lead=row.kind==='history'?(row.finished?'✓':row.progress!==null&&row.progress>.01?'◐':'·'):row.kind==='queued'?String(row.position).padStart(2,'0'):row.kind==='now'?'▶':'·';
  return <div role="option" id={`queue-${tab}-${row.index}`} aria-selected={active} data-active={active||undefined} data-kind={row.kind} data-path={row.path}
    className="queue-row" onMouseEnter={()=>props.onActive(row.index)} onClick={()=>props.onOpen(row.index)}>
    <span className="queue-lead" aria-hidden="true">{lead}</span>
    <span className="queue-main">
      <span className="queue-title">{row.title}{!row.read?<span className="unread-pip" title="Unread edition" aria-label="Unread edition"/>:null}</span>
      <span className="queue-byline">{row.byline}</span>
      {row.reason?<span className="queue-reason">{row.voice?<Badge variant="outline" className="queue-voice">{row.voice}</Badge>:null}<span>{row.reason}</span></span>:null}
      {row.kind==='now'&&row.progress!==null?<span className="queue-progress" aria-hidden="true"><span style={{width:`${Math.round(row.progress*100)}%`}}/></span>:null}
    </span>
    <span className="queue-side">
      {row.when?<span className="queue-when">{row.when}</span>:null}
      <span className="queue-side-row">
        <span className="queue-time">{row.finished?<><CheckIcon aria-hidden="true" className="size-3"/> Finished</>:row.time}</span>
        {row.changed?<Badge variant="outline" className="queue-changed" title="This document changed since you last opened it">Changed</Badge>:null}
        {row.kind==='suggested'?<Button variant="ghost" size="xs" tabIndex={-1} className="queue-action" aria-label={`Add ${row.title} to your queue`} onClick={event=>{event.stopPropagation();props.onPin(row.index);}}><PlusIcon data-icon="inline-start"/>Queue</Button>:null}
        {row.kind==='queued'||row.kind==='history'?<Button variant="ghost" size="icon-xs" tabIndex={-1} className="queue-action" aria-label={row.kind==='history'?`Remove ${row.title} from history`:`Remove ${row.title} from your queue`} onClick={event=>{event.stopPropagation();props.onRemove(row.index);}}><XIcon/></Button>:null}
      </span>
    </span>
  </div>;
}
function Sections({sections,props,tab,empty}:{sections:QueueSection[];props:QueueProps;tab:string;empty?:string|null}){
  return <div role="listbox" id={'queue-list-'+tab} className="queue-list" tabIndex={0} aria-label={tab==='next'?'Up next':'History'} aria-activedescendant={empty?undefined:`queue-${tab}-${props.active}`}>
    {empty?<p className="queue-empty">{empty}</p>:null}
    {sections.map(section=><div key={section.id} role="group" aria-labelledby={'queue-section-'+section.id} className="queue-section" data-section={section.id}>
      <div className="queue-section-head"><span id={'queue-section-'+section.id} className="eyebrow">{section.label}{section.count!==undefined?<span className="queue-count"> · {section.count}</span>:null}</span>
        {section.action?<Button variant="ghost" size="xs" tabIndex={-1} onClick={section.action.onClick}>{section.action.label}</Button>:null}</div>
      {section.rows.length?section.rows.map(row=><Row key={row.kind+row.path} row={row} props={props} tab={tab}/>):section.empty?<p className="queue-empty">{section.empty}</p>:null}
    </div>)}
  </div>;
}
export function QueuePanel(props:QueueProps){
  return <div className="queue-inner">
    <div className="queue-top"><h2 id="queue-title">Reading queue</h2><Button variant="ghost" size="icon-sm" className="close-button" aria-label="Close the reading queue" onClick={props.onClose}><XIcon/></Button></div>
    <Tabs value={props.tab} onValueChange={value=>props.onTab(value as 'next'|'history')} className="queue-tabs">
      <TabsList className="queue-tablist"><TabsTrigger value="next" id="queue-tab-next">Up next{props.queuedCount?<span className="queue-tab-count">{props.queuedCount}</span>:null}</TabsTrigger><TabsTrigger value="history" id="queue-tab-history">History</TabsTrigger></TabsList>
      {props.confirm?<div className="queue-confirm" role="alertdialog" aria-label="Confirm" aria-describedby="queue-confirm-text"><p id="queue-confirm-text">{props.confirm.message}</p>
        <ButtonGroup><Button size="sm" variant="destructive" id="queue-confirm-yes" onClick={()=>props.onConfirm(true)}>{props.confirm.action}</Button><Button size="sm" variant="outline" onClick={()=>props.onConfirm(false)}>Keep</Button></ButtonGroup></div>:null}
      <TabsContent value="next" className="queue-content"><Sections sections={props.next} props={props} tab="next" empty={props.loading&&!props.next.length?'Lining up…':null}/></TabsContent>
      <TabsContent value="history" className="queue-content">
        <div className="queue-filter"><ButtonGroup aria-label="Show"><Button size="xs" variant="outline" aria-pressed={props.filter==='all'} onClick={()=>props.onFilter('all')}>All opens</Button><Button size="xs" variant="outline" aria-pressed={props.filter==='finished'} onClick={()=>props.onFilter('finished')}>Finished</Button></ButtonGroup></div>
        <Sections sections={props.historyEmpty?[]:props.history} props={props} tab="history" empty={props.historyEmpty}/>
        {props.historyMore?<div className="queue-more"><Button size="sm" variant="ghost" onClick={props.onMore}>Show earlier</Button></div>:null}
      </TabsContent>
    </Tabs>
    <div className="queue-keys" aria-hidden="true">{props.tab==='next'
      ?<><span><kbd>j k</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>J K</kbd> reorder</span><span><kbd>p</kbd> queue it</span><span><kbd>x</kbd> remove</span><span><kbd>c</kbd> clear</span><span><kbd>Tab</kbd> history</span></>
      :<><span><kbd>j k</kbd> move</span><span><kbd>↵</kbd> resume</span><span><kbd>f</kbd> finished</span><span><kbd>x</kbd> remove</span><span><kbd>Tab</kbd> up next</span></>}</div>
  </div>;
}
