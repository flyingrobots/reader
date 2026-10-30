/* Admin › Library (#admin/library): what the library holds and what you have read, and the works behind any number.
   Design sheet: docs/admin-design/library.md. The model is computed by web_ui/dashboard.mjs (libraryModel) and passed in
   with the app's actions; this page renders it with the theme tiers and draws charts with library-charts.ts. Selecting
   a total, a slice, a bar or a legend entry lists its works under Latest additions; selecting it again clears it. */
import {Fragment, useEffect, useRef, useState} from 'react';
import {cn} from 'cn';
import {ArrowUpRightIcon, MessageSquareTextIcon, XIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle} from '@/components/ui/item';
import {Notice} from '@/theme/molecules/notice';
import {EmptyState} from '@/theme/molecules/states';
import {StatusCard} from '@/theme/organisms/status-card';
import {CardGrid} from '@/theme/templates/card-grid';
import {drawChart, palette, type ChartRow, type LibraryWork, type Panel} from './library-charts';

type Total={key:string;value:number;label:string;works?:LibraryWork[];panel?:string};
type Pending={id:string;path:string;owner:string;quote:string;comments:string;at:string};
export type LibraryModel={participant:string;catalog:string;today:string;day:string;works:LibraryWork[];undated:number;panels:Panel[];totals:Total[];pending:Pending[]};
export type LibraryActions={model:()=>LibraryModel|null;open:(path:string,options?:{thread?:string|null;split?:boolean})=>void;picker:()=>void;settings:()=>void;
  tooltip:(event:Event,title:string,detail:string)=>void;hideTooltip:()=>void;charts:GalleryCharts};
type Hooks={mount:HTMLElement;works:LibraryWork[];select:(label:string,works:LibraryWork[],key?:string)=>void;showTooltip:(event:Event,title:string,detail:string)=>void;hideTooltip:()=>void};
/** The gallery charts in web_ui/library-charts.mjs, passed in by app.mjs. */
type GalleryCharts={drawArrivalCalendar:(options:Hooks&{today:string})=>void;drawReadingTopics:(options:Hooks)=>void;mountShelves:(options:Hooks&{navigate:(path:string)=>void})=>{reset:()=>void}};
type Selection={key:string;label:string;works:LibraryWork[]}|null;

const motion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
const newest=(works:LibraryWork[])=>[...works].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.title.localeCompare(b.title));

