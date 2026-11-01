import {FileTextIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Item,ItemContent,ItemTitle,ItemDescription} from '@/components/ui/item';
import type {Article} from './model';

/** Molecule: shadcn Item + Button, title, metadata, and a receipt-state Badge. */
export function ArticleRow({article,current,onOpen}:{article:Article;current:boolean;onOpen:()=>void}){
  return <Item render={<Button variant="ghost"/>} className="h-auto w-full justify-start whitespace-normal text-left" data-article-row="" data-path={article.primary} data-read={article.read===true} aria-current={current?'page':undefined} onClick={onOpen}>
    <ItemContent className="min-w-0">
      <ItemTitle className="w-full"><FileTextIcon aria-hidden/><span className="line-clamp-2">{article.title}</span></ItemTitle>
      <ItemDescription className="line-clamp-2">{article.authors?.join(', ')}{article.date?<> · {article.date}</>:null}</ItemDescription>
      <ItemDescription data-article-path="" className="truncate" title={article.primary}>{article.primary}</ItemDescription>
      <Badge variant={article.read?'outline':'secondary'}>{article.read?'Read':'Unread'}</Badge>
    </ItemContent>
  </Item>;
}
