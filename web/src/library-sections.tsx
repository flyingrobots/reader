import {useMemo,useState} from 'react';
import {ArrowLeftIcon,ChevronRightIcon} from 'lucide-react';
import {Item,ItemActions,ItemContent,ItemDescription,ItemGroup,ItemTitle} from './components/ui/item';
import {Button} from './components/ui/button';
import {Field,FieldLabel} from './components/ui/field';
import {Input} from './components/ui/input';
import {EmptyState} from './theme/molecules/states';
import {ArticleRow} from './explorer/article-row';
import {ExplorerPagination} from './explorer/explorer-pagination';
import {filterArticles,PAGE_SIZE,type Article} from './explorer/model';

export type SectionLink={label:string;count:number;href:string};
export function SectionItems({items}:{items:SectionLink[]}){
  return <ItemGroup aria-label="Library sections">{items.map(item=><Item key={item.label} variant="outline" size="sm" render={<a href={item.href}/>} data-library-section={item.label}>
    <ItemContent><ItemTitle>{item.label}</ItemTitle><ItemDescription>{item.count} {item.count===1?'article':'articles'} in the library</ItemDescription></ItemContent>
    <ItemActions><ChevronRightIcon aria-hidden/></ItemActions>
  </Item>)}</ItemGroup>;
}
export type SectionPageProps={label:string;articles:Article[];onOpen:(path:string)=>void;onHome:()=>void};
export function SectionPage({label,articles,onOpen,onHome}:SectionPageProps){
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const matches=useMemo(()=>filterArticles(articles,query,'','newest',null),[articles,query]);
  const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE)),safePage=Math.min(page,pages-1),rows=matches.slice(safePage*PAGE_SIZE,(safePage+1)*PAGE_SIZE);
  return <section data-ui="shadcn" data-section-page={label} className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-10">
    <Button variant="ghost" className="self-start" onClick={onHome}><ArrowLeftIcon data-icon="inline-start"/>Back to library</Button>
    <header className="flex flex-col gap-2"><h1 id="section-title" tabIndex={-1} className="text-3xl font-semibold">{label}</h1><p className="text-sm text-muted-foreground">{articles.length} {articles.length===1?'article':'articles'} in this section · newest first</p></header>
    <Field><FieldLabel htmlFor="section-query">Filter this section</FieldLabel><Input id="section-query" value={query} placeholder="Title, author, or path…" onChange={event=>{setQuery(event.target.value);setPage(0);}}/></Field>
    <p role="status" className="text-xs text-muted-foreground tabular-nums">{matches.length?`${safePage*PAGE_SIZE+1}–${safePage*PAGE_SIZE+rows.length} of ${matches.length} articles`:'0 articles'}</p>
    {rows.length?<ItemGroup aria-label="Section articles">{rows.map(article=><ArticleRow key={article.primary} article={article} current={false} onOpen={()=>onOpen(article.primary)}/>)}</ItemGroup>:<EmptyState title="No articles match" description="Try another filter."/>}
    <ExplorerPagination page={safePage} pages={pages} onPage={next=>{setPage(next);document.getElementById('section-title')?.scrollIntoView({block:'start'});}}/>
  </section>;
}
