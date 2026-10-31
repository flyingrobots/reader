/** Send to AI-TTS: build the request from the open edition, a selection or the reading position. */
import {codePointOffset} from './logic.mjs';

export function installSpeech({state, api, reading, notify, track, openMenu: showMenu, companion = null}) {
  let menu = null;  // The open Speak menu (web/src/shell-dialog.tsx), closed when a choice is sent.
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
  async function send(scope, voice) {
    if (state.doc?.preview) { notify('Inbox previews can be spoken once they are filed into the library.', 'info'); return; }
    if (state.doc?.historical) { notify('Send to AI-TTS reads the current file; open the current version to listen.', 'info'); return; }
    menu?.close();
    if (!spoken()) { notify(state.doc ? 'This document has no text to speak.' : 'Open a document to send it to AI-TTS.'); return; }
    let body; try { body = request(scope); if (voice !== undefined) body.voice = voice; } catch (error) { notify(error.message, 'error'); return; }
    try {
      const queued = await api('/api/speak', body);
      notify(queued.held ? 'Queued for AI-TTS; it plays when the pause ends.' : 'Queued for AI-TTS.', 'success', queued.id);
      track({...queued,path:body.path,source_sha256:body.source_sha256});
    } catch (error) {
      // A missing or stopped daemon is a setup question, not an error: name it and offer setup.
      if (error.data?.unavailable) companion ? companion('ai-tts', error.message) : notify('AI-TTS isn’t running', 'error', error.message);
      else notify(error.message, 'error');
    }
  }
  function openMenu() {
    if (state.doc?.historical) { notify('Send to AI-TTS reads the current file; open the current version to listen.', 'info'); return; }
    if (!spoken()) { notify(state.doc ? 'This document has no text to speak.' : 'Open a document to send it to AI-TTS.'); return; }
    menu = showMenu({hasSelection: !!selection(), api, choose: (scope, voice) => send(scope, voice), onClosed: () => { menu = null; }});
  }
  $('#speak-selection').onclick = () => { $('#selection-tools').hidden = true; send('selection'); };
  return {send, openMenu};
}
