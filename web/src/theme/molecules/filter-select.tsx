/* Molecule: one list filter, a labelled shadcn Select whose first choice is "All" (the empty value). Filters sit in a
   wrapping row with the list's Refresh button (see FilterBar). */
import type {ReactNode} from 'react';
import {Field, FieldLabel} from '@/components/ui/field';
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';

export type FilterChoice={value:string;label:string};
export function FilterSelect({id,label,value,choices,onChange}:{id:string;label:string;value:string;choices:FilterChoice[];onChange:(value:string)=>void}){
  const items=[{value:'',label:'All'},...choices];
  return <Field className="w-full min-w-0 sm:w-48" data-filter={id}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={items} value={value} onValueChange={next=>onChange(next??'')}>
      <SelectTrigger id={id} size="sm" className="w-full min-w-0"><SelectValue className="truncate"/></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}><SelectGroup>{items.map(item=><SelectItem key={item.value||'all'} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </Field>;
}

/** The row of filters above a list, with its actions (Refresh) aligned to the bottom of the fields. */
export function FilterBar({label,children,actions}:{label:string;children:ReactNode;actions?:ReactNode}){
  return <div role="group" aria-label={label} className="flex flex-wrap items-end gap-3" data-filter-bar="">{children}{actions?<div className="flex gap-2">{actions}</div>:null}</div>;
}
