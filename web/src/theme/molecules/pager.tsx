/* Molecule: cursor paging for a newest-first list: an optional count, then Newer and Older. Lists here read bounded
   pages by cursor, so there are no page numbers to show. */
import type {ReactNode} from 'react';
import {ChevronLeftIcon, ChevronRightIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';

export function Pager({count,newer,older,onNewer,onOlder}:{count?:ReactNode;newer:boolean;older:boolean;onNewer:()=>void;onOlder:()=>void}){
  return <nav aria-label="Pages" className="flex items-center gap-2" data-pager="">
    {count?<span className="mr-auto text-sm text-muted-foreground tabular-nums">{count}</span>:<span className="mr-auto"/>}
    <Button size="sm" variant="ghost" disabled={!newer} onClick={onNewer}><ChevronLeftIcon data-icon="inline-start" aria-hidden/>Newer</Button>
    <Button size="sm" variant="ghost" disabled={!older} onClick={onOlder}>Older<ChevronRightIcon data-icon="inline-end" aria-hidden/></Button>
  </nav>;
}
