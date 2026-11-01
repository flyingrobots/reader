/** Section identity is the magazine's first named project, with its existing folder fallback. */
import {section} from './magazine.mjs';
export const sectionHref=label=>'#section='+encodeURIComponent(label);
export const sectionArticles=(works,label)=>works.filter(work=>section(work)===label);
export function sectionsForIssue(issue,works){
  const entries=[issue.cover,...issue.features,...issue.contents.flatMap(group=>group.items)].filter(Boolean);
  const labels=new Set(entries.map(entry=>section(entry.work)));
  const counts=new Map();for(const work of works){const label=section(work);counts.set(label,(counts.get(label)||0)+1);}
  return [...labels].map(label=>({label,count:counts.get(label)||0,href:sectionHref(label)})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
}
