/* The reading log under a document title: who read this edition or an earlier one, and when. One collapsed line names
   up to four readers; opening it lists them by edition, with task agents folded into their own disclosure. The model is
   computed by web_ui/reading-log.mjs (readingLogModel); app.mjs renders it into the article's `.reading-log` slot. */
import {ChevronDownIcon} from 'lucide-react';
import {cn} from 'cn';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Item, ItemContent, ItemGroup, ItemTitle} from '@/components/ui/item';

type Row={participant:string;label:string;group:string;state:'current'|'earlier';at:string;when:string;stamp:string;threads:number;against:string|null};
type Entry={folded:number;text:string}|{state:'current'|'earlier';mark:string;label:string;earlier:boolean;when:string;stamp:string};
export type ReadingLogModel={empty:boolean;entries:Entry[];more:number;summary:string;groups:{state:string;title:string;mark:string;rows:Row[]}[];
  agents:{title:string;hint:string;rows:Row[]}|null;quizzes:string[];writing:{path:string;label:string}[]};
export type ReadingLogActions={threads:(participant:string)=>void;open:(path:string,split:boolean)=>void;layout:()=>void};

const MARK={current:'◉',earlier:'◐'};
const Mark=({state}:{state:'current'|'earlier'})=><span aria-hidden data-reading-log-mark="" className={cn(state==='current'?'text-primary':'text-muted-foreground')}>{MARK[state]}</span>;
// Opening a disclosure changes the article's height: scroll progress and margin pins measure again after it renders.
const relayout=(actions:ReadingLogActions)=>requestAnimationFrame(actions.layout);

function Rows({rows,actions}:{rows:Row[];actions:ReadingLogActions}){
  return <ItemGroup role="list" className="gap-0">{rows.map(row=><Item key={row.participant+row.state} role="listitem" size="xs" className="min-h-0 rounded-none border-0 border-t border-border px-0 py-1"
    data-reading-log-row="" data-state={row.state} data-group={row.group} data-against={row.against??undefined}>
    <Mark state={row.state}/>
    <ItemContent className="block min-w-0"><ItemTitle data-reading-log-name="" className="inline text-xs font-normal text-foreground [overflow-wrap:anywhere]">{row.label}</ItemTitle>
      <time dateTime={row.at} title={row.stamp} className="ml-2.5 text-xs text-muted-foreground tabular-nums">{row.when}</time></ItemContent>
    {row.threads?<Button variant="link" size="xs" className="ml-auto h-auto px-0" data-reader-threads={row.participant} onClick={()=>actions.threads(row.participant)}>{row.threads} {row.threads===1?'thread':'threads'}</Button>:null}
  </Item>)}</ItemGroup>;
}

function Extras({model,actions}:{model:ReadingLogModel;actions:ReadingLogActions}){
  return <>
    {model.quizzes.length?<ul data-reading-log-quizzes="" className="mt-2 flex flex-col gap-0.5 text-[13px] leading-snug text-muted-foreground">{model.quizzes.map(line=><li key={line}>{line}</li>)}</ul>:null}
    {model.writing.length?<ul data-reading-log-writing="" className="mt-1 flex flex-col">{model.writing.map(piece=><li key={piece.path}>
      <Button variant="link" size="xs" className="h-auto px-0" render={<a href={'#read='+encodeURIComponent(piece.path)} data-path={piece.path}/>}
        onClick={event=>{event.preventDefault();actions.open(piece.path,event.shiftKey);}}>{piece.label}</Button></li>)}</ul>:null}
  </>;
}

export function ReadingLog({model,actions}:{model:ReadingLogModel|null;actions:ReadingLogActions}){
  if(!model)return <p data-reading-log-empty="" data-unavailable="" className="italic">Reading log unavailable</p>;
  if(model.empty)return <><p data-reading-log-empty="" className="italic">Not yet read by anyone. You’ll be first.</p><Extras model={model} actions={actions}/></>;
  return <>
    <Collapsible data-reading-log-details="" onOpenChange={()=>relayout(actions)}>
      <CollapsibleTrigger data-reading-log-toggle="" aria-label={model.summary}
        className="group/log flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <span data-reading-log-line="" className="min-w-0 [body.two-page_&]:truncate">
          {model.entries.map((entry,i)=><span key={i}>{i?<span aria-hidden> · </span>:null}
            {'folded' in entry?<span data-reading-log-entry="" data-folded={entry.folded} className="whitespace-nowrap">{entry.text}</span>
              :<span data-reading-log-entry="" data-state={entry.state} title={entry.stamp} className="whitespace-nowrap"><Mark state={entry.state}/> {entry.label}{entry.earlier?<> <span>(earlier edition)</span></>:null} {entry.when}</span>}</span>)}
          {model.more?<><span aria-hidden> · </span><span data-reading-log-more="" className="text-foreground">+{model.more} more</span></>:null}
        </span>
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 self-center transition-transform group-data-[panel-open]/log:rotate-180"/>
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted data-reading-log-body="" className="grid gap-4 pt-4 pb-1">
        {model.groups.map(group=><section key={group.state} data-reading-log-group={group.state}>
          <h3 className="m-0 mb-2 font-sans text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{group.title}</h3>
          <Rows rows={group.rows} actions={actions}/>
        </section>)}
        {model.agents?<Collapsible data-reading-log-agents="" onOpenChange={()=>relayout(actions)}>
          <CollapsibleTrigger data-reading-log-agents-toggle="" className="group/agents flex w-full cursor-pointer items-baseline gap-2 border-t border-border py-1.5 text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {model.agents.title} <span className="text-muted-foreground">{model.agents.hint}</span>
            <ChevronDownIcon aria-hidden className="ml-auto size-3 shrink-0 self-center transition-transform group-data-[panel-open]/agents:rotate-180"/>
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted className="pl-3.5"><Rows rows={model.agents.rows} actions={actions}/></CollapsibleContent>
        </Collapsible>:null}
      </CollapsibleContent>
    </Collapsible>
    <Extras model={model} actions={actions}/>
  </>;
}
