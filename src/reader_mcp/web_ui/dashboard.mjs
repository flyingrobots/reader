/** Reading statistics, counted from catalog works and exact-version receipts. */
import {escapeHTML as esc, formatDate, plainQuote, plural, readActivity} from './logic.mjs';
import {drawArrivalCalendar, drawReadingTopics, mountShelves} from './library-charts.mjs';

export function weeklyArrivals(works,today,count=12){
  const end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-(end.getUTCDay()+6)%7);
  const bins=Array.from({length:count},(_,i)=>{const day=new Date(end);day.setUTCDate(day.getUTCDate()-7*(count-i-1));return {key:day.toISOString().slice(0,10),label:day.toISOString().slice(0,10),value:0,works:[]};});
  for(const work of works){if(!/^\d{4}-\d{2}-\d{2}$/.test(work.date || ''))continue;const day=new Date(work.date+'T00:00:00Z');if(Number.isNaN(+day))continue;day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);const bin=bins.find(b=>b.key===day.toISOString().slice(0,10));if(bin){bin.value++;bin.works.push(work);}}
  return bins;
}
export function groupWorks(works,key,{multiple=false,limit=7}={}){
  const groups=new Map();
  for(const work of works){let values=typeof key==='function'?key(work):work[key];values=Array.isArray(values)?values:[values || 'Unspecified'];if(!multiple)values=values.slice(0,1);for(const value of new Set(values.length?values:['Unspecified'])){if(!groups.has(value))groups.set(value,[]);groups.get(value).push(work);}}
  const rows=[...groups].map(([label,items])=>({key:label,label,value:items.length,works:items})).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
  if(rows.length<=limit)return rows;
  const rest=rows.slice(limit-1),items=[...new Map(rest.flatMap(row=>row.works).map(work=>[work.primary,work])).values()];
  return [...rows.slice(0,limit-1),{key:'__other',label:'Other',value:items.length,works:items}];
}
export function sizeBand(work){const size=work.primary_bytes;if(!Number.isFinite(size)||size<0)return 'Unknown';return size<10240?'Under 10 KiB':size<51200?'10–50 KiB':size<262144?'50–256 KiB':size<1048576?'256 KiB–1 MiB':'1 MiB or more';}
const palette=Array.from({length:8},(_,i)=>`var(--chart-${i+1})`);

