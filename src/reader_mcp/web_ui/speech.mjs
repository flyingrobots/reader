/** Send to AI-TTS: build the request from the open edition, a selection or the reading position. */
import {codePointOffset} from './logic.mjs';

export function installSpeech({state, api, reading, notify, track, openDialog, closeDialog}) {
  const $ = selector => document.querySelector(selector);
  const spoken = () => state.doc && (state.doc.text !== null || state.doc.kind === '.pdf');
  const selection = () => state.selected && state.selected.path === state.doc?.path && getSelection()?.isCollapsed === false ? state.selected : null;
  /** Plain text renders as one <pre>; find the character at the reading line instead of a block. */
  function plainOffset() {
    const pre = $('#article > pre'); if (!pre || !document.caretPositionFromPoint && !document.caretRangeFromPoint) return null;
    const box = (reading.hasBook() ? $('.book-viewport') : pre).getBoundingClientRect();
    const x = Math.max(box.left, pre.getBoundingClientRect().left) + 12, y = reading.hasBook() ? box.top + 12 : innerHeight * .22;
    const hit = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : document.caretRangeFromPoint(x, y);
    const node = hit?.offsetNode || hit?.startContainer, offset = hit?.offset ?? hit?.startOffset;
    if (!node || !pre.contains(node) || node.nodeType !== 3) return null;
    let before = 0; for (const text of pre.childNodes) { if (text === node) break; before += text.textContent.length; }
    return codePointOffset(state.doc.text, before + offset);
  }
  function request(scope) {
    const doc = state.doc, base = {path: doc.path, source_sha256: doc.sha256, scope};
    if (scope === 'selection') {
      const selected = selection(); if (!selected) throw new Error('Select a passage first.');
      return {...base, start: selected.start, end: selected.end};
    }
    if (scope === 'from') {
      const mark = reading.capture();
      if (doc.kind === '.pdf') return mark?.pdf_page ? {...base, page: mark.pdf_page} : {...base, page: 1};
      const start = mark?.source_offset ?? plainOffset();
      if (start === null || start === undefined) throw new Error('Couldn’t find your place on this page. Try Whole article.');
      return {...base, start};
    }
    return base;
  }
  async function send(scope) {
    if (state.doc?.preview) { notify('Inbox previews can be spoken once they are filed into the library.', 'info'); return; }
    if (state.doc?.historical) { notify('Send to AI-TTS reads the current file; open the current version to listen.', 'info'); return; }
    closeDialog('speak-menu');
    if (!spoken()) { notify(state.doc ? 'This document has no text to speak.' : 'Open a document to send it to AI-TTS.'); return; }
    let body; try { body = request(scope); } catch (error) { notify(error.message, 'error'); return; }
    try {
      const queued = await api('/api/speak', body);
      notify(queued.held ? 'Queued for AI-TTS; it plays when the pause ends.' : 'Queued for AI-TTS.', 'success', queued.id);
      track(queued);
    } catch (error) {
      if (error.data?.unavailable) notify('AI-TTS isn’t running', 'error', error.message);
      else notify(error.message, 'error');
    }
  }
  function openMenu() {
    if (state.doc?.historical) { notify('Send to AI-TTS reads the current file; open the current version to listen.', 'info'); return; }
    if (!spoken()) { notify(state.doc ? 'This document has no text to speak.' : 'Open a document to send it to AI-TTS.'); return; }
    const menu = $('#speak-menu'), hasSelection = !!selection();
    menu.querySelector('[data-speak=selection]').disabled = !hasSelection;
    menu.querySelector('[data-speak=selection]').title = hasSelection ? '' : 'Select a passage to send only that.';
    openDialog('speak-menu');
    menu.querySelector(hasSelection ? '[data-speak=selection]' : '[data-speak=article]').focus();
  }
  const menu = $('#speak-menu');
  menu.querySelectorAll('[data-speak]').forEach(button => button.onclick = () => send(button.dataset.speak));
  menu.addEventListener('keydown', event => {
    const scope = {a: 'article', f: 'from', s: 'selection'}[event.key];
    if (scope && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); if (!menu.querySelector(`[data-speak=${scope}]`).disabled) send(scope); return; }
    if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.querySelectorAll('[data-speak]:not(:disabled)')], index = items.indexOf(document.activeElement);
      items[(index + (['j', 'ArrowDown'].includes(event.key) ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
  $('#speak-selection').onclick = () => { $('#selection-tools').hidden = true; send('selection'); };
  return {send, openMenu};
}
