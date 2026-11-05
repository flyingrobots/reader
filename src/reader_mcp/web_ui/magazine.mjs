/** The homepage as this week's issue: a cover story, features and contents chosen from recent additions. */
import {formatDate} from './logic.mjs';

// Types left out of an issue unless the reader changes the list in Settings.
export const DEFAULT_EXCLUDED_TYPES=['Task','Receipt','Manifest','Handoff'];
// The newsletter is an editorial signal for the issue; its working papers are not pieces of it.
export const EXCLUDED_FOLDERS=['library/newsletters/'];
export const FEATURES=4, MIN_FEATURES=3, QUIET=4, GROUP=6, CONTENTS=80;
const DAY=86400000;
// Bounded interest terms; the sum orders candidates. See docs/web.md.
export const WEIGHTS={unread:1,recency:.5,type:.4,engagement:.4,references:.3,pick:.5,short:-.3};
const TYPE_WEIGHTS=[[/essay|perspective|design|vision/i,.4],[/report|research|reflection|book|feature/i,.3],[/journal|reading notes|connection|guide/i,.25],[/note|document|draft|plan/i,.1],[/reference/i,.05]];
const TEXT=new Set(['.md','.markdown','.txt']);

const day=value=>new Date(value+'T00:00:00Z');
const iso=date=>date.toISOString().slice(0,10);
const shift=(value,days)=>iso(new Date(+day(value)+days*DAY));
const dated=work=>/^\d{4}-\d{2}-\d{2}$/.test(work.date||'');

/** ISO-8601 week (Monday start) containing a YYYY-MM-DD day. */
export function isoWeek(value){
  const date=day(value),weekday=(date.getUTCDay()+6)%7,thursday=new Date(+date+(3-weekday)*DAY),year=thursday.getUTCFullYear();
  const week=1+Math.floor((+thursday-Date.UTC(year,0,1))/(7*DAY));
  const start=iso(new Date(+date-weekday*DAY));
  return {id:`${year}-W${String(week).padStart(2,'0')}`,start,end:shift(start,6)};
}
/** The Monday-to-Sunday range of an ISO week id such as 2026-W43, or null. */
export function weekRange(id){
  const match=/^(\d{4})-W(\d{2})$/.exec(id||'');if(!match)return null;
  const year=+match[1],week=+match[2],jan4=new Date(Date.UTC(year,0,4)),monday=new Date(+jan4-((jan4.getUTCDay()+6)%7)*DAY+(week-1)*7*DAY);
  const start=iso(monday),found=isoWeek(start);return found.id===id?found:null;
}
export function parseExcluded(value){
  const list=Array.isArray(value)?value:typeof value==='string'?value.split(','):DEFAULT_EXCLUDED_TYPES;
  return list.map(item=>String(item).trim()).filter(Boolean);
}
const named=values=>(values||[]).filter(value=>typeof value==='string'&&value&&!/^(Unspecified|Unclassified)/.test(value));
function folderLabel(path){const folder=path.split('/')[1]||'Library';return path.split('/').length>2?folder.replace(/[-_]+/g,' ').replace(/^\w/,c=>c.toUpperCase()):'Library';}
/** Pieces in one issue should come from different places: the first named project, else the top folder. */
export function section(work){return named(work.projects)[0]||folderLabel(work.primary);}
export function baseTitle(title){return (title||'').toLocaleLowerCase().replace(/\s*\([^)]*\)?\s*$/,'').trim();}
export function words(work){return TEXT.has((work.primary_format||'').toLowerCase())&&Number.isFinite(work.primary_bytes)?Math.round(work.primary_bytes/6):null;}
export function minutes(work,pace=220){const count=words(work);return count===null?null:Math.max(1,Math.round(count/(pace||220)));}

export function candidates(works,{start,end,exclude=DEFAULT_EXCLUDED_TYPES}={}){
  const excluded=new Set(parseExcluded(exclude).map(type=>type.toLocaleLowerCase()));
  return works.filter(work=>dated(work)&&work.date>=start&&work.date<=end&&!EXCLUDED_FOLDERS.some(folder=>work.primary?.startsWith(folder))&&!(work.types||[]).some(type=>excluded.has(String(type).toLocaleLowerCase())));
}

