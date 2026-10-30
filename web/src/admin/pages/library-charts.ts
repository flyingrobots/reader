/* Admin › Library's charts, drawn with the vendored D3 (loaded by index.html as the global `d3`) into a chart card's
   mount. The card, its title, note and legend are React (library.tsx); this file draws only the SVG, keeps every mark
   keyboard-reachable, and reports a choice back. Colours are the theme's --chart-N tokens and --line/--surface. */
declare const d3:any;

export type ChartRow={key:string;label:string;value:number;works:LibraryWork[]};
export type LibraryWork={primary:string;title:string;authors?:string[];projects?:string[];topics?:string[];date?:string|null;date_label:string;read?:boolean};
export type Panel={id:string;kind:'columns'|'donut'|'bars'|'atlas';title:string;note:string;rows:ChartRow[];center?:string|number;caption?:string;line?:boolean;detail?:string};
export type ChartHooks={choose:(row:ChartRow)=>void;tooltip:(event:Event,title:string,detail:string)=>void;hideTooltip:()=>void;open:(path:string)=>void;works:LibraryWork[]};

export const palette=Array.from({length:8},(_,i)=>`var(--chart-${i+1})`);
const plural=(n:number,word:string)=>`${n.toLocaleString()} ${n===1?word:word+'s'}`;

function svg(mount:HTMLElement,panel:Panel,viewBox='0 0 360 176'){
  return d3.select(mount).append('svg').attr('viewBox',viewBox).attr('role','img').attr('aria-labelledby','title-'+panel.id);
}
function interactive(nodes:any,action:(row:any)=>void,hooks:ChartHooks,label:(row:any)=>string,detail:(row:any)=>string){
  nodes.attr('tabindex',0).attr('role','button').attr('aria-label',(row:any)=>`${label(row)}: ${detail(row)}`)
    .on('mouseenter focus',(event:Event,row:any)=>hooks.tooltip(event,label(row),detail(row))).on('mouseleave blur',hooks.hideTooltip)
    .on('click',(_:Event,row:any)=>{hooks.hideTooltip();action(row);})
    .on('keydown',(event:KeyboardEvent,row:any)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();hooks.hideTooltip();action(row);}});
}

function columns(mount:HTMLElement,panel:Panel,hooks:ChartHooks){
  const rows=panel.rows,chart=svg(mount,panel),detail=(row:ChartRow)=>`${row.value.toLocaleString()} ${panel.detail||'works'}`;
  const x=d3.scaleBand().domain(rows.map(row=>row.key)).range([30,350]).padding(.3),y=d3.scaleLinear().domain([0,Math.max(1,d3.max(rows,(row:ChartRow)=>row.value))]).nice().range([145,13]);
  chart.append('g').attr('class','chart-grid').attr('transform','translate(30,0)').call(d3.axisLeft(y).tickValues(y.ticks(3).filter(Number.isInteger)).tickSize(-320).tickFormat(d3.format('~s'))).call((g:any)=>g.select('.domain').remove());
  const bars=chart.selectAll('rect').data(rows).join('rect').attr('x',(row:ChartRow)=>x(row.key)).attr('y',(row:ChartRow)=>y(row.value)).attr('width',x.bandwidth())
    .attr('height',(row:ChartRow)=>Math.max(row.value?2:0,145-y(row.value))).attr('rx',1).attr('fill',(_:unknown,i:number)=>palette[i%2]);
  interactive(bars,hooks.choose,hooks,row=>row.label,detail);
  if(panel.line){
    bars.attr('opacity',.35);
    chart.append('path').datum(rows).attr('fill','none').attr('stroke','var(--chart-1)').attr('stroke-width',2).attr('pointer-events','none')
      .attr('d',d3.line().x((row:ChartRow)=>x(row.key)+x.bandwidth()/2).y((row:ChartRow)=>y(row.value)).curve(d3.curveMonotoneX));
    const points=chart.selectAll('circle').data(rows).join('circle').attr('cx',(row:ChartRow)=>x(row.key)+x.bandwidth()/2).attr('cy',(row:ChartRow)=>y(row.value)).attr('r',3).attr('fill','var(--chart-1)');
    interactive(points,hooks.choose,hooks,row=>row.label,detail);
  }
  const ticks=rows.filter((_,i)=>rows.length<8||i%Math.ceil(rows.length/5)===0);
  chart.selectAll('text.x-label').data(ticks).join('text').attr('class','axis-text').attr('x',(row:ChartRow)=>x(row.key)+x.bandwidth()/2).attr('y',165).attr('text-anchor','middle').text((row:ChartRow)=>row.label);
}