function Chart({panel,choose,actions,works,selected,today}:{panel:Panel;choose:(key:string,row:ChartRow)=>void;actions:LibraryActions;works:LibraryWork[];selected:string|null;today:string}){
  const mount=useRef<HTMLDivElement>(null),latest=useRef({choose,actions});latest.current={choose,actions};
  const shelves=useRef<{reset:()=>void}|null>(null),[calendar,setCalendar]=useState(false);
  useEffect(()=>{if(!mount.current)return;const element=mount.current;
    const hooks:Hooks={mount:element,works,select:(label,items,key=panel.id+':'+label)=>latest.current.choose(key,{key,label,value:items.length,works:items}),
      showTooltip:(event,title,detail)=>latest.current.actions.tooltip(event,title,detail),hideTooltip:()=>latest.current.actions.hideTooltip()};
    const charts=latest.current.actions.charts;
    if(panel.kind==='shelves'){shelves.current=charts.mountShelves({...hooks,navigate:path=>latest.current.actions.open(path)});return ()=>{hooks.hideTooltip();element.replaceChildren();};}
    if(panel.kind==='reading-topics'){charts.drawReadingTopics(hooks);return ()=>{hooks.hideTooltip();element.replaceChildren();};}
    if(panel.calendar&&calendar){charts.drawArrivalCalendar({...hooks,today});return ()=>{hooks.hideTooltip();element.replaceChildren();};}
    return drawChart(element,panel,{works,choose:row=>latest.current.choose(panel.id+':'+row.key,row),open:path=>latest.current.actions.open(path),
      tooltip:(event,title,detail)=>latest.current.actions.tooltip(event,title,detail),hideTooltip:()=>latest.current.actions.hideTooltip()});},[panel,works,calendar,today]);
  // The gallery charts mark their own choices; mirror the page's selection onto them.
  useEffect(()=>{mount.current?.querySelectorAll<HTMLElement>('[data-chart-choice]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.chartChoice===selected)));});
  const legend=panel.kind==='donut';
  const action=panel.kind==='shelves'?<Button id="atlas-reset" variant="ghost" size="xs" onClick={()=>{shelves.current?.reset();choose('',{key:'',label:'',value:0,works:[]});}}>Reset</Button>
    :panel.calendar?<Button id="arrivals-view" variant="ghost" size="xs" aria-pressed={calendar} aria-label={calendar?'Show weekly arrivals':'Show arrival calendar'} onClick={()=>{actions.hideTooltip();setCalendar(!calendar);}}>{calendar?'Weekly':'Calendar'}</Button>:null;
  return <StatusCard id={'panel-'+panel.id} data-stat-panel={panel.id} titleId={'title-'+panel.id} title={panel.title} description={panel.note} badge={action}>
    <div className={legend?'grid items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr]':''}>
      <div ref={mount} id={'chart-'+panel.id} data-chart-mount="" className={cn('chart-mount min-w-0 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full',legend&&'mx-auto w-full max-w-44')}/>
      {legend?<div className="flex flex-col gap-0.5" role="group" aria-label={panel.title+' legend'}>{panel.rows.map((row,i)=>{const key=panel.id+':'+row.key;
        return <Button key={row.key} variant={selected===key?'secondary':'ghost'} size="xs" className="justify-start" data-chart-choice={key} aria-pressed={selected===key} onClick={()=>choose(key,row)}>
          <span aria-hidden data-chart-swatch="" className="size-2 shrink-0 rounded-full" style={{background:palette[i%palette.length]}}/><span className="min-w-0 flex-1 truncate text-left">{row.label}</span><span className="tabular-nums text-muted-foreground">{row.value.toLocaleString()}</span></Button>;})}</div>:null}
    </div>
  </StatusCard>;
}

function WorkItem({work,index,open}:{work:LibraryWork;index:number;open:LibraryActions['open']}){
  return <Item size="sm" role="listitem" className="cursor-pointer px-1 text-left hover:bg-muted" render={<button type="button"/>} data-path={work.primary} onClick={event=>open(work.primary,{split:event.shiftKey})}>
    <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground tabular-nums" aria-hidden>{String(index+1).padStart(2,'0')}</span>
    <ItemContent className="min-w-0">
      <ItemTitle className="font-serif text-base font-normal [overflow-wrap:anywhere]">{work.title}{!work.read?<span className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" title="Unread edition" aria-label="Unread edition"/>:null}</ItemTitle>
      <ItemDescription>{work.authors?.join(' · ')||'Unspecified author'}{work.projects?.[0]&&work.projects[0]!=='Unspecified project'?' · '+work.projects[0]:''}</ItemDescription>
    </ItemContent>
    <ItemActions className="text-xs text-muted-foreground tabular-nums">{work.date_label}</ItemActions>
  </Item>;
}

export function LibraryPage({actions}:{actions:LibraryActions}){
  const model=actions.model();
  const [selection,setSelection]=useState<Selection>(null),[shown,setShown]=useState(8);
  const explore=useRef<HTMLDivElement>(null),status=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{setSelection(null);setShown(8);},[model]);
  useEffect(()=>{setShown(8);},[selection]);
  if(!model)return <Notice tone="error" role="status" title="Library statistics are unavailable here."/>;
  const select=(key:string,label:string,works:LibraryWork[])=>{
    const cleared=!key||selection?.key===key;setSelection(cleared?null:{key,label,works});
    if(document.activeElement?.closest('[data-chart-mount],[data-totals]'))requestAnimationFrame(()=>status.current?.focus({preventScroll:true}));
    if(!cleared)requestAnimationFrame(()=>explore.current?.scrollIntoView({block:'start',behavior:motion()}));
  };
  const listed=selection?selection.works:model.works,count=shown,title=selection?selection.label:'Latest additions';
  return <div className="flex flex-col gap-6" data-library="">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <span className="text-sm text-muted-foreground">Current library holdings and your reading activity.</span>
      <span className="text-xs text-muted-foreground tabular-nums">Catalog · {model.catalog} · Current editions · {model.today}</span>
    </div>
    <ItemGroup role="list" aria-label="Library metrics" data-totals="" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {model.totals.map((total,i)=><Item key={total.key} role="listitem" variant="outline" size="sm" data-total={i} render={<button type="button"/>} className="cursor-pointer items-start text-left hover:bg-muted"
        onClick={()=>total.panel?document.getElementById('panel-'+total.panel)?.scrollIntoView({block:'start',behavior:motion()}):select('total:'+total.key,i===0?'All catalog works':total.label,total.works||[])}>
        <ItemContent className="gap-0.5"><ItemTitle data-total-value="" className="font-serif text-2xl font-normal tabular-nums">{total.value.toLocaleString()}</ItemTitle><ItemDescription className="text-xs">{total.label}</ItemDescription></ItemContent>
      </Item>)}
    </ItemGroup>
    <CardGrid data-statistics-grid="">{model.panels.map(panel=><Chart key={panel.id} panel={panel} works={model.works} today={model.day} actions={actions} selected={selection?.key??null} choose={(key,row)=>select(key,row.label,row.works)}/>)}</CardGrid>
    <div ref={explore} className="scroll-mt-16">
      <StatusCard id="dashboard-explore" titleId="editions-title" title={title} description="Explore the works behind the numbers."
        badge={selection?<Button id="dashboard-reset" variant="ghost" size="xs" onClick={()=>select('',title,[])}><XIcon data-icon="inline-start" aria-hidden/>Clear selection</Button>:null}
        footer={<div className="flex w-full flex-wrap items-center gap-2">{listed.length>count?<Button id="dashboard-more" variant="outline" size="sm" onClick={()=>setShown(count+8)}>Show more works</Button>:null}
          <Button id="all-works" variant="link" size="sm" className="ml-auto px-0" onClick={actions.picker}>Open the file picker<ArrowUpRightIcon data-icon="inline-end" aria-hidden/></Button></div>}>
        <p ref={status} id="dashboard-selection" data-slot="selection-status" role="status" tabIndex={-1} className="text-sm text-muted-foreground outline-none">{selection?`${listed.length.toLocaleString()} matching ${listed.length===1?'work':'works'} · newest arrivals first`:'Select a chart segment or bar to browse its works.'}</p>
        {listed.length?<ItemGroup role="list" id="latest-list" className="gap-0">{newest(listed).slice(0,count).map((work,i)=><Fragment key={work.primary}>{i?<ItemSeparator role="presentation" className="my-0"/>:null}<WorkItem work={work} index={i} open={actions.open}/></Fragment>)}</ItemGroup>
          :<EmptyState title="No works in this selection"/>}
      </StatusCard>
    </div>
    <StatusCard id="dashboard-margins" title="Unread discussion" description={model.pending.length?'Latest threads':'All caught up'}>
      {model.pending.length?<ItemGroup role="list" className="gap-2">{model.pending.map(thread=><Item key={thread.id} role="listitem" variant="outline" size="sm" render={<button type="button"/>} className="cursor-pointer items-start text-left hover:bg-muted"
          data-margin-item="" data-thread-link={thread.id} data-path={thread.path} onClick={event=>actions.open(thread.path,{thread:thread.id,split:event.shiftKey})}>
        <ItemContent className="min-w-0"><ItemDescription className="text-xs">{thread.owner}</ItemDescription>
          <ItemTitle data-quote="" className="line-clamp-none font-serif text-base font-normal [overflow-wrap:anywhere]">“{thread.quote.slice(0,140)}{thread.quote.length>140?'…':''}”</ItemTitle>
          <ItemDescription data-count="" className="text-xs">{thread.comments} · {thread.at}</ItemDescription></ItemContent></Item>)}</ItemGroup>
        :<EmptyState icon={MessageSquareTextIcon} title="No unread passage threads" description="Nothing in the margins is waiting for you."/>}
    </StatusCard>
    <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
      <span className="max-w-prose">Grouped catalog works, including their attachments. Charts describe the current holdings and recorded arrival/filing dates. {model.undated===1?'1 work has':model.undated.toLocaleString()+' works have'} no arrival date and are excluded from time charts. Read marks record opened editions, rather than reading duration.</span>
      <Button id="personalize" variant="link" size="sm" className="px-0" onClick={actions.settings}>Customize this dashboard<ArrowUpRightIcon data-icon="inline-end" aria-hidden/></Button>
    </div>
  </div>;
}