// Embedded in Behind the scenes, the page owns the header and the h1; the dashboard keeps its sections.
export function mountDashboard({root,data,prefs,embedded=false,workRows,wireDocumentLinks,openPicker,openPreferences,navigate,showTooltip,hideTooltip,seek}){
  const $=selector=>root.querySelector(selector), works=data.works;
  // In-session document opens update works before the next server bootstrap.
  const readCount=works.filter(work=>work.read).length,m={...data.metrics,works:works.length,read:readCount,unread:works.length-readCount};
  const weeks=weeklyArrivals(works,data.today),thisWeek=weeks.at(-1)?.value || 0,undated=works.filter(w=>!w.date).length;
  const topics=groupWorks(works,'topics'),formats=groupWorks(works,w=>(w.primary_format || 'Unknown').replace(/^\./,'').toUpperCase()),types=groupWorks(works,'types');
  const authorRows=groupWorks(works,'authors',{multiple:true,limit:10000}).slice(0,7),projects=groupWorks(works,'projects');
  const sizes=groupWorks(works,sizeBand,{limit:10});const order=['Under 10 KiB','10–50 KiB','50–256 KiB','256 KiB–1 MiB','1 MiB or more','Unknown'];sizes.sort((a,b)=>order.indexOf(a.label)-order.indexOf(b.label));
  const status=[{key:'Read',label:'Read',value:m.read,works:works.filter(w=>w.read)},{key:'Unread',label:'Unread',value:m.unread,works:works.filter(w=>!w.read)}];
  const discussion=data.discussion || {open:m.threads,resolved:0,comments:0,highlights:0,warnings:0};
  const panel=(id,title,note,extra='')=>`<section class="stat-panel" id="panel-${id}" aria-labelledby="title-${id}"><div class="panel-heading"><h2 id="title-${id}">${title}</h2>${extra}</div><div class="chart-mount" id="chart-${id}"></div><p class="panel-note">${note}</p></section>`;
  const header=`<header class="dashboard-header"><div><a href="#" class="folio-brand" data-home>Reader<span class="dot">.</span></a><span class="dashboard-edition">Library statistics</span></div><div class="dashboard-actions"><button type="button" id="dashboard-profile" data-button="ghost sm" class="profile-button">${esc(data.participant)} <span aria-hidden="true">↗</span></button><button type="button" id="dashboard-open" data-button="outline sm" class="dashboard-open">Open a document <kbd>Space e</kbd></button></div></header>`;
  root.innerHTML=`<div class="home dashboard${embedded?' embedded':''}">${embedded?'':header}<div class="dashboard-intro"><div>${embedded?'<h3 class="dashboard-title" id="dashboard-title">Reading statistics</h3>':'<h1 class="dashboard-title" id="home-title">Reading statistics</h1>'}<p>Current library holdings and your reading activity.</p></div><span class="dashboard-snapshot">Catalog · ${esc(formatDate(data.as_of))}<br>Current editions · ${esc(formatDate(data.today))}</span></div><section class="dashboard-totals" aria-label="Library metrics">${[[m.works,'Catalog works'],[m.read,'Read by you'],[m.unread,'Unread editions'],[thisWeek,'Arrived this week'],[m.authors,'Authors'],[m.threads,'Passage threads']].map(([n,label],i)=>`<button class="total-cell" data-total="${i}"><strong>${n.toLocaleString()}</strong><span>${label}</span></button>`).join('')}</section><div class="statistics-grid">${panel('arrivals','Arrivals over time','Last 12 weeks · recorded arrival / filing dates','<button type="button" data-button="ghost xs" id="arrivals-view" aria-pressed="false" aria-label="Show arrival calendar">Calendar</button>')}${prefs.activity?panel('activity','Your reading activity','Latest current-edition read marks · 28 days'):''}${panel('reading','Read & unread','Exact-version opened status for '+esc(data.participant))}${panel('topics','Works by topic','First catalog topic · one slice per work')}${panel('formats','Works by format','Primary sources · attachments counted with their work')}${panel('types','Kinds of writing','First catalog type · grouped works')}${panel('authors','On your shelves, by author','Top 7 authors · a coauthored work counts for each')}${panel('projects','Works by project','First catalog project · select a bar to explore')}${panel('sizes','Primary source sizes','Source bytes · a size distribution, not reading time')}${panel('waiting','Reading by topic','First topic · current-edition opened status')}${panel('discussion','In the margins',plural(discussion.comments,'comment')+' · '+plural(discussion.warnings,'warning'))}${prefs.atlas?panel('atlas','A map of the stacks','First topic → first project → work · select a shelf to zoom','<button type="button" data-button="ghost xs" class="chart-reset" id="atlas-reset">Reset</button>'):''}</div><section class="dashboard-explore" aria-labelledby="editions-title"><div class="explore-heading"><div><span class="eyebrow">Explore the works behind the numbers</span><h2 id="editions-title">Latest additions</h2></div><button type="button" id="dashboard-reset" data-button="link xs" class="text-button" hidden>Clear selection ×</button></div><p id="dashboard-selection" class="dashboard-selection" role="status" tabindex="-1">Select a chart segment or bar to browse its works.</p><ol class="reading-list" id="latest-list"></ol><button type="button" id="dashboard-more" data-button="link xs" class="text-button" hidden>Show more works</button><button type="button" id="all-works" data-button="link xs" class="text-button">Open the file picker ↗</button></section><section class="dashboard-margins"><div class="section-title"><h2>Unread discussion</h2><span class="quiet">${data.pending.length?'Latest threads':'All caught up'}</span></div>${data.pending.length?data.pending.slice(0,3).map(t=>({...t,quote:plainQuote(t.quote)})).map(t=>`<button class="margin-item" data-thread-link="${esc(t.id)}" data-path="${esc(t.path)}"><span class="who">${esc(t.owner)}</span><span class="quote">“${esc(t.quote.slice(0,140))}${t.quote.length>140?'…':''}”</span><span class="count">${plural(t.comments,'comment')} · ${formatDate(t.at)}</span></button>`).join(''):'<p class="empty-note">No unread passage threads for this participant.</p>'}</section><footer class="dashboard-footnote"><span>Grouped catalog works, including their attachments. Charts describe the current holdings and recorded arrival/filing dates.<br>${undated===1?'1 work has':undated.toLocaleString()+' works have'} no arrival date and are excluded from time charts. Read marks record opened editions, rather than reading duration.</span><button type="button" id="personalize" data-button="link xs" class="text-button">Customize this dashboard ↗</button></footer></div>`;
  let selection=null,chosenWorks=[],shown=8;
  function renderSelection(){
    $('#latest-list').innerHTML=workRows(chosenWorks.slice(0,shown));
    if(!chosenWorks.length)$('#latest-list').innerHTML='<li class="empty-note">No works in this selection.</li>';
    $('#dashboard-more').hidden=shown>=chosenWorks.length;
    wireDocumentLinks($('#latest-list'));
  }
  $('#dashboard-more').onclick=()=>{shown+=8;renderSelection();};
  function select(label,items,key=label){
    const repeated=selection===key;selection=repeated?null:key;
    const chosen=repeated?works:items;
    $('#editions-title').textContent=repeated?'Latest additions':label;
    $('#dashboard-selection').textContent=repeated?'Select a chart segment or bar to browse its works.':`${chosen.length.toLocaleString()} matching ${chosen.length===1?'work':'works'} · newest arrivals first`;
    $('#dashboard-reset').hidden=repeated;
    chosenWorks=[...chosen].sort((a,b)=>(b.date || '').localeCompare(a.date || '')||a.title.localeCompare(b.title));shown=8;renderSelection();
    root.querySelectorAll('[data-chart-choice]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.chartChoice===selection)));
    if(document.activeElement?.closest('.chart-mount,.dashboard-totals'))$('#dashboard-selection').focus({preventScroll:true});
    if(label)seek($('.dashboard-explore'));
  }
  const choose=(row,key=row.label)=>select(row.label,row.works,key);
  $('#dashboard-reset').onclick=()=>{selection='';select('',works);};
  $('#personalize').onclick=openPreferences;$('#all-works').onclick=()=>openPicker('all');if(!embedded){$('#dashboard-profile').onclick=openPreferences;$('#dashboard-open').onclick=()=>openPicker('all');}
  root.querySelectorAll('[data-total]').forEach((button,i)=>button.onclick=()=>{if(i===0)select('All catalog works',works);else if(i===1)choose(status[0]);else if(i===2)choose(status[1]);else if(i===3)select('Arrived this week',weeks.at(-1).works);else if(i===4)seek($('#panel-authors'));else seek($('#panel-discussion'));});
  function svg(id){return d3.select($('#chart-'+id)).append('svg').attr('viewBox','0 0 360 176').attr('role','img').attr('aria-labelledby','title-'+id);}
  function interactive(nodes,action,detail=row=>plural(row.value,'work')){
    nodes.attr('tabindex',0).attr('role','button').attr('aria-label',row=>`${row.label}: ${detail(row)}`).on('mouseenter focus',function(event,row){showTooltip(event,row.label,detail(row));}).on('mouseleave blur',hideTooltip).on('click',(event,row)=>{hideTooltip();action(row);}).on('keydown',(event,row)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();hideTooltip();action(row);}});
  }
  function legend(id,rows,action=row=>choose(row,id+':'+row.key)){
    const holder=d3.select($('#chart-'+id)).append('div').attr('class','chart-legend');
    rows.forEach((row,i)=>holder.append('button').attr('type','button').attr('data-chart-choice',id+':'+row.key).attr('aria-pressed','false').on('click',()=>action(row)).html(`<i style="background:${palette[i%palette.length]}" aria-hidden="true"></i><span>${esc(row.label)}</span><strong>${row.value.toLocaleString()}</strong>`));
  }
  function donut(id,rows,center,note,action=row=>choose(row,id+':'+row.key)){
    const mount=$('#chart-'+id);mount.classList.add('donut-layout');const chart=svg(id).attr('viewBox','0 0 180 176');
    const arc=d3.arc().innerRadius(48).outerRadius(69).cornerRadius(1.5),pieces=d3.pie().sort(null).value(row=>row.value)(rows),group=chart.append('g').attr('transform','translate(90,88)');
    group.append('circle').attr('r',60).attr('fill','none').attr('stroke','var(--line)').attr('stroke-width',20);
    const paths=group.selectAll('path').data(pieces).join('path').attr('d',arc).attr('fill',(_,i)=>palette[i%palette.length]).attr('stroke','var(--surface)').attr('stroke-width',2);
    interactive(paths,part=>action(part.data),part=>plural(part.value,'work'));paths.attr('aria-label',part=>`${part.data.label}: ${part.value.toLocaleString()}`).on('mouseenter focus',function(event,part){showTooltip(event,part.data.label,`${part.value.toLocaleString()} · ${d3.sum(rows,row=>row.value)?Math.round(part.value/d3.sum(rows,row=>row.value)*100):0}%`);});
    group.append('text').attr('class','donut-total').attr('text-anchor','middle').attr('y',0).text(center);group.append('text').attr('class','donut-caption').attr('text-anchor','middle').attr('y',20).text(note);legend(id,rows,action);
  }
  function horizontal(id,rows){
    const chart=svg(id),x=d3.scaleLinear().domain([0,Math.max(1,d3.max(rows,row=>row.value))]).range([137,323]),y=d3.scaleBand().domain(rows.map(row=>row.key)).range([8,165]).padding(.42);
    const groups=chart.selectAll('g.row').data(rows).join('g').attr('class','chart-bar-row');
    groups.append('text').attr('x',128).attr('y',row=>y(row.key)+y.bandwidth()/2+3).attr('text-anchor','end').attr('class','axis-text').text(row=>row.label.length>20?row.label.slice(0,18)+'…':row.label);
    groups.append('rect').attr('x',137).attr('y',row=>y(row.key)).attr('width',row=>Math.max(1,x(row.value)-137)).attr('height',y.bandwidth()).attr('rx',1).attr('fill',(_,i)=>palette[i%palette.length]);
    groups.append('text').attr('x',row=>x(row.value)+6).attr('y',row=>y(row.key)+y.bandwidth()/2+3).attr('class','bar-value').text(row=>row.value);
    groups.append('rect').attr('x',0).attr('y',row=>y(row.key)-5).attr('width',360).attr('height',y.step()).attr('fill','transparent');interactive(groups,row=>choose(row,id+':'+row.key));
  }
  function columns(id,rows,{labelDate=false,detail='works',action=row=>choose(row,id+':'+row.key),line=false}={}){
    const chart=svg(id),x=d3.scaleBand().domain(rows.map(row=>row.key)).range([30,350]).padding(.3),y=d3.scaleLinear().domain([0,Math.max(1,d3.max(rows,row=>row.value))]).nice().range([145,13]);
    chart.append('g').attr('class','chart-grid').attr('transform','translate(30,0)').call(d3.axisLeft(y).tickValues(y.ticks(3).filter(Number.isInteger)).tickSize(-320).tickFormat(d3.format('~s'))).call(g=>g.select('.domain').remove());
    const bars=chart.selectAll('rect').data(rows).join('rect').attr('x',row=>x(row.key)).attr('y',row=>y(row.value)).attr('width',x.bandwidth()).attr('height',row=>Math.max(row.value?2:0,145-y(row.value))).attr('rx',1).attr('fill',(_,i)=>palette[i%2]);interactive(bars,action,row=>`${row.value.toLocaleString()} ${detail}`);
    if(line){bars.attr('opacity',.35);chart.append('path').datum(rows).attr('fill','none').attr('stroke','var(--chart-1)').attr('stroke-width',2).attr('pointer-events','none').attr('d',d3.line().x(row=>x(row.key)+x.bandwidth()/2).y(row=>y(row.value)).curve(d3.curveMonotoneX));const points=chart.selectAll('circle').data(rows).join('circle').attr('cx',row=>x(row.key)+x.bandwidth()/2).attr('cy',row=>y(row.value)).attr('r',3).attr('fill','var(--chart-1)');interactive(points,action,row=>`${row.value.toLocaleString()} ${detail}`);}
    const tickRows=rows.filter((_,i)=>rows.length<8||i%Math.ceil(rows.length/5)===0);
    chart.selectAll('text.x-label').data(tickRows).join('text').attr('class','axis-text').attr('x',row=>x(row.key)+x.bandwidth()/2).attr('y',165).attr('text-anchor','middle').text(row=>labelDate?formatDate(row.key):row.label);
  }
  let calendar=false;
  const arrivalsView=$('#arrivals-view');
  function drawArrivals(){
    $('#chart-arrivals').replaceChildren();
    if(calendar)drawArrivalCalendar({mount:$('#chart-arrivals'),works,today:data.today,select,showTooltip,hideTooltip});
    else columns('arrivals',weeks,{labelDate:true,line:true});
    arrivalsView.textContent=calendar?'Weekly':'Calendar';arrivalsView.setAttribute('aria-pressed',String(calendar));arrivalsView.setAttribute('aria-label',calendar?'Show weekly arrivals':'Show arrival calendar');
  }
  arrivalsView.onclick=()=>{hideTooltip();calendar=!calendar;drawArrivals();};drawArrivals();
  if(prefs.activity){const rows=readActivity(works,data.today).map(day=>({key:day.date,label:day.date,value:day.count,works:day.works}));columns('activity',rows,{labelDate:true,detail:'latest read marks'});}
  donut('reading',status,Math.round(m.works?m.read/m.works*100:0)+'%','read');donut('topics',topics,m.works,'works');donut('formats',formats,formats.length,'formats');donut('types',types,m.works,'works');
  horizontal('authors',authorRows);horizontal('projects',projects);horizontal('sizes',sizes);drawReadingTopics({mount:$('#chart-waiting'),works,select,showTooltip,hideTooltip});
  const threadRows=[{key:'Open',label:'Open threads',value:discussion.open,works:works.filter(w=>data.pending.some(t=>t.path===w.primary))},{key:'Resolved',label:'Resolved threads',value:discussion.resolved,works:[]}];
  donut('discussion',threadRows,m.threads,'threads',row=>{if(row.value)select(row.label,works.filter(w=>(discussion.paths?.[row.key.toLowerCase()] || []).includes(w.primary)));});
  if(prefs.atlas){
    const shelves=mountShelves({mount:$('#chart-atlas'),works,navigate,select,showTooltip,hideTooltip});
    $('#atlas-reset').onclick=()=>{shelves.reset();selection='';select('',works);};
  }
  wireDocumentLinks(root);select('',works);
  return {select};
}