function donut(mount:HTMLElement,panel:Panel,hooks:ChartHooks){
  const rows=panel.rows,total=d3.sum(rows,(row:ChartRow)=>row.value),chart=svg(mount,panel,'0 0 180 176');
  const arc=d3.arc().innerRadius(48).outerRadius(69).cornerRadius(1.5),pieces=d3.pie().sort(null).value((row:ChartRow)=>row.value)(rows),group=chart.append('g').attr('transform','translate(90,88)');
  group.append('circle').attr('r',60).attr('fill','none').attr('stroke','var(--line)').attr('stroke-width',20);
  const paths=group.selectAll('path').data(pieces).join('path').attr('d',arc).attr('fill',(_:unknown,i:number)=>palette[i%palette.length]).attr('stroke','var(--surface)').attr('stroke-width',2);
  interactive(paths,(part:any)=>hooks.choose(part.data),hooks,(part:any)=>part.data.label,(part:any)=>`${part.value.toLocaleString()} · ${total?Math.round(part.value/total*100):0}%`);
  group.append('text').attr('class','donut-total').attr('text-anchor','middle').attr('y',0).text(String(panel.center??''));
  group.append('text').attr('class','donut-caption').attr('text-anchor','middle').attr('y',20).text(panel.caption||'');
}

function bars(mount:HTMLElement,panel:Panel,hooks:ChartHooks){
  const rows=panel.rows,chart=svg(mount,panel);
  const x=d3.scaleLinear().domain([0,Math.max(1,d3.max(rows,(row:ChartRow)=>row.value))]).range([137,323]),y=d3.scaleBand().domain(rows.map(row=>row.key)).range([8,165]).padding(.42);
  const groups=chart.selectAll('g.row').data(rows).join('g').attr('class','chart-bar-row');
  groups.append('text').attr('x',128).attr('y',(row:ChartRow)=>y(row.key)+y.bandwidth()/2+3).attr('text-anchor','end').attr('class','axis-text').text((row:ChartRow)=>row.label.length>20?row.label.slice(0,18)+'…':row.label);
  groups.append('rect').attr('x',137).attr('y',(row:ChartRow)=>y(row.key)).attr('width',(row:ChartRow)=>Math.max(1,x(row.value)-137)).attr('height',y.bandwidth()).attr('rx',1).attr('fill',(_:unknown,i:number)=>palette[i%palette.length]);
  groups.append('text').attr('x',(row:ChartRow)=>x(row.value)+6).attr('y',(row:ChartRow)=>y(row.key)+y.bandwidth()/2+3).attr('class','bar-value').text((row:ChartRow)=>row.value);
  groups.append('rect').attr('x',0).attr('y',(row:ChartRow)=>y(row.key)-5).attr('width',360).attr('height',y.step()).attr('fill','transparent');
  interactive(groups,hooks.choose,hooks,row=>row.label,row=>plural(row.value,'work'));
}

function atlas(mount:HTMLElement,panel:Panel,hooks:ChartHooks){
  const chart=svg(mount,panel,'0 0 360 180'),groups=d3.group(hooks.works,(w:LibraryWork)=>w.topics?.[0]||'Unclassified topic');
  const hierarchy=d3.hierarchy({children:[...groups].map(([name,children]:[string,LibraryWork[]])=>({name,children:children.map(w=>({...w,value:1}))}))}).sum((row:any)=>row.value||0).sort((a:any,b:any)=>b.value-a.value);
  d3.pack().size([350,170]).padding(4)(hierarchy);const group=chart.append('g').attr('transform','translate(5,5)');
  group.selectAll('.topic-circle').data(hierarchy.children||[]).join('circle').attr('class','topic-circle').attr('cx',(row:any)=>row.x).attr('cy',(row:any)=>row.y).attr('r',(row:any)=>row.r)
    .on('click',(_:Event,row:any)=>hooks.choose({key:'atlas:'+row.data.name,label:row.data.name,value:groups.get(row.data.name).length,works:groups.get(row.data.name)}));
  group.selectAll('.work-dot').data(hierarchy.leaves()).join('circle').attr('class','work-dot').attr('cx',(row:any)=>row.x).attr('cy',(row:any)=>row.y).attr('r',(row:any)=>Math.max(1,row.r))
    .attr('fill',(row:any)=>palette[(hierarchy.children||[]).indexOf(row.parent)%palette.length]).attr('tabindex',0).attr('role','link').attr('aria-label',(row:any)=>row.data.title)
    .on('click',(_:Event,row:any)=>hooks.open(row.data.primary))
    .on('keydown',(event:KeyboardEvent,row:any)=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();hooks.open(row.data.primary);}})
    .on('mouseenter focus',(event:Event,row:any)=>hooks.tooltip(event,row.data.title,row.data.authors?.join(' · ')||'')).on('mouseleave blur',hooks.hideTooltip);
}

const DRAW={columns,donut,bars,atlas};
/** Draws a panel's chart into an empty mount; returns a cleanup that removes it. */
export function drawChart(mount:HTMLElement,panel:Panel,hooks:ChartHooks){
  if(typeof d3==='undefined')return ()=>{};
  DRAW[panel.kind](mount,panel,hooks);
  return ()=>{hooks.hideTooltip();mount.replaceChildren();};
}
