/** The reading log under a document title: who read this edition, or an earlier one, and when. */
import {escapeHTML as esc, formatDate, formatDateTime, localDay, daysBetween} from './logic.mjs';

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
function row(r,now){
  const threads=r.threads?`<button type="button" data-button="link xs" class="reading-log-threads" data-reader-threads="${esc(r.participant)}">${r.threads} ${r.threads===1?'thread':'threads'}</button>`:'';
  // The change view (RW-06) attaches to [data-against] when it is installed.
  const against=r.state==='earlier'&&r.version?` data-against="${esc(r.version)}"`:'';
  return `<li class="reading-log-row" data-state="${r.state}" data-group="${r.group}"${against}><span class="reading-log-mark" aria-hidden="true">${MARK[r.state]}</span><span class="reading-log-name">${esc(label(r))}</span><time datetime="${esc(r.at)}" title="${esc(stamp(r))}">${esc(readWhen(r.at,now))}</time>${threads}</li>`;
}
export function readingLogHTML(data,now=new Date()){
  if(!data.readers.length)return '<p class="reading-log-empty">Not yet read by anyone. You’ll be first.</p>';
  const entries=logEntries(data),visible=entries.slice(0,LOG_NAMES),rest=entries.slice(LOG_NAMES);
  const more=rest.reduce((n,e)=>n+(e.folded?e.folded.length:1),0);
  const word=n=>n===1?'task agent':'task agents';
  const line=visible.map(e=>e.folded?`<span class="reading-log-entry" data-folded="${e.folded.length}">${e.folded.length} ${word(e.folded.length)}</span>`
    :`<span class="reading-log-entry" data-state="${e.reader.state}" title="${esc(stamp(e.reader))}"><span class="reading-log-mark" aria-hidden="true">${MARK[e.reader.state]}</span> ${esc(label(e.reader))}${e.reader.state==='earlier'?' <span class="reading-log-earlier">(earlier edition)</span>':''} ${esc(readWhen(e.reader.at,now))}</span>`).join('<span class="reading-log-dot" aria-hidden="true"> · </span>');
  const newest=list=>[...list].sort((a,b)=>b.at.localeCompare(a.at));
  const groups=['current','earlier'].map(state=>{const list=newest(data.readers.filter(r=>!r.folded&&r.state===state));return list.length?`<section class="reading-log-group" data-group-state="${state}"><div class="eyebrow" role="heading" aria-level="3">${STATE[state]}</div><ul>${list.map(r=>row(r,now)).join('')}</ul></section>`:'';}).join('');
  const folded=data.readers.filter(r=>r.folded);
  const agents=folded.length?`<details class="reading-log-agents"><summary>${folded.length} ${word(folded.length)} <span class="reading-log-hint">fewer than ${data.one_off_threshold} documents read</span></summary><ul>${newest(folded).map(r=>row(r,now)).join('')}</ul></details>`:'';
  return `<details class="reading-log-details"><summary aria-label="Reading log: ${esc(visible.map(e=>e.folded?e.folded.length+' '+word(e.folded.length):label(e.reader)+(e.reader.state==='earlier'?', earlier edition':'')).join(', '))}${more?esc(`, and ${more} more`):''}"><span class="reading-log-line">${line}${more?`<span class="reading-log-dot" aria-hidden="true"> · </span><span class="reading-log-more">+${more} more</span>`:''}</span><span class="reading-log-caret" aria-hidden="true">▾</span></summary><div class="reading-log-body">${groups}${agents}</div></details>`;
}
