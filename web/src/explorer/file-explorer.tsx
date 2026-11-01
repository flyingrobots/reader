import {useMemo,useState,type KeyboardEvent} from 'react';
import {SearchIcon,XIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {ItemGroup} from '@/components/ui/item';
import {EmptyState} from '@/theme/molecules/states';
import {ArticleRow} from './article-row';
import {ExplorerFilters} from './explorer-filters';
import {ExplorerPagination} from './explorer-pagination';
import {filterArticles,PAGE_SIZE,type Article,type ReadFilter,type SortOrder} from './model';

export type ExplorerProps={articles:Article[];current:string|null;folder:string|null;onOpen:(path:string)=>void;onClose:()=>void;onSearch:()=>void;onClearFolder:()=>void;onQueue:(path:string)=>void};
/** Organism: a persistent, nonmodal library column. State survives article navigation and closing/reopening. */
export function FileExplorer({articles,current,folder,onOpen,onClose,onSearch,onClearFolder,onQueue}:ExplorerProps){
  const [query,setQuery]=useState(''),[read,setRead]=useState<ReadFilter>(''),[sort,setSort]=useState<SortOrder>('newest'),[page,setPage]=useState(0);
  const matches=useMemo(()=>filterArticles(articles,query,read,sort,folder),[articles,query,read,sort,folder]);
  const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE)),safePage=Math.min(page,pages-1),start=safePage*PAGE_SIZE,rows=matches.slice(start,start+PAGE_SIZE);
  function pageTo(next:number){setPage(next);document.getElementById('file-results')?.scrollTo(0,0);}
  function listKeys(event:KeyboardEvent<HTMLElement>){
    const nodes=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-article-row]')],index=nodes.indexOf(document.activeElement as HTMLButtonElement);
    const delta=['j','ArrowDown'].includes(event.key)?1:['k','ArrowUp'].includes(event.key)?-1:0;
    if(delta||['Home','End'].includes(event.key)){
      event.preventDefault();event.stopPropagation();const next=event.key==='Home'?0:event.key==='End'?nodes.length-1:(index+delta+nodes.length)%nodes.length;nodes[next]?.focus();
    }else if(event.key==='/'){event.preventDefault();event.stopPropagation();document.getElementById('file-query')?.focus();}
    else if(event.key==='q'&&index>=0){event.preventDefault();event.stopPropagation();onQueue(rows[index].primary);}
  }
  return <div data-ui="shadcn" className="flex h-full min-h-0 flex-col bg-background text-foreground">
    <header className="flex items-center justify-between gap-2 p-4"><h2 id="picker-title" className="text-base font-semibold">File Explorer</h2><Button variant="ghost" size="icon" aria-label="Close File Explorer" onClick={onClose}><XIcon/></Button></header>
    <div className="flex flex-col gap-3 px-4 pb-4"><ExplorerFilters query={query} read={read} sort={sort} onQuery={value=>{setQuery(value);setPage(0);}} onRead={value=>{setRead(value);setPage(0);}} onSort={value=>{setSort(value);setPage(0);}}/>
      {folder?<div className="flex min-w-0 items-center gap-2"><span id="explorer-folder" className="truncate text-xs text-muted-foreground" title={folder}>{folder}</span><Button variant="ghost" size="xs" onClick={()=>{setPage(0);onClearFolder();}}>All folders</Button></div>:null}
      <p id="explorer-count" role="status" className="text-xs text-muted-foreground tabular-nums">{matches.length?`${start+1}–${start+rows.length} of ${matches.length} articles`:'0 articles'}</p>
    </div><Separator/>
    <div id="file-results" tabIndex={0} aria-label="Library articles" className="min-h-0 flex-1 overflow-y-auto p-2" onKeyDown={listKeys}>
      {rows.length?<ItemGroup aria-label="Articles">{rows.map(article=><ArticleRow key={article.primary} article={article} current={current===article.primary} onOpen={()=>onOpen(article.primary)}/>)}</ItemGroup>:<EmptyState title="No articles match" description="Try another filter or reading status."/>}
    </div><Separator/>
    <footer className="flex flex-col gap-2 p-3"><Button variant="ghost" onClick={onSearch}><SearchIcon data-icon="inline-start"/>Search contents</Button><ExplorerPagination page={safePage} pages={pages} onPage={pageTo}/><span className="text-xs text-muted-foreground">j / k to move · / to filter · Esc to close</span></footer>
  </div>;
}
