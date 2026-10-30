/* Molecule: labelled facts ("Library files · 18") as a responsive grid of shadcn Items. Each fact keeps `data-fact` and
   its value `data-fact-value`, so checks find a fact by name rather than by layout. */
import type {ReactNode} from 'react';
import {cn} from 'cn';
import {Item, ItemContent, ItemDescription, ItemGroup, ItemTitle} from '@/components/ui/item';

export type FactEntry={key?:string;label:string;value:ReactNode};
export function FactList({facts,className}:{facts:FactEntry[];className?:string}){
  const shown=facts.filter(fact=>fact.value!==null&&fact.value!==undefined&&fact.value!=='');
  if(!shown.length)return null;
  return <ItemGroup role="list" className={cn('grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2',className)}>
    {shown.map(fact=><Item key={fact.key||fact.label} role="listitem" variant="muted" size="xs" data-fact={fact.key||fact.label} className="items-start">
      <ItemContent className="gap-0.5">
        <ItemDescription className="text-xs">{fact.label}</ItemDescription>
        <ItemTitle data-fact-value="" className="tabular-nums [overflow-wrap:anywhere]">{typeof fact.value==='number'?fact.value.toLocaleString():fact.value}</ItemTitle>
      </ItemContent>
    </Item>)}
  </ItemGroup>;
}
