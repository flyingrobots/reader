/* The full search page: a query field, modes, facets and passages grouped by work. State lives in web_ui/search-page.mjs.
   Design sheet: docs/ui-design/search.md. Built from shadcn components (data-ui="shadcn" opts the page into the slot
   preflight); excerpts stay text nodes so matches can be CSS custom highlights. */
import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {FolderIcon, SearchIcon, SearchXIcon, SlidersHorizontalIcon, XIcon} from 'lucide-react';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {Checkbox} from './components/ui/checkbox';
import {Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet} from './components/ui/field';
import {Input} from './components/ui/input';
import {InputGroup, InputGroupAddon, InputGroupInput} from './components/ui/input-group';
import {Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle} from './components/ui/item';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription} from './components/ui/sheet';
import {Skeleton} from './components/ui/skeleton';
import {Switch} from './components/ui/switch';
import {ToggleGroup, ToggleGroupItem} from './components/ui/toggle-group';
import {Notice} from './theme/molecules/notice';
import {EmptyState} from './theme/molecules/states';

export type Passage={path:string;page:number|null;start_line:number;end_line:number;line:number;excerpt:string;spans:[number,number][];matched_by:string[];literal:boolean};
export type Work={id:string;title:string;primary:string;authors:string[];projects:string[];types:string[];date:string|null;read:boolean;score:number;passages:Passage[]};
export type Filters={project:string[];author:string[];type:string[];from:string|null;to:string|null;read:'all'|'unread'|'read';folder:string|null;machine:boolean};
export type Result={works:Work[];total:number;facets:{project:Record<string,number>;author:Record<string,number>;type:Record<string,number>;folder:Record<string,number>};facet_scope:'top'|'all';pool:number;indexed_at:string|null;complete:boolean;semantic:'used'|'unavailable'|null;warnings:string[]};
export type SearchModel={query:string;mode:'best'|'words'|'meaning';filters:Filters;status:'idle'|'loading'|'ready'|'error';error:string|null;result:Result|null;works:Work[];active:number;recent:string[];suggestions:string[];loadingMore:boolean;today:string};
export type SearchActions={query:(q:string)=>void;mode:(m:SearchModel['mode'])=>void;filters:(patch:Partial<Filters>)=>void;clearFilters:()=>void;open:(index:number)=>void;select:(index:number)=>void;queue:(path:string)=>void;more:()=>void;backstage:()=>void;fieldKey:(event:React.KeyboardEvent<HTMLInputElement>)=>void};

const MODES:{value:SearchModel['mode'];label:string;hint:string}[]=[{value:'best',label:'Best',hint:'Exact words and meaning, blended'},{value:'words',label:'Exact words',hint:'Passages containing your words'},{value:'meaning',label:'Meaning',hint:'Passages about the same idea'}];
const FACETS:{key:'project'|'author'|'type';label:string}[]=[{key:'project',label:'Project'},{key:'author',label:'Author'},{key:'type',label:'Type'}];
// A plain YYYY-MM-DD is a calendar date, shown as written; a timestamp is shown as the reader's local day.
const day=(value:string|null)=>{if(!value)return 'Undated';const plain=/^\d{4}-\d{2}-\d{2}$/.test(value),d=new Date(plain?value+'T12:00:00Z':value);return Number.isNaN(+d)?'Undated':new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric',...(plain?{timeZone:'UTC'}:{})}).format(d);};
export function freshness(value:string|null){
  if(!value)return 'index date unknown';const date=new Date(value);if(Number.isNaN(+date))return 'index date unknown';
  const minutes=Math.round((Date.now()-+date)/60000);
  return 'indexed '+(minutes<1?'just now':minutes<60?minutes+' min ago':minutes<1440?Math.round(minutes/60)+' h ago':day(value));
}
const shift=(today:string,days:number)=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);};
const label=(p:Passage)=>p.page?`Page ${p.page}`:`Line ${p.line}`;
/** Code-point spans to UTF-16 offsets, so emoji before a match keep highlights aligned. */
function units(text:string,spans:[number,number][]){
  const offsets:number[]=[];let unit=0;for(const ch of text){offsets.push(unit);unit+=ch.length;}offsets.push(unit);
  return spans.map(([s,e])=>[offsets[s]??unit,offsets[e]??unit] as [number,number]);
}
export function flatPassages(works:Work[]){return works.flatMap((work,w)=>work.passages.map((passage,p)=>({work,passage,w,p})));}

