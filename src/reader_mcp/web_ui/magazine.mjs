/** The homepage as this week's issue: a cover story, features and contents chosen from recent additions. */
import {escapeHTML as esc, formatDate} from './logic.mjs';

// Types left out of an issue unless the reader changes the list in Settings.
export const DEFAULT_EXCLUDED_TYPES=['Task','Receipt','Manifest','Handoff'];
// The newsletter is an editorial signal for the issue; its working papers are not pieces of it.
export const EXCLUDED_FOLDERS=['library/newsletters/'];
export const FEATURES=4, MIN_FEATURES=3, QUIET=4, STANDFIRSTS=12, GROUP=6, CONTENTS=80;
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

// Rendering. All catalog text is escaped; standfirsts arrive as text nodes.
// A machine-written standfirst carries the same small mark as Behind the scenes: local model · <model>.
const machineMark=model=>{const mark=document.createElement('span');mark.className='lm-mark issue-machine-mark';mark.dataset.readerDecoration='';mark.textContent='local model · '+(String(model).split('/').pop()||model);return mark;};
const range=(start,end)=>{const a=day(start),b=day(end),month=d=>d.toLocaleDateString('en',{month:'long',timeZone:'UTC'});
  return a.getUTCMonth()===b.getUTCMonth()?`${month(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${b.getUTCFullYear()}`:`${month(a)} ${a.getUTCDate()} – ${month(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;};
const short=(start,end)=>{const a=formatDate(start),b=formatDate(end);return a.split(' ')[0]===b.split(' ')[0]?`${a}–${b.split(' ')[1]}`:`${a} – ${b}`;};
const pip=work=>work.read?'':'<span class="unread-pip" title="Unread edition" aria-label="Unread edition"></span>';
const href=work=>'#read='+encodeURIComponent(work.primary);
function byline(work,pace){
  const parts=[work.authors?.length?esc(work.authors.join(' · ')):'Unspecified author',esc(formatDate(work.date))];
  const time=minutes(work,pace);if(time)parts.push(`≈ ${time} min`);
  return parts.map(part=>`<span>${part}</span>`).join('')+(work.read?'<span class="issue-read">Read</span>':'<span class="issue-unread"><span class="unread-pip" aria-hidden="true"></span>Unread</span>');
}
function kicker(work,label){const type=named(work.types)[0];return [label,section(work),type].filter(Boolean).map(esc).join('<span aria-hidden="true"> · </span>');}

export function mountMagazine({root,issue,weeks,signals,prefs,api,wireDocumentLinks,openIssue,motion,art={},artMake=false}){
  const {cover,features,contents}=issue,letter=signals?.newsletters?.[0];
  const index=weeks.findIndex(w=>w.id===issue.week),older=weeks[index+1]||(index<0?weeks.find(w=>w.id<issue.week):null),newer=index>0?weeks[index-1]:index<0?[...weeks].reverse().find(w=>w.id>issue.week):null;
  const note=issue.fallback?`Nothing new has arrived in the last two weeks. This is the latest issue, ${short(issue.start,issue.end)}.`:issue.quiet?`A quiet week: covering ${short(issue.start,issue.end)}.`:'';
  const weekNumber=+issue.week.slice(6);
  // + Queue (RW-30): the app wires [data-queue-add]; q on a focused piece does the same.
  const queueButton=work=>`<button type="button" data-button="ghost xs" class="issue-queue" data-queue-add="${esc(work.primary)}" aria-label="Add ${esc(work.title)} to your queue" title="Add to your queue · q">+ Queue</button>`;
  const item=({work})=>`<li${work.read?' data-read':''}><a href="${esc(href(work))}" data-path="${esc(work.primary)}" data-piece><span class="contents-title">${esc(work.title)}</span>${pip(work)}<span class="contents-meta">${esc([elsewhere?section(work):null,named(work.types)[0],formatDate(work.date)].filter(Boolean).join(' · '))}</span></a></li>`;
  let elsewhere=false;
  // Bespoke art (RW-43): the cover's figure and the features' thumbnails; app.mjs paints them after mount.
  // A piece without art shows nothing special; the cover offers to make some when a producer is available.
  const thumb=work=>art[work.primary]?`<div class="feature-art" data-art-thumb="${esc(work.primary)}" data-reader-decoration aria-hidden="true"></div>`:'';
  const feature=(entry,i)=>`<article class="issue-feature" aria-labelledby="feature-${i}"><div class="feature-number" aria-hidden="true">${String(i+2).padStart(2,'0')}</div>${thumb(entry.work)}<div class="issue-kicker">${kicker(entry.work)}</div><h3 class="feature-title" id="feature-${i}"><a href="${esc(href(entry.work))}" data-path="${esc(entry.work.primary)}" data-piece>${esc(entry.work.title)}</a></h3><p class="feature-standfirst" data-standfirst="${esc(entry.work.primary)}"></p><div class="issue-byline">${byline(entry.work,prefs.pace)}</div>${queueButton(entry.work)}</article>`;
  root.innerHTML=`<div class="issue" id="issue" data-week="${esc(issue.week)}">
<header class="issue-masthead"><div class="issue-dateline"><span>Issue ${weekNumber} · ${esc(issue.week.slice(0,4))}</span><span>${esc(range(weekRange(issue.week).start,weekRange(issue.week).end))}</span></div>
<h1 class="issue-flag" id="home-title">Reader<span class="dot" aria-hidden="true">.</span><span class="sr-only"> Issue ${esc(issue.week)}</span></h1>
<nav class="issue-nav" aria-label="Issues"><button type="button" data-button="ghost xs" data-issue="${esc(older?.id||'')}" ${older?'':'disabled'} aria-label="Previous issue" title="Previous issue · [">‹</button><details class="issue-archive"><summary>Past issues</summary><ol>${weeks.slice(0,12).map(w=>`<li><a href="#issue=${esc(w.id)}" data-issue="${esc(w.id)}"${w.id===issue.week?' aria-current="page"':''}><span>${esc(short(w.start,w.end))}</span><small>${w.count} ${w.count===1?'piece':'pieces'}</small></a></li>`).join('')}</ol></details><button type="button" data-button="ghost xs" data-issue="${esc(newer?.id||'')}" ${newer?'':'disabled'} aria-label="Next issue" title="Next issue · ]">›</button></nav></header>
${note?`<p class="issue-note" role="note">${esc(note)}</p>`:''}
<div class="issue-spread" data-features="${features.length}" data-rest="${Math.max(0,features.length-1)}">
${cover?`<section class="issue-cover" aria-labelledby="cover-title"><div class="issue-kicker">${kicker(cover.work,'Cover story')}</div><h2 class="cover-title" id="cover-title"><a href="${esc(href(cover.work))}" data-path="${esc(cover.work.primary)}" data-piece data-cover>${esc(cover.work.title)}</a></h2>${art[cover.work.primary]?`<figure class="cover-art" data-art="${esc(cover.work.primary)}" data-reader-decoration></figure>`:''}<p class="cover-standfirst" data-standfirst="${esc(cover.work.primary)}"></p><div class="issue-byline">${byline(cover.work,prefs.pace)}</div>${queueButton(cover.work)}${!art[cover.work.primary]&&artMake?`<button type="button" data-button="ghost xs" class="issue-art-make" data-art-generate="${esc(cover.work.primary)}" data-reader-decoration title="An agent reads the piece, writes an art brief and composes a scene; a background job">Make cover art</button>`:''}</section>
<aside class="issue-summary" aria-label="This issue"><dl><div><dt>New</dt><dd>${issue.count}</dd></div><div><dt>Unread</dt><dd>${issue.unread}</dd></div><div><dt>Sections</dt><dd>${issue.sections}</dd></div></dl>${letter?`<a class="issue-letter" href="${esc('#read='+encodeURIComponent(letter.path))}" data-path="${esc(letter.path)}"><span class="issue-kicker">From the editors</span><span class="issue-letter-title">${esc(letter.title)}</span></a>`:''}${contents.length>1?`<nav class="issue-index" aria-label="Sections in this issue"><h2 class="issue-kicker">Sections</h2><ol>${contents.map((group,i)=>`<li><button type="button" data-button="ghost xs" data-jump="contents-${i}"><span>${esc(group.label)}</span><small>${group.items.length}</small></button></li>`).join('')}</ol></nav>`:''}</aside>`
  :`<section class="issue-empty"><h2>Nothing has arrived yet.</h2><p>When works are filed with a date, the newest become this week’s issue. Reader Admin keeps the library statistics.</p></section>`}
${features.length?`<section class="issue-features" aria-label="Features">${features.map(feature).join('')}</section>`:''}
${contents.length?`<section class="issue-contents" aria-labelledby="contents-title"><h2 class="issue-section-title" id="contents-title">In this issue</h2><div class="contents-columns">${contents.map((group,i)=>(elsewhere=!!group.elsewhere,`<section class="contents-group" id="contents-${i}" tabindex="-1" aria-label="${esc(group.label)}"><h3>${esc(group.label)}<small>${group.items.length}</small></h3><ol>${group.items.slice(0,GROUP).map(item).join('')}</ol>${group.items.length>GROUP?`<details class="contents-more"><summary>${group.items.length-GROUP} more</summary><ol>${group.items.slice(GROUP,CONTENTS).map(item).join('')}</ol></details>`:''}</section>`)).join('')}</div></section>`:''}
</div>
<footer class="issue-footer"><p>Chosen from works filed ${esc(short(issue.start,issue.end))}: unread first, then how recent, the kind of writing, other voices’ reading, open margin threads${letter?' and the newsletter’s picks':''}. Each feature comes from a different project where one is available.</p><button type="button" data-button="link xs" id="issue-backstage">Library statistics are in Reader Admin ↗</button></footer>
</div>`;
  wireDocumentLinks(root);
  // The wide-window rail lists the contents sections; a jump scrolls there without touching the route.
  root.querySelectorAll('[data-jump]').forEach(el=>el.addEventListener('click',()=>{const target=root.querySelector('#'+el.dataset.jump);if(!target)return;target.scrollIntoView({behavior:motion()?'smooth':'auto',block:'start'});target.focus({preventScroll:true});}));
  root.querySelectorAll('[data-issue]').forEach(el=>el.addEventListener('click',event=>{event.preventDefault();if(el.dataset.issue)openIssue(el.dataset.issue);}));
  // Standfirsts: only for the pieces on screen, a few at a time.
  const slots=[...root.querySelectorAll('[data-standfirst]')].slice(0,STANDFIRSTS),queue=[...slots];
  const next=async()=>{for(let slot=queue.shift();slot;slot=queue.shift()){try{const data=await api('/api/standfirst?path='+encodeURIComponent(slot.dataset.standfirst));if(data.standfirst&&slot.isConnected){slot.textContent=data.standfirst;slot.dataset.source=data.source;if(data.source==='local-model'&&data.model)slot.after(machineMark(data.model));}else slot.remove();}catch{slot.remove();}}};
  const done=Promise.all([next(),next(),next()]);
  if(motion())gsap.from(root.querySelectorAll('.issue-masthead,.issue-cover>*,.issue-summary,.issue-feature,.issue-contents'),{y:14,opacity:0,duration:.7,stagger:.05,ease:'power3.out',clearProps:'all'});
  return {done,pieces:()=>[...root.querySelectorAll('[data-piece]')].filter(el=>el.checkVisibility())};
}
