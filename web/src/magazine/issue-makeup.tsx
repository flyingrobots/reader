/* Topic & makeup visualization above "In this issue".
   D3 computes geometry; React owns the SVG and shadcn owns its frame and controls. */
import {useEffect,useMemo,useRef,useState} from 'react';
import {XIcon} from 'lucide-react';
import {cn} from 'cn';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';

declare const d3:any;

export type MakeupPiece={path:string;title:string;href:string;read:boolean;section:string;type:string|null;date:string};
export type MakeupSection={name:string;other?:boolean;count:number;unread:number;read:number};
export type MakeupTopic={name:string;other?:boolean;count:number;unread:number;read:number;children:MakeupSection[];pieces:MakeupPiece[]};
export type MakeupForm={name:string;other?:boolean;count:number;unread:number;read:number;pieces:MakeupPiece[]};
export type IssueMakeupModel={total:number;unread:number;read:number;topicCount:number;topics:MakeupTopic[];forms:MakeupForm[]};

type Selection={kind:'topic'|'form';name:string}|null;
type TreemapBox={name:string;other?:boolean;count:number;unread:number;read:number;x0:number;y0:number;x1:number;y1:number;colorIndex:number;
  sections:{name:string;count:number;unread:number;read:number;x0:number;y0:number;x1:number;y1:number}[]};

const PALETTE=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)','var(--chart-5)','var(--chart-6)','var(--chart-7)','var(--chart-8)'];
const plural=(n:number,one:string,many=one+'s')=>n===1?one:many;
const clip=(text:string,width:number,pxPerChar=6.2)=>{const max=Math.floor((width-10)/pxPerChar);return max<3?'':text.length<=max?text:text.slice(0,max-1)+'…';};
const activationKey=(e:{key:string})=>e.key==='Enter'||e.key===' ';

function useWidth(ref:{current:HTMLElement|null},fallback:number){
  const [width,setWidth]=useState(fallback);
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    const measure=()=>setWidth(Math.max(220,Math.round(el.clientWidth)||fallback));
    measure();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(measure);observer.observe(el);
    return ()=>observer.disconnect();
  },[fallback]);
  return width;
}

