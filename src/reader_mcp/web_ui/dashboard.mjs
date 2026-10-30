/** Reading statistics, counted from catalog works and exact-version receipts, for Admin › Library. */
import {formatDate, plainQuote, plural, readActivity} from './logic.mjs';

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

/** Admin › Library's model: every count, chart row and label the React page (web/src/admin/pages/library.tsx) renders.
 *  Plain data only; the page draws charts and handles selection. Dates arrive formatted, so the page needs no locale logic. */
export function libraryModel({data,prefs}){
  const works=data.works.map(w=>({...w,date_label:formatDate(w.date)})),byPath=new Map(works.map(w=>[w.primary,w])),m=data.metrics,lift=list=>list.map(w=>byPath.get(w.primary)||w);
  const rows=list=>list.map(row=>({...row,works:lift(row.works)}));
  const weeks=rows(weeklyArrivals(works,data.today)).map(row=>({...row,label:formatDate(row.key)})),thisWeek=weeks.at(-1)?.value || 0,undated=works.filter(w=>!w.date).length;
  const sizes=groupWorks(works,sizeBand,{limit:10});const order=['Under 10 KiB','10–50 KiB','50–256 KiB','256 KiB–1 MiB','1 MiB or more','Unknown'];sizes.sort((a,b)=>order.indexOf(a.label)-order.indexOf(b.label));
  const status=[{key:'Read',label:'Read',value:m.read,works:works.filter(w=>w.read)},{key:'Unread',label:'Unread',value:m.unread,works:works.filter(w=>!w.read)}];
  const discussion=data.discussion || {open:m.threads,resolved:0,comments:0,highlights:0,warnings:0};
  const formats=groupWorks(works,w=>(w.primary_format || 'Unknown').replace(/^\./,'').toUpperCase());
  const threads=[{key:'Open',label:'Open threads',value:discussion.open,works:works.filter(w=>(discussion.paths?.open || []).includes(w.primary))},
    {key:'Resolved',label:'Resolved threads',value:discussion.resolved,works:works.filter(w=>(discussion.paths?.resolved || []).includes(w.primary))}];
  const panels=[
    {id:'arrivals',kind:'columns',title:'Arrivals over time',note:'Last 12 weeks · recorded arrival / filing dates',rows:weeks,line:true,detail:'works'},
    ...(prefs.activity?[{id:'activity',kind:'columns',title:'Your reading activity',note:'Latest current-edition read marks · 28 days',rows:readActivity(works,data.today).map(day=>({key:day.date,label:formatDate(day.date),value:day.count,works:lift(day.works)})),detail:'latest read marks'}]:[]),
    {id:'reading',kind:'donut',title:'Read & unread',note:'Exact-version opened status for '+data.participant,rows:status,center:Math.round(m.works?m.read/m.works*100:0)+'%',caption:'read'},
    {id:'topics',kind:'donut',title:'Works by topic',note:'First catalog topic · one slice per work',rows:groupWorks(works,'topics'),center:m.works,caption:'works'},
    {id:'formats',kind:'donut',title:'Works by format',note:'Primary sources · attachments counted with their work',rows:formats,center:formats.length,caption:'formats'},
    {id:'types',kind:'donut',title:'Kinds of writing',note:'First catalog type · grouped works',rows:groupWorks(works,'types'),center:m.works,caption:'works'},
    {id:'authors',kind:'bars',title:'On your shelves, by author',note:'Top 7 authors · a coauthored work counts for each',rows:groupWorks(works,'authors',{multiple:true,limit:10000}).slice(0,7)},
    {id:'projects',kind:'bars',title:'Works by project',note:'First catalog project · select a bar to explore',rows:groupWorks(works,'projects')},
    {id:'sizes',kind:'bars',title:'Primary source sizes',note:'Source bytes · a size distribution, not reading time',rows:sizes},
    {id:'waiting',kind:'bars',title:'Still waiting, by topic',note:'Unread current editions · select a topic to explore',rows:groupWorks(works.filter(w=>!w.read),'topics')},
    {id:'discussion',kind:'donut',title:'In the margins',note:plural(discussion.comments,'comment')+' · '+plural(discussion.warnings,'warning'),rows:threads,center:m.threads,caption:'threads'},
    ...(prefs.atlas?[{id:'atlas',kind:'atlas',title:'A map of the stacks',note:'Each dot is a work · hover to inspect, click to read',rows:[]}]:[])];
  return {participant:data.participant,catalog:formatDate(data.as_of),today:formatDate(data.today),works,undated,panels,
    totals:[{key:'works',value:m.works,label:'Catalog works',works},{key:'read',value:m.read,label:'Read by you',works:status[0].works},{key:'unread',value:m.unread,label:'Unread editions',works:status[1].works},
      {key:'week',value:thisWeek,label:'Arrived this week',works:weeks.at(-1)?.works||[]},{key:'authors',value:m.authors,label:'Authors',panel:'authors'},{key:'threads',value:m.threads,label:'Passage threads',panel:'discussion'}],
    pending:data.pending.slice(0,3).map(t=>({id:t.id,path:t.path,owner:t.owner,quote:plainQuote(t.quote),comments:plural(t.comments,'comment'),at:formatDate(t.at)}))};
}
