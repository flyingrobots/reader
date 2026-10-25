import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {CALLOUT_TYPES, calloutPlugin, parseCalloutMarker} from '../src/reader_mcp/web_ui/callouts.mjs';

const markdownit = createRequire(import.meta.url)('../src/reader_mcp/web_ui/vendor/markdown-it.min.js');
// The same source-map wrapper the app installs, so offsets are tested end to end.
function reader() {
  const md = markdownit({html:true, linkify:true});
  md.use(calloutPlugin);
  for (const type of ['paragraph_open','heading_open','blockquote_open','bullet_list_open','ordered_list_open']) {
    const original = md.renderer.rules[type];
    md.renderer.rules[type] = (tokens, index, options, env, self) => {
      const token = tokens[index];
      if (token.map) {
        const lines = [0]; let at = 0; for (const line of env.raw.split('\n')) { at += line.length + 1; lines.push(at); }
        token.attrSet('data-source-start', lines[token.map[0]]);
        token.attrSet('data-source-end', Math.min(lines[token.map[1]], env.raw.length));
      }
      return original ? original(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
    };
  }
  return raw => md.render(raw, {raw});
}
const render = reader();
const blocks = (html, tag) => [...html.matchAll(new RegExp(`<${tag}[^>]*data-source-start="(\\d+)" data-source-end="(\\d+)"[^>]*>`, 'g'))].map(m => [+m[1], +m[2]]);

test('every Obsidian type and alias maps to its canonical callout', () => {
  const expected = {note:[], abstract:['summary','tldr'], info:[], todo:[], tip:['hint','important'], success:['check','done'], question:['help','faq'], warning:['caution','attention'], failure:['fail','missing'], danger:['error'], bug:[], example:[], quote:['cite']};
  for (const [type, aliases] of Object.entries(expected)) for (const id of [type, ...aliases]) {
    assert.equal(CALLOUT_TYPES[id], type, id);
    const html = render(`> [!${id.toUpperCase()}]\n> Body.`);
    assert.match(html, new RegExp(`<aside[^>]* class="callout" data-callout="${type}"`), id);
    assert.match(html, new RegExp(`data-callout-icon="${type}"`), id);
  }
  assert.equal(Object.keys(CALLOUT_TYPES).length, Object.values(expected).flat().length + 13);
});

test('titles default to the identifier in title case and accept inline Markdown', () => {
  assert.match(render('> [!faq]\n> Body.'), /<span class="callout-title-text">Faq<\/span>/);
  assert.match(render('> [!tip] A *good* idea\n> Body.'), /<span class="callout-title-text">A <em>good<\/em> idea<\/span>/);
  assert.equal(parseCalloutMarker('[!note]  Spaced title  ').title, 'Spaced title');
  assert.equal(parseCalloutMarker('[note] no'), null);
  assert.equal(parseCalloutMarker('not [!note] at start'), null);
});

test('unknown types fall back to note but keep their own title', () => {
  const html = render('> [!marginalia]\n> Body.');
  assert.match(html, /data-callout="note" data-callout-alias="marginalia"/);
  assert.match(html, /callout-title-text">Marginalia</);
});

test('folding uses details: minus is closed, plus is open, none is a static header', () => {
  const closed = render('> [!info]- Closed\n> Hidden body.');
  assert.match(closed, /data-callout-fold="closed"[^>]*><details class="callout-fold"><summary class="callout-title" data-reader-decoration="">/);
  assert.match(closed, /<\/div><\/details><\/aside>/);
  assert.match(render('> [!info]+ Open\n> Body.'), /data-callout-fold="open"[^>]*><details class="callout-fold" open><summary/);
  const plain = render('> [!info] Plain\n> Body.');
  assert.doesNotMatch(plain, /<details|data-callout-fold/);
  assert.match(plain, /<div class="callout-title" data-reader-decoration="">/);
});

test('nested callouts nest by blockquote depth and close in order', () => {
  const html = render('> [!note] Outer\n> Outer body.\n>\n> > [!warning]- Inner\n> > Inner body.\n>\n> After inner.\n\nOutside.');
  assert.equal((html.match(/<aside[^>]* class="callout"/g) || []).length, 2);
  assert.match(html, /Outer body.*<aside[^>]* class="callout" data-callout="warning".*Inner body.*<\/details><\/aside>\s*<p[^>]*>After inner\.<\/p>\s*<\/div><\/aside>\s*<p[^>]*>Outside\.<\/p>/s);
  assert.match(render('> [!note]\n> > [!tip] Deep\n> > Body.'), /<div class="callout-content">\s*<aside[^>]* class="callout" data-callout="tip"/);
});

test('body blocks keep exact source offsets and the marker line is not part of them', () => {
  const raw = 'Intro.\n\n> [!note] Title line\n> First body line\n> continues here.\n>\n> Second paragraph.\n';
  const html = render(raw);
  const [aside] = blocks(html, 'aside'), paragraphs = blocks(html, 'p');
  assert.deepEqual(aside, [raw.indexOf('> [!note]'), raw.length]);
  assert.equal(raw.slice(...paragraphs[1]), '> First body line\n> continues here.\n');
  assert.equal(raw.slice(...paragraphs[2]), '> Second paragraph.\n');
  assert.doesNotMatch(html, /\[!note\]/);
  assert.match(html, /<p[^>]*>First body line\ncontinues here\.<\/p>/);
  // A marker-only first line drops the empty paragraph; the next block maps normally.
  const bare = '> [!quote]\n>\n> Only paragraph.';
  const only = blocks(render(bare), 'p');
  assert.equal(only.length, 1);
  assert.equal(bare.slice(...only[0]), '> Only paragraph.');
});

test('plain blockquotes and look-alikes stay blockquotes', () => {
  assert.match(render('> Just a quote.'), /^<blockquote/);
  assert.match(render('> Text first\n> [!note] later'), /^<blockquote/);
  assert.match(render('```\n> [!note] code\n```'), /^<pre><code>&gt; \[!note\] code/);
  assert.match(render('[!note] not quoted'), /^<p[^>]*>\[!note\] not quoted/);
});
