/** Section identity is the magazine's first named project (case-folded for matching), with its existing folder fallback. */
import {pickSectionLabel,section,sectionKey} from './magazine.mjs';
export const sectionHref=label=>'#section='+encodeURIComponent(label);
export const sectionArticles=(works,label)=>{const target=String(label||'').toLocaleLowerCase();return works.filter(work=>sectionKey(work)===target);};
export function sectionsForIssue(issue,works){
  const entries=[issue.cover,...issue.features,...issue.contents.flatMap(group=>group.items)].filter(Boolean);
  const labels=new Map();
  for(const work of works){const raw=section(work),key=raw.toLocaleLowerCase();labels.set(key,pickSectionLabel(labels.get(key),raw));}
  for(const entry of entries){const raw=section(entry.work),key=raw.toLocaleLowerCase();labels.set(key,pickSectionLabel(labels.get(key),raw));}
  const counts=new Map();for(const work of works){const key=sectionKey(work);counts.set(key,(counts.get(key)||0)+1);}
  const keys=[...new Set(entries.map(entry=>sectionKey(entry.work)))];
  return keys.map(key=>{const label=labels.get(key)||key;return {label,count:counts.get(key)||0,href:sectionHref(label)};}).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
}
