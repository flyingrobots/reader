import {ChevronLeftIcon,ChevronRightIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Pagination,PaginationContent,PaginationItem} from '@/components/ui/pagination';

/** Molecule: real disabled buttons inside the shared Pagination composition. */
export function ExplorerPagination({page,pages,onPage}:{page:number;pages:number;onPage:(page:number)=>void}){
  return <Pagination data-explorer-pagination="" aria-label="Article pages"><PaginationContent className="w-full justify-between">
    <PaginationItem><Button variant="outline" size="sm" aria-label="Previous article page" disabled={page===0} onClick={()=>onPage(page-1)}><ChevronLeftIcon data-icon="inline-start"/>Previous</Button></PaginationItem>
    <PaginationItem><span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">{page+1} / {pages}</span></PaginationItem>
    <PaginationItem><Button variant="outline" size="sm" aria-label="Next article page" disabled={page+1>=pages} onClick={()=>onPage(page+1)}>Next<ChevronRightIcon data-icon="inline-end"/></Button></PaginationItem>
  </PaginationContent></Pagination>;
}
