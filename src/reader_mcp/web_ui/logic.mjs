/** Source coordinates stay in Unicode code points, as Reader's annotation API requires. */
export const normalize = text => text.replace(/\s+/gu, ' ').trim();
export const escapeHTML = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const codePointOffset = (text, offset) => Array.from(text.slice(0, offset)).length;
/** codePointOffset for many offsets into one text: one O(n) scan, then O(log n) per lookup.
 * A low surrogate preceded by a high surrogate is the second half of one code point. */
export function codePointIndex(text) {
  if (!/[\uDC00-\uDFFF]/.test(text)) return offset => Math.max(0, Math.min(offset, text.length));
  const pairs = [];
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xDC00 && c <= 0xDFFF) { const p = text.charCodeAt(i - 1); if (p >= 0xD800 && p <= 0xDBFF) pairs.push(i); }
  }
  return offset => {
    offset = Math.max(0, Math.min(offset, text.length));
    let lo = 0, hi = pairs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[mid] < offset) lo = mid + 1; else hi = mid; }
    return offset - lo;
  };
}
export function bodyOf(raw) {
  const front = raw.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return {text: front ? raw.slice(front[0].length) : raw, offset: front?.[0].length || 0};
}

export function projectSource(raw) {
  // Typed arrays and bulk copies. The rewrites below keep or shorten the text, so each pass
  // normally fits in a buffer of the previous length; ensure() grows it otherwise.
  let text = raw, starts = new Int32Array(raw.length), ends = new Int32Array(raw.length);
  for (let i = 0, cp = 0; i < raw.length; cp++) {
    const c = raw.charCodeAt(i), d = raw.charCodeAt(i + 1), width = c >= 0xD800 && c <= 0xDBFF && d >= 0xDC00 && d <= 0xDFFF ? 2 : 1;
    for (let k = 0; k < width; k++, i++) { starts[i] = cp; ends[i] = cp + 1; }
  }
  const rewrite = (regex, capture = null, replacement = null) => {
    let next = '', cursor = 0, length = 0;
    let ns = new Int32Array(text.length), ne = new Int32Array(text.length);
    const ensure = n => { if (n <= ns.length) return; const a = new Int32Array(n * 2), b = new Int32Array(n * 2); a.set(ns); b.set(ne); ns = a; ne = b; };
    const copy = (from, to) => { ns.set(starts.subarray(from, to), length); ne.set(ends.subarray(from, to), length); length += to - from; };
    for (const match of text.matchAll(regex)) {
      next += text.slice(cursor, match.index); copy(cursor, match.index);
      if (capture !== null) {
        const [a, b] = match.indices[capture];
        next += text.slice(a, b); copy(a, b);
      } else if (replacement) {
        const value = replacement(match);
        next += value; ensure(length + value.length);
        ns.fill(starts[match.index], length, length + value.length); ne.fill(ends[match.index + match[0].length - 1], length, length + value.length); length += value.length;
      }
      cursor = match.index + match[0].length;
    }
    next += text.slice(cursor); copy(cursor, starts.length);
    text = next; starts = ns.subarray(0, length); ends = ne.subarray(0, length);
  };
  rewrite(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/dg);
  rewrite(/^\s*```[^\n]*$/dgm);
  rewrite(/!\[[^\]]*\]\([^\n)]*\)/dg);
  rewrite(/!\[\[[^\]]+\]\]/dg);
  // Obsidian block ids (` ^id` ending a block, or a line of its own) are hidden when rendered.
  rewrite(/[ \t]+\^[A-Za-z0-9-]{1,64}(?=[ \t]*$)/dgm);
  rewrite(/^\^[A-Za-z0-9-]{1,64}[ \t]*$/dgm);
  rewrite(/\[([^\]]+)\]\([^\n)]*\)/dg, 1);
  rewrite(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/dg, null, m => m[2] || m[1]);
  rewrite(/<(https?:[^>]+)>/dg, 1);
  rewrite(/<[^>]+>/dg);
  rewrite(/^(?:\s{0,3}#{1,6}\s+|\s*>\s?|\s*[-+*]\s+|\s*\d+[.)]\s+)/dgm);
  rewrite(/`([^`\n]+)`/dg, 1);
  rewrite(/\*\*([^*\n]+)\*\*/dg, 1);
  rewrite(/__([^_\n]+)__/dg, 1);
  rewrite(/~~([^~\n]+)~~/dg, 1);
  rewrite(/\*([^*\n]+)\*/dg, 1);
  rewrite(/(?<!\w)_([^_\n]+)_(?!\w)/dg, 1);
  rewrite(/\\([\\`*_{}\[\]()#+.!>-])/dg, 1);
  rewrite(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/dgi, null, m => {
    const names = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '};
    if (m[1][0] !== '#') return names[m[1].toLowerCase()];
    const n = m[1][1].toLowerCase() === 'x' ? parseInt(m[1].slice(2), 16) : parseInt(m[1].slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m[0];
  });
  rewrite(/\s+/dg, null, () => ' ');
  return {text, starts, ends};
}

/** Optional `bounds.occurrence` / `bounds.count` pick a repeat of the quote within bounds when the caller counted the same repeats in the rendered block. */
export function sourceRangeForQuote(raw, quote, bounds = null, projected = null) {
  quote = normalize(quote);
  if (!quote || quote.length > 16000) throw new Error('Choose a passage of at most 16,000 characters.');
  projected ??= projectSource(raw);
  const candidates = [];
  let index = 0;
  while ((index = projected.text.indexOf(quote, index)) >= 0) {
    const start = projected.starts[index], end = projected.ends[index + quote.length - 1];
    if ((!bounds || start >= bounds.start && end <= bounds.end) && rawCodePoints(raw, start, end).trim()) candidates.push({start, end});
    if (candidates.length > 1000) break;
    index++;
  }
  if (candidates.length > 1 && bounds?.count === candidates.length && Number.isInteger(bounds.occurrence) && bounds.occurrence >= 0 && bounds.occurrence < candidates.length) return candidates[bounds.occurrence];
  if (candidates.length !== 1) throw new Error(candidates.length ? 'This passage occurs more than once. Select a longer passage.' : 'This selection cannot be anchored safely across its formatting. Select within a paragraph.');
  return candidates[0];
}
/** The raw source between two code point offsets, without materializing every code point. */
export function rawCodePoints(raw, start, end) {
  let cp = 0, i = 0, from = -1;
  start = Math.max(0, start);
  while (i < raw.length && cp < end) {
    if (cp === start) from = i;
    const c = raw.charCodeAt(i), d = raw.charCodeAt(i + 1);
    i += c >= 0xD800 && c <= 0xDBFF && d >= 0xDC00 && d <= 0xDFFF ? 2 : 1;
    cp++;
  }
  return from < 0 ? '' : raw.slice(from, i);
}
// Projection starts and ends never decrease, so the visible characters inside
// [start, end) are one contiguous run found by two binary searches.
export function visibleQuote(projection, start, end) {
  const {starts, ends} = projection;
  let lo = 0, hi = starts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid] < start) lo = mid + 1; else hi = mid; }
  let first = lo;
  lo = first; hi = ends.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ends[mid] <= end) lo = mid + 1; else hi = mid; }
  return lo > first ? normalize(projection.text.slice(first, lo)) : '';
}
/** Visible-text projection of joined DOM text: each whitespace run becomes one space and every other code
 *  unit is kept. `starts[j]`/`ends[j]` are the raw UTF-16 span of projected unit j; both units of a surrogate
 *  pair end after the pair. Typed arrays, not per-character objects: a 2 MB article projects in a few ms. */
export function projectText(raw) {
  const text = raw.replace(/\s+/gu, ' '), starts = new Int32Array(text.length), ends = new Int32Array(text.length);
  let j = 0, i = 0;
  const visible = to => {
    for (; i < to; i++, j++) {
      const c = raw.charCodeAt(i), d = raw.charCodeAt(i + 1);
      starts[j] = i;
      if (c >= 0xD800 && c <= 0xDBFF && d >= 0xDC00 && d <= 0xDFFF && i + 1 < to) { ends[j] = i + 2; starts[++j] = ++i; ends[j] = i + 1; }
      else ends[j] = i + 1;
    }
  };
  for (const match of raw.matchAll(/\s+/gu)) { visible(match.index); starts[j] = i; ends[j] = i = match.index + match[0].length; j++; }
  visible(raw.length);
  return {text, starts, ends};
}
export function occurrences(text, query) {
  const result = [];
  if (!query) return result;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  // At most 2,000 matches; `limited` says a 2,001st exists, so the count is a floor.
  for (const match of text.matchAll(regex)) {
    if (result.length >= 2000) { result.limited = true; break; }
    result.push({start:match.index, end:match.index + match[0].length});
  }
  return result;
}
/* Dates and times. A plain `YYYY-MM-DD` is a calendar date (a catalog or frontmatter date) and is shown
   as written; anything with a time is an instant and is shown, and grouped by day, in the reader's local
   time zone. `timeZone` exists for tests; the browser's own zone is the default everywhere. */
const PLAIN_DATE=/^\d{4}-\d{2}-\d{2}$/;
export const isPlainDate=value=>typeof value==='string' && PLAIN_DATE.test(value);
const instant=value=>{const date=value instanceof Date?value:new Date(value);return Number.isNaN(date.getTime())?null:date;};
const dayParts=new Map();
function partsIn(timeZone){
  const key=timeZone||'';if(!dayParts.has(key))dayParts.set(key,new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone}));
  return dayParts.get(key);
}
/** The calendar day of a value: a plain date as written, an instant as its local day; null when unparseable. */
export function localDay(value,timeZone){
  if(value===null || value===undefined || value==='')return null;
  if(isPlainDate(value))return value;
  const date=instant(value);if(!date)return null;
  const p=Object.fromEntries(partsIn(timeZone).formatToParts(date).map(part=>[part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** Today's local calendar day. */
export const todayLocal=(now=new Date(),timeZone)=>localDay(now,timeZone);
/** Whole days from plain day `a` to plain day `b` (b - a). */
export const daysBetween=(a,b)=>Math.round((Date.UTC(...ymd(b))-Date.UTC(...ymd(a)))/864e5);
const ymd=day=>{const [y,m,d]=day.split('-').map(Number);return [y,m-1,d];};
/** A plain day moved by `days` calendar days. */
export function addDays(day,days){const d=new Date(Date.UTC(...ymd(day))+days*864e5);return d.toISOString().slice(0,10);}
/** The instant of local midnight at the start of plain day `day`, as UTC ISO (the browser's zone only). */
export const localMidnight=day=>new Date(...ymd(day)).toISOString();
/** A work's calendar day: the local day of its arrival instant when it has one, else its catalog date. */
export const workDay=(work,timeZone)=>work?.arrival_time?localDay(work.arrival_time,timeZone)||work.date||null:work?.date||null;
/** The library bootstrap in local days: `today` is the browser's day and each work's `date` its local
    arrival day (the server's UTC `today` and catalog day are kept as `utc_today` and `catalog_date`). */
export function localizeLibrary(data,now=new Date(),timeZone){
  if(!data)return data;
  if(data.today)data.utc_today=data.today;
  data.today=todayLocal(now,timeZone);
  for(const work of [...(data.works||[]),...(data.recent||[])]){if(work.arrival_time && !('catalog_date' in work)){work.catalog_date=work.date;work.date=workDay(work,timeZone);}}
  return data;
}
/** Read marks per local day for the `days` days ending today: [{date, count, works}]. */
export function readActivity(works,today,days=28,timeZone){
  const keys=Array.from({length:days},(_,i)=>addDays(today,i-days+1)),rows=new Map(keys.map(key=>[key,{date:key,count:0,works:[]}]));
  for(const work of works){if(!work.read || !work.read_at)continue;const row=rows.get(localDay(work.read_at,timeZone));if(row){row.count++;row.works.push(work);}}
  return keys.map(key=>rows.get(key));
}
/** "Oct 24" (plus the year when asked): plain dates as written, instants in the local zone. */
export function formatDate(day,{year=false,timeZone}={}) {
  if(!day)return 'Undated';
  const plain=isPlainDate(day),date=plain?new Date(day+'T12:00:00Z'):instant(day);
  if(!date)return 'Undated';
  return new Intl.DateTimeFormat('en',{month:'short',day:'numeric',...(year?{year:'numeric'}:{}),timeZone:plain?'UTC':timeZone}).format(date);
}
/** A full local date and time with its zone, for title attributes: "Oct 24, 2026, 5:16 PM PDT". */
export function formatDateTime(value,timeZone){
  const date=isPlainDate(value)?null:instant(value);if(!date)return String(value ?? '');
  return new Intl.DateTimeFormat('en',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone}).format(date);
}
/** GitHub-style heading slugs of rendered heading text; links.py computes the same from source. */
export const headingSlug = text => normalize(text).toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
/** The embedded document an element belongs to (its nearest `.embedded-content`), or null for the open document. */
export const scopeOf = element => element?.closest?.('.embedded-content') || null;
/** Give each heading of a rendered document a slug, numbering repeats in document order. */
export function slugHeadings(root) {
  const seen = new Map();
  const scope = scopeOf(root);
  for (const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if (scopeOf(heading) !== scope) continue;
    const base = headingSlug(heading.textContent), count = seen.get(base) || 0;
    seen.set(base, count + 1); heading.dataset.headingSlug = count ? base + '-' + count : base;
  }
}
/** The element a #fragment names: an id, a heading slug, or a heading's text (as wikilinks write it). */
export function findFragment(root, fragment) {
  if (!root || !fragment) return null;
  let raw = fragment; try { raw = decodeURIComponent(fragment); } catch {}
  const scope = scopeOf(root), own = element => scopeOf(element) === scope;
  const wanted = headingSlug(raw);
  return [...root.querySelectorAll('[id]')].find(element => element.id === raw && own(element))
    || [...root.querySelectorAll('[data-heading-slug]')].find(element => own(element) && (element.dataset.headingSlug === raw || element.dataset.headingSlug === wanted)) || null;
}
/** "1 comment", "2 comments": every rendered count goes through this. */
export const plural = (n, one, many = one + 's') => `${Number(n).toLocaleString('en')} ${Number(n) === 1 ? one : many}`;
/** Display text for a raw source quote: Markdown markers, including those cut by the span's edges, are dropped. */
export function plainQuote(raw) {
  return normalize(projectSource(String(raw || '')).text
    .replace(/\*\*|__|`+/g, '')
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$)/g, '$1'));
}
