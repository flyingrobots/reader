/* Molecule: labelled facts ("Library files · 18") as shadcn Items. `grid` (the default) tiles short facts responsively;
   `rows` gives each fact a full-width row (label column, then value) for long values such as paths and commands.
   Each fact keeps `data-fact` and its value `data-fact-value`, so checks find a fact by name rather than by layout. */
import type {ReactNode} from 'react';
import {cn} from 'cn';
import {Item, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle} from '@/components/ui/item';

export type FactEntry={key?:string;label:string;value:ReactNode};
export function FactList({facts,layout='grid',className}:{facts:FactEntry[];layout?:'grid'|'rows';className?:string}){
  const shown=facts.filter(fact=>fact.value!==null&&fact.value!==undefined&&fact.value!=='');
  if(!shown.length)return null;
  const value=(fact:FactEntry)=>typeof fact.value==='number'?fact.value.toLocaleString():fact.value;
  if(layout==='rows')return <ItemGroup role="list" className={cn('gap-0',className)}>
    {shown.map((fact,index)=><div key={fact.key||fact.label} className="contents">{index?<ItemSeparator role="presentation" className="my-0"/>:null}
      <Item role="listitem" size="xs" data-fact={fact.key||fact.label} className="grid grid-cols-1 items-baseline gap-0.5 px-0 py-1.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
        <ItemDescription className="text-xs sm:text-sm">{fact.label}</ItemDescription>
        <ItemTitle data-fact-value="" className="line-clamp-none font-normal tabular-nums [overflow-wrap:anywhere]">{value(fact)}</ItemTitle>
      </Item></div>)}
  </ItemGroup>;
  return <ItemGroup role="list" className={cn('grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2',className)}>
    {shown.map(fact=><Item key={fact.key||fact.label} role="listitem" variant="muted" size="xs" data-fact={fact.key||fact.label} className="items-start">
      <ItemContent className="gap-0.5">
        <ItemDescription className="text-xs">{fact.label}</ItemDescription>
        <ItemTitle data-fact-value="" className="tabular-nums [overflow-wrap:anywhere]">{value(fact)}</ItemTitle>
      </ItemContent>
    </Item>)}
  </ItemGroup>;
}
