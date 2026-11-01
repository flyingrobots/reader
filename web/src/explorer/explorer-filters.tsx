import {Field,FieldGroup,FieldLabel} from '@/components/ui/field';
import {Input} from '@/components/ui/input';
import {Select,SelectContent,SelectGroup,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import type {ReadFilter,SortOrder} from './model';

function ExplorerChoice({id,label,value,items,onChange}:{id:string;label:string;value:string;items:{value:string;label:string}[];onChange:(value:string)=>void}){
  return <Field className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={items} value={value} onValueChange={next=>{if(next!==null)onChange(next);}}>
      <SelectTrigger id={id} className="w-full min-w-0"><SelectValue className="truncate"/></SelectTrigger>
      <SelectContent alignItemWithTrigger={false}><SelectGroup>{items.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </Field>;
}
/** Molecule: labelled filtering and sorting controls, built from the shared shadcn atoms. */
export function ExplorerFilters({query,read,sort,onQuery,onRead,onSort}:{query:string;read:ReadFilter;sort:SortOrder;onQuery:(value:string)=>void;onRead:(value:ReadFilter)=>void;onSort:(value:SortOrder)=>void}){
  return <FieldGroup className="gap-3">
    <Field><FieldLabel htmlFor="file-query">Filter articles</FieldLabel><Input id="file-query" value={query} placeholder="Title, author, project, or path…" autoComplete="off" onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='Enter'){event.preventDefault();const first=document.querySelector<HTMLButtonElement>('#file-results [data-article-row]');if(event.key==='Enter')first?.click();else first?.focus();}}} onChange={event=>onQuery(event.target.value)}/></Field>
    <div className="grid grid-cols-2 gap-2">
      <ExplorerChoice id="explorer-read" label="Reading status" value={read} items={[{value:'',label:'All articles'},{value:'unread',label:'Unread'},{value:'read',label:'Read'}]} onChange={value=>onRead(value as ReadFilter)}/>
      <ExplorerChoice id="explorer-sort" label="Sort by" value={sort} items={[{value:'newest',label:'Newest first'},{value:'oldest',label:'Oldest first'},{value:'title',label:'Title A–Z'},{value:'author',label:'Author A–Z'}]} onChange={value=>onSort(value as SortOrder)}/>
    </div>
  </FieldGroup>;
}
