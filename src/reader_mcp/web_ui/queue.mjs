/** Reading queue (Space r): Up next and History, the q action, Space n and the end-of-article lead.
    State, requests and keys live here; the panel itself is a React island from the controls bundle. */
import {daysBetween, formatDate, localDay, todayLocal} from './logic.mjs';

/** "Today", "Yesterday", else "Oct 21" (with the year outside the current one); both are local plain days. */
export function historyDayLabel(date, today) {
  const days = daysBetween(date, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDate(date, {year:date.slice(0, 4) !== today.slice(0, 4)});
}
/** History pages regrouped by the reader's local day of each open (the server pages newest first). */
export function historyDays(pages, timeZone) {
  const days = [];
  for (const item of pages.flatMap(day => day.items)) {
    const date = localDay(item.opened_at, timeZone) || 'unknown';
    if (!days.length || days.at(-1).date !== date) days.push({date, items:[]});
    days.at(-1).items.push(item);
  }
  return days;
}

export function installQueue({state, api, navigate, notify, renderPanel, focusMain, onChange, needsReader=() => false}) {
  const $ = selector => document.querySelector(selector);
  const panel = $('#queue-panel');
  const q = {tab:'next', active:0, filter:'all', data:null, history:null, loading:false, confirm:null, pending:null, generation:0};
  const param = encodeURIComponent;
  const participant = () => state.prefs.participant;
  const tz = () => -new Date().getTimezoneOffset();
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1:'st', 2:'nd', 3:'rd'})[n % 10] || 'th');
  const pace = () => +state.prefs.pace || 220;
  const isOpen = () => !panel.hidden;

  function minutes(words, fraction=0) { return Math.max(1, Math.ceil(words * (1 - fraction) / pace())); }
  function time(row) {
    if (row.finished) return 'Finished';
    if (row.progress !== null && row.progress > .01) return Math.round(row.progress * 100) + '%' + (row.words ? ' · ' + minutes(row.words, row.progress) + ' min left' : '');
    return row.words ? minutes(row.words) + ' min' : '';
  }
  function byline(row) { return [row.authors?.join(' · '), row.projects?.[0]].filter(Boolean).join(' · ') || 'Unspecified author'; }
  function clock(iso) { return new Date(iso).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'}); }

  /** Flat, indexed rows for each tab, in display order. */
  function model() {
    let index = 0;
    const row = (item, kind, extra={}) => ({index:index++, kind, path:item.path, title:item.title, byline:byline(item), read:item.read, time:time(item), progress:item.progress, finished:item.finished, ...extra});
    const data = q.data, next = [];
    if (data) {
      if (data.now) next.push({id:'now', label:data.now.resume ? 'Pick up where you left off' : 'Now reading', rows:[row(data.now, 'now', {resume:!!data.now.resume})]});
      next.push({id:'queued', label:'Queued by you', count:data.queued.length, rows:data.queued.map((item, i) => row(item, 'queued', {position:i + 1})), empty:'Nothing queued yet. Press q on anything to add it.',
        action:data.queued.length ? {label:'Clear', onClick:askClear} : undefined});
      if (data.suggested.length) next.push({id:'suggested', label:'Suggested', rows:data.suggested.map(item => row(item, 'suggested', {reason:item.reason, voice:item.source === 'voice' ? item.added_by : undefined}))});
    }
    const nextRows = next.flatMap(section => section.rows);
    index = 0;
    const today = todayLocal();
    const history = historyDays(q.history?.days || []).map(day => ({id:'day-' + day.date, label:day.date === 'unknown' ? 'Undated' : historyDayLabel(day.date, today), rows:day.items.map(item => row(item, 'history', {when:clock(item.opened_at), changed:item.changed}))}));
    return {next, nextRows, history, historyRows:history.flatMap(section => section.rows)};
  }
  function rows(m=model()) { return q.tab === 'next' ? m.nextRows : m.historyRows; }
  function render() {
    if (!isOpen()) return;
    const m = model(), list = rows(m);
    q.active = Math.max(0, Math.min(q.active, list.length - 1));
    panel.toggleAttribute('aria-busy', q.loading);
    renderPanel(panel, {tab:q.tab, active:q.active, loading:q.loading, next:m.next, history:m.history, queuedCount:q.data?.queued.length || 0,
      historyEmpty:q.history && !q.history.total ? (q.filter === 'finished' ? 'Nothing finished yet.' : 'No reading history yet.') : null,
      historyMore:q.history?.next_cursor != null, filter:q.filter, confirm:q.confirm,
      onTab:switchTab, onFilter:setFilter, onOpen:openRow, onActive:index => {q.active = index; render();}, onRemove:index => {q.active = index; remove();},
      onPin:index => {q.active = index; pin();}, onMore:more, onConfirm:answer, onClose:() => close()});
    const active = panel.querySelector(`#queue-${q.tab}-${q.active}`);
    active?.scrollIntoView({block:'nearest'});
  }

  async function refresh() {
    const generation = ++q.generation;
    q.loading = true; render();
    try {
      const data = await api('/api/queue?participant=' + param(participant()) + (state.doc ? '&current=' + param(state.doc.path) : ''));
      if (generation !== q.generation) return;
      q.data = data; onChange?.(data);
    } catch (error) { failed(error); }
    finally { if (generation === q.generation) { q.loading = false; render(); } }
  }
  async function loadHistory(more=false) {
    const cursor = more ? q.history?.next_cursor || 0 : 0;
    try {
      const data = await api(`/api/history?participant=${param(participant())}&cursor=${cursor}&tz=${tz()}${q.filter === 'finished' ? '&filter=finished' : ''}`);
      if (more && q.history) {
        const days = [...q.history.days];
        for (const day of data.days) {
          if (days.at(-1)?.date === day.date) days[days.length - 1] = {...days.at(-1), items:[...days.at(-1).items, ...day.items]};
          else days.push(day);
        }
        q.history = {...data, days};
      } else q.history = data;
      render();
    } catch (error) { failed(error); }
  }
  /** A failed request; in the static web demo (#107) a queue write explains instead of failing. */
  function failed(error) { notify(error.message, error.local ? 'info' : 'error'); }
  async function change(action, path, extra={}) {
    if (needsReader()) throw Object.assign(new Error('Your reading queue needs Reader on your computer: it saves into the library.'), {local:true});
    const data = await api('/api/queue', {participant:participant(), action, path, request_id:crypto.randomUUID(), current:state.doc?.path || null, ...extra});
    q.data = data; onChange?.(data); render();
    return data;
  }

  function open(tab='next') {
    closeOthers?.();
    q.tab = tab; q.confirm = null; panel.hidden = false;
    render(); refresh(); if (tab === 'history' || !q.history) loadHistory();
    requestAnimationFrame(() => (panel.querySelector('#queue-list-' + q.tab) || panel.querySelector('[role=tab]'))?.focus({preventScroll:true}));
    onChange?.(q.data);
  }
  function close(focus=true) {
    if (!isOpen()) return;
    panel.hidden = true; q.confirm = null; q.generation++;
    if (focus) focusMain();
    onChange?.(q.data);
  }
  function toggle() { isOpen() ? close() : open(); }
  function switchTab(tab) { if (tab === q.tab) return; q.tab = tab; q.active = 0; q.confirm = null; if (tab === 'history') loadHistory(); render(); requestAnimationFrame(() => panel.querySelector('#queue-list-' + tab)?.focus({preventScroll:true})); onChange?.(q.data); }
  function setFilter(filter) { q.filter = filter; q.active = 0; loadHistory(); }
  function more() { if (q.history?.next_cursor != null) loadHistory(true); }

  function current() { return rows()[q.active]; }
  function openRow(index=q.active) {
    const row = rows()[index]; if (!row) return;
    close(false);
    if (row.path === state.doc?.path) { focusMain(); return; }
    navigate(row.path);
  }
  async function remove() {
    const row = current(); if (!row) return;
    if (row.kind === 'now') { notify('This one is open now. Close it by opening something else.'); return; }
    if (row.kind === 'history') { q.confirm = {message:`Remove “${row.title}” from your history? Your read receipt and reading position stay.`, action:'Remove', run:() => hide(row)}; render(); focusConfirm(); return; }
    try { await change('remove', row.path); notify(row.kind === 'queued' ? 'Removed from your queue.' : 'Suggestion dismissed.'); } catch (error) { failed(error); }
  }
  async function hide(row) {
    try { await api('/api/history', {participant:participant(), action:'hide', path:row.path}); await loadHistory(); refresh(); notify('Removed from history. Your read receipt stays.'); }
    catch (error) { failed(error); }
  }
  async function pin() {
    const row = current(); if (!row) return;
    if (row.kind !== 'suggested') { if (row.kind === 'history') add(row.path); return; }
    try { const data = await change('pin', row.path, row.reason && !row.voice ? {reason:row.reason} : {}); announce(data, row.path, 'Added to your queue'); } catch (error) { failed(error); }
  }
  function askClear() {
    const count = q.data?.queued.length || 0; if (!count) return;
    q.confirm = {message:`Clear ${count} queued ${count === 1 ? 'document' : 'documents'}? Suggestions and your history stay.`, action:'Clear queue', run:async () => { try { await change('clear'); notify('Your queue is clear.'); } catch (error) { failed(error); } }};
    render(); focusConfirm();
  }
  function focusConfirm() { requestAnimationFrame(() => panel.querySelector('#queue-confirm-yes')?.focus()); }
  function answer(yes) {
    const confirm = q.confirm; q.confirm = null; render();
    panel.querySelector('#queue-list-' + q.tab)?.focus({preventScroll:true});
    if (yes) confirm?.run();
  }
  async function move(delta) {
    const row = current(); if (row?.kind !== 'queued') return;
    const target = row.position - 1 + delta; if (target < 0 || target >= q.data.queued.length) return;
    try { await change('move', row.path, {index:target}); q.active += delta; render(); } catch (error) { failed(error); }
  }
  function announce(data, path, verb) {
    const position = data.queued.findIndex(item => item.path === path) + 1;
    notify(position ? `${verb} · ${ordinal(position)}` : verb, 'success');
  }

  /** The q action, from anywhere a document is offered. */
  async function add(path) {
    if (!path?.startsWith('library/')) { notify('Only library documents can be queued.'); return; }
    const before = q.data?.queued.some(item => item.path === path);
    try { const data = await change('add', path); announce(data, path, before ? 'Already in your queue' : 'Added to your queue'); }
    catch (error) { failed(error); }
  }
  /** Space n: open the next queued document, like skipping to the next track. */
  async function next() {
    try {
      const data = await api('/api/queue?participant=' + param(participant()) + (state.doc ? '&current=' + param(state.doc.path) : ''));
      q.data = data;
      const item = data.queued.find(row => row.path !== state.doc?.path);
      if (!item) { notify('Your queue is empty. Press q on anything to add it.'); return; }
      close(false); navigate(item.path);
    } catch (error) { failed(error); }
  }
  /** History log entry for an open; the server also takes it out of Up next. */
  async function opened(doc) {
    try { await api('/api/history', {participant:participant(), action:'open', path:doc.path, sha256:doc.sha256}); } catch { /* History is a convenience; reading continues. */ }
    if (q.data) q.data = {...q.data, queued:q.data.queued.filter(item => item.path !== doc.path)};
  }
  /** The first queued document, for the end-of-article lead. */
  async function peek() {
    try { const data = await api('/api/queue?participant=' + param(participant()) + (state.doc ? '&current=' + param(state.doc.path) : '')); q.data = data; return data.queued.find(row => row.path !== state.doc?.path) || null; }
    catch { return null; }
  }

  /** Keys while the panel has focus. Returns true when the key was handled here. */
  function handleKey(event) {
    if (!isOpen() || !panel.contains(event.target) || state.leader || event.metaKey || event.ctrlKey) return false;
    const key = event.key;
    if (q.confirm) {
      if (['Escape', 'n'].includes(key)) { event.preventDefault(); event.stopPropagation(); answer(false); return true; }
      if (['Enter', 'y'].includes(key)) { event.preventDefault(); answer(true); return true; }
      return key !== 'Tab';
    }
    if (key === ' ' || key === ',' || key === 'Escape' || key === '?') return false;
    if (event.target.closest('[role=tab],[data-queue-filter]')) {
      if (['Enter', 'ArrowLeft', 'ArrowRight'].includes(key)) return false;
    }
    const list = rows(), act = fn => { event.preventDefault(); fn(); return true; };
    if (key === 'Tab' || key === '1' || key === '2') return act(() => switchTab(key === '1' ? 'next' : key === '2' ? 'history' : q.tab === 'next' ? 'history' : 'next'));
    if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) return act(() => move(key === 'ArrowUp' ? -1 : 1));
    if (key === 'J' || key === 'K') return act(() => move(key === 'K' ? -1 : 1));
    if (key === 'j' || key === 'ArrowDown') return act(() => { q.active = Math.min(list.length - 1, q.active + 1); if (q.tab === 'history' && q.active === list.length - 1) more(); render(); });
    if (key === 'k' || key === 'ArrowUp') return act(() => { q.active = Math.max(0, q.active - 1); render(); });
    if (key === 'Home' || key === 'g') return act(() => { q.active = 0; render(); });
    if (key === 'End' || key === 'G') return act(() => { q.active = list.length - 1; render(); });
    if (key === 'Enter') return act(() => openRow());
    if (key === 'x' || key === 'Delete' || key === 'Backspace') return act(remove);
    if (key === 'p' || key === 'q') return act(pin);
    if (key === 'c' && q.tab === 'next') return act(askClear);
    if (key === 'f' && q.tab === 'history') return act(() => setFilter(q.filter === 'all' ? 'finished' : 'all'));
    // Other single keys stay inside the panel instead of moving the page behind it.
    if (key.length === 1) { event.preventDefault(); return true; }
    return false;
  }
  let closeOthers = null;
  return {open, close, toggle, add, next, opened, peek, handleKey, isOpen, refresh, mode:() => q.tab, setCloseOthers(fn) { closeOthers = fn; }};
}
