/* Obsidian callouts for markdown-it: `> [!type] Title`, foldable `[!type]-` / `[!type]+`,
   nested by blockquote depth. Types and aliases follow Obsidian's built-in set; unknown
   types render as `note`. The generated header (icon + title) is decoration; the body keeps
   markdown-it's own block tokens, so their source maps (and annotation anchors) are exact.
   The marker line is removed from the first paragraph and that paragraph's map starts one
   line later, at its first body line. Pure: no DOM, so Node tests can run it. */
export const CALLOUT_TYPES = Object.freeze({
  note:'note', abstract:'abstract', summary:'abstract', tldr:'abstract', info:'info', todo:'todo',
  tip:'tip', hint:'tip', important:'tip', success:'success', check:'success', done:'success',
  question:'question', help:'question', faq:'question', warning:'warning', caution:'warning', attention:'warning',
  failure:'failure', fail:'failure', missing:'failure', danger:'danger', error:'danger',
  bug:'bug', example:'example', quote:'quote', cite:'quote',
});
const MARKER = /^\[!([A-Za-z0-9_-]+)\]([+-]?)[ \t]*(.*?)[ \t]*$/;
const titleCase = id => id.charAt(0).toUpperCase() + id.slice(1);

export function parseCalloutMarker(line) {
  const match = MARKER.exec(line);
  if (!match) return null;
  const id = match[1].toLowerCase();
  return {type: CALLOUT_TYPES[id] || 'note', id, fold: match[2] === '-' ? 'closed' : match[2] === '+' ? 'open' : null, title: match[3] || titleCase(id), custom: !!match[3]};
}

function closing(tokens, index) {
  for (let depth = 0, j = index; j < tokens.length; j++) {
    if (tokens[j].type === 'blockquote_open') depth++;
    else if (tokens[j].type === 'blockquote_close' && --depth === 0) return tokens[j];
  }
  return null;
}

function markCallouts(state) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i], paragraph = tokens[i + 1], inline = tokens[i + 2];
    if (open.type !== 'blockquote_open' || paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    const newline = inline.content.indexOf('\n');
    const callout = parseCalloutMarker(newline < 0 ? inline.content : inline.content.slice(0, newline));
    if (!callout) continue;
    if (newline < 0) tokens.splice(i + 1, 3);
    else {
      inline.content = inline.content.slice(newline + 1);
      for (const token of [paragraph, inline]) if (token.map) token.map = [token.map[0] + 1, token.map[1]];
    }
    const close = closing(tokens, i);
    if (!close) continue;
    open.meta = {...open.meta, callout};
    close.meta = {...close.meta, callout};
  }
}

export function calloutPlugin(md) {
  md.core.ruler.after('block', 'reader_callouts', markCallouts);
  const open = md.renderer.rules.blockquote_open, close = md.renderer.rules.blockquote_close;
  md.renderer.rules.blockquote_open = (tokens, index, options, env, self) => {
    const token = tokens[index], callout = token.meta?.callout;
    if (!callout) return open ? open(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
    token.attrJoin('class', 'callout');
    token.attrSet('data-callout', callout.type);
    if (callout.id !== callout.type) token.attrSet('data-callout-alias', callout.id);
    if (callout.fold) token.attrSet('data-callout-fold', callout.fold);
    token.attrSet('role', 'note');
    const title = md.renderInline(callout.title, {});
    const header = `<span class="callout-icon" data-callout-icon="${callout.type}" aria-hidden="true"></span><span class="callout-title-text">${title}</span>`;
    const head = callout.fold
      ? `<details class="callout-fold"${callout.fold === 'open' ? ' open' : ''}><summary class="callout-title" data-reader-decoration="">${header}</summary>`
      : `<div class="callout-title" data-reader-decoration="">${header}</div>`;
    return `<aside${self.renderAttrs(token)}>${head}<div class="callout-content">\n`;
  };
  md.renderer.rules.blockquote_close = (tokens, index, options, env, self) => {
    const callout = tokens[index].meta?.callout;
    if (!callout) return close ? close(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
    return callout.fold ? '</div></details></aside>\n' : '</div></aside>\n';
  };
}
