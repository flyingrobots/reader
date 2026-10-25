/* Static demo shim (RW-42). Inert unless the page carries <meta name="reader-static-demo">, which only
   `reader demo --export-static` writes. With the flag, /api/* requests are answered from the exported
   files in data/, search runs on a client-side keyword index, and highlights, comments and reading
   positions stay in this browser's storage. Everything that needs a running Reader says so. */
(() => {
  'use strict';
  const flag = document.querySelector('meta[name="reader-static-demo"]');
  if (!flag) return;
  let config;
  try { config = JSON.parse(flag.content); } catch { return; }
  const BASE = typeof config.base === 'string' && config.base.startsWith('/') ? config.base : '/';
  const STORE = 'reader.static-demo.v1';
  const LOCALLY = 'Run Reader on your computer to try this: the web demo has no server.';
  const realFetch = window.fetch.bind(window);
  const RealEventSource = window.EventSource;
  const cache = new Map();
  const load = name => {
    if (!cache.has(name)) cache.set(name, realFetch(BASE + 'data/' + name).then(r => { if (!r.ok) throw new Error('Missing demo data ' + name); return r.json(); })
      .catch(error => { cache.delete(name); throw error; }));
    return cache.get(name);
  };
  const manifest = () => load('manifest.json');

  // Local state: this visitor's highlights, replies and reading positions, in this browser only.
  const blank = () => ({version: 1, threads: {}, replies: {}, resolved: {}, bookmarks: {}});
  let memory = null;
  function local() {
    if (memory) return memory;
    try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); memory = saved && saved.version === 1 ? {...blank(), ...saved} : blank(); }
    catch { memory = blank(); }
    return memory;
  }
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(memory)); } catch { /* Private mode: changes last for this page only. */ } }

  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8'}});
  const unavailable = (message = LOCALLY, status = 501) => json({error: message, unavailable: true, static_demo: true}, status);
  const fileURL = path => BASE + 'files/' + path.split('/').map(encodeURIComponent).join('/');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, '+00:00');

  /** The exporter's lookup key: route plus sorted query pairs, without the browser's UTC offset. */
  function keyOf(path, pairs) {
    const sorted = pairs.filter(([k]) => k !== 'tz').map(([k, v]) => [String(k), String(v)])
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
    return JSON.stringify([path, sorted]);
  }
  /** A recorded answer, trying the default participant when another (or none) was asked for. */
  async function recorded(path, params) {
    const m = await manifest(), pairs = [...params];
    const tries = [pairs];
    const others = pairs.filter(([k]) => k !== 'participant');
    tries.push([...others, ['participant', m.participant]], others);
    for (const attempt of tries) {
      const entry = m.routes[keyOf(path, attempt)];
      if (entry) return {status: entry[1], data: await load('r/' + entry[0] + '.json')};
    }
    return null;
  }
  async function replay(path, params) {
    const found = await recorded(path, params);
    return found ? json(found.data, found.status) : json({error: 'This view was not recorded for the web demo. ' + LOCALLY, static_demo: true}, 404);
  }

  // ---- Search: a keyword index over the vault's own passages, and fuzzy titles. ----
  const fold = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const words = query => (fold(query).match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 32);
  let indexed = null;
  async function index() {
    if (indexed) return indexed;
    const [data, boot] = await Promise.all([load('search.json'), library()]);
    indexed = {...data, folded: data.passages.map(fold), works: new Map(boot.works.map(w => [w.primary, w]))};
    return indexed;
  }
  async function library() { return (await recorded('/api/library', [])).data; }
  const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function matcher(terms) {
    const patterns = terms.map(term => new RegExp('(?:^|[^\\p{L}\\p{N}_])' + escapeRegExp(term), 'gu'));
    return text => {
      let score = 0;
      for (const pattern of patterns) { pattern.lastIndex = 0; const hits = (text.match(pattern) || []).length; if (!hits) return 0; score += hits; }
      return score;
    };
  }
  function workOf(idx, path) {
    return idx.works.get(path) || {id: path, title: path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), primary: path,
      authors: [], projects: [], types: [], topics: [], date: null, arrival_time: null, primary_format: '.' + path.split('.').pop()};
  }
  /** About 300 characters around the first hit, with term spans in excerpt offsets. */
  function excerpt(text, terms) {
    const flat = text.replace(/\s+/g, ' ').trim(), folded = fold(flat);
    let first = -1;
    for (const term of terms) { const at = folded.indexOf(term); if (at >= 0 && (first < 0 || at < first)) first = at; }
    const start = Math.max(0, first - 80), end = Math.min(flat.length, start + 300);
    const body = flat.slice(start, end), text2 = (start ? '…' : '') + body + (end < flat.length ? '…' : ''), shift = start ? 1 : 0;
    const spans = [], low = fold(body);
    for (const term of terms) { let at = low.indexOf(term); while (at >= 0 && spans.length < 24) { spans.push([at + shift, at + shift + term.length]); at = low.indexOf(term, at + term.length); } }
    spans.sort((a, b) => a[0] - b[0]);
    return {excerpt: text2, spans};
  }
  function hits(idx, terms, prefix) {
    const score = matcher(terms), found = [];
    idx.chunks.forEach(([p, page, start, end, passage]) => {
      const path = idx.paths[p];
      if (!path.startsWith(prefix)) return;
      const s = score(idx.folded[passage]) + (terms.every(t => fold(path).includes(t)) ? 1 : 0);
      if (s) found.push({path, page, start_line: start, end_line: end, passage, score: s / Math.sqrt(1 + idx.folded[passage].length / 400)});
    });
    return found.sort((a, b) => b.score - a.score);
  }
  async function readSet() { const boot = await library(); return new Map(boot.works.map(w => [w.primary, w.read])); }
  async function search(params) {
    const q = params.get('q') || '', mode = params.get('mode') || 'fuzzy', prefix = (params.get('path_prefix') || 'library/').replace(/\/?$/, '/');
    if (!q.trim()) return json({error: 'Expected a query of 1–1000 characters'}, 400);
    if (mode === 'semantic') return unavailable('Semantic search needs Reader’s local embedding model on your computer. Keyword and fuzzy search work here.', 400);
    const idx = await index(), read = await readSet(), m = await manifest();
    if (mode === 'fuzzy') {
      const needle = fold(q).trim(), results = [];
      for (const work of idx.works.values()) {
        if (!work.primary.startsWith(prefix)) continue;
        const hay = fold([work.title, work.primary, ...(work.authors || [])].join(' '));
        let score = hay.includes(needle) ? 1 - Math.min(.4, hay.indexOf(needle) / 400) : 0;
        if (!score) { let at = 0, gaps = 0; for (const ch of needle) { const next = hay.indexOf(ch, at); if (next < 0) { gaps = -1; break; } gaps += next - at; at = next + 1; } if (gaps >= 0) score = Math.max(0, .75 - gaps / (needle.length * 12)); }
        if (score >= .48) results.push({...work, path: work.primary, matched_by: ['fuzzy'], score, read: read.get(work.primary) === true});
      }
      results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
      return json({results: results.slice(0, 30), mode, indexed_at: m.exported_at, warnings: [], scope: 'Titles, paths and authors in the demo library (searched in your browser).'});
    }
    const terms = words(q); if (!terms.length) return json({results: [], mode, indexed_at: m.exported_at, warnings: [], complete: true});
    const seen = new Set(), results = [];
    for (const hit of hits(idx, terms, prefix)) {
      if (seen.has(hit.path)) continue; seen.add(hit.path);
      const work = workOf(idx, hit.path);
      results.push({path: hit.path, title: work.title, metadata: {title: work.title}, score: hit.score, matched_by: ['keyword'], page: hit.page,
        start_line: hit.start_line, end_line: hit.end_line, excerpt: excerpt(idx.passages[hit.passage], terms).excerpt, read: read.get(hit.path) === true});
      if (results.length >= 30) break;
    }
    return json({query: q, mode, results, indexed_at: m.exported_at, complete: true, warnings: [], scope: 'Keyword search of the demo library, in your browser.'});
  }
  async function searchPage(params) {
    const q = params.get('q') || '', mode = params.get('mode') || 'best';
    if (!q.trim()) return json({error: 'Expected a query of 1–1000 characters'}, 400);
    const offset = Math.max(0, +params.get('offset') || 0), limit = Math.min(50, Math.max(1, +params.get('limit') || 20));
    const f = {project: params.getAll('project'), author: params.getAll('author'), type: params.getAll('type'), from: params.get('from'), to: params.get('to'),
      from_at: params.get('from_at'), to_at: params.get('to_at'), read: params.get('read') || 'all', folder: params.get('folder'), machine: params.get('machine') === '1'};
    const idx = await index(), read = await readSet(), m = await manifest(), terms = words(q);
    const all = terms.length ? hits(idx, terms, f.folder || 'library/') : [];
    const facetField = {project: 'projects', author: 'authors', type: 'types'};
    const tests = {
      project: w => !f.project.length || f.project.some(v => (w.projects || []).includes(v)),
      author: w => !f.author.length || f.author.some(v => (w.authors || []).includes(v)),
      type: w => !f.type.length || f.type.some(v => (w.types || []).includes(v)),
      date: w => (!f.from || (w.date || '') >= f.from) && (!f.to || (!!w.date && w.date <= f.to)),
      read: w => f.read === 'all' || (read.get(w.primary) === true) === (f.read === 'read')};
    const passes = skip => hit => Object.entries(tests).every(([name, test]) => name === skip || test(workOf(idx, hit.path)));
    const grouped = new Map();
    for (const hit of all.filter(passes())) {
      const work = workOf(idx, hit.path), entry = grouped.get(work.id) || {work, score: hit.score, passages: []};
      grouped.set(work.id, entry);
      if (entry.passages.length >= 3) continue;
      const {excerpt: text, spans} = excerpt(idx.passages[hit.passage], terms);
      if (entry.passages.some(p => p.excerpt === text)) continue;
      entry.passages.push({path: hit.path, page: hit.page, start_line: hit.start_line, end_line: hit.end_line, line: hit.start_line, excerpt: text, spans, matched_by: ['keyword'], literal: true});
    }
    const ordered = [...grouped.values()];
    const fields = ['id', 'title', 'primary', 'authors', 'projects', 'types', 'date', 'arrival_time', 'primary_format'];
    const works = ordered.slice(offset, offset + limit).map(e => ({...Object.fromEntries(fields.map(k => [k, e.work[k] ?? null])), read: read.get(e.work.primary) === true, score: e.score, passages: e.passages}));
    const facets = {};
    for (const [name, field] of Object.entries(facetField)) {
      const counts = new Map(), ids = new Set();
      for (const hit of all.filter(passes(name))) { const w = workOf(idx, hit.path); if (ids.has(w.id)) continue; ids.add(w.id); for (const v of new Set(w[field] || [])) counts.set(v, (counts.get(v) || 0) + 1); }
      facets[name] = Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, 40));
    }
    const depth = (f.folder || 'library/').replace(/\/$/, '').split('/').length + 1, folders = new Map();
    for (const hit of all.filter(passes())) { const parts = hit.path.split('/'); if (parts.length > depth) { const key = parts.slice(0, depth).join('/') + '/'; if (!folders.has(key)) folders.set(key, new Set()); folders.get(key).add(workOf(idx, hit.path).id); } }
    facets.folder = Object.fromEntries([...folders].map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1]).slice(0, 12));
    const warnings = mode === 'words' ? [] : ['Meaning search needs Reader’s embedding model on your computer; the web demo shows exact-word matches.'];
    return json({query: q, mode, terms, filters: f, works, total: ordered.length, offset, limit, facets, facet_scope: 'all', pool: 500,
      indexed_at: m.exported_at, complete: true, semantic: mode === 'words' ? null : 'unavailable', warnings, scope: 'Keyword search of the demo library, in your browser.'});
  }

  // ---- Links: the exporter's resolutions, else a relative path that exists in the export. ----
  async function resolveOne(from, target) {
    const table = await load('resolve.json'), known = table[from] || {};
    if (known[target]) return known[target];
    const paths = new Set(await load('paths.json'));
    const [raw, fragment = ''] = String(target).split('#');
    if (!raw) return {path: from, fragment};
    const parts = (raw.startsWith('library/') ? raw : from.split('/').slice(0, -1).join('/') + '/' + raw).split('/'), out = [];
    for (const part of parts) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
    const candidate = out.join('/');
    for (const option of [candidate, candidate + '.md']) if (paths.has(option)) return {path: option, fragment};
    return {path: null, fragment};
  }

  // ---- Local writes: highlights, replies, resolve and reading positions. ----
  async function documentText(path) { const found = await recorded('/api/document', [['path', path]]); return found?.status === 200 ? found.data : null; }
  async function annotate(request) {
    const state = local(), op = request.operation;
    if (op === 'seen' || op === 'attention') return json({participant: request.participant, updated: (request.items || []).length, read: [], static_demo: true});
    if (op === 'create') {
      const doc = await documentText(request.path);
      if (!doc || typeof doc.text !== 'string') return json({error: 'Passage annotations support Markdown only'}, 400);
      const chars = Array.from(doc.text), {start, end} = request;
      if (!Number.isInteger(start) || !Number.isInteger(end) || !(0 <= start && start < end && end <= chars.length)) return json({error: 'Invalid passage range; offsets are Unicode code points'}, 400);
      const id = request.request_id || uuid();
      if (state.threads[id]) return json(state.threads[id]);
      const thread = {schema_version: 1, kind: request.kind === 'warning' ? 'warning' : 'highlight', id, document_path: request.path, document_id: null, owner: request.owner,
        created_at: now(), revision: 1, resolved: false, local: true,
        anchor: {start, end, quote: chars.slice(start, end).join(''), prefix: chars.slice(Math.max(0, start - 64), start).join(''), suffix: chars.slice(end, end + 64).join(''), source_sha256: doc.sha256},
        initial_comment: request.comment || '', comments: []};
      if (request.comment) thread.comments.push({id: uuid(), author: request.owner, body: request.comment, created_at: now(), reply_to: null});
      state.threads[id] = thread; persist();
      return json(thread);
    }
    if (op === 'reply') {
      const comment = {id: request.request_id || uuid(), author: request.author, body: String(request.body || ''), created_at: now(), reply_to: request.reply_to || null, local: true};
      if (!comment.body.trim()) return json({error: 'Comment is required'}, 400);
      const own = state.threads[request.thread_id];
      if (own) { if (!own.comments.some(c => c.id === comment.id)) { own.comments.push(comment); own.revision += 1; } }
      else { const list = state.replies[request.thread_id] ||= []; if (!list.some(c => c.id === comment.id)) list.push(comment); }
      persist();
      return json(own || {id: request.thread_id, comments: state.replies[request.thread_id]});
    }
    if (op === 'resolve') { state.resolved[request.thread_id] = !!request.resolved; if (state.threads[request.thread_id]) state.threads[request.thread_id].resolved = !!request.resolved; persist(); return json({id: request.thread_id, resolved: !!request.resolved}); }
    return unavailable();
  }
  function withLocalThreads(data, path) {
    const state = local();
    const threads = (data.threads || []).map(t => ({...t, comments: [...t.comments, ...(state.replies[t.id] || [])], resolved: t.id in state.resolved ? state.resolved[t.id] : t.resolved}));
    for (const thread of Object.values(state.threads)) if (thread.document_path === path) threads.push({...thread, location: {status: 'exact', start: thread.anchor.start, end: thread.anchor.end}});
    return {...data, threads};
  }

  async function get(url) {
    const path = url.pathname, params = url.searchParams;
    if (path === '/') return new Response('ok', {status: 200});
    if (path === '/api/health') return json({status: 'ok', version: 'static demo', static_demo: true, busy: []});
    if (path === '/api/prose') return json({available: false, message: 'Prose colors need Reader and Colorful Language on your computer.', static_demo: true});
    if (path === '/api/fonts') return json({families: []});
    if (path === '/api/local-model' || path === '/api/service' || path.startsWith('/api/speak/')) return unavailable(LOCALLY, 503);
    // Art (RW-43): the exported scenes draw here; making new art needs a voice on a running Reader.
    if (path === '/api/art/jobs') return json({jobs: [], active: 0, default: 'static-demo', error: null, static_demo: true,
      producers: [{id: 'static-demo', kind: 'voice', label: 'A voice on your computer', available: true, static_demo: true, cli: null, model: null, estimate_seconds: null}]});
    if (path === '/api/art/still') return json({error: 'Still images are not part of the web demo.', static_demo: true}, 404);
    if (path === '/api/search') return search(params);
    if (path === '/api/search/page') return searchPage(params);
    if (path === '/api/resolve') return json(await resolveOne(params.get('from') || '', params.get('target') || ''));
    if (path === '/api/resolve-batch') return json({results: await Promise.all(params.getAll('target').map(t => resolveOne(params.get('from') || '', t)))});
    if (path === '/api/file') return realFetch(fileURL(params.get('path') || ''));
    if (path === '/api/changes' && (params.has('a') || params.has('b'))) return unavailable('Comparing arbitrary versions needs Reader on your computer; What changed works here.', 400);
    if (path === '/api/library') {
      const found = await recorded(path, params);
      return json({...found.data, token: 'static-demo', static_demo: {exported_at: config.exported_at, base: BASE}});
    }
    if (path === '/api/discussion') {
      const found = await recorded(path, params);
      return found && found.status === 200 ? json(withLocalThreads(found.data, params.get('path'))) : replay(path, params);
    }
    if (path === '/api/document') {
      const found = await recorded(path, params);
      if (found && found.status === 200) { const mark = local().bookmarks[params.get('path')]; return json(mark && mark.source_sha256 === found.data.sha256 ? {...found.data, bookmark: mark} : found.data); }
      return replay(path, params);
    }
    return replay(path, params);
  }
  async function post(url, body) {
    let request = {};
    try { request = JSON.parse(body || '{}'); } catch { return json({error: 'Expected JSON'}, 400); }
    const path = url.pathname;
    if (path === '/api/annotations') return annotate(request);
    if (path === '/api/seen') return json({participant: request.participant, updated: (request.items || []).length, read: [], static_demo: true});
    if (path === '/api/bookmark') {
      const {participant, path: doc, ...item} = request; local().bookmarks[doc] = {...item, updated_at: now()}; persist();
      return json(local().bookmarks[doc]);
    }
    if (path === '/api/history') return json({participant: request.participant, static_demo: true});
    if (path === '/api/chat') return unavailable('Chat voices run on your computer: try `reader demo`, whose scripted voices answer without any AI account.');
    if (path === '/api/queue') return unavailable('The reading queue saves into the library; run Reader on your computer to change it.');
    if (path === '/api/art') return request.action === 'still' ? json({static_demo: true})
      : unavailable('Making art needs Reader on your computer: `reader demo` has a scripted voice that answers art commissions.');
    return unavailable();
  }

  window.fetch = async function (input, init = {}) {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !(url.pathname === '/' || url.pathname.startsWith('/api/'))) return realFetch(input, init);
    const method = (init.method || (typeof input === 'object' && !(input instanceof URL) ? input.method : 'GET') || 'GET').toUpperCase();
    try { return await (method === 'GET' ? get(url) : post(url, init.body)); }
    catch (error) { console.warn('Reader static demo', error); return json({error: 'The web demo could not answer: ' + (error.message || error)}, 500); }
  };

  /** Chat streams have no server: the panel gets a quiet, healthy stream. */
  class StaticEventSource extends EventTarget {
    constructor(url, options) {
      const parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin || !parsed.pathname.startsWith('/api/') || !RealEventSource) {
        if (RealEventSource) return new RealEventSource(url, options);
      }
      super();
      this.url = parsed.href; this.readyState = 0; this.withCredentials = false; this.onopen = this.onmessage = this.onerror = null;
      const send = (kind, data) => { if (this.readyState === 2) return; const event = new MessageEvent(kind, {data: JSON.stringify(data)}); this.dispatchEvent(event); };
      const id = parsed.searchParams.get('id');
      setTimeout(() => { if (this.readyState === 2) return; this.readyState = 1; const open = new Event('open'); this.dispatchEvent(open); this.onopen?.(open);
        send('hello', {chat_id: id, seq: 0, revision: null, pending: [], interval: 15}); }, 0);
      this.timer = setInterval(() => send('ping', {revision: null, pending: [], interval: 15}), 15000);
    }
    close() { this.readyState = 2; clearInterval(this.timer); }
  }
  StaticEventSource.CONNECTING = 0; StaticEventSource.OPEN = 1; StaticEventSource.CLOSED = 2;
  window.EventSource = StaticEventSource;

  // Images the app points at /api/file load the exported copy.
  const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (source?.set) Object.defineProperty(HTMLImageElement.prototype, 'src', {...source, set(value) {
    const text = String(value);
    if (text.startsWith('/api/file?path=')) { const path = new URLSearchParams(text.slice(10)).get('path') || ''; return source.set.call(this, fileURL(path)); }
    return source.set.call(this, value);
  }});

  // A small, dismissible note: what this page is and where changes live.
  const NOTE = 'reader.static-demo.note.v1';
  function note() {
    try { if (sessionStorage.getItem(NOTE)) return; } catch { /* Storage blocked: show the note. */ }
    const style = document.createElement('style');
    style.textContent = '.static-demo-note{position:fixed;z-index:60;left:16px;bottom:48px;max-width:min(440px,calc(100vw - 32px));display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);box-shadow:var(--shadow);font:12px/1.45 var(--sans)}.static-demo-note p{margin:0}.static-demo-note strong{color:var(--accent);font-weight:650}.static-demo-note a{color:var(--accent)}.static-demo-note button{flex:none;color:var(--muted);font-size:12px;padding:2px 4px}.static-demo-note button:hover{color:var(--ink)}';
    document.head.append(style);
    const box = document.createElement('aside');
    box.className = 'static-demo-note'; box.setAttribute('data-reader-decoration', ''); box.setAttribute('role', 'note'); box.id = 'static-demo-note';
    box.innerHTML = '<p><strong>Web demo.</strong> Highlights, notes and reading positions you add stay only in this browser. Chat voices, semantic search, the inbox runner, the local model and Read aloud need Reader on your computer: <a href="https://github.com/flyingrobots/reader#try-the-demo" rel="noopener">try it locally</a>. <a href="#" data-static-reset>Reset this demo</a></p><button type="button" aria-label="Hide this note">Hide</button>';
    box.querySelector('button').onclick = () => { box.remove(); try { sessionStorage.setItem(NOTE, '1'); } catch {} };
    box.querySelector('[data-static-reset]').onclick = event => { event.preventDefault(); try { localStorage.removeItem(STORE); } catch {} memory = null; location.reload(); };
    document.body.append(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', note, {once: true}); else note();
  window.readerStaticDemo = {base: BASE, exportedAt: config.exported_at, reset() { try { localStorage.removeItem(STORE); } catch {} memory = null; }};
})();