/** Excerpts are text nodes; matches are CSS custom highlights, never markup. */
function useHighlights(root:React.RefObject<HTMLElement|null>,deps:unknown[]){
  useLayoutEffect(()=>{
    const element=root.current;const registry=(globalThis as any).CSS?.highlights;const Highlight=(globalThis as any).Highlight;
    if(!element||!registry||!Highlight)return;
    const all:Range[]=[],active:Range[]=[];
    for(const node of element.querySelectorAll<HTMLElement>('[data-spans]')){
      const text=node.firstChild;if(!text||text.nodeType!==Node.TEXT_NODE)continue;
      for(const [s,e] of units(text.textContent||'',JSON.parse(node.dataset.spans||'[]'))){
        const range=document.createRange();range.setStart(text,Math.min(s,text.textContent!.length));range.setEnd(text,Math.min(e,text.textContent!.length));
        (node.closest('[data-active]')?active:all).push(range);
      }
    }
    registry.set('reader-search-term',new Highlight(...all));registry.set('reader-search-active',new Highlight(...active));
    return ()=>{registry.delete('reader-search-term');registry.delete('reader-search-active');};
  },deps);
}

/** One pressed value from a single-choice ToggleGroup (Base UI reports an array; an unpress keeps the current value). */
const one=<T extends string>(set:(value:T)=>void)=>(values:unknown[])=>{if(values[0])set(values[0] as T);};

function FacetList({scope,name,label,counts,selected,onChange}:{scope:string;name:string;label:string;counts:Record<string,number>;selected:string[];onChange:(values:string[])=>void}){
  const [all,setAll]=useState(false);
  const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  if(!entries.length)return null;
  const shown=all?entries:entries.slice(0,6).concat(entries.slice(6).filter(([v])=>selected.includes(v)));
  return <FieldSet data-facet={name} className="gap-2">
    <FieldLegend variant="label">{label}</FieldLegend>
    <FieldGroup className="gap-1.5">{shown.map(([value,count])=>{const id=`${scope}-facet-${name}-${value}`.replace(/[^\w-]+/g,'-');const on=selected.includes(value);
      return <Field key={value} orientation="horizontal" data-selected={on||undefined}>
        <Checkbox id={id} checked={on} onCheckedChange={checked=>onChange(checked?[...selected,value]:selected.filter(v=>v!==value))}/>
        <FieldLabel htmlFor={id} className="min-w-0 flex-1 font-normal"><span className="truncate">{value}</span><span className="ml-auto text-xs text-muted-foreground tabular-nums" data-facet-count="">{count.toLocaleString()}</span></FieldLabel>
      </Field>;})}</FieldGroup>
    {entries.length>6&&<Button variant="link" size="xs" className="self-start px-0" onClick={()=>setAll(!all)}>{all?'Fewer':`All ${entries.length}`}</Button>}
  </FieldSet>;
}

