import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {embedPlugin, parseEmbed, kindOf, unitIndex} from '../src/reader_mcp/web_ui/embeds.mjs';
import {bodyOf, codePointIndex, projectSource} from '../src/reader_mcp/web_ui/logic.mjs';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/transclusion/corpus.json', import.meta.url), 'utf8'));
const markdownit = createRequire(import.meta.url)('../src/reader_mcp/web_ui/vendor/markdown-it.min.js');
// The app's renderer: embeds plus the source-map wrapper (app.mjs), with code point offsets into env.full.
function reader() {
  const md = markdownit({html:true, linkify:true}).use(embedPlugin);
  for (const type of ['paragraph_open','heading_open','blockquote_open','bullet_list_open','ordered_list_open']) {
    const original = md.renderer.rules[type];
    md.renderer.rules[type] = (tokens, index, options, env, self) => {
      const token = tokens[index];
      if (token.map && env.raw) {
        if (!env.lineOffsets) { env.lineOffsets = [0]; let at = 0; for (const line of env.raw.split('\n')) { at += line.length + 1; env.lineOffsets.push(at); } env.codePoint = codePointIndex(env.full); }
        token.attrSet('data-source-start', env.codePoint((env.offset || 0) + env.lineOffsets[token.map[0]]));
      }
      return original ? original(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
    };
  }
  return md;
}
const embedsIn = (md, text) => {
  const found = [];
  const walk = tokens => { for (const token of tokens) { if (token.type === 'reader_embed') found.push(token.meta.raw); if (token.children) walk(token.children); } };
  walk(md.parse(text, {embeds: true}));
  return found;
};

test('parseEmbed matches the shared corpus', () => {
  for (const {raw, expect} of corpus.parse) {
    const parsed = parseEmbed(raw);
    assert.deepEqual(Object.fromEntries(Object.keys(expect).map(key => [key, parsed[key]])), expect, raw);
  }
  assert.equal(kindOf('notes/v1.2 notes'), 'markdown');
});

test('markdown-it finds the same embeds as the server scan: never in code, comments or after a backslash', () => {
  const md = reader();
  for (const {text, expect} of corpus.scan) assert.deepEqual(embedsIn(md, text), expect, JSON.stringify(text));
});

test('rendering: standalone embeds are blocks, inline ones spans, images are images, chat keeps the text', () => {
  const md = reader();
  const html = md.render('![[note#Part]]\n\nText ![[other]] here.\n\n![[pic.png|300x200]]\n\n`![[code]]` and [[wiki|label]] and `[[not a link]]`\n', {raw: '', full: '', embeds: true});
  assert.match(html, /^<div class="document-embed" data-embed="note#Part" data-embed-kind="markdown"><\/div>/);
  assert.doesNotMatch(html, /<p[^>]*><div/);
  assert.match(html, /<p>Text <span class="document-embed" data-embed="other" data-embed-kind="markdown"><\/span> here\.<\/p>/);
  assert.match(html, /<img class="embed-image" data-embed-image src="pic\.png" alt="pic\.png" width="300" height="200">/);
  assert.match(html, /<code>!\[\[code\]\]<\/code>/);
  assert.match(html, /<a href="wiki">label<\/a>/);
  assert.match(html, /<code>\[\[not a link\]\]<\/code>/);
  assert.equal(md.render('See ![[x]].', {}), '<p>See ![[x]].</p>\n');
  assert.match(md.render('\\![[x]]', {embeds: true}), /^<p>!<a href="x">x<\/a><\/p>/);
  assert.doesNotMatch(md.render('[[javascript:alert(1)]]', {embeds: true}), /href/);
});

test('Obsidian block ids are hidden from rendered text and from the source projection', () => {
  const md = reader(), source = 'A paragraph. ^para-1\n\n- item ^item-2\n\nTable line\n^table-3\n\n^alone\n';
  const html = md.render(source, {embeds: true});
  assert.doesNotMatch(html, /\^/);
  assert.match(html, /<p hidden="">/);
  assert.doesNotMatch(projectSource(source).text, /\^/);
});

test('an embedded fragment renders with the embedded file’s code point offsets', () => {
  const md = reader(), full = corpus.files['library/notes/deep/Target Note.md'];
  const start = full.indexOf('Setext Title'), end = full.length;
  const html = md.render(full.slice(start, end), {raw: full.slice(start, end), full, offset: start, embeds: true});
  const cp = Array.from(full.slice(0, start)).length;
  assert.match(html, new RegExp(`<h2 data-source-start="${cp}">Setext Title</h2>`));
  // The server sends code points; unitIndex maps them back to UTF-16 for slicing.
  const text = 'a🐈b🐈c', units = unitIndex(text);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(units), [0, 1, 3, 4, 6, 7]);
});
