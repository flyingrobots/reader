/** Gallery-inspired library views. Catalog works are the counting unit, never attachments.
 * Patterns: observablehq.com/@d3/{calendar/2,stacked-horizontal-bar-chart/2,zoomable-icicle}.
 * Uses Reader's locally shipped D3 and theme tokens; no network requests or inferred links.
 */
import {formatDate, plural} from './logic.mjs';

const colors=['var(--chart-1)','var(--chart-2)'];
const dayMs=86400000;
function dateValue(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return null;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value?date:null;
}
export function arrivalCalendar(works,today,weeks=12){
  const end=dateValue(today);if(!end)return [];
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7-7*(weeks-1));
  const rows=Array.from({length:Math.round((end-start)/dayMs)+1},(_,i)=>{
    const date=new Date(+start+i*dayMs),key=date.toISOString().slice(0,10);
    return {key,label:key,value:0,works:[],week:Math.floor(i/7),weekday:i%7};
  });
  const byDay=new Map(rows.map(row=>[row.key,row]));
  for(const work of works){const row=byDay.get(work.date);if(row){row.value++;row.works.push(work);}}
  return rows;
}
export function readingTopics(works,limit=7){
  const groups=new Map();
  for(const work of works){const name=work.topics?.[0] || 'Unspecified';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(work);}
  let rows=[...groups].map(([label,items])=>({key:JSON.stringify(['topic',label]),label,works:items,value:items.length})).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
  if(rows.length>limit){const others=rows.slice(limit-1);rows=[...rows.slice(0,limit-1),{key:'topic-remainder',label:'Other topics',works:others.flatMap(row=>row.works),value:others.reduce((sum,row)=>sum+row.value,0)}];}
  return rows.map(row=>({...row,segments:[true,false].map((read,i)=>({key:JSON.stringify([row.key,read]),label:row.label+' · '+(read?'Read':'Unread'),value:row.works.filter(work=>Boolean(work.read)===read).length,works:row.works.filter(work=>Boolean(work.read)===read),series:i}))}));
}
export function shelfHierarchy(works){
  const topics=new Map();
  for(const work of works){
    const topic=work.topics?.[0] || 'Unspecified topic',project=work.projects?.[0] || 'Unspecified project';
    if(!topics.has(topic))topics.set(topic,new Map());const projects=topics.get(topic);
    if(!projects.has(project))projects.set(project,[]);projects.get(project).push({name:work.title,work,value:1});
  }
  return {name:'All shelves',children:[...topics].map(([name,projects])=>({name,children:[...projects].map(([name,children])=>({name,children}))}))};
}
function activate(nodes,action,showTooltip,hideTooltip){
  nodes.attr('tabindex',0).attr('role','button').attr('data-chart-choice',row=>row.key).attr('aria-pressed','false').attr('aria-label',row=>`${row.label}: ${plural(row.value,'work')}`)
    .on('mouseenter focus',(event,row)=>showTooltip(event,row.label,plural(row.value,'work'))).on('mouseleave blur',hideTooltip)
    .on('click',(_,row)=>{hideTooltip();action(row);}).on('keydown',(event,row)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();hideTooltip();action(row);}});
}
export function drawArrivalCalendar({mount,works,today,select,showTooltip,hideTooltip}){
  const rows=arrivalCalendar(works,today),chart=d3.select(mount).append('svg').attr('viewBox','0 0 360 176').attr('role','group').attr('aria-label','Daily arrivals, last twelve calendar weeks');
  const max=Math.max(1,...rows.map(row=>row.value)),cell=22,left=46,top=18;
  chart.selectAll('.calendar-weekday').data(['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).join('text').attr('class','axis-text').attr('x',38).attr('y',(_,i)=>top+i*cell+14).attr('text-anchor','end').text(day=>day);
  chart.selectAll('.calendar-day').data(rows).join('rect').attr('class','calendar-day').attr('x',row=>left+row.week*cell).attr('y',row=>top+row.weekday*cell).attr('width',19).attr('height',19).attr('rx',2).attr('fill',row=>row.value?'var(--chart-1)':'var(--raised)').attr('fill-opacity',row=>row.value ? .35+.65*row.value/max : 1).attr('stroke','var(--chart-stroke, var(--line))');
  const active=chart.selectAll('.calendar-day').filter(row=>row.value>0);activate(active,row=>select(formatDate(row.key),row.works,'calendar:'+row.key),showTooltip,hideTooltip);
  active.attr('data-chart-choice',row=>'calendar:'+row.key).attr('aria-label',row=>`${formatDate(row.key)}: ${plural(row.value,'arrival')}`);
  chart.selectAll('.calendar-count').data(rows.filter(row=>row.value)).join('text').attr('class','calendar-count').attr('x',row=>left+row.week*cell+9.5).attr('y',row=>top+row.weekday*cell+13).attr('text-anchor','middle').text(row=>row.value>99?'99+':row.value).attr('pointer-events','none');
  chart.selectAll('.calendar-month').data(rows.filter(row=>row.weekday===0&&(row.week===0||row.key.slice(8)<='07'))).join('text').attr('class','axis-text').attr('x',row=>left+row.week*cell).attr('y',10).text(row=>formatDate(row.key));
  if(!rows.some(row=>row.value))d3.select(mount).append('p').attr('class','chart-empty').text('No recorded arrivals in these twelve weeks.');
}
export function drawReadingTopics({mount,works,select,showTooltip,hideTooltip}){
  const rows=readingTopics(works),chart=d3.select(mount).append('svg').attr('viewBox','0 0 360 176').attr('role','group').attr('aria-label','Read and unread current editions by first topic');
  const x=d3.scaleLinear().domain([0,Math.max(1,...rows.map(row=>row.value))]).range([137,323]),y=d3.scaleBand().domain(rows.map(row=>row.key)).range([8,165]).padding(.42);
  const groups=chart.selectAll('.topic-reading-row').data(rows).join('g').attr('class','topic-reading-row');
  const labels=groups.append('text').attr('class','axis-text').attr('x',128).attr('y',row=>y(row.key)+y.bandwidth()/2+3).attr('text-anchor','end').text(row=>row.label.length>20?row.label.slice(0,18)+'…':row.label);
  activate(labels,row=>select(row.label,row.works,row.key),showTooltip,hideTooltip);
  groups.each(function(row){
    let offset=0;
    const segments=row.segments.map(segment=>{const start=offset;offset+=segment.value;return {...segment,start};}).filter(segment=>segment.value);
    const bars=d3.select(this).selectAll('rect').data(segments).join('rect').attr('class','topic-reading-segment').attr('x',segment=>x(segment.start)).attr('y',y(row.key)).attr('width',segment=>x(segment.start+segment.value)-x(segment.start)).attr('height',y.bandwidth()).attr('fill',segment=>colors[segment.series]).attr('stroke','var(--chart-stroke, var(--surface))');
    activate(bars,segment=>select(segment.label,segment.works,segment.key),showTooltip,hideTooltip);
  });
  groups.append('text').attr('class','bar-value').attr('x',row=>x(row.value)+5).attr('y',row=>y(row.key)+y.bandwidth()/2+3).text(row=>row.value);
  const legend=d3.select(mount).append('div').attr('class','chart-series-key');
  ['Read','Unread'].forEach((label,i)=>legend.append('span').text(label).style('border-color',colors[i]));
  if(!rows.length)d3.select(mount).append('p').attr('class','chart-empty').text('No catalog works to compare.');
}
export function mountShelves({mount,works,navigate,select,showTooltip,hideTooltip}){
  const tree=d3.hierarchy(shelfHierarchy(works)).sum(node=>node.value || 0).sort((a,b)=>b.value-a.value||a.data.name.localeCompare(b.data.name));
  d3.partition().size([1,tree.height+1])(tree);
  const holder=d3.select(mount).classed('shelf-chart',true),navigation=holder.append('nav').attr('class','shelf-breadcrumbs').attr('aria-label','Shelf location');
  const picker=holder.append('select').attr('class','shelf-picker').attr('aria-label','Open a shelf or work');
  const chart=holder.append('svg').attr('viewBox','0 0 360 210').attr('role','group').attr('aria-label','Zoomable shelves, sized by catalog work count');
  const context=holder.append('p').attr('class','shelf-context').attr('role','status');let focus=tree;
  function open(node){if(node.data.work){hideTooltip();navigate(node.data.work.primary);}else{focus=node;draw();}}
  function draw(){
    const restoreFocus=mount.contains(document.activeElement);
    hideTooltip();navigation.selectAll('*').remove();
    focus.ancestors().reverse().forEach(node=>navigation.append('button').attr('type','button').attr('aria-current',node===focus?'location':null).text(node.data.name).on('click',()=>{focus=node;draw();}));
    const children=focus.children || [],options=[null,...children];
    picker.selectAll('option').data(options).join('option').attr('value',(_,i)=>i).text(node=>node?`${node.data.name} · ${plural(node.value,'work')}`:'Choose a shelf or work…');picker.property('value','0').property('disabled',!children.length).on('change',event=>{const node=children[Number(event.target.value)-1];if(node)open(node);});
    const span=focus.x1-focus.x0;
    // Only draw readable cells. The native shelf picker exposes every child, including tiny cells.
    const visible=focus.descendants().filter(node=>node!==focus&&node.depth<=focus.depth+2&&(node.x1-node.x0)/span*210>=18);
    const cells=chart.selectAll('g').data(visible,node=>JSON.stringify(node.ancestors().reverse().map(n=>n.data.work?.primary || n.data.name))).join('g').attr('class','shelf-cell').attr('transform',node=>`translate(${(node.depth-focus.depth-1)*180},${(node.x0-focus.x0)/span*210})`);
    cells.selectAll('*').remove();
    cells.append('rect').attr('width',178).attr('height',node=>(node.x1-node.x0)/span*210-2).attr('fill',node=>colors[(node.depth-1)%2]).attr('stroke','var(--chart-stroke, var(--line))');
    cells.append('rect').attr('class','shelf-label-background').attr('x',3).attr('y',1).attr('width',node=>Math.min(172,Math.min(24,node.data.name.length)*6+8)).attr('height',16).attr('fill','var(--surface)').attr('pointer-events','none');
    cells.append('text').attr('x',7).attr('y',13).text(node=>node.data.name.length>24?node.data.name.slice(0,22)+'…':node.data.name).attr('pointer-events','none');
    cells.append('title').text(node=>`${node.ancestors().reverse().map(n=>n.data.name).join(' › ')} · ${plural(node.value,'work')}`);
    cells.attr('tabindex',0).attr('role',node=>node.data.work?'link':'button').attr('aria-label',node=>`${node.data.name}: ${plural(node.value,'work')}${node.data.work?'. Open document':'. Zoom into shelf'}`).on('click',(_,node)=>open(node)).on('keydown',(event,node)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();open(node);}}).on('mouseenter focus',(event,node)=>showTooltip(event,node.data.name,plural(node.value,'work'))).on('mouseleave blur',hideTooltip);
    chart.attr('aria-label',`Shelves in ${focus.data.name}, sized by catalog work count`);
    context.selectAll('*').remove();
    if(children.length){context.append('button').attr('type','button').attr('data-button','link xs').text(`Browse ${plural(focus.value,'work')} on this shelf`).on('click',()=>select(focus.ancestors().reverse().map(n=>n.data.name).join(' › '),focus.leaves().map(node=>node.data.work).filter(Boolean),'shelf:'+JSON.stringify(focus.ancestors().map(n=>n.data.name))));}
    else context.text('No catalog works on these shelves.');
    // Redrawing must not strand keyboard focus on a removed cell or breadcrumb.
    if(restoreFocus&&mount.isConnected)picker.node().focus({preventScroll:true});
  }
  draw();
  return {reset(){focus=tree;draw();}};
}
