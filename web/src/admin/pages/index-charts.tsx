/** D3 computes geometry; React owns the SVG and shadcn owns its frame and controls. */
import {useEffect, useRef, useState} from 'react';
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Skeleton} from '@/components/ui/skeleton';
import {IndexDocHelp} from './index-docs';
import type {Check, MaintenanceStatus} from '../../backstage';

declare const d3:any;
type Budget={key:string;index:string;label:string;used:number;limit:number;bytes:boolean};
const number=(n:number)=>n.toLocaleString();
const bytes=(n:number)=>n>=2**30?`${(n/2**30).toFixed(2)} GiB`:`${(n/2**20).toFixed(1)} MiB`;
const detail=(row:Budget)=>`${row.bytes?bytes(row.used):number(row.used)} of ${row.bytes?bytes(row.limit):number(row.limit)} · ${(row.used/row.limit*100).toFixed(1)}% used`;
function budgets(checks:Record<string,Check>,storage:boolean){
  const rows:Budget[]=[];
  const add=(index:string,key:string,label:string,pair:unknown,byteCount=false)=>{if(Array.isArray(pair)&&pair.length===2&&pair.every(v=>typeof v==='number'&&Number.isFinite(v))&&pair[0]>=0&&pair[1]>0)rows.push({key,index,label,used:pair[0],limit:pair[1],bytes:byteCount});};
  for(const [index,key,label] of storage?[['search','database','Search database'],['search','cache','Embedding cache'],['catalog','sources','Catalog sources']]:[['search','passages','Search passages'],['catalog','files','Catalog files']]){
    add(index,key,label,(checks[index]?.usage as Record<string,unknown>|undefined)?.[key],storage);
  }
  if(!storage)for(const item of (checks.limits?.items||[]) as {key:string;label:string;used:number|null;limit:number}[])add('limits',item.key,item.label,[item.used,item.limit]);
  return rows;
}

