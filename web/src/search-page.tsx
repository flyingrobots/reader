/* The full search page: a query field, modes, facets and passages grouped by work. State lives in web_ui/search-page.mjs. */
import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {SearchIcon, SlidersHorizontalIcon, XIcon} from 'lucide-react';
import {Badge} from './components/ui/badge';
import {Button} from './components/ui/button';
import {ButtonGroup} from './components/ui/button-group';
import {Checkbox} from './components/ui/checkbox';
import {Input} from './components/ui/input';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription} from './components/ui/sheet';
import {Skeleton} from './components/ui/skeleton';
import {Switch} from './components/ui/switch';

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

function FacetList({scope,name,label,counts,selected,onChange}:{scope:string;name:string;label:string;counts:Record<string,number>;selected:string[];onChange:(values:string[])=>void}){
  const [all,setAll]=useState(false);
  const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  if(!entries.length)return null;
  const shown=all?entries:entries.slice(0,6).concat(entries.slice(6).filter(([v])=>selected.includes(v)));
  return <fieldset className="search-facet" data-facet={name}><legend>{label}</legend>
    <ul>{shown.map(([value,count])=>{const id=`${scope}-facet-${name}-${value}`.replace(/[^\w-]+/g,'-');const on=selected.includes(value);
      return <li key={value}><label htmlFor={id} data-selected={on||undefined}><Checkbox id={id} checked={on} onCheckedChange={checked=>onChange(checked?[...selected,value]:selected.filter(v=>v!==value))}/><span className="search-facet-name">{value}</span><span className="search-facet-count">{count.toLocaleString()}</span></label></li>;})}</ul>
    {entries.length>6&&<Button variant="link" size="xs" className="search-facet-more" onClick={()=>setAll(!all)}>{all?'Fewer':`All ${entries.length}`}</Button>}
  </fieldset>;
}

