# Web reader third-party notices

Reader's own code is licensed under Apache-2.0. The browser includes separately
licensed dependencies under `src/reader_mcp/web_ui/vendor/`; their retained license
files, notices and minified headers govern those files. The pinned asset manifest
records versions, upstream tarballs, integrity and content hashes.

| Dependency | Version | License / notice |
| --- | --- | --- |
| D3 | 7.9.0 | ISC; retained d3 license |
| GSAP, ScrollTrigger, ScrollSmoother | 3.15.0 | GSAP standard license; upstream README and script headers retained |
| Markdown-it | 15.0.3 | MIT; retained license |
| DOMPurify | 3.4.17 | Apache-2.0 OR MPL-2.0; retained license texts |
| Newsreader variable font | 5.3.0 package | SIL Open Font License 1.1; retained font license |
| Manrope variable font | 5.3.0 package | SIL Open Font License 1.1; retained font license |
| PDF.js | 6.4.299 | Apache-2.0 with bundled font/CMap and third-party notices retained |

GSAP is distributed under its [own standard license](https://gsap.com/community/standard-license/),
not Reader's Apache license. Check those terms when redistributing or changing the
product's use. Its upstream package points to those terms instead of including a
standalone LICENSE file.

The PDF text-layer CSS is adapted from Mozilla PDF.js `web/text_layer_builder.css`,
copyright 2014 Mozilla Foundation, under Apache-2.0. Reader's adaptation scopes the
rules to the minimal selectable page layer and uses the library's theme selection
color. PDF rendering and text layout follow the [PDF.js examples](https://mozilla.github.io/pdf.js/examples/)
and TextLayer API. All bundled license texts and notices remain in `vendor/`.

## Page turn and article shapes

The two-page page turn and article shapes bundle [Three.js](https://threejs.org) 0.186.1
(MIT, license retained in `controls/licenses/`) into one shared chunk under
`controls/three/`, loaded on demand by `controls/page-turn.js` (two-page reading) and
`controls/shape.js` (article shapes). The curl model, shaders, DOM rasterizer and the
shape scene are Reader's own.

## Diagrams

Mermaid diagrams are drawn by [Pele](https://pele.run) 1.10.0 (MIT, copyright 2026
kepano; license retained in `controls/licenses/pele-LICENSE`). It is bundled from its
`pele/lazy` entry into `controls/diagrams.js` and per-diagram-type chunks under
`controls/diagrams/`, which load only for documents that contain Mermaid. Pele's
compatibility specs and grammar files derive from [Mermaid](https://mermaid.js.org),
which is also MIT licensed; Mermaid itself is not bundled. Reader's figure, theme
mapping and page-turn SVG serialization are its own.

## Math

TeX is typeset by [KaTeX](https://katex.org) 0.19.1 (MIT, copyright Khan Academy and
other contributors; license retained in `controls/licenses/katex-LICENSE`), bundled into
`controls/math.js`. Its stylesheet and woff2 fonts are copied into `controls/katex/`.
The fonts are unmodified. They are copyright 2009-2010 Design Science, Inc. and
2014-2018 Khan Academy, under the SIL Open Font License 1.1, which each font's
metadata (name table) states with its copyright. The stylesheet is unchanged except
that its `@font-face` rules list only the woff2 sources. They load only for documents
with math. Reader's markdown-it math syntax plugin is its own.

## Code highlighting

Fenced code is highlighted by [Shiki](https://shiki.style) 4.5.0 (MIT, copyright Pine Wu
and Anthony Fu; licenses retained in `controls/licenses/shiki-LICENSE` and the
`@shikijs-*` files) with its JavaScript regular-expression engine, which uses
`oniguruma-to-es`, `oniguruma-parser`, `regex`, `regex-recursion` and `regex-utilities`
(all MIT). No WebAssembly is bundled or fetched. The TextMate grammars come from
`@shikijs/langs` (MIT; each grammar keeps the license of its upstream VS Code or
community source, recorded in the grammar files). The tokenizer is bundled into
`controls/highlight.js`, and each grammar into its own chunk under
`controls/highlight/`; they load only when a fenced block in a supported language
nears the viewport. The `hast` utilities listed in `controls/licenses/` are part of
Shiki's dependency graph and are recorded for completeness. Reader's language table
and highlighter loader follow the shadcn/ui base-nova `lib/highlighter` (MIT); the
CSS-highlight painting and theme mapping are Reader's own.

## Markdown editor (scratch pad)

The scratch pad's Markdown editor is [CodeMirror 6](https://codemirror.net) —
`@codemirror/state` 6.7.6, `@codemirror/view` 6.43.15, `@codemirror/commands` 6.11.1,
`@codemirror/language` 6.13.1, `@codemirror/lang-markdown` 6.5.2 and their `@lezer/*`,
`style-mod`, `w3c-keyname`, `crelt` and `@marijn/find-cluster-break` dependencies (MIT,
copyright Marijn Haverbeke and others) — with Vim keys from
[`@replit/codemirror-vim`](https://github.com/replit/codemirror-vim) 6.4.0 (MIT,
copyright Replit and the CodeMirror contributors). They are bundled into
`controls/editor.js`, which loads only when a scratch buffer opens; each package's
license is retained under `controls/licenses/` (the build retains the license of
every package esbuild reads, including the HTML, CSS and JavaScript language packages
`lang-markdown` references but the bundle leaves out).

## Colorful Language (optional, not distributed)

Prose colors call a separately installed [Colorful Language](https://github.com/flyingrobots/colorful-language)
CLI (`colorful`, Apache-2.0, copyright its authors) as an external process. Reader
neither bundles nor builds it. `src/reader_mcp/prose.py` ports the checks of
Colorful's reference consumer `consumers/graft-projection.mjs` (Apache-2.0) and pins
the hashes of its `colorful.syntax/v1` contract and `colorful.vocabulary/v1`
manifest. `tests/fake_colorful.py` is Reader's own stand-in.

## Theme Editor color engine and fonts

The Theme Editor bundles [Culori](https://culori.js.org) 4.0.2 (MIT, license retained
in `controls/licenses/culori-LICENSE`) for color conversion, gamut mapping, WCAG
contrast and color-vision simulation. Its decision vocabulary follows meodai's
[Design Book](https://github.com/meodai/design-book): best contrast with a surface,
most vivid candidate gated by contrast, and CVD separation. Design Book is
AGPL-3.0-only, so none of its code is included; Reader's implementation is its own.

The built-in famous themes reuse color values from MIT-licensed palettes. Their
authors and sources are recorded in `web_ui/famous-themes.json`: Solarized (Ethan
Schoonover), Gruvbox (Pavel Pertsev), Catppuccin (Catppuccin Org), Nord (Arctic Ice
Studio and Sven Greb), Dracula and Alucard (Dracula team), Rosé Pine (Rosé Pine),
Tokyo Night (enkia) and One Dark/One Light (Atom). Reader's role mappings and the
contrast adjustments listed in `controls/famous-themes.css` are Reader's own. The
theme names identify the palettes; the projects do not endorse Reader.

Reader distributes no Google Fonts. A family is downloaded only when a user adds it in
the Theme Editor. It is stored in that user's vault with its upstream license file and
a manifest. Those fonts remain under their own licenses (usually SIL OFL 1.1).

## shadcn Base UI controls

The editable component sources in `web/src/components/ui/` came from the official
shadcn/ui `base-nova` registry using CLI 4.22.1. They are covered by the retained
MIT license in `web/LICENSE.shadcn-ui`. Reader's composition and build tooling use
Apache-2.0. Compiled assets in `web_ui/controls/` include React, React DOM,
Base UI, Floating UI, Lucide, Sonner (MIT), `@shadcn/react` (MIT, for the chat MessageScroller), `cn`, class-variance-authority and their runtime
dependencies. Full license texts are retained in `controls/licenses/`; bundled
headers and `controls/build-meta.json` record exact dependency versions and
source/output hashes. The npm lockfile records package integrity. Tailwind CSS
4.3.3 generates the component utilities during development. The activity transcript
follows shadcn's AI Elements (Base UI) recipes. It uses only the registry items above
(`trace`, `message`, `marker` and `hover-card` among them) and adds
no npm dependency. The recipes' Vercel AI SDK demos are not included.

## Demo vault content

`reader demo` ships a small example library in `src/reader_mcp/demo/content/`. Its texts are
public-domain excerpts from Project Gutenberg eBooks (Thoreau, Emerson, Montaigne in Charles
Cotton's translation, Bacon, Woolf, Darwin, Babbage and Lovelace) and its one image is Darwin's
diagram of divergence (1859) from Wikimedia Commons, marked public domain there. Everything else in
it (the Lantern project, its people and numbers, the newsletter and the voices) is fictional and
written for Reader under Apache-2.0. [`src/reader_mcp/demo/content/NOTICE.md`](src/reader_mcp/demo/content/NOTICE.md)
lists every work, its eBook number and URL; the built vault carries a copy as `NOTICE.md`.
