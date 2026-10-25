/** The search page route: linkable query and filters (#search=…), debounced requests, keys, and recent searches. */
import {mountSearchPage, flatPassages, clearControlsWithin} from './controls/reader-controls.js';
import {addDays, localMidnight, todayLocal, workDay} from './logic.mjs';

const BLANK = {project:[], author:[], type:[], from:null, to:null, read:'all', folder:null, machine:false};
const MODES = ['best', 'words', 'meaning'];
const RECENT = 'reader.search.recent.v1', SESSION = 'reader.search.session.v1';
const read = (store, key, fallback) => { try { return JSON.parse(store.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const write = (store, key, value) => { try { store.setItem(key, JSON.stringify(value)); } catch {} };

/** {query, mode, filters} ↔ the URLSearchParams string carried by #search=. */
export function encodeSearch({query, mode, filters}) {
  const p = new URLSearchParams();
  if (query) p.set('q', query);
  if (mode !== 'best') p.set('mode', mode);
  for (const key of ['project', 'author', 'type']) for (const value of filters[key]) p.append(key, value);
  for (const key of ['from', 'to', 'folder']) if (filters[key]) p.set(key, filters[key]);
  if (filters.read !== 'all') p.set('read', filters.read);
  if (filters.machine) p.set('machine', '1');
  return p.toString();
}
export function decodeSearch(text) {
  const p = new URLSearchParams(text || ''), filters = {...BLANK};
  for (const key of ['project', 'author', 'type']) filters[key] = p.getAll(key).filter(Boolean).slice(0, 20);
  for (const key of ['from', 'to']) filters[key] = /^\d{4}-\d{2}-\d{2}$/.test(p.get(key) || '') ? p.get(key) : null;
  const folder = p.get('folder');
  filters.folder = folder && folder.startsWith('library/') ? folder : null;
  filters.read = ['unread', 'read'].includes(p.get('read')) ? p.get('read') : 'all';
  filters.machine = p.get('machine') === '1';
  return {query: (p.get('q') || '').slice(0, 1000), mode: MODES.includes(p.get('mode')) ? p.get('mode') : 'best', filters};
}

export function installSearch({api, state, navigate, back, backstage, notify, queue}) {
  const remembered = read(sessionStorage, SESSION, null);
  let params = remembered ? decodeSearch(remembered) : {query:'', mode:'best', filters:{...BLANK}};
  let island = null, model = null, timer = 0, request = 0, controller = null;
  const hash = () => '#search=' + encodeURIComponent(encodeSearch(params));
  // A hand-typed `#search=receipts` (no `=` inside) is the query itself; a malformed escape is read literally.
  const fromHash = value => {
    const raw = value.replace(/^#search=?/, ''); let text; try { text = decodeURIComponent(raw); } catch { text = raw; }
    return decodeSearch(text && !text.includes('=') ? new URLSearchParams({q:text}).toString() : text);
  };
  const passages = () => flatPassages(model?.works || []);
  const words = query => (query.match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 32);

  function set(patch) { model = {...model, ...patch}; island?.update(patch); }
  function remember() {
    write(sessionStorage, SESSION, encodeSearch(params));
    if (state.view === 'search') history.replaceState({reader:true, path:':search'}, '', hash());
  }
  function addRecent(query) {
    query = query.trim(); if (!query) return;
    const recent = [query, ...read(localStorage, RECENT, []).filter(q => q !== query)].slice(0, 8);
    write(localStorage, RECENT, recent); set({recent});
  }
  function suggestions() {
    const counts = new Map();
    for (const work of state.data?.works || []) if (!work.read) for (const topic of work.topics || []) if (!/^Unclassified/.test(topic)) counts.set(topic, (counts.get(topic) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([topic]) => topic);
  }
  function url(offset) {
    const q = new URLSearchParams(encodeSearch(params));
    if (!q.has('q')) q.set('q', params.query);
    q.set('mode', params.mode); q.set('offset', offset); q.set('limit', 20);
    if (state.prefs.participant) q.set('participant', state.prefs.participant);
    // Local midnights bound the range, so works with an arrival time match by their local day.
    if (params.filters.from) q.set('from_at', localMidnight(params.filters.from));
    if (params.filters.to) q.set('to_at', localMidnight(addDays(params.filters.to, 1)));
    return '/api/search/page?' + q.toString();
  }
  async function run(offset = 0, attempt = 0) {
    clearTimeout(timer);
    const id = ++request; controller?.abort();
    if (!params.query.trim()) { controller = null; set({status:'idle', result:null, works:[], active:0, error:null}); return; }
    controller = new AbortController();
    set(offset ? {loadingMore:true} : {status:'loading', error:null});
    try {
      const result = await api(url(offset), null, {signal:controller.signal});
      if (id !== request) return;
      result.works.forEach(w => { if (w.arrival_time) w.date = workDay(w); });
      const works = offset ? [...model.works, ...result.works.filter(w => !model.works.some(o => o.id === w.id))] : result.works;
      set({status:'ready', result, works, loadingMore:false, active:offset ? model.active : 0, terms:result.terms});
    } catch (error) {
      if (id !== request || error.name === 'AbortError') return;
      if (/running; try again/.test(error.message) && attempt < 4) { timer = setTimeout(() => run(offset, attempt + 1), 250 * (attempt + 1)); return; }
      set({status:'error', error:error.message, loadingMore:false});
    }
  }
  function schedule() { clearTimeout(timer); request++; controller?.abort(); remember(); timer = setTimeout(run, params.mode === 'meaning' ? 450 : 200); }
  function update(patch) {
    params = {...params, ...patch, filters:{...params.filters, ...(patch.filters || {})}};
    set({query:params.query, mode:params.mode, filters:params.filters});
  }
  function open(index, background = false) {
    const entry = passages()[index]; if (!entry) return;
    addRecent(params.query);
    const at = {line:entry.passage.line, page:entry.passage.page, terms:model.terms || words(params.query), query:params.query.trim()};
    if (background) {
      const link = location.pathname + '#read=' + encodeURIComponent(entry.passage.path) + '&at=' + encodeURIComponent(JSON.stringify(at));
      window.open(link, '_blank', 'noopener');
      notify('Opened “' + entry.work.title + '” in a new tab.');
      return;
    }
    navigate(entry.passage.path, {at});
  }
  /** q or + Queue: add the active passage's work (its primary source) to the reading queue. */
  function enqueue(index = model.active) { const entry = passages()[index]; if (entry && queue) queue(entry.work.primary); }
  function select(index) {
    const count = passages().length; if (!count) return;
    set({active:Math.max(0, Math.min(count - 1, index))});
  }
  function step(delta, byWork) {
    const list = passages(); if (!list.length) return;
    const current = list[model.active] || list[0];
    if (!byWork) { select(model.active + delta); return; }
    const target = Math.max(0, Math.min(model.works.length - 1, current.w + delta));
    select(list.findIndex(entry => entry.w === target));
  }
  const focusField = () => { const field = document.getElementById('search-query'); field?.focus(); field?.select(); };
  const focusResults = () => document.querySelector(`.search-results [data-passage="${model.active}"]`)?.focus();
  const actions = {
    query(q) { update({query:q.slice(0, 1000)}); schedule(); },
    mode(m) { update({mode:m}); remember(); run(); },
    filters(patch) { update({filters:patch}); remember(); run(); },
    clearFilters() { update({filters:{...BLANK}}); remember(); run(); },
    open, select, queue:path => queue?.(path), more() { run(model.works.length); }, backstage,
    fieldKey(event) {
      if (event.key === 'ArrowDown' || event.ctrlKey && ['j', 'n'].includes(event.key)) { event.preventDefault(); if (passages().length) { select(model.active); focusResults(); } }
      else if (event.key === 'Enter') { event.preventDefault(); clearTimeout(timer); if (model.status === 'ready' && passages().length && model.result) open(model.active); else run(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (passages().length) focusResults(); else back(); }
    },
  };
  return {
    view: 'search', hash,
    render(container, routeHash) {
      if (routeHash?.startsWith('#search')) params = fromHash(routeHash);
      clearControlsWithin(container);
      model = {query:params.query, mode:params.mode, filters:params.filters, status:'idle', error:null, result:null, works:[], active:0,
        recent:read(localStorage, RECENT, []), suggestions:suggestions(), loadingMore:false, terms:null, today:todayLocal()};
      island = mountSearchPage(container, model, actions);
      remember();
      run();
      requestAnimationFrame(focusField);
    },
    leave() { clearTimeout(timer); request++; controller?.abort(); island = null; if (params.query.trim()) addRecent(params.query); },
    focus: focusField,
    /** Escape on a page control (mode, facet, filter) returns to the results, or the field; returns false when Escape should leave. */
    escape() {
      const active = document.activeElement, page = document.querySelector('.search-page');
      if (!page?.contains(active) || active.id === 'search-query' || active.closest('[data-passage]')) return false;
      if (passages().length) focusResults(); else focusField();
      return true;
    },
    /** Keys on the page outside the field; returns true when handled. */
    key(event) {
      if (event.target.closest?.('input,textarea,select,[role=dialog]')) return false;
      const map = {j:() => step(1), k:() => step(-1), ArrowDown:() => step(1), ArrowUp:() => step(-1), J:() => step(1, true), K:() => step(-1, true),
        Enter:() => open(model.active), o:() => open(model.active, true), q:() => enqueue(), '/':focusField};
      const handler = map[event.key]; if (!handler) return false;
      if (event.key === 'Enter' && event.target.closest?.('button:not([data-passage]),a')) return false;
      event.preventDefault(); handler(); return true;
    },
  };
}
