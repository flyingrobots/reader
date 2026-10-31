/** The reading log under a document title: who read this edition, or an earlier one, and when. */
import {formatDate, formatDateTime, localDay, daysBetween} from './logic.mjs';

// Names in the collapsed line before "+N more".
export const LOG_NAMES=4;
const MARK={current:'◉',earlier:'◐'};
const STATE={current:'Read this edition',earlier:'Read an earlier edition'};

/** "just now", "12 min ago", "today", "yesterday", "3 days ago" within a week, then a date. */
export function readWhen(at,now=new Date()){
  const date=new Date(at),elapsed=now-date;if(Number.isNaN(elapsed))return formatDate(at);
  if(elapsed<60e3)return 'just now';
  if(elapsed<3600e3)return Math.floor(elapsed/60e3)+' min ago';
  const days=daysBetween(localDay(date),localDay(now));
  if(days<=0)return 'today';if(days===1)return 'yesterday';if(days<7)return days+' days ago';
  return formatDate(at);
}
const label=r=>r.group==='you'?'You':r.participant;
// Full local date and time, with its zone, for the title attribute.
const stamp=r=>`${STATE[r.state]} · ${r.participant} · ${formatDateTime(r.at)}`;
/** Collapsed entries: voices, then you, then agents (server order), then one folded entry for task agents. */
export function logEntries(data){
  const shown=data.readers.filter(r=>!r.folded),folded=data.readers.filter(r=>r.folded);
  return [...shown.map(r=>({reader:r})),...(folded.length?[{folded}]:[])];
}
/** Your own receipt, as the client just recorded it in `navigate`. */
export function withYou(data,at=new Date().toISOString()){
  const mine=data.readers.find(r=>r.group==='you');
  const you={participant:data.participant,group:'you',threads:0,...mine,state:'current',at,version:data.version,folded:false};
  const readers=data.readers.filter(r=>r!==mine);const at0=readers.findIndex(r=>r.group!=='voice');
  readers.splice(at0<0?readers.length:at0,0,you);return {...data,readers};
}
/** Everything the reading log shows, as plain strings and numbers for web/src/reading-log.tsx. */
export function readingLogModel(data,now=new Date()){
  const word=n=>n===1?'task agent':'task agents';
  const row=r=>({participant:r.participant,label:label(r),group:r.group,state:r.state,at:r.at,when:readWhen(r.at,now),stamp:stamp(r),
    threads:r.threads||0,against:r.state==='earlier'&&r.version?r.version:null});
  const quizzes=(data.quiz_results||[]).map(r=>`${r.group==='you'?'You':r.participant} took the quiz · ${r.score}/${r.total} · ${readWhen(r.at,now)}${r.state==='earlier'?' · earlier edition':''}`);
  const writing=(data.writing||[]).map(piece=>({path:piece.path,label:'You wrote about this · '+formatDate(piece.date)}));
  if(!data.readers.length)return {empty:true,entries:[],more:0,summary:'',groups:[],agents:null,quizzes,writing};
  const entries=logEntries(data),visible=entries.slice(0,LOG_NAMES),rest=entries.slice(LOG_NAMES);
  const more=rest.reduce((n,e)=>n+(e.folded?e.folded.length:1),0);
  const line=visible.map(e=>e.folded?{folded:e.folded.length,text:`${e.folded.length} ${word(e.folded.length)}`}
    :{state:e.reader.state,mark:MARK[e.reader.state],label:label(e.reader),earlier:e.reader.state==='earlier',when:readWhen(e.reader.at,now),stamp:stamp(e.reader)});
  const summary='Reading log: '+visible.map(e=>e.folded?e.folded.length+' '+word(e.folded.length):label(e.reader)+(e.reader.state==='earlier'?', earlier edition':'')).join(', ')+(more?`, and ${more} more`:'');
  const newest=list=>[...list].sort((a,b)=>b.at.localeCompare(a.at));
  const groups=['current','earlier'].map(state=>({state,title:STATE[state],mark:MARK[state],rows:newest(data.readers.filter(r=>!r.folded&&r.state===state)).map(row)})).filter(group=>group.rows.length);
  const folded=data.readers.filter(r=>r.folded);
  const agents=folded.length?{title:`${folded.length} ${word(folded.length)}`,hint:`fewer than ${data.one_off_threshold} documents read`,rows:newest(folded).map(row)}:null;
  return {empty:false,entries:line,more,summary,groups,agents,quizzes,writing};
}
