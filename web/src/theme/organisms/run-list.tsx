/* Organism: a list of runs, newest first, as a shadcn ItemGroup of RunRows divided by ItemSeparators. `render` returns
   the row Item itself (role listitem), a direct child of the group so the group's spacing rules apply. */
import {Fragment, type ReactNode} from 'react';
import {ItemGroup, ItemSeparator} from '@/components/ui/item';

export function RunList<T>({runs,keyOf,render,label,...props}:{runs:T[];keyOf:(run:T)=>string;render:(run:T)=>ReactNode;label:string;id?:string}){
  return <ItemGroup role="list" aria-label={label} data-run-list="" {...props}>
    {runs.map((run,index)=><Fragment key={keyOf(run)}>{index?<ItemSeparator role="presentation"/>:null}{render(run)}</Fragment>)}
  </ItemGroup>;
}
