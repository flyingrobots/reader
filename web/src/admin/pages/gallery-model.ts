/* Admin › Library's gallery chart data: the arrival calendar, reading by topic and the shelves hierarchy. Pure functions
   of catalog works (the counting unit; attachments never count), shared by library-charts.ts and the Node unit tests.
   Patterns: observablehq.com/@d3/{calendar/2,stacked-horizontal-bar-chart/2,zoomable-icicle}. */

export type GalleryWork={primary:string;title:string;topics?:string[];projects?:string[];date?:string|null;read?:boolean};
export type CalendarDay<W extends GalleryWork=GalleryWork>={key:string;label:string;value:number;works:W[];week:number;weekday:number};
export type TopicSegment<W extends GalleryWork=GalleryWork>={key:string;label:string;value:number;works:W[];series:number};
export type TopicRow<W extends GalleryWork=GalleryWork>={key:string;label:string;value:number;works:W[];segments:TopicSegment<W>[]};
export type Shelf<W extends GalleryWork=GalleryWork>={name:string;children?:Shelf<W>[];work?:W;value?:number};

const dayMs=86400000;

/** A plain YYYY-MM-DD date that exists, or null. */
function dateValue(value:string|null|undefined){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value?date:null;
}

/** "Oct 23" for a plain date, as logic.mjs's formatDate writes it. */
export function shortDate(day:string){
  return new Intl.DateTimeFormat('en',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
}

export const plural=(count:number,word:string)=>`${count.toLocaleString()} ${count===1?word:word+'s'}`;

/** Monday-first days from `weeks` calendar weeks ago through today, each with the works that arrived that day. */
export function arrivalCalendar<W extends GalleryWork>(works:W[],today:string,weeks=12):CalendarDay<W>[]{
  const end=dateValue(today);if(!end)return [];
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7-7*(weeks-1));
  const rows=Array.from({length:Math.round((+end-+start)/dayMs)+1},(_,i):CalendarDay<W>=>{
    const key=new Date(+start+i*dayMs).toISOString().slice(0,10);
    return {key,label:key,value:0,works:[],week:Math.floor(i/7),weekday:i%7};
  });
  const byDay=new Map(rows.map(row=>[row.key,row]));
  for(const work of works){const row=work.date?byDay.get(work.date):undefined;if(row){row.value++;row.works.push(work);}}
  return rows;
}

/** Works by first topic, largest first, with the rest folded into Other topics; each row splits into read and unread. */
export function readingTopics<W extends GalleryWork>(works:W[],limit=7):TopicRow<W>[]{
  const groups=new Map<string,W[]>();
  for(const work of works){const name=work.topics?.[0]||'Unspecified';if(!groups.has(name))groups.set(name,[]);groups.get(name)!.push(work);}
  let rows=[...groups].map(([label,items])=>({key:JSON.stringify(['topic',label]),label,works:items,value:items.length})).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
  if(rows.length>limit){const others=rows.slice(limit-1);rows=[...rows.slice(0,limit-1),{key:'topic-remainder',label:'Other topics',works:others.flatMap(row=>row.works),value:others.reduce((sum,row)=>sum+row.value,0)}];}
  return rows.map(row=>({...row,segments:[true,false].map((read,i)=>{const items=row.works.filter(work=>Boolean(work.read)===read);
    return {key:JSON.stringify([row.key,read]),label:row.label+' · '+(read?'Read':'Unread'),value:items.length,works:items,series:i};})}));
}

/** First topic → first project → work, for the zoomable shelves. */
export function shelfHierarchy<W extends GalleryWork & {title:string}>(works:W[]):Shelf<W>{
  const topics=new Map<string,Map<string,Shelf<W>[]>>();
  for(const work of works){
    const topic=work.topics?.[0]||'Unspecified topic',project=work.projects?.[0]||'Unspecified project';
    if(!topics.has(topic))topics.set(topic,new Map());const projects=topics.get(topic)!;
    if(!projects.has(project))projects.set(project,[]);projects.get(project)!.push({name:work.title,work,value:1});
  }
  return {name:'All shelves',children:[...topics].map(([name,projects])=>({name,children:[...projects].map(([name,children])=>({name,children}))}))};
}
