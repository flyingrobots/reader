/* The reader's own lists around a document: its outline rail, Read next and Linked from. app.mjs and links.mjs own their state and wiring;
   these only draw them, keeping the class names their rules, keys and tests use. */
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {Item, ItemDescription, ItemFooter, ItemGroup, ItemTitle} from './components/ui/item';

export type OutlineRailEntry={href:string;title:string;depth:number};
export type OutlineRailModel={entries:OutlineRailEntry[];levels:string|null;onGo?:(index:number)=>void;onLevels?:()=>void};
export function OutlineRail({entries,levels,onGo,onLevels}:OutlineRailModel){
  return <>
    <ItemTitle className="outline-head">Contents</ItemTitle>
    <ol className="outline-list">{entries.map((entry,index)=><Item key={index} render={<li/>} size="xs" className="block gap-0 rounded-none border-0 p-0" data-depth={entry.depth}>
      <Button variant="ghost" size="xs" nativeButton={false} className="h-auto w-full justify-start rounded-none whitespace-normal" onClick={event=>{event.preventDefault();onGo?.(index);}} render={<a href={entry.href} data-outline-index={index}/>}>{entry.title}</Button>
    </Item>)}</ol>
    {levels?<Button variant="ghost" size="xs" className="outline-levels" onClick={onLevels}>{levels}</Button>:null}
  </>;
}

export type NextRead={path:string;href:string;title:string;unread:boolean;byline:string;reasons:string[]};
export type NextReadsModel={queued:(NextRead&{label:string})|null;items:NextRead[]};
const Unread=()=><Badge className="unread-pip size-1.5 p-0" title="Unread edition" aria-label="Unread edition"/>;
function ReadLink({read,lead}:{read:NextRead;lead?:string}){
  return <Item size="sm" className={lead?'next-read next-in-queue':'next-read'} render={<a href={read.href} data-path={read.path}/>}>
    {lead?<ItemDescription className="next-in-queue-label">{lead}</ItemDescription>:null}
    <ItemTitle className="next-read-title line-clamp-none block">{read.title}{read.unread?<Unread/>:null}</ItemTitle>
    <ItemDescription className="next-read-byline">{read.byline}</ItemDescription>
    {read.reasons.length?<ItemFooter className="next-read-reasons">{read.reasons.map(reason=><Badge key={reason} variant="outline">{reason}</Badge>)}</ItemFooter>:null}
  </Item>;
}
export function NextReads({queued,items}:NextReadsModel){
  return <>
    {queued?<ReadLink read={queued} lead={queued.label}/>:null}
    {items.length?<><ItemTitle className="eyebrow" id="next-reads-title">Read next</ItemTitle>
      <ItemGroup role="list" className="gap-[.2em]">{items.map(read=><Item key={read.path} role="listitem" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1.5 rounded-none border-0 p-0"><ReadLink read={read}/>
        <Button variant="ghost" size="xs" className="next-read-queue" data-queue-add={read.path} aria-label={`Add ${read.title} to your queue`} title="Add to your queue · q">+ Queue</Button></Item>)}</ItemGroup></>:null}
  </>;
}

export type LinkedFromRow={source:string;href:string;fragment:string;title:string;meta:string};
export function LinkedFromList({rows}:{rows:LinkedFromRow[]}){
  return <ItemGroup className="linked-from-list" role="list">{rows.map(row=><Item key={row.source} role="listitem" size="sm" className="linked-from-row" render={<a href={row.href} data-source={row.source} data-fragment={row.fragment}/>}>
    <ItemTitle className="linked-from-title line-clamp-none block">{row.title}</ItemTitle><ItemDescription className="linked-from-meta">{row.meta}</ItemDescription>
  </Item>)}</ItemGroup>;
}
export function LinkedFromHead({count}:{count:number}){
  return <ItemTitle className="eyebrow" id="linked-from-title">Linked from{count?<Badge variant="secondary" className="linked-from-count tabular-nums">{count}</Badge>:null}</ItemTitle>;
}