/** The window an issue covers: its ISO week, widened to 14 days when fewer than four pieces arrived. */
export function issueWindow(works,{week,exclude}={}){
  const range=weekRange(week);if(!range)throw new Error('Expected an ISO week such as 2026-W43');
  const count=candidates(works,{...range,exclude}).length;
  if(count>=QUIET)return {...range,week:range.id,quiet:false};
  return {week:range.id,id:range.id,start:shift(range.start,-7),end:range.end,quiet:true};
}
/** Weeks that hold at least one candidate, newest first, up to `through`. */
export function issueWeeks(works,{exclude,through}={}){
  const counts=new Map();
  for(const work of candidates(works,{start:'0000-01-01',end:through||'9999-12-31',exclude})){const id=isoWeek(work.date).id;counts.set(id,(counts.get(id)||0)+1);}
  return [...counts].sort((a,b)=>b[0].localeCompare(a[0])).map(([id,count])=>({id,count,...weekRange(id)}));
}
/** The bare homepage: this week's issue, or the latest issue with pieces when nothing has arrived for two weeks. */
export function currentIssue(works,{today,exclude}){
  const here=isoWeek(today),window=issueWindow(works,{week:here.id,exclude});
  if(candidates(works,{...window,exclude}).length)return {...window,fallback:false};
  const latest=issueWeeks(works,{exclude,through:today})[0];
  return latest?{...issueWindow(works,{week:latest.id,exclude}),fallback:true,current:here.id}:{...window,fallback:false};
}

export function typeWeight(work){
  let best=0;for(const type of work.types||[])for(const [pattern,weight] of TYPE_WEIGHTS)if(pattern.test(type)){best=Math.max(best,weight);break;}
  return (work.types||[]).length&&!best?.15:best;
}
/** Interest in one candidate, as bounded, named terms. */
export function interest(work,{start,end,today,picks=new Set()}){
  const last=today&&today<end?today:end,span=Math.max(1,(+day(last)-+day(start))/DAY),age=Math.max(0,Math.min(span,(+day(last)-+day(work.date))/DAY));
  const count=words(work);
  const terms={
    unread:work.read?0:WEIGHTS.unread,
    recency:WEIGHTS.recency*(1-age/span),
    type:Math.min(WEIGHTS.type,typeWeight(work)),
    engagement:Math.min(WEIGHTS.engagement,.1*(+work.voices||0)+.1*(+work.threads||0)),
    references:Math.min(WEIGHTS.references,.05*(+work.inbound||0)),
    pick:picks.has(work.primary)?WEIGHTS.pick:0,
    short:count!==null&&count<300?WEIGHTS.short*(1-count/300):0,
  };
  return {terms,score:Object.values(terms).reduce((sum,value)=>sum+value,0)};
}
const order=(a,b)=>b.score-a.score||(b.work.date||'').localeCompare(a.work.date||'')||a.work.title.localeCompare(b.work.title)||a.work.primary.localeCompare(b.work.primary);

/** Cover, features and contents for a window. Deterministic for the same works, reads and signals. */
export function selectIssue(works,{window,today,exclude,picks=[],near=[],features=FEATURES}){
  const pickSet=new Set(picks),similar=new Map();
  for(const [a,b] of near){if(!similar.has(a))similar.set(a,new Set());if(!similar.has(b))similar.set(b,new Set());similar.get(a).add(b);similar.get(b).add(a);}
  const ranked=candidates(works,{...window,exclude}).map(work=>({work,...interest(work,{...window,today,picks:pickSet})})).sort(order);
  const titles=new Set(),pool=[];
  for(const entry of ranked){const title=baseTitle(entry.work.title);if(title&&titles.has(title))continue;titles.add(title);pool.push(entry);}
  const cover=pool[0]||null,chosen=cover?[cover]:[];
  const close=entry=>chosen.some(other=>similar.get(entry.work.primary)?.has(other.work.primary));
  for(const strict of [true,false]){
    for(const entry of pool){
      if(chosen.length>features||(!strict&&chosen.length>MIN_FEATURES))break;
      if(chosen.includes(entry)||close(entry))continue;
      if(strict&&chosen.some(other=>section(other.work)===section(entry.work)))continue;
      chosen.push(entry);
    }
  }
  const rest=pool.filter(entry=>!chosen.includes(entry)),groups=new Map();
  for(const entry of rest){const key=section(entry.work);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(entry);}
  for(const items of groups.values())items.sort((a,b)=>Number(a.work.read)-Number(b.work.read)||order(a,b));
  let contents=[...groups].map(([label,items])=>({label,items})).sort((a,b)=>b.items.filter(e=>!e.work.read).length-a.items.filter(e=>!e.work.read).length||b.items.length-a.items.length||a.label.localeCompare(b.label));
  // Many one-piece sections read as noise; past six sections they share one 'Elsewhere' group.
  const single=contents.filter(group=>group.items.length===1);
  if(contents.length>6&&single.length>1)contents=[...contents.filter(group=>group.items.length>1),{label:'Elsewhere',elsewhere:true,items:single.map(group=>group.items[0]).sort((a,b)=>Number(a.work.read)-Number(b.work.read)||order(a,b))}];
  return {...window,cover,features:chosen.slice(1),contents,count:pool.length,unread:pool.filter(entry=>!entry.work.read).length,sections:new Set(pool.map(entry=>section(entry.work))).size};
}

