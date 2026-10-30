/* Molecules: the three states every Admin read can be in besides "here it is". EmptyState is the shadcn Empty (nothing
   to show, said plainly); LoadingState is a Spinner row while a read is pending; Unavailable is the destructive Notice
   for a read that failed, so a failure is never drawn as zero or as healthy. */
import type {ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from '@/components/ui/empty';
import {Item, ItemContent, ItemDescription, ItemMedia} from '@/components/ui/item';
import {Spinner} from '@/components/ui/spinner';
import {Notice} from './notice';

export function EmptyState({icon:Icon,title,description,children,...props}:{icon?:LucideIcon;title:ReactNode;description?:ReactNode;children?:ReactNode;id?:string}){
  return <Empty className="border border-dashed p-6 md:p-8" data-empty="" {...props}>
    <EmptyHeader>
      {Icon?<EmptyMedia variant="icon"><Icon aria-hidden/></EmptyMedia>:null}
      <EmptyTitle>{title}</EmptyTitle>
      {description?<EmptyDescription>{description}</EmptyDescription>:null}
    </EmptyHeader>
    {children?<EmptyContent>{children}</EmptyContent>:null}
  </Empty>;
}

export function LoadingState({children='Loading…'}:{children?:ReactNode}){
  return <Item size="xs" className="px-0" data-loading="" role="status">
    <ItemMedia><Spinner aria-hidden/></ItemMedia>
    <ItemContent><ItemDescription>{children}</ItemDescription></ItemContent>
  </Item>;
}

export function Unavailable({what,error,...props}:{what:ReactNode;error:string;id?:string}){
  return <Notice tone="error" title={<>{what} unavailable</>} data-unavailable="" role="status" {...props}>{error}</Notice>;
}
