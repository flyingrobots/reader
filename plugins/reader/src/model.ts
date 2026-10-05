/** Pure relationship projection. All evidence comes from explicit local links. */
export interface Citation {
  target: string | null;
  link: string;
  label: string;
  line: number;
  excerpt: string;
}
export interface DocumentRecord {
  path: string;
  title: string;
  id?: string;
  ownerTarget?: string;
  original?: string;
  catalogOriginal?: string;
  documentDate?: string;
  arrivalDate?: string;
  modified?: string;
  kind?: 'Connection' | 'Reaction';
  readingScope?: string;
  links: Citation[];
}
export interface Association { wrapper: string; original: string }
export interface Evidence extends Citation {
  note: string;
  noteTitle: string;
  kind: 'Connection' | 'Reaction' | 'Catalog';
  context?: string;
  readingScope?: string;
}
export interface ResultRow {
  key: string;
  path: string | null;
  title: string;
  evidence: Evidence[];
  date?: RecordedDate;
}
export type DateMode = 'document' | 'arrival' | 'modified';
export interface RecordedDate { day: string; timestamp?: number; value: string }
export function recordedDate(value: unknown): RecordedDate | undefined {
  if (typeof value !== 'string') return;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(value);
  if (!match) return;
  const calendar = new Date(match[1] + 'T00:00:00Z');
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10) !== match[1]) return;
  if (value === match[1]) return { day: value, value };
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? { day: new Date(timestamp).toISOString().slice(0,10), timestamp, value } : undefined;
}
export function firstDate(...values: unknown[]): string | undefined { return values.find(v => recordedDate(v)) as string | undefined; }
export function sortRows(rows: ResultRow[]): ResultRow[] {
  return rows.sort((a,b) => (a.date?.day ?? '9999-99-99').localeCompare(b.date?.day ?? '9999-99-99')
    || (a.date?.timestamp ?? Infinity) - (b.date?.timestamp ?? Infinity)
    || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
export interface Result {
  subject: string;
  title: string;
  notes: ResultRow[];
  related: ResultRow[];
  catalog: ResultRow[];
  problems: string[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validId(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }
export function libraryPath(path: string): boolean {
  return path.startsWith('library/') && !path.split('/').some(p => !p || p === '.' || p === '..') && !path.includes('\\');
}
export function editorialKind(path: string, author: unknown): DocumentRecord['kind'] {
  const authors = Array.isArray(author) ? author : [author];
  if (!authors.some(a => typeof a === 'string' && a.trim().toLowerCase() === 'reader librarian')) return;
  if (path.endsWith('/index.md')) return;
  if (path.startsWith('library/connections/')) return 'Connection';
  if (path.startsWith('library/reactions/')) return 'Reaction';
}
function navigation(path: string | null): boolean {
  return path === 'library/index.md' || !!path && /^library\/[^/]+\/index\.md$/.test(path);
}
export class DocumentResolver {
  records: Map<string, DocumentRecord>;
  identities = new Map<string, string>();
  problems = new Map<string, Set<string>>();
  owners = new Map<string, string[]>();
  associations: Association[];
  constructor(records: DocumentRecord[], associations: Association[] = []) {
    this.records = new Map(records.map(r => [r.path, r]));
    this.associations = associations.filter(a => this.records.has(a.wrapper) && this.records.has(a.original));
    const ids = new Map<string, Set<string>>();
    for (const record of records) {
      const target = record.ownerTarget ?? record.path;
      if (record.ownerTarget) this.owners.set(target, [...(this.owners.get(target) ?? []), record.path]);
      if (record.id) {
        const paths = ids.get(record.id) ?? new Set<string>(); paths.add(record.path); ids.set(record.id, paths);
        this.identities.set(target, record.id);
      }
    }
    for (const paths of ids.values()) if (paths.size > 1) for (const p of paths) this.conflict(p, paths);
    for (const [target, owners] of this.owners) {
      const direct = this.records.get(target);
      const claimants = direct?.id ? [...owners, target] : owners;
      if (claimants.length > 1) for (const p of [...claimants, target]) this.conflict(p, new Set(claimants));
      if (!this.records.has(target)) for (const p of owners) this.conflict(p, new Set([p]));
    }
  }
  private conflict(path: string, owners: Set<string>) {
    const found = this.problems.get(path) ?? new Set<string>();
    for (const p of owners) found.add(p);
    this.problems.set(path, found);
    const target = this.records.get(path)?.ownerTarget;
    if (target) this.problems.set(target, new Set([...(this.problems.get(target) ?? []), ...owners]));
  }
  key(path: string) { return this.problems.has(path) ? path : (this.identities.get(path) ?? path); }
  title(path: string) {
    const owners = this.owners.get(path);
    if (!this.problems.has(path) && owners?.length === 1) return this.records.get(owners[0])!.title;
    return this.records.get(path)?.title ?? path.split('/').pop() ?? path;
  }
  date(path: string, mode: DateMode): RecordedDate | undefined {
    const record = this.records.get(path);
    const owner = !this.problems.has(path) ? this.owners.get(path)?.[0] : undefined;
    const metadata = owner ? this.records.get(owner) : undefined;
    if (mode === 'modified') return recordedDate(record?.modified);
    const original = record?.original && !this.problems.has(record.original) ? this.records.get(record.original) : undefined;
    if (mode === 'arrival') return recordedDate(firstDate(original?.arrivalDate, record?.arrivalDate, metadata?.arrivalDate));
    return recordedDate(firstDate(original?.documentDate, record?.documentDate, metadata?.documentDate,
      original?.arrivalDate, record?.arrivalDate, metadata?.arrivalDate));
  }
  context(path: string): { subject: string; paths: Map<string, string | undefined>; problems: string[] } {
    const errors = new Set(this.problems.get(path) ?? []);
    const record = this.records.get(path);
    const subject = record?.ownerTarget && !errors.size && this.records.has(record.ownerTarget) ? record.ownerTarget : path;
    const paths = new Map<string, string | undefined>([[subject, undefined]]);
    if (!errors.size) {
      if (subject !== path) paths.set(path, 'About this document’s metadata');
      const original = this.records.get(subject)?.original;
      if (original && this.records.has(original) && !this.problems.has(original)) paths.set(original, 'About the original document');
      const basis = new Set(paths.keys());
      for (const a of this.associations) {
        if (basis.has(a.original) && !this.problems.has(a.wrapper)) paths.set(a.wrapper, 'About this document’s catalog');
        if (basis.has(a.wrapper) && !this.problems.has(a.original)) paths.set(a.original, 'About the source document');
      }
      for (const p of paths.keys()) for (const problem of this.problems.get(p) ?? []) errors.add(problem);
    }
    return { subject, paths, problems: [...errors] };
  }
}
export class RelationshipIndex {
  resolver: DocumentResolver;
  private incoming = new Map<string, Set<string>>();
  constructor(records: DocumentRecord[], associations: Association[] = []) {
    this.resolver = new DocumentResolver(records, associations);
    for (const record of records) if (record.kind) {
      for (const citation of record.links) if (citation.target && !navigation(citation.target)) {
        const sources = this.incoming.get(citation.target) ?? new Set<string>(); sources.add(record.path);
        this.incoming.set(citation.target, sources);
      }
    }
  }
  query(path: string, mode: DateMode = 'document'): Result {
    const { subject, paths, problems } = this.resolver.context(path);
    const record = this.resolver.records.get(subject);
    const result: Result = { subject, title: this.resolver.title(subject), notes: [], related: [], catalog: [], problems };
    const notes = new Map<string, ResultRow>(), related = new Map<string, ResultRow>(), catalog = new Map<string, ResultRow>();
    const notePaths = new Set<string>();
    for (const p of paths.keys()) for (const note of this.incoming.get(p) ?? []) notePaths.add(note);
    if (record?.kind === 'Connection') notePaths.add(subject);
    for (const notePath of notePaths) {
      const note = this.resolver.records.get(notePath)!;
      const matches = note.links.filter(l => l.target && paths.has(l.target));
      if (notePath !== subject) for (const citation of matches) {
        const evidence = this.evidence(note, citation, note.kind!, paths.get(citation.target!));
        this.add(notes, note.path, note.title, evidence);
      }
      if (note.kind === 'Connection') for (const citation of note.links) {
        if (citation.target && paths.has(citation.target) || navigation(citation.target)) continue;
        this.add(related, citation.target, citation.label, this.evidence(note, citation, 'Connection', matches[0]?.target ? paths.get(matches[0].target) : undefined));
      }
    }
    const wrappers = new Set(this.resolver.associations.filter(a => paths.has(a.wrapper)).map(a => a.wrapper));
    for (const wrapper of wrappers) {
      const note = this.resolver.records.get(wrapper)!;
      for (const citation of note.links) {
        if (citation.target && paths.has(citation.target) || navigation(citation.target)) continue;
        this.add(catalog, citation.target, citation.label, this.evidence(note, citation, 'Catalog'));
      }
    }
    const sort = (map: Map<string, ResultRow>) => sortRows([...map.values()].map(row => ({ ...row, date: row.path ? this.resolver.date(row.path, mode) : undefined })));
    result.notes = sort(notes); result.related = sort(related); result.catalog = sort(catalog);
    return result;
  }
  private evidence(note: DocumentRecord, citation: Citation, kind: Evidence['kind'], context?: string): Evidence {
    return { ...citation, note: note.path, noteTitle: note.title, kind, context, readingScope: note.readingScope };
  }
  private add(rows: Map<string, ResultRow>, path: string | null, label: string, evidence: Evidence) {
    const key = path ? this.resolver.key(path) : `missing:${evidence.note}:${evidence.link}`;
    const row = rows.get(key) ?? { key, path, title: path ? this.resolver.title(path) : label, evidence: [] };
    if (!row.evidence.some(e => e.note === evidence.note && e.line === evidence.line && e.link === evidence.link)) row.evidence.push(evidence);
    rows.set(key, row);
  }
}

export function filterRows(rows: ResultRow[], query: string): ResultRow[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => words.every(word => `${row.title} ${row.path ?? ''}`.toLocaleLowerCase().includes(word)));
}

export function inboxItems(paths: string[]): string[] {
  return [...new Set(paths.filter(path => path.startsWith('inbox/') && path !== 'inbox/README.md'
    && !path.split('/').some(part=>part.startsWith('.'))).map(path=>path.split('/')[1]))].sort();
}

/** Literal query words only; semantic retrieval has passage-level, not token-level evidence. */
export function matchingParts(text: string, query: string): { text: string; match: boolean }[] {
  const tokens = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a,b)=>b.length-a.length);
  if (!tokens.length) return [{text,match:false}];
  const escaped = tokens.map(token=>token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const pattern = new RegExp(escaped.join('|'),'giu');
  const parts: {text:string;match:boolean}[]=[];let cursor=0;
  for (const match of text.matchAll(pattern)) {
    const start=match.index!;
    if(start>cursor)parts.push({text:text.slice(cursor,start),match:false});
    parts.push({text:match[0],match:true});cursor=start+match[0].length;
  }
  if(cursor<text.length)parts.push({text:text.slice(cursor),match:false});
  return parts;
}