// The model the React issue draws (web/src/magazine/magazine.tsx).
const range=(start,end)=>{const a=day(start),b=day(end),month=d=>d.toLocaleDateString('en',{month:'long',timeZone:'UTC'});
  return a.getUTCMonth()===b.getUTCMonth()?`${month(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${b.getUTCFullYear()}`:`${month(a)} ${a.getUTCDate()} – ${month(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;};
const short=(start,end)=>{const a=formatDate(start),b=formatDate(end);return a.split(' ')[0]===b.split(' ')[0]?`${a}–${b.split(' ')[1]}`:`${a} – ${b}`;};
const href=work=>'#read='+encodeURIComponent(work.primary);
const kicker=(work,label)=>[label,section(work),named(work.types)[0]].filter(Boolean).join(' · ');

/** What an issue shows, as plain values: the pieces, their lines of type and the neighbouring issues. */
export function issueModel({issue,weeks,signals,prefs,art={},artMake=false,sections=[]}){
  const letter=signals?.newsletters?.[0],span=weekRange(issue.week);
  const index=weeks.findIndex(w=>w.id===issue.week),older=weeks[index+1]||(index<0?weeks.find(w=>w.id<issue.week):null),newer=index>0?weeks[index-1]:index<0?[...weeks].reverse().find(w=>w.id>issue.week):null;
  const piece=({work},label)=>{const time=minutes(work,prefs.pace);return {path:work.primary,title:work.title,href:href(work),read:!!work.read,kicker:kicker(work,label),author:work.authors?.length?work.authors.join(' · '):'Unspecified author',date:formatDate(work.date),time:time?`≈ ${time} min`:null,art:!!art[work.primary]};};
  const row=(entry,elsewhere)=>{const {work}=entry;return {path:work.primary,title:work.title,href:href(work),read:!!work.read,meta:[elsewhere?section(work):null,named(work.types)[0],formatDate(work.date)].filter(Boolean).join(' · ')};};
  return {week:issue.week,number:+issue.week.slice(6),year:issue.week.slice(0,4),dates:range(span.start,span.end),window:short(issue.start,issue.end),
    note:issue.fallback?`Nothing new has arrived in the last two weeks. This is the latest issue, ${short(issue.start,issue.end)}.`:issue.quiet?`A quiet week: covering ${short(issue.start,issue.end)}.`:'',
    older:older?.id||null,newer:newer?.id||null,past:weeks.slice(0,12).map(w=>({id:w.id,label:short(w.start,w.end),count:w.count,current:w.id===issue.week})),
    cover:issue.cover?piece(issue.cover,'Cover story'):null,features:issue.features.map(entry=>piece(entry)),
    counts:[{label:'New',value:issue.count},{label:'Unread',value:issue.unread},{label:'Sections',value:issue.sections}],
    letter:letter?{path:letter.path,title:letter.title,href:'#read='+encodeURIComponent(letter.path)}:null,sections,artMake,
    contents:issue.contents.map((group,i)=>({id:`contents-${i}`,label:group.label,count:group.items.length,items:group.items.slice(0,GROUP).map(entry=>row(entry,group.elsewhere)),more:group.items.slice(GROUP,CONTENTS).map(entry=>row(entry,group.elsewhere))}))};
}
/** The issue's entrance; app.mjs skips it under reduced motion. */
export function animateIssue(root){gsap.from(root.querySelectorAll('.issue-masthead,.issue-cover>*,.issue-summary,.issue-feature,.issue-contents'),{y:14,opacity:0,duration:.7,stagger:.05,ease:'power3.out',clearProps:'all'});}