export function IndexCharts({status,selected,onSelect}:{status:MaintenanceStatus|null;selected:string;onSelect:(key:string)=>void}){
  const plot=useRef<HTMLDivElement|null>(null),[width,setWidth]=useState(520);
  useEffect(()=>{const element=plot.current;if(!element)return;const observer=new ResizeObserver(()=>setWidth(Math.max(280,Math.round(element.clientWidth-parseFloat(getComputedStyle(element).paddingLeft)-parseFloat(getComputedStyle(element).paddingRight)))));observer.observe(element);return ()=>observer.disconnect();},[]);
  const labelWidth=width<420?120:190,barWidth=Math.max(100,width-labelWidth-60);
  const [segment,setSegment]=useState(0),[hover,setHover]=useState<string|null>(null),[mode,setMode]=useState('storage');
  const checks=status?.checks||{},search=checks.search,text=search?.text_documents,missing=search?.unembedded;
  const known=typeof text==='number'&&typeof missing==='number'&&Number.isFinite(text)&&Number.isFinite(missing)&&text>=missing&&missing>=0;
  const parts=known?[{label:'Fully embedded',value:text-missing},{label:'Needs embeddings',value:missing}]:[];
  const ready=known&&text>0?Math.round((text-missing)/text*100):null;
  const rows=budgets(checks,mode==='storage');
  const available=typeof d3!=='undefined';
  const arc=available?d3.arc().innerRadius(70).outerRadius(94).padAngle(.025).cornerRadius(3):null;
  const slices=available?d3.pie().sort(null).value((part:{value:number})=>part.value)(parts):[];
  const x=available?d3.scaleLinear().domain([0,1]).range([0,barWidth]).clamp(true):null;
  const picked=parts[segment];
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]" data-index-charts="">
    <Card className="min-w-0" data-index-chart="coverage">
      <CardHeader><CardTitle>Semantic coverage<IndexDocHelp title="Semantic coverage" section="embedding-coverage"/></CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-center justify-center gap-4">
        {known&&text>0&&available?<svg viewBox="0 0 240 240" className="w-52 max-w-full shrink-0" role="group" aria-label="Semantic coverage of indexed text documents">
          <title>Semantic coverage</title><desc>Share of indexed text documents with embeddings. Select a segment or its label to inspect Search.</desc>
          <g transform="translate(120 120)">{slices.filter((s:any)=>s.value>0).map((slice:any)=>{
            const index=parts.indexOf(slice.data);return <path key={slice.data.label} d={arc(slice)} fill={`var(--chart-${index+1})`} opacity={segment===index?1:.55}
              className="cursor-pointer" role="button" tabIndex={0} aria-label={`${slice.data.label}: ${number(slice.value)} text documents`} aria-pressed={segment===index}
              onPointerEnter={()=>setSegment(index)} onFocus={()=>setSegment(index)} onClick={()=>{setSegment(index);onSelect('search');}}
              onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSegment(index);onSelect('search');}}}><title>{slice.data.label}: {number(slice.value)}</title></path>;})}
            <text textAnchor="middle" y="3" fill="currentColor" fontSize="36" fontWeight="600">{ready}%</text><text textAnchor="middle" y="27" fill="var(--muted)" fontSize="12">fully embedded</text>
          </g>
        </svg>:status&&search?<p className="text-sm text-muted-foreground">{known&&text===0?'No indexed text documents yet.':'Coverage has not been measured yet.'}</p>:<Skeleton className="size-48 rounded-full"/>}
        <div className="flex min-w-[12rem] max-w-full flex-1 flex-col gap-2">{parts.map((part,index)=><Button key={part.label} variant={segment===index?'secondary':'ghost'} className="h-auto justify-between gap-4 py-3" aria-pressed={segment===index} onClick={()=>{setSegment(index);onSelect('search');}}>
          <span className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full" style={{background:`var(--chart-${index+1})`}}/>{part.label}</span><span className="tabular-nums">{number(part.value)}</span>
        </Button>)}</div>
      </CardContent>
      <CardFooter><p className="text-sm text-muted-foreground" role="status">{picked?`${number(picked.value)} ${picked.label.toLowerCase()}`:'Not measured'}</p></CardFooter>
    </Card>
    <Card className="min-w-0" data-index-chart="capacity">
      <CardHeader><CardTitle>Capacity & headroom<IndexDocHelp title="Capacity charts" section="interactive-charts"/></CardTitle></CardHeader>
      <CardContent ref={plot}><Tabs value={mode} onValueChange={value=>{setMode(String(value));setHover(null);}}>
        <TabsList aria-label="Capacity measure"><TabsTrigger value="storage">Storage</TabsTrigger><TabsTrigger value="inventories">Inventories</TabsTrigger></TabsList>
        {['storage','inventories'].map(tab=><TabsContent key={tab} value={tab}>
          {tab===mode?(rows.length&&available?<svg viewBox={`0 0 ${width} ${rows.length*48+32}`} className="w-full" role="group" aria-label={`${mode==='storage'?'Storage':'Inventory'} capacity budgets`}>
            <title>{mode==='storage'?'Storage budgets':'Inventory budgets'}</title><desc>Each bar shows a percentage of its own configured limit. Exact usage and limits are available in View chart data.</desc>
            {[0,.5,1].map(tick=><g key={tick}><line x1={labelWidth+x(tick)} x2={labelWidth+x(tick)} y1="22" y2={rows.length*48+15} stroke="var(--line)" strokeDasharray="3 4"/><text x={labelWidth+x(tick)} y="13" textAnchor="middle" fill="var(--muted)" fontSize="10">{tick*100}%</text></g>)}
            {rows.map((row,i)=><g key={row.key} transform={`translate(0 ${i*48+30})`} className="cursor-pointer" role="button" tabIndex={0} aria-label={`${row.label}: ${detail(row)}`} aria-pressed={selected===row.index}
              onPointerEnter={()=>setHover(`${row.label}: ${detail(row)}`)} onPointerLeave={()=>setHover(null)} onFocus={()=>setHover(`${row.label}: ${detail(row)}`)} onBlur={()=>setHover(null)}
              onClick={()=>onSelect(row.index)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(row.index);}}}>
              <rect x="0" y="-5" width={width} height="38" rx="5" fill={selected===row.index?'var(--raised)':'transparent'}/>
              <text x="8" y="15" fill="currentColor" fontSize="12">{width<420&&row.label.length>17?row.label.slice(0,15)+'…':row.label}</text>
              <rect x={labelWidth} y="5" width={barWidth} height="12" rx="3" fill="var(--line)"/>
              <rect x={labelWidth} y="5" width={x(row.used/row.limit)} height="12" rx="3" fill={row.used>=row.limit?'var(--warning)':'var(--chart-1)'}/>
              <text x={width-7} y="16" textAnchor="end" fill="currentColor" fontSize="11">{(row.used/row.limit*100).toFixed(1)}%</text><title>{detail(row)}</title>
            </g>)}
          </svg>:status?<p className="py-8 text-sm text-muted-foreground">No measured budgets yet. Missing values are not zero usage.</p>:<Skeleton className="mt-4 h-40 w-full"/>):null}
        </TabsContent>)}
      </Tabs>
      {rows.length?<Collapsible className="mt-3"><CollapsibleTrigger render={<Button variant="ghost" size="sm"/>}>View chart data</CollapsibleTrigger>
        <CollapsibleContent><Table><TableHeader><TableRow><TableHead>Budget</TableHead><TableHead>Used</TableHead><TableHead>Limit</TableHead></TableRow></TableHeader><TableBody>{rows.map(row=><TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell className="tabular-nums">{row.bytes?bytes(row.used):number(row.used)}</TableCell><TableCell className="tabular-nums">{row.bytes?bytes(row.limit):number(row.limit)}</TableCell></TableRow>)}</TableBody></Table></CollapsibleContent>
      </Collapsible>:null}
      </CardContent>
      <CardFooter><p className="text-sm text-muted-foreground" role="status">{hover||'Usage / configured limit'}</p></CardFooter>
    </Card>
  </div>;
}
