/* Molecule: one run (a rebuild, a check, an inbox run, a model item) as a shadcn Item: its state icon, its name, when it
   ran and its one-line outcome. A failed outcome reads in the destructive colour. */
import type {ReactNode} from 'react';
import {cn} from 'cn';
import {Item, ItemContent, ItemDescription, ItemMedia, ItemTitle, ItemActions} from '@/components/ui/item';
import {RunStateIcon, type RunState} from '../atoms/run-state-icon';

export function RunRow({state,title,meta,outcome,actions,...props}:{state:RunState;title:ReactNode;meta?:ReactNode;outcome?:ReactNode;actions?:ReactNode}&Record<`data-${string}`,string|undefined>){
  return <Item size="xs" role="listitem" className="items-start px-0" data-run-state={state} {...props}>
    <ItemMedia variant="icon" className="mt-0.5"><RunStateIcon state={state}/></ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle className="[overflow-wrap:anywhere]">{title}</ItemTitle>
      {meta?<ItemDescription className="text-xs">{meta}</ItemDescription>:null}
      {outcome?<ItemDescription className={cn('line-clamp-none text-xs [overflow-wrap:anywhere]',state==='failed'&&'text-destructive')} data-outcome="">{outcome}</ItemDescription>:null}
    </ItemContent>
    {actions?<ItemActions>{actions}</ItemActions>:null}
  </Item>;
}