function FilterPanel({scope,model,actions}:{scope:string;model:SearchModel;actions:SearchActions}){
  const f=model.filters,r=model.result,today=model.today;
  const presets:[string,string|null][]=[['Any time',null],['Past week',shift(today,6)],['Past month',shift(today,29)],['Past year',shift(today,364)]];
  const preset=presets.find(([,from])=>from===f.from&&(!from||!f.to));
  return <div className="search-filters">
    {f.folder&&<div className="search-scope"><span className="search-filter-label">Folder</span><Badge variant="outline" className="search-folder-chip">{f.folder.replace(/^library\//,'')}<button type="button" aria-label="Search all folders" onClick={()=>actions.filters({folder:null})}><XIcon/></button></Badge></div>}
    {FACETS.map(({key,label})=><FacetList key={key} scope={scope} name={key} label={label} counts={r?.facets[key]||{}} selected={f[key]} onChange={values=>actions.filters({[key]:values})}/>)}
    <fieldset className="search-facet" data-facet="date"><legend>Date</legend>
      <ButtonGroup aria-label="Date" className="search-presets">{presets.map(([name,from])=><Button key={name} variant="outline" size="xs" aria-pressed={preset?.[0]===name} onClick={()=>actions.filters({from,to:null})}>{name.replace('Past ','')}</Button>)}</ButtonGroup>
      <div className="search-range"><label><span>From</span><Input type="date" aria-label="From date" value={f.from||''} max={f.to||today} onChange={event=>actions.filters({from:event.target.value||null})}/></label><label><span>To</span><Input type="date" aria-label="To date" value={f.to||''} min={f.from||undefined} onChange={event=>actions.filters({to:event.target.value||null})}/></label></div>
    </fieldset>
    <fieldset className="search-facet" data-facet="read"><legend>Read state</legend>
      <ButtonGroup aria-label="Read state">{(['all','unread','read'] as const).map(value=><Button key={value} variant="outline" size="xs" aria-pressed={f.read===value} data-read-filter={value} onClick={()=>actions.filters({read:value})}>{value[0].toUpperCase()+value.slice(1)}</Button>)}</ButtonGroup>
    </fieldset>
    {r&&Object.keys(r.facets.folder).length>0&&<fieldset className="search-facet" data-facet="folder"><legend>Folders</legend><ul className="search-folders">{Object.entries(r.facets.folder).map(([folder,count])=><li key={folder}><button type="button" onClick={()=>actions.filters({folder})}><span>{folder.replace(/^library\//,'').replace(/\/$/,'')}</span><span className="search-facet-count">{count}</span></button></li>)}</ul></fieldset>}
    <label className="search-machine" htmlFor={scope+'-machine'}><Switch id={scope+'-machine'} size="sm" checked={f.machine} onCheckedChange={value=>actions.filters({machine:value})}/><span>Include machine files<small>Receipts, logs and code, matched by path</small></span></label>
    {r?.facet_scope==='top'&&<p className="search-facet-scope">Counts cover the top {r.pool} passages.</p>}
  </div>;
}

function Passages({work,offset,active,actions}:{work:Work;offset:number;active:number;actions:SearchActions}){
  return <ol className="search-passages">{work.passages.map((p,i)=>{const index=offset+i;const on=index===active;
    return <li key={p.path+':'+p.line+':'+i}><button type="button" className="search-passage" data-passage={index} data-active={on||undefined} aria-current={on||undefined} tabIndex={on?0:-1}
      onClick={()=>actions.open(index)} onFocus={()=>actions.select(index)}>
      <span className="search-passage-label">{label(p)}{p.path!==work.primary&&<span className="search-passage-file"> · {p.path.split('/').pop()}</span>}</span>
      {p.excerpt?<span className="search-excerpt" data-spans={JSON.stringify(p.spans)}>{p.excerpt}</span>:<span className="search-excerpt quiet-excerpt">Matched by its file name.</span>}
      {!p.literal&&<span className="search-related">Related, not exact</span>}
    </button></li>;})}</ol>;
}

function Empty({model,actions}:{model:SearchModel;actions:SearchActions}){
  return <div className="search-empty">
    <p className="search-lede">Every indexed passage in the library, by its words or by what it means. Results open at the passage.</p>
    {model.recent.length>0&&<section><h2 className="eyebrow">Recent searches</h2><ul className="search-chips">{model.recent.map(q=><li key={q}><Button variant="outline" size="sm" onClick={()=>actions.query(q)}>{q}</Button></li>)}</ul></section>}
    {model.suggestions.length>0&&<section><h2 className="eyebrow">Topics in your unread works</h2><ul className="search-chips">{model.suggestions.map(q=><li key={q}><Button variant="ghost" size="sm" onClick={()=>actions.query(q)}>{q}</Button></li>)}</ul></section>}
  </div>;
}

function Notes({model,actions}:{model:SearchModel;actions:SearchActions}){
  const r=model.result;if(!r)return null;const notes:ReactNode[]=[];
  if(!r.complete||r.warnings.some(w=>/changed since/.test(w)))notes.push(<p key="stale" className="search-note" data-note="stale">{!r.complete?'The last index run stopped before finishing, so some works may be missing.':'Some sources changed since the index was built.'} <Button variant="link" size="xs" onClick={actions.backstage}>Rebuild in Behind the scenes</Button></p>);
  if(r.semantic==='unavailable'&&model.mode!=='words')notes.push(<p key="semantic" className="search-note" data-note="semantic">Meaning search is unavailable right now; these are exact-word matches. <Button variant="link" size="xs" onClick={actions.backstage}>Check the index</Button></p>);
  return notes.length?<div className="search-notes">{notes}</div>:null;
}

export function SearchPage({model,actions}:{model:SearchModel;actions:SearchActions}){
  const results=useRef<HTMLDivElement>(null);const [sheet,setSheet]=useState(false);
  useHighlights(results,[model.works,model.active]);
  useLayoutEffect(()=>{if(document.activeElement?.closest('.search-results'))results.current?.querySelector<HTMLElement>(`[data-passage="${model.active}"]`)?.focus({preventScroll:true});results.current?.querySelector(`[data-passage="${model.active}"]`)?.scrollIntoView({block:'nearest'});},[model.active]);
  const r=model.result,f=model.filters;
  const active=[...f.project,...f.author,...f.type].length+(f.from||f.to?1:0)+(f.read!=='all'?1:0)+(f.folder?1:0)+(f.machine?1:0);
  const passages=model.works.reduce((n,w)=>n+w.passages.length,0);
  let offset=0;
  return <section className="search-page" aria-labelledby="search-title" data-status={model.status}>
    <header className="search-head">
      <div className="eyebrow" id="search-title">Search the library</div>
      <div className="search-field"><SearchIcon aria-hidden="true" className="search-field-icon"/>
        <Input id="search-query" type="search" autoComplete="off" spellCheck={false} placeholder="A phrase, a name, an idea…" aria-label="Search the library" aria-describedby="search-meta" value={model.query} onChange={event=>actions.query(event.target.value)} onKeyDown={actions.fieldKey}/></div>
      <div className="search-bar">
        <ButtonGroup aria-label="Search mode" className="search-modes">{MODES.map(m=><Button key={m.value} variant="outline" size="sm" title={m.hint} aria-pressed={model.mode===m.value} data-search-mode={m.value} onClick={()=>actions.mode(m.value)}>{m.label}</Button>)}</ButtonGroup>
        <p id="search-meta" className="search-meta" role="status">{model.status==='loading'&&!r?'Searching…':r&&model.query.trim()?<>{r.total.toLocaleString()} {r.total===1?'work':'works'}<span aria-hidden="true"> · </span>{passages} {passages===1?'passage':'passages'} shown<span aria-hidden="true"> · </span>{freshness(r.indexed_at)}</>:''}</p>
        <Button variant="outline" size="sm" className="search-filter-toggle" onClick={()=>setSheet(true)}><SlidersHorizontalIcon data-icon="inline-start"/>Filters{active?` · ${active}`:''}</Button>
      </div>
    </header>
    <div className="search-body">
      <aside className="search-rail" aria-label="Filters"><FilterPanel scope="rail" model={model} actions={actions}/>{active>0&&<Button variant="ghost" size="xs" className="search-clear" onClick={actions.clearFilters}>Clear filters</Button>}</aside>
      <div className="search-results" ref={results}>
        <Notes model={model} actions={actions}/>
        {model.status==='error'?<div className="search-empty" data-state="error"><p className="search-lede">{/index|format/i.test(model.error||'')?'The search index isn’t ready.':'Search couldn’t finish.'}</p><p className="quiet">{model.error}</p>{/index|format/i.test(model.error||'')&&<Button variant="outline" size="sm" onClick={actions.backstage}>Open Behind the scenes</Button>}</div>
        :!model.query.trim()?<Empty model={model} actions={actions}/>
        :model.status==='loading'&&!model.works.length?<div className="search-skeleton" role="status" aria-label="Searching">{[0,1,2].map(i=><div key={i} className="search-work"><Skeleton className="h-5 w-2/5"/><Skeleton className="h-3 w-1/4"/><Skeleton className="h-4 w-full"/><Skeleton className="h-4 w-11/12"/></div>)}</div>
        :r&&!model.works.length?<div className="search-empty" data-state="none"><p className="search-lede">Nothing matched “{model.query.trim()}”.</p><div className="search-chips">{model.mode!=='meaning'&&<Button variant="outline" size="sm" onClick={()=>actions.mode('meaning')}>Search by meaning</Button>}{active>0&&<Button variant="outline" size="sm" onClick={actions.clearFilters}>Clear filters</Button>}{model.mode==='meaning'&&<Button variant="outline" size="sm" onClick={()=>actions.mode('words')}>Exact words</Button>}</div></div>
        :<ol className="search-works" aria-label="Results">{model.works.map(work=>{const start=offset;offset+=work.passages.length;
          return <li key={work.id} className="search-work" data-work={work.primary} data-read={work.read||undefined}>
            <h3 className="search-work-title">{work.title}{!work.read&&<span className="unread-pip" title="Unread edition" aria-label="Unread edition"/>}</h3>
            <div className="search-work-byline"><span>{work.authors.join(' · ')}</span>{work.projects[0]&&work.projects[0]!=='Unspecified project'&&<Badge variant="secondary" className="search-project">{work.projects[0]}</Badge>}<span>{day(work.date)}</span><Button variant="ghost" size="xs" className="search-queue" data-queue-add={work.primary} aria-label={`Add ${work.title} to your queue`} title="Add to your queue · q" onClick={()=>actions.queue(work.primary)}>+ Queue</Button></div>
            <Passages work={work} offset={start} active={model.active} actions={actions}/>
          </li>;})}</ol>}
        {r&&model.works.length<r.total&&model.status!=='error'&&<div className="search-more"><Button variant="outline" onClick={actions.more} disabled={model.loadingMore}>{model.loadingMore?'Loading…':`Show more works · ${(r.total-model.works.length).toLocaleString()} left`}</Button></div>}
      </div>
    </div>
    <Sheet open={sheet} onOpenChange={setSheet}><SheetContent side="bottom" className="search-sheet"><SheetHeader><SheetTitle>Filters</SheetTitle><SheetDescription>Narrow the passages. Counts are works.</SheetDescription></SheetHeader><div className="search-sheet-body"><FilterPanel scope="sheet" model={model} actions={actions}/>{active>0&&<Button variant="ghost" size="sm" onClick={actions.clearFilters}>Clear filters</Button>}</div></SheetContent></Sheet>
  </section>;
}