function FilterPanel({scope,model,actions}:{scope:string;model:SearchModel;actions:SearchActions}){
  const f=model.filters,r=model.result,today=model.today;
  const presets:[string,string|null][]=[['Any time',null],['Past week',shift(today,6)],['Past month',shift(today,29)],['Past year',shift(today,364)]];
  const preset=presets.find(([,from])=>from===f.from&&(!from||!f.to));
  return <FieldGroup className="gap-6" data-filters="">
    {f.folder&&<Field><FieldLabel>Folder</FieldLabel><Badge variant="outline" className="h-auto max-w-full gap-1 py-0.5" data-folder-chip=""><FolderIcon aria-hidden/><span className="truncate">{f.folder.replace(/^library\//,'')}</span>
      <Button variant="ghost" size="icon-xs" className="-mr-1 size-4" aria-label="Search all folders" onClick={()=>actions.filters({folder:null})}><XIcon/></Button></Badge></Field>}
    {FACETS.map(({key,label})=><FacetList key={key} scope={scope} name={key} label={label} counts={r?.facets[key]||{}} selected={f[key]} onChange={values=>actions.filters({[key]:values})}/>)}
    <FieldSet data-facet="date" className="gap-2"><FieldLegend variant="label">Date</FieldLegend>
      <ToggleGroup variant="outline" size="sm" aria-label="Date" value={[preset?.[0]||'']} onValueChange={one<string>(name=>actions.filters({from:presets.find(([n])=>n===name)![1],to:null}))}>
        {presets.map(([name])=><ToggleGroupItem key={name} value={name}>{name.replace('Past ','')}</ToggleGroupItem>)}</ToggleGroup>
      <div className="grid grid-cols-2 gap-2">
        <Field className="gap-1"><FieldLabel htmlFor={scope+'-from'} className="text-xs font-normal text-muted-foreground">From</FieldLabel><Input id={scope+'-from'} type="date" aria-label="From date" value={f.from||''} max={f.to||today} onChange={event=>actions.filters({from:event.target.value||null})}/></Field>
        <Field className="gap-1"><FieldLabel htmlFor={scope+'-to'} className="text-xs font-normal text-muted-foreground">To</FieldLabel><Input id={scope+'-to'} type="date" aria-label="To date" value={f.to||''} min={f.from||undefined} onChange={event=>actions.filters({to:event.target.value||null})}/></Field>
      </div>
    </FieldSet>
    <FieldSet data-facet="read" className="gap-2"><FieldLegend variant="label">Read state</FieldLegend>
      <ToggleGroup variant="outline" size="sm" aria-label="Read state" value={[f.read]} onValueChange={one<Filters['read']>(value=>actions.filters({read:value}))}>
        {(['all','unread','read'] as const).map(value=><ToggleGroupItem key={value} value={value} data-read-filter={value}>{value[0].toUpperCase()+value.slice(1)}</ToggleGroupItem>)}</ToggleGroup>
    </FieldSet>
    {r&&Object.keys(r.facets.folder).length>0&&<FieldSet data-facet="folder" className="gap-2"><FieldLegend variant="label">Folders</FieldLegend>
      <ItemGroup className="gap-0.5">{Object.entries(r.facets.folder).map(([folder,count])=><Item key={folder} size="xs" role="listitem" className="cursor-pointer px-1.5 py-1 text-left hover:bg-muted" render={<button type="button"/>} onClick={()=>actions.filters({folder})}>
        <ItemContent className="min-w-0"><ItemTitle className="truncate font-normal">{folder.replace(/^library\//,'').replace(/\/$/,'')}</ItemTitle></ItemContent><ItemActions className="text-xs text-muted-foreground tabular-nums" data-facet-count="">{count}</ItemActions></Item>)}</ItemGroup></FieldSet>}
    <Field orientation="horizontal" data-machine="">
      <Switch id={scope+'-machine'} size="sm" checked={f.machine} onCheckedChange={value=>actions.filters({machine:value})}/>
      <FieldContent><FieldLabel htmlFor={scope+'-machine'}>Include machine files</FieldLabel><FieldDescription>Receipts, logs and code, matched by path</FieldDescription></FieldContent>
    </Field>
    {r?.facet_scope==='top'&&<FieldDescription>Counts cover the top {r.pool} passages.</FieldDescription>}
  </FieldGroup>;
}

function Passages({work,offset,active,actions}:{work:Work;offset:number;active:number;actions:SearchActions}){
  return <ItemGroup className="gap-1" aria-label={'Passages in '+work.title}>{work.passages.map((p,i)=>{const index=offset+i;const on=index===active;
    return <Item key={p.path+':'+p.line+':'+i} role="listitem" size="sm" variant={on?'muted':'default'} render={<button type="button"/>} className="w-full min-w-0 cursor-pointer flex-col items-start gap-1 text-left hover:bg-muted/60"
      data-passage={index} data-active={on||undefined} aria-current={on||undefined} tabIndex={on?0:-1} onClick={()=>actions.open(index)} onFocus={()=>actions.select(index)}>
      <ItemDescription className="text-xs" data-passage-label="">{label(p)}{p.path!==work.primary&&<span> · {p.path.split('/').pop()}</span>}</ItemDescription>
      {p.excerpt?<span className="w-full min-w-0 font-serif text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]" data-excerpt="" data-spans={JSON.stringify(p.spans)}>{p.excerpt}</span>
        :<span className="text-sm text-muted-foreground italic" data-excerpt="">Matched by its file name.</span>}
      {!p.literal&&<Badge variant="outline" data-related="">Related, not exact</Badge>}
    </Item>;})}</ItemGroup>;
}

function Start({model,actions}:{model:SearchModel;actions:SearchActions}){
  return <div className="flex flex-col gap-6" data-search-empty="">
    <p data-slot="lede" className="max-w-prose font-serif text-lg text-muted-foreground">Every indexed passage in the library, by its words or by what it means. Results open at the passage.</p>
    {model.recent.length>0&&<section className="flex flex-col gap-2"><h2 data-slot="section-label" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent searches</h2>
      <div className="flex flex-wrap gap-2">{model.recent.map(q=><Button key={q} variant="outline" size="sm" onClick={()=>actions.query(q)}>{q}</Button>)}</div></section>}
    {model.suggestions.length>0&&<section className="flex flex-col gap-2"><h2 data-slot="section-label" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Topics in your unread works</h2>
      <div className="flex flex-wrap gap-2">{model.suggestions.map(q=><Button key={q} variant="ghost" size="sm" onClick={()=>actions.query(q)}>{q}</Button>)}</div></section>}
  </div>;
}

function Notes({model,actions}:{model:SearchModel;actions:SearchActions}){
  const r=model.result;if(!r)return null;const notes:ReactNode[]=[];
  if(!r.complete||r.warnings.some(w=>/changed since/.test(w)))notes.push(<Notice key="stale" data-note="stale" title={!r.complete?'The last index run stopped before finishing, so some works may be missing.':'Some sources changed since the index was built.'}
    action={<Button variant="outline" size="xs" onClick={actions.backstage}>Rebuild</Button>}/>);
  if(r.semantic==='unavailable'&&model.mode!=='words')notes.push(<Notice key="semantic" data-note="semantic" title="Meaning search is unavailable right now; these are exact-word matches."
    action={<Button variant="outline" size="xs" onClick={actions.backstage}>Check the index</Button>}/>);
  return notes.length?<div className="flex flex-col gap-2">{notes}</div>:null;
}

export function SearchPage({model,actions}:{model:SearchModel;actions:SearchActions}){
  const results=useRef<HTMLDivElement>(null);const [sheet,setSheet]=useState(false);
  useHighlights(results,[model.works,model.active]);
  useLayoutEffect(()=>{if(document.activeElement?.closest('[data-search-results]'))results.current?.querySelector<HTMLElement>(`[data-passage="${model.active}"]`)?.focus({preventScroll:true});results.current?.querySelector(`[data-passage="${model.active}"]`)?.scrollIntoView({block:'nearest'});},[model.active]);
  const r=model.result,f=model.filters;
  const active=[...f.project,...f.author,...f.type].length+(f.from||f.to?1:0)+(f.read!=='all'?1:0)+(f.folder?1:0)+(f.machine?1:0);
  const passages=model.works.reduce((n,w)=>n+w.passages.length,0);
  const indexProblem=/index|format/i.test(model.error||'');
  let offset=0;
  return <section className="search-page mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-8 pb-24 font-sans md:px-8" data-ui="shadcn" aria-labelledby="search-title" data-status={model.status}>
    <header className="flex flex-col gap-3" data-search-head="">
      <h1 id="search-title" data-slot="page-title" className="font-serif text-3xl leading-tight font-normal tracking-tight md:text-4xl">Search the library</h1>
      <InputGroup className="h-11">
        <InputGroupAddon><SearchIcon aria-hidden="true"/></InputGroupAddon>
        <InputGroupInput id="search-query" type="search" autoComplete="off" spellCheck={false} placeholder="A phrase, a name, an idea…" aria-label="Search the library" aria-describedby="search-meta" className="text-base" value={model.query} onChange={event=>actions.query(event.target.value)} onKeyDown={actions.fieldKey}/>
      </InputGroup>
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup variant="outline" size="sm" aria-label="Search mode" data-search-modes="" value={[model.mode]} onValueChange={one<SearchModel['mode']>(actions.mode)}>
          {MODES.map(m=><ToggleGroupItem key={m.value} value={m.value} title={m.hint} data-search-mode={m.value}>{m.label}</ToggleGroupItem>)}</ToggleGroup>
        <p id="search-meta" data-slot="search-meta" className="min-w-0 flex-1 text-sm text-muted-foreground" role="status">{model.status==='loading'&&!r?'Searching…':r&&model.query.trim()?<>{r.total.toLocaleString()} {r.total===1?'work':'works'}<span aria-hidden="true"> · </span>{passages} {passages===1?'passage':'passages'} shown<span aria-hidden="true"> · </span>{freshness(r.indexed_at)}</>:''}</p>
        <Button variant="outline" size="sm" className="lg:hidden" data-filter-toggle="" onClick={()=>setSheet(true)}><SlidersHorizontalIcon data-icon="inline-start"/>Filters{active?` · ${active}`:''}</Button>
      </div>
    </header>
    <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden flex-col gap-4 lg:flex" aria-label="Filters" data-search-rail=""><FilterPanel scope="rail" model={model} actions={actions}/>{active>0&&<Button variant="ghost" size="xs" className="self-start" data-clear-filters="" onClick={actions.clearFilters}>Clear filters</Button>}</aside>
      <div className="flex min-w-0 flex-col gap-4" ref={results} data-search-results="">
        <Notes model={model} actions={actions}/>
        {model.status==='error'?<EmptyState data-state="error" icon={SearchXIcon} title={indexProblem?'The search index isn’t ready.':'Search couldn’t finish.'} description={model.error||undefined}>
            {indexProblem&&<Button variant="outline" size="sm" onClick={actions.backstage}>Open Reader Admin</Button>}</EmptyState>
        :!model.query.trim()?<Start model={model} actions={actions}/>
        :model.status==='loading'&&!model.works.length?<div className="flex flex-col gap-6" role="status" aria-label="Searching">{[0,1,2].map(i=><div key={i} className="flex flex-col gap-2"><Skeleton className="h-5 w-2/5"/><Skeleton className="h-3 w-1/4"/><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-11/12"/></div>)}</div>
        :r&&!model.works.length?<EmptyState data-state="none" icon={SearchXIcon} title={`Nothing matched “${model.query.trim()}”.`}>
            <div className="flex flex-wrap justify-center gap-2">{model.mode!=='meaning'&&<Button variant="outline" size="sm" onClick={()=>actions.mode('meaning')}>Search by meaning</Button>}{active>0&&<Button variant="outline" size="sm" onClick={actions.clearFilters}>Clear filters</Button>}{model.mode==='meaning'&&<Button variant="outline" size="sm" onClick={()=>actions.mode('words')}>Exact words</Button>}</div></EmptyState>
        :<ol className="flex flex-col gap-8" aria-label="Results" data-slot="results">{model.works.map(work=>{const start=offset;offset+=work.passages.length;
          return <li key={work.id} className="flex flex-col gap-2" data-work={work.primary} data-read={work.read||undefined}>
            <h3 data-slot="work-title" data-work-title="" className="font-serif text-xl leading-snug font-normal">{work.title}{!work.read&&<span className="ml-2 inline-block size-1.5 rounded-full bg-primary align-middle" title="Unread edition" aria-label="Unread edition"/>}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"><span>{work.authors.join(' · ')}</span>{work.projects[0]&&work.projects[0]!=='Unspecified project'&&<Badge variant="secondary">{work.projects[0]}</Badge>}<span>{day(work.date)}</span>
              <Button variant="ghost" size="xs" className="ml-auto" data-queue-add={work.primary} aria-label={`Add ${work.title} to your queue`} title="Add to your queue · q" onClick={()=>actions.queue(work.primary)}>+ Queue</Button></div>
            <Passages work={work} offset={start} active={model.active} actions={actions}/>
          </li>;})}</ol>}
        {r&&model.works.length<r.total&&model.status!=='error'&&<Button variant="outline" className="self-center" onClick={actions.more} disabled={model.loadingMore}>{model.loadingMore?'Loading…':`Show more works · ${(r.total-model.works.length).toLocaleString()} left`}</Button>}
      </div>
    </div>
    <Sheet open={sheet} onOpenChange={setSheet}><SheetContent side="bottom" className="max-h-[85vh]" data-search-sheet=""><SheetHeader><SheetTitle>Filters</SheetTitle><SheetDescription>Narrow the passages. Counts are works.</SheetDescription></SheetHeader>
      <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6"><FilterPanel scope="sheet" model={model} actions={actions}/>{active>0&&<Button variant="ghost" size="sm" className="self-start" onClick={actions.clearFilters}>Clear filters</Button>}</div></SheetContent></Sheet>
  </section>;
}