export function IssueMakeup({makeup,hasCover,wire}:{makeup:IssueMakeupModel;hasCover:boolean;wire:(element:HTMLElement)=>void}){
  const [selected,setSelected]=useState<Selection>(null);
  const [hovered,setHovered]=useState<string|null>(null);
  const treemapRef=useRef<HTMLDivElement>(null);
  const breakdownRef=useRef<HTMLDivElement>(null);
  const trayRef=useRef<HTMLDivElement>(null);

  const treemapW=useWidth(treemapRef,560);
  const treemapH=Math.max(220,Math.min(340,Math.round(treemapW*0.54)));
  const breakdownW=useWidth(breakdownRef,340);

  useEffect(()=>{setSelected(null);setHovered(null);},[makeup]);
  useEffect(()=>{if(selected&&trayRef.current)wire(trayRef.current);},[selected,wire]);

  const boxes=useMemo<TreemapBox[]>(()=>{
    if(!makeup.topics.length||typeof d3==='undefined')return [];
    const data={name:'root',children:makeup.topics.map((topic,index)=>({
      ...topic,colorIndex:index,
      children:(topic.children.length?topic.children:[{name:topic.name,count:topic.count,unread:topic.unread,read:topic.read}]),
    }))};
    const root=d3.hierarchy(data).sum((node:any)=>node.children?0:Math.max(1,node.count||0)).sort((a:any,b:any)=>(b.value||0)-(a.value||0));
    d3.treemap().tile(d3.treemapSquarify.ratio(1.35)).size([treemapW,treemapH]).paddingOuter(4).paddingTop(24).paddingInner(4).round(true)(root);
    return (root.children||[]).map((group:any)=>({
      name:group.data.name,other:group.data.other,count:group.data.count,unread:group.data.unread,read:group.data.read,
      x0:group.x0,y0:group.y0,x1:group.x1,y1:group.y1,colorIndex:group.data.colorIndex,
      sections:(group.children||[]).map((leaf:any)=>({
        name:leaf.data.name,count:leaf.data.count,unread:leaf.data.unread,read:leaf.data.read,
        x0:leaf.x0,y0:leaf.y0,x1:leaf.x1,y1:leaf.y1,
      })),
    }));
  },[makeup.topics,treemapW,treemapH]);

  const formLayout=useMemo(()=>{
    const forms=makeup.forms;
    if(!forms.length||typeof d3==='undefined')return {rows:[],barX:104,barMaxW:120,height:0};
    const labelW=breakdownW<290?80:breakdownW>=340?134:112,countW=34,barX=labelW+8,barMaxW=Math.max(44,breakdownW-barX-countW);
    const height=Math.max(34,forms.length*30);
    const y=d3.scaleBand().domain(forms.map(f=>f.name)).range([0,height]).paddingInner(0.26);
    const x=d3.scaleLinear().domain([0,Math.max(1,...forms.map(f=>f.count))]).range([0,barMaxW]);
    return {barX,barMaxW,height,rows:forms.map(f=>({
      ...f,y:y(f.name)||0,bw:y.bandwidth(),unreadW:f.unread?Math.max(3,x(f.unread)):0,totalW:Math.max(3,x(f.count)),
    }))};
  },[makeup.forms,breakdownW]);

  const balance=useMemo(()=>{
    if(!makeup.total||typeof d3==='undefined')return {unreadW:0,readW:0};
    const x=d3.scaleLinear().domain([0,makeup.total]).range([0,breakdownW]);
    const unreadW=makeup.unread?Math.max(4,Math.min(breakdownW,x(makeup.unread))):0;
    return {unreadW,readW:Math.max(0,breakdownW-unreadW)};
  },[makeup.total,makeup.unread,breakdownW]);

  if(!makeup.total)return null;

  const activeGroup=selected?.kind==='topic'
    ?makeup.topics.find(t=>t.name===selected.name)
    :selected?.kind==='form'?makeup.forms.find(f=>f.name===selected.name):null;
  const unreadPct=Math.round(100*makeup.unread/makeup.total);
  const toggle=(kind:'topic'|'form',name:string)=>setSelected(prev=>prev&&prev.kind===kind&&prev.name===name?null:{kind,name});

  return <section className={cn('issue-makeup col-span-full pt-10 pb-9 @min-[1360px]/issue:border-t @min-[1360px]/issue:border-border',hasCover&&'@min-[1360px]/issue:col-[1/13]')} aria-labelledby="makeup-title">
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="issue-section-title font-serif text-3xl font-[450] tracking-[-.01em]" id="makeup-title">Topics &amp; makeup</h2>
        <p className="m-0 text-xs text-muted-foreground tabular-nums">{makeup.total} {plural(makeup.total,'piece')} · {makeup.unread} unread · {makeup.topicCount} {plural(makeup.topicCount,'topic')}</p>
      </div>
      {selected?<Button type="button" variant="ghost" size="xs" onClick={()=>setSelected(null)}>Show full overview</Button>:null}
    </div>

    <div className="grid grid-cols-1 gap-6 @min-[840px]/issue:grid-cols-[minmax(0,1.45fr)_minmax(240px,1fr)] @min-[840px]/issue:items-start">
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-[650] tracking-[.1em] uppercase text-muted-foreground">Topic landscape by section</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">Area = pieces · dot = unread</span>
        </div>
        <div ref={treemapRef} className="w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card">
          {boxes.length?<svg className="block h-auto w-full select-none" width={treemapW} height={treemapH} viewBox={`0 0 ${treemapW} ${treemapH}`} role="img" aria-label={`Topic landscape for ${makeup.total} works in this issue`} data-makeup-treemap="">
            {boxes.map(box=>{
              const bw=Math.max(0,box.x1-box.x0),bh=Math.max(0,box.y1-box.y0);
              const color=PALETTE[box.colorIndex%PALETTE.length];
              const isSelected=selected?.kind==='topic'&&selected.name===box.name;
              const titleClip=clip(box.name,bw-24,6.4);
              const countLabel=bw>=40?String(box.count):'';
              const summaryText=`${box.name}: ${box.count} ${plural(box.count,'piece')} (${box.unread} unread) · ${box.sections.map(s=>`${s.name} ${s.count}`).join(', ')}`;
              return <g key={box.name} transform={`translate(${box.x0},${box.y0})`} className="cursor-pointer focus:outline-none" role="button" tabIndex={0} aria-pressed={isSelected} aria-label={summaryText}
                data-topic-tile={box.name} onClick={()=>toggle('topic',box.name)}
                onKeyDown={e=>{if(activationKey(e)){e.preventDefault();toggle('topic',box.name);}}}
                onMouseEnter={()=>setHovered(summaryText)} onFocus={()=>setHovered(summaryText)}
                onMouseLeave={()=>setHovered(null)} onBlur={()=>setHovered(null)}>
                <title>{summaryText}</title>
                <rect width={bw} height={bh} rx={5} fill="var(--card)" stroke={isSelected?'var(--primary)':'var(--border)'} strokeWidth={isSelected?2:1}/>
                <rect x={1} y={1} width={Math.max(0,bw-2)} height={3} rx={1.5} fill={color}/>
                {titleClip?<text x={8} y={17} fill="var(--foreground)" fontSize={11} fontWeight={650}>{titleClip}</text>:null}
                {countLabel?<text x={bw-8} y={17} textAnchor="end" fill="var(--foreground)" fontSize={10.5} fontWeight={500}>{countLabel}</text>:null}
                {box.sections.map(sec=>{
                  const lx=sec.x0-box.x0,ly=sec.y0-box.y0,lw=Math.max(0,sec.x1-sec.x0),lh=Math.max(0,sec.y1-sec.y0);
                  const secLabel=lw>=54&&lh>=22?clip(sec.name,lw-(sec.unread>0?18:10),6.1):'';
                  const secMeta=lw>=62&&lh>=36?`${sec.count} · ${sec.unread} unread`:'';
                  return <g key={sec.name} transform={`translate(${lx},${ly})`}>
                    <rect width={lw} height={lh} rx={3} fill={color} fillOpacity={sec.unread>0?0.16:0.06} stroke="var(--border)" strokeWidth={0.75}/>
                    <rect width={3} height={lh} rx={1.5} fill={color} fillOpacity={sec.unread>0?0.9:0.32}/>
                    {sec.unread>0&&lw>=18&&lh>=14?<circle cx={lw-8} cy={10} r={2.5} fill={color}/>:null}
                    {secLabel?<text x={8} y={14} fill="var(--foreground)" fontSize={10.5} fontWeight={550} paintOrder="stroke" stroke="var(--card)" strokeWidth={2.5} strokeLinejoin="round">{secLabel}</text>:null}
                    {secMeta?<text x={8} y={27} fill="var(--foreground)" fontSize={9.5} paintOrder="stroke" stroke="var(--card)" strokeWidth={2.5} strokeLinejoin="round">{secMeta}</text>:null}
                  </g>;
                })}
              </g>;
            })}
          </svg>:<div className="p-4 text-xs text-muted-foreground">Topic geometry unavailable.</div>}
        </div>
        <p className="mt-2 mb-0 min-h-4 text-xs text-muted-foreground tabular-nums" role="status" aria-live="polite" data-makeup-status="">
          {hovered||(activeGroup?`${activeGroup.name}: ${activeGroup.count} ${plural(activeGroup.count,'piece')} (${activeGroup.unread} unread)`:'Select a topic tile or form bar to inspect matching pieces.')}
        </p>
      </div>

      <div className="min-w-0 rounded-lg border border-border bg-card p-4">
        <div ref={breakdownRef} className="flex min-w-0 flex-col gap-5">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[11px] font-[650] tracking-[.1em] uppercase text-muted-foreground">Reading balance</span>
            <span className="text-xs font-medium text-foreground tabular-nums">{unreadPct}% unread · {makeup.unread} of {makeup.total}</span>
          </div>
          <svg className="block h-auto w-full select-none" width={breakdownW} height={18} viewBox={`0 0 ${breakdownW} 18`} role="img" aria-label={`Reading balance: ${makeup.unread} unread, ${makeup.read} read`} data-makeup-balance="">
            <rect x={0} y={2} width={breakdownW} height={14} rx={4} fill="var(--secondary)" stroke="var(--border)" strokeWidth={0.75}/>
            {balance.unreadW>0?<rect x={0} y={2} width={balance.unreadW} height={14} rx={4} fill="var(--chart-1)"/>:null}
          </svg>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1.5"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="var(--chart-1)"/></svg>Unread {makeup.unread}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-xs border border-border bg-secondary" aria-hidden="true"/>Read {makeup.read}</span>
          </div>
        </div>

        <div className="min-w-0 border-t border-border pt-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-[650] tracking-[.1em] uppercase text-muted-foreground">Forms in this issue</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">Unread / read</span>
          </div>
          {formLayout.rows.length?<svg className="block h-auto w-full select-none" width={breakdownW} height={formLayout.height} viewBox={`0 0 ${breakdownW} ${formLayout.height}`} role="img" aria-label="Document forms in this issue" data-makeup-forms="">
            {formLayout.rows.map((row:any)=>{
              const isSelected=selected?.kind==='form'&&selected.name===row.name;
              const rowLabel=clip(row.name,formLayout.barX-6,5.9)||row.name.slice(0,10);
              const cy=row.y+row.bw/2+4;
              const info=`${row.name}: ${row.count} ${plural(row.count,'piece')} (${row.unread} unread)`;
              return <g key={row.name} className="cursor-pointer focus:outline-none" role="button" tabIndex={0} aria-pressed={isSelected} aria-label={info}
                data-form-bar={row.name} onClick={()=>toggle('form',row.name)}
                onKeyDown={e=>{if(activationKey(e)){e.preventDefault();toggle('form',row.name);}}}
                onMouseEnter={()=>setHovered(info)} onFocus={()=>setHovered(info)}
                onMouseLeave={()=>setHovered(null)} onBlur={()=>setHovered(null)}>
                <title>{info}</title>
                <rect x={0} y={row.y} width={breakdownW} height={row.bw} rx={4} fill={isSelected?'var(--secondary)':'transparent'} stroke={isSelected?'var(--primary)':'none'} strokeWidth={1.5}/>
                <text x={4} y={cy} fill="var(--foreground)" fontSize={11.5} fontWeight={isSelected?650:500}>{rowLabel}</text>
                <rect x={formLayout.barX} y={row.y+2} width={formLayout.barMaxW} height={Math.max(8,row.bw-4)} rx={3} fill="var(--secondary)"/>
                <rect x={formLayout.barX} y={row.y+2} width={row.totalW} height={Math.max(8,row.bw-4)} rx={3} fill="var(--chart-5)" fillOpacity={0.35}/>
                {row.unreadW>0?<rect x={formLayout.barX} y={row.y+2} width={row.unreadW} height={Math.max(8,row.bw-4)} rx={3} fill="var(--chart-2)"/>:null}
                <text x={breakdownW-4} y={cy} textAnchor="end" fill="var(--foreground)" fontSize={11.5} fontWeight={600}>{row.count}</text>
              </g>;
            })}
          </svg>:null}
        </div>
        </div>
      </div>
    </div>

    {activeGroup?<div ref={trayRef} className="mt-4 rounded-lg border border-border bg-card p-4" data-makeup-tray="">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{selected?.kind==='topic'?'Topic':'Form'}</Badge>
          <span className="font-serif text-base font-medium text-foreground">{activeGroup.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{activeGroup.count} {plural(activeGroup.count,'piece')} · {activeGroup.unread} unread</span>
        </div>
        <Button type="button" variant="ghost" size="xs" aria-label="Clear selection" onClick={()=>setSelected(null)}><XIcon/>Clear</Button>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 @min-[700px]/issue:grid-cols-2">
        {activeGroup.pieces.map(piece=><li key={piece.path} className="min-w-0 border-t border-border pt-2">
          <a href={piece.href} className={cn('block text-sm leading-snug text-foreground hover:text-primary',piece.read&&'text-muted-foreground')}>{piece.title}</a>
          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground tabular-nums">
            <span>{piece.section}</span>
            {piece.type?<span>· {piece.type}</span>:null}
            <span>· {piece.date}</span>
            {!piece.read?<span>· unread</span>:null}
          </div>
        </li>)}
      </ul>
    </div>:null}
  </section>;
}
