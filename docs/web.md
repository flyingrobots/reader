# Library web reader

Reader serves a local, keyboard-driven library website over the same documents,
annotations and participant receipts used by the CLI, MCP tools and Obsidian.
The server binds to IPv4 loopback only. It is a trusted local application, with
participant labels for attribution rather than authenticated accounts. It can run
as an always-on macOS service and be published to your own tailnet with
`tailscale serve`; see [Always-on service and Tailscale](#always-on-service-and-tailscale).

## Start

Install the Python environment and configure the private vault as described in
[separate-vault setup](separate-vault.md), then run from the code checkout:

```sh
.venv/bin/python scripts/start_web.py
```

Open `http://127.0.0.1:8766`. Stop with Ctrl-C. The launcher uses `READER_ROOT`
or the existing ignored `.reader/config.json`; it never initializes a vault.
An explicit equivalent is:

```sh
reader --root /path/to/private-vault web --port 8766 --participant You
```

All browser dependencies and fonts are served locally. Prebuilt browser assets
ship with Reader; users do not need Node or a frontend build. There is no runtime
CDN, external analytics or hosted account. Content and semantic
search retain the existing [search](search.md) configuration and model lifecycle.
The web server does not rebuild indexes or download models at startup.

## Reading and navigation

| Key or control | Behavior |
| --- | --- |
| Space, then e; comma, then e | Documents browser; recent opened works first |
| Documents: j / k, arrows, Enter | Choose and open a document |
| Documents: `/` or Filter | Reveal and focus fuzzy/content/semantic filtering |
| Documents: Escape | Clear/hide an active filter, then close on a second Escape |
| `/`, Enter | Find literal text in the open document and visit the match |
| n / N | Next / previous occurrence |
| j / k | Scroll, or next / previous spread in paged reading; on the homepage, next / previous piece of the issue |
| g c | Homepage: focus the cover story |
| [ / ] | Homepage: previous / next issue |
| h / l | Reading history, or previous / next spread in paged reading |
| gg / G | Beginning / end |
| ]] / [[ | Next heading / start of this section, then the previous heading |
| Space o; footer Outline | Show or hide the document outline (rail, popover or sheet) |
| Ctrl-d / Ctrl-u; Ctrl-f / Ctrl-b | Half-screen / screen, or turn a spread |
| Space h / t / p | Home (this week's issue) / passage discussions / Settings in Reader Admin (the footer's Backstage and `:backstage` open its Overview) |
| Space v | Versions: every edition and its git history as a timeline (`j`/`k` or arrows move, Enter opens, `c` on two items compares, Escape closes) |
| Space d | What changed: since your receipt, else against the newer version, else against another reader's edition |
| Space , t; F10 | Theme Editor (F10 also closes it; focus returns to where it was opened from) |
| Space Shift+T; `:themes` | Quick theme picker in the footer; choose a theme to apply and save it immediately |
| Space s, then a / f / s | Send to AI-TTS: whole article, from here, or the selection |
| Space u; header Source | Open the raw source file (`/api/file`, front matter included) in a new tab; filed documents and inbox previews, not historical versions |
| Space m | Chat with the voices about the open document |
| Space x | Take a source-anchored quiz on the open article |
| Space a | Write about the article from a voice's question |
| Space z | Hide or reveal reading chrome |
| Tab to a diagram, Enter (or click) | Open the diagram full size; Escape closes it |
| ? / Escape | Help / close the current interface |
| v / V | VISUAL / VISUAL LINE: select from the keyboard (see [Modal keyboard](#modal-keyboard-visual-the-command-line-registers-and-lists)) |
| `:` | Command line in the status line (`:theme paper`, `:grep words`, `:help`) |
| ]c / [c, ]x / [x | Next / previous margin thread, or unread margin thread; Enter on its mark opens it |
| ]f / [f, ]l / [l | Next / previous figure, image or table; next / previous link (its preview opens) |
| K / g f / g x | On a focused link: preview / follow / open in a new tab |
| % ; *n*% | Footnote reference ↔ its note; with a count, that percent of the document |
| g d | First use of the term found with `/` (in VISUAL, the word under the cursor) |
| z z / z t / z b | The current find match, jump target or cursor to the middle / top / bottom of the window |
| m *a–z* / ' *a–z* / ' ' | Set a mark / return to it / back to before the last jump |
| Ctrl-o / Ctrl-i | Back / forward through the jump list, across documents |
| ]q / [q | Next / previous location in the location list |
| Ctrl-r *a* in a writing box | Paste register *a* as a quoted citation |
| Command-Enter or Ctrl-Enter in a comment | Submit the comment |

**Routes.** A document's URL is `#read=<URL-encoded path>`; a link to a heading in
another document adds `&h=<heading id>`, as does following an in-document `#heading`
link, so reload, Back/Forward and copied URLs return to that heading. Hand-made
`#read=<path>#<heading>` links (raw or with `%23`) are accepted and rewritten to the
`&h=` form; an unknown heading or a malformed escape opens the document normally.
`h` / `l` walk an in-app visit list that starts at the route Reader was opened on
and follows Back, Forward, typed URLs and `#read=` links as well as Reader's own
navigation. A path with no document shows *Link target not found* with the path and
a **Find a document** button, without an error toast; the API answers it with 404.

Commands yield to text fields, selects, composition and dialogs. Standard browser
selection, copying and context menus remain available. The sticky footer reports
the active interaction mode and its applicable shortcuts. It offers layout,
the quick theme picker and light/dark switch, an **Outline** button when the document has an outline, the current section title, and a **Backstage** button that opens Reader Admin's Overview. In zen mode the chrome reappears on keyboard
focus or when the pointer reaches the lower-right corner.

The mode corner has a distinct background for Normal, Browse, Search, Insert,
Leader, Settings (the Theme Editor and Backstage share one color), Help and Thread;
VISUAL shares Thread's color, COMMAND Leader's and the list panels Browse's. Semantic mode colors mix with the selected
palette and use separate light/dark lightness levels. The printed mode remains
the primary label; recognizing a color is not required to use it.

Documents opens with the filter and search-method controls hidden. Keyboard focus
starts on the document tree, so ordinary browsing never starts typing into a
search field. Filtering is explicit and retains folder scope when used from a
breadcrumb. The three search methods appear only while filtering.

Documents follows the [shadcn File Tree pattern](https://ui.shadcn.com/docs/ai-elements/base/file-tree):
Collapsible folders and Button file rows, grouped by their actual library paths.
Recent files remain the default selection; grouping retains first appearance in
the recent or search ranking. Folders initially expand to expose those files.
Use j/k or Up/Down through visible folders/files, h/l or Left/Right to collapse,
expand or move to the parent/child, and Enter to toggle a folder or open a file.
Search-field arrows continue to select matching files and reveal their parents.

Read files use muted title text and a check mark. Unread files keep normal text
and an unread pip. This uses the selected participant's exact-version receipt,
including fuzzy, content and semantic search results and nonprimary attachments.
A changed source returns to unread styling. Browsing, collapsing folders and
searching do not mark documents read; opening a document does.

Settings offers three paired palettes: **Ink / Paper**, **Orchid · Light / Dark**,
and **Harvest · Light / Dark**. The footer's light/dark control preserves the
chosen palette family. Orchid uses the eight colors from the supplied reference,
with lighter accents over plum surfaces at night. Harvest preserves all 66 supplied
OKLCH ramp tokens in `web_ui/harvest.css` and maps them to semantic interface and
chart colors. CSS performs display-gamut mapping. Preview a palette with
`/?theme=orchid`, `/?theme=orchid-dark`, `/?theme=harvest` or
`/?theme=harvest-dark`; an explicit theme selection clears a conflicting preview
parameter and saves the preference. Theme previews do not change participant data.

### Modal keyboard: VISUAL, the command line, registers and lists

Reader keeps the status line as its only chrome and adds three Vim-like tools to
it. Every mode exits with Escape, one step at a time toward NORMAL: pending keys
(a count, a `"a` register, half a sequence such as `g`) first, then VISUAL or the
command line, then the page's own Escape (panels, find, the search page).

**One keymap.** `web_ui/keys.mjs` holds the only page keydown listener. Every key
is a row in its table: `{mode, keys, when, run, help, hint, group, display}`. The
parser handles counts (`3)`, `5j`), register prefixes (`"a`), multi-key sequences
(`gg`, `]]`, `gf`) with a 650 ms window, the Space or comma leader with a 1.2 s
window, `{a-z}` arguments (`ma`, `'a`) and a mode stack. A row whose `when()` is
false, or whose `run()` returns `false`, lets the next row for the same key (or the
browser) have it, which is how two-page turns, the homepage and the search page
share `j`/`k`. An unknown key after the leader is swallowed. `keys.prefix(token,
{label, ms})` declares another family that behaves like the leader: `Ctrl-w` is one
(label WINDOW, 1.5 s window), so its hints come from the table too and an unknown
second key is swallowed. The leader hints in
the status line and the help dialog (`?`) are generated from the table, so they
cannot drift from the keys; rows without `run()` document keys that a panel
handles itself. `window.readerKeymap.listed()` returns the table read-only.

Adding a key or command from a feature module:

```js
keys.map({mode: 'normal', keys: '<Space>x', when: () => !!state.doc, run: ({count}) => openThing(count),
          hint: 'thing', group: 'Leader: Space or comma', help: 'Open the thing'});
keys.command({name: 'thing', args: '[name]', help: 'Open the thing', complete: typed => names(typed), run: name => openThing(name)});
```

Keys still never run while focus is in a text field, select, dialog or other
owned control, except F10 and Ctrl-r in a writing box. The queue panel's keys run
before the table (`keys.intercept`).

**VISUAL (`v`) and VISUAL LINE (`V`).** `v` places a reading cursor, an accent
underline under one word, on the first sentence on screen, or where the cursor
last was in this document if that is still on screen. `web_ui/cursor.mjs` keeps a
text model of `#article` that skips margin pins, decorations (embed headers and
notes included), buttons, diagram drawings, MathML twins and closed folds; the text
of embedded documents is part of the model, so the cursor reads through embeds; words and sentences come from
`Intl.Segmenter` within each block, so a heading is never part of the next
sentence. The selection is the page selection, so it paints like a mouse
selection and assistive technology reads it; the cursor is the `reader-cursor`
custom highlight. Both reach the page-turn rasterizer (the selection as the
style-less `reader-visual` highlight). The mouse toolbar stays hidden meanwhile.
Entering VISUAL builds the text model once: about 0.2 s for a 2 MB synthetic
document (1.7 million characters), a motion about 50 ms.

| VISUAL key | Behavior |
| --- | --- |
| j / k, ↓ / ↑ | A visual line down / up, keeping the column (a block in VISUAL LINE) |
| w / b / e, ← / → | Next word, previous word, end of word; one character |
| ) / ( and } / { | Next sentence / start of this or the previous one; same for paragraphs and blocks |
| 0 / $, g g / G | Start / end of the line; of the document |
| H / M / L | Top / middle / bottom of the window; in two-page reading the left page, the right page, the last line |
| i s, a s, i p, a p | Select the sentence (with its trailing space) or the block under the cursor |
| o | Swap the cursor to the other end |
| % , g d, z z / z t / z b | Matching footnote marker; first use of the selected word; align |
| h / c / ! | Highlight / comment / warn, through the usual annotation path |
| s | Send the selection to AI-TTS |
| y, "*a*y | Yank with its citation into the unnamed register or register *a* |
| * | More like this: a meaning search for the selection, as a location list |
| K / g f / g x | Preview / follow / open in a new tab the link under the cursor |
| : | Command line (the command may use the selection; VISUAL ends after it) |
| v, V, Escape | Switch between VISUAL and VISUAL LINE, or leave |

With nothing selected yet, an action applies to the sentence under the cursor, so
`v` `h` highlights one sentence. Counts repeat motions: `v` `3)` selects three
sentences. In two-page reading a motion past the page edge turns the spread (the
3D curl for a one-spread move); in continuous reading the window scrolls when the
cursor nears an edge. To start a selection elsewhere, move the cursor and press
Escape, then `v` again: VISUAL resumes at the remembered cursor. The status line
reads `VISUAL · 3 sentences · 22 words`. Actions map the model's text to source
offsets with the same `sourceRangeForQuote()` and block bounds as a mouse
selection, so keyboard annotations anchor identically, and historical versions
stay read-only. A pointer press anywhere outside the status line leaves VISUAL.

**Command line (`:`).** The key hints give way to an input with the mode label
COMMAND. Tab completes command names and arguments (themes, layouts, speech
scopes, rebuild kinds, documents through fuzzy search, help topics), repeated Tab
cycles, and up to six choices show quietly beside the input. Up / Down (or Ctrl-p /
Ctrl-n) recall earlier commands that start with what is typed; 100 are kept per
device (`reader.commands.v1`). Enter runs, Escape (or Backspace on an empty line)
cancels. A unique prefix runs its command (`:chan`), an unknown name toasts the
closest match ("Did you mean :changes?"). Commands: `:open <document>` (`:e`),
`:theme <id>`, `:layout scroll|spread`, `:speak [article|here|selection]`,
`:rebuild search|keywords|browse|catalog|links`, `:check`, `:changes`, `:versions`,
`:outline`, `:chat`, `:threads`, `:queue`, `:next`, `:home`, `:files`, `:search
[words]`, `:backstage` (`:admin`), `:settings`, `:zen`, `:colors`, `:find <words>`, `:noh`, `:grep <words>`,
`:copen`, `:cclose`, `:cnext`, `:cprev`, `:cclear`, `:marks`, `:registers` and
`:help [command]`. The help dialog lists them all.

**Registers.** `y` stores the passage with its citation: path, edition SHA-256,
source code-point offsets, quote (at most 16 KiB) and title, in the unnamed
register `"`, and with `"a` also in register *a*. Registers live per participant
in this browser's `localStorage` (`reader.registers.v1`) and never reach the
vault; a yank also copies the plain quote to the clipboard when the browser allows
it. Ctrl-r then a register name in a reply, comment or chat box inserts the
citation as a Markdown block quote ending in a link to the document; Escape
cancels. `:registers` lists them in the side panel, and Enter opens one's passage.

**Location list (quickfix).** `:grep <words>` fills it with up to 50 passages
from the search page's keyword mode (`/api/search/page?mode=words`), `*` in
VISUAL with meaning-search passages for the selection. `:copen` shows it in the
right-side panel (mode QUICKFIX, `j`/`k`, Enter, Escape). `]q` / `[q` and `:cnext` /
`:cprev` open the next and previous location at its line with its words found;
a location in the current document is revealed in place. The status line shows
`QF 3/17` while a list exists; `:cclear` empties it. Up to 500 entries are kept in
`localStorage` (`reader.quickfix.v1`). Register locations open at their source
offsets, or at the start of the document with a toast if the edition changed.

**Marks and jumps.** `m`*a–z* marks the first block in view (its source offset,
the fraction through it and the progress) for this document and edition;
`'`*a* returns, with a toast if the edition changed since. Marks for the 200 most
recently marked documents are kept per participant (`reader.marks.v1`);
`:marks` lists them. Following a link, the picker, the queue, a mark, a location,
`gg`, `G`, `]]`, `[[`, `n`, `N`, `]c`, `]f`, `%` and `gd` are jumps: the place you
left goes on a jump list of 100 places for this tab. Ctrl-o / Ctrl-i walk it
across documents, and `''` returns to where you were before the latest jump (and
back again). The visit history on `h` / `l` is unchanged.

**Document motions.** `]c` / `[c` step through margin threads in reading order and
focus each margin mark (Enter opens the thread); `]x` / `[x` only unread ones.
`]f` / `[f` reach figures, images, diagrams and tables, flashing each; a diagram's
canvas takes focus, so Enter opens it full size. `]l` / `[l` focus the next link
written in the document, which shows its preview; `K` shows it again, `gf`
follows it and `gx` opens it in a new tab (a library link opens in a new Reader
tab). `%` follows `[^label]` footnote markers between a reference and its
`[^label]:` note; with a count it goes to that percent of the document (`50%`).
`gd` goes to the first use of the term found with `/`. `zz`, `zt` and `zb` move the
current find match, the last jump target or the focused element to the middle,
top or bottom of the window in continuous reading.

Deliberate changes from the earlier keys: Escape with a pending leader or
sequence now only cancels it (one step), instead of also closing panels; `"`,
`v`, `V`, `:`, `m`, `'`, `%`, `K`, `z`, digits and Ctrl-o / Ctrl-i are now bound in NORMAL;
in the homepage `]` waits 650 ms for a second key while a location list exists.
Every other key behaves as before.

### Dates and time zones

Every date and time the web app shows is in the browser's local time zone
(`Intl.DateTimeFormat`), and every grouping by day (*Today*, *Yesterday*, *Oct 21*,
issue weeks, activity days) uses local days. The helpers live in
`web_ui/logic.mjs` (`formatDate`, `formatDateTime`, `localDay`, `todayLocal`,
`workDay`, `readActivity`, `localizeLibrary`).

- **Plain dates are calendar dates.** A `YYYY-MM-DD` value (a catalog, frontmatter or
  newsletter date) is shown exactly as written in every zone; it is never read as a
  UTC midnight and shifted.
- **Timestamps are instants.** Receipt times, history opens, commit dates, thread and
  comment times, job and inbox times, and a work's `arrival_time` are shown as the
  reader's local day or time. Read times in titles carry the zone, for example
  *Oct 24, 2026, 5:16 PM PDT*.
- **Works.** `/api/library` and `/api/search/page` send each work's catalog `date` with
  its `arrival_time` (UTC ISO, or null when the arrival was a plain date). The browser
  replaces `date` with the local day of `arrival_time` (keeping `catalog_date`), so the
  homepage issue week, dashboard arrivals, lists and search results agree with the
  reader's calendar. `today` is the browser's local day; the server's UTC day is kept
  as `utc_today`.
- **Server grouping.** The server returns instants and the browser groups them: the
  dashboard's 28-day reading activity is counted from each work's `read_at`, and
  History regroups `/api/history` pages by the local day of each `opened_at`, so DST
  changes inside the window are handled. The search page's date range adds the
  browser's local midnights (`from_at`, `to_at`) so works with an arrival time match by
  their local day.
- **Limit.** The issue signals request (`/api/issue`) still selects candidate works by
  their catalog (UTC) day; a piece within a few hours of a week boundary can miss its
  newsletter-pick or near-pair signal, though it is listed in the local week.

### Themes and the Theme Editor

The footer's palette button switches between built-in, famous and saved custom
themes without leaving the current page. Selections apply immediately and persist
on this device, with no Save step. The menu supports arrows, typeahead, Enter and
Escape. Open it with **Space then Shift+T** or `:themes`; **Space t** still opens
threads, and **F10** opens the Theme Editor. On narrow screens the palette icon
stays visible while the theme's name is shown inside the menu. The adjacent Dark
switch keeps the selected palette family.

Besides Ink/Paper, Orchid and Harvest, Settings offers eight well-known open-source
palettes as built-in pairs (light · dark): **Solarized** (Light · Dark), **Gruvbox**
(Light · Dark), **Catppuccin** (Latte · Mocha), **Nord** (Snow Storm · Polar Night),
**Dracula** (Alucard · Dracula), **Rosé Pine** (Dawn · Main), **Tokyo Night**
(Day · Night) and **One** (Light · Dark). Their `data-theme` values are `<family>` and
`<family>-dark`, for example `solarized-dark`. `web_ui/famous-themes.json` keeps each
upstream palette verbatim, with its author, license and source, plus a Reader role
mapping per variant. `npm run build` resolves the mappings with the editor's own color
code and writes `controls/famous-themes.css`. Where an upstream color misses a
contrast floor below, the build moves it in OKLCH lightness only, by the smallest
amount that passes, and lists every such change at the top of the generated file.
Nord has no official light theme; its light pair uses Nord's Snow Storm and Polar
Night colors. To change a mapping, edit the JSON and rebuild; never edit the
generated CSS.

Every theme, built-in or custom, sets the same standard tokens. The contract lives
in `web_ui/theme-tokens.json`, which both the server validator and the editor read:

| Group | Tokens |
| --- | --- |
| Surfaces | `--bg`, `--surface`, `--raised`, `--line` |
| Text | `--ink`, `--muted`, `--faint` |
| Accent | `--accent`, `--accent-ink`, `--rust` (secondary emphasis) |
| Signals | `--warning` |
| Annotations (translucent) | `--selection`, `--own`, `--other` |
| Charts | `--chart-1` … `--chart-8`, `--chart-stroke` |
| Fonts | `--serif` (reading), `--sans` (interface), `--mono` (code) |

`--shadow` and the footer's `--mode-*` colors are derived from these, not edited.
Tailwind semantic colors (`--color-primary` and so on) map onto the same tokens.
A dark variant is any `data-theme` that is `ink` or ends in `-dark`.

Open the Theme Editor with Space , t (leader, comma, t), F10, or **Theme Editor…**
in Settings. Closing it (F10, Esc or the close button) returns focus to where it was
opened from, or the page, once the sheet's close has finished; the sheet itself moves
no focus, so a slow close cannot leave focus on the first control behind it. It edits
one theme at a time, with Light and Dark variants:

- **Create.** Choose *New theme from a seed color*, then **Generate both variants**.
  Neutrals are tinted toward the seed hue. Each role keeps a fixed OKLCH lightness and
  chroma band, and text is then nudged in lightness until it meets its contrast target.
  Chart colors are chosen greedily from 24 hues × 3 lightness bands at one chroma,
  maximizing the worst-case OKLab distance under typical vision, protanopia,
  deuteranopia and tritanopia.
- **Edit.** Each token has a color picker and a hex field; translucent tokens add
  opacity. **Derive dark/light variant** maps the other variant to its polarity while
  keeping each token's hue. *Vivid accents* lists the highest-chroma accents that keep
  4.5:1 on the page, stay distinct from the warning color, and have readable on-accent text.
- **Duplicate.** Built-in themes are read from the live cascade and saved as a copy;
  their files never change. Duplicates are stored as sRGB hex, so wide-gamut Harvest
  values are chroma-mapped (lightness and hue held).
- **Delete.** Removes `themes/<id>.json`. If it was in use, Reader switches to Ink or
  Paper with the same polarity. Downloaded fonts are kept.

The preview renders a sample article, margin panel, buttons, chart swatches and the
mode footer with the draft tokens and fonts. **Simulate** shows it under protanopia,
deuteranopia, tritanopia or grayscale without changing the stored values.

**Checks** run on each variant as you edit:

| Group | Rule |
| --- | --- |
| Text contrast (WCAG 2.2) | Text on page and surfaces 4.5:1, aim 7:1; muted on page, surfaces and raised fills 4.5:1; faint on page and surfaces 4.5:1; links on page and surfaces 4.5:1; on-accent, secondary emphasis and warning 4.5:1; text over each translucent highlight 4.5:1 |
| Mode labels | On-accent text over each derived mode color 4.5:1 (shown only when failing) |
| Interface boundaries | Accent 3:1 as a non-text control; rules about 1.2:1; surface layers ΔE_OK ≥ 0.012; text hierarchy steps by lightness; page polarity matches the variant |
| Charts | Each fill 3:1 against the page *or* the chart border (the border rule) |
| Color vision | Closest chart pair ΔE_OK ≥ 0.06, own vs others' highlights ≥ 0.04, warning vs accent ≥ 0.08, under each simulation |

A failing text check offers **Use #…**, the nearest color in OKLCH lightness (hue held)
that meets the target; **Fix contrast failures** applies them all. Color-vision items
are reported for review, not failure: legends and labels still name every series.
Checks use WCAG 2.x ratios. APCA is not included. These checks are aids, not an
accessibility certification.

Custom themes are stored in the private vault as `themes/<id>.json`: schema version 1
with `id`, `name`, `fonts` (`serif`/`sans`/`mono` family or null for the default),
`headings` (`h1`–`h6`, each `{font, size}`: a family or null for the Reading font, and
a size in pixels from 10 to 120 or null for the stylesheet default), `light` and `dark` (every color token, lowercase `#rrggbb` or `#rrggbbaa`),
`created_at` and `updated_at`. Ids are 1–40 lowercase letters, digits or hyphens. They
cannot be a built-in name or end in `-dark`. A theme saved before `headings` existed
reads with every level at its default. Heading settings become `--h1-font`/`--h1-size`
through `--h6-*` custom properties, which only the document's headings read; the H1 font
also sets the document title, whose size stays responsive. The page uses
`data-theme="user-<id>"` and `user-<id>-dark`. Writes are atomic under
`.reader/themes.lock`. Limits are 64 themes and 64 KiB per theme. The generated CSS is
cached in `reader.themes.v1` local storage so a saved theme paints before
`/api/themes` answers; clearing it only delays custom themes until that response.

#### Google Fonts

The editor can search the Google Fonts catalog and **Add** a family. The local server
then downloads it once: the catalog from `fonts.google.com/metadata/fonts` (cached for
a week in `themes/fonts/.catalog.json`), the family stylesheet from
`fonts.googleapis.com`, and its latin and latin-ext woff2 files from `fonts.gstatic.com`.
Variable weight ranges are used where available. The license comes from the
`google/fonts` repository on GitHub when found. Each family is stored in
`themes/fonts/<slug>/` with `font.css`, the woff2 files, `LICENSE.txt` and a
`manifest.json` recording source URLs, sizes and SHA-256 hashes. Fonts are served from
`/fonts/<slug>/`, so the CSP stays `font-src 'self'`. Only these HTTPS hosts are
contacted, and redirects elsewhere are refused. Limits are 32 families, 8 files and
16 MiB per family, and 4 MiB per file. Reading pages never contact Google; only an
explicit search or Add does. Without network access, the catalog and downloads fail
with an error, and installed fonts keep working. Other scripts (Cyrillic, Greek,
Vietnamese) are not downloaded; those characters fall back to the role's stack.

Beside the mode indicator, a breadcrumb trail shows **Library**, the containing
folders and the current filename. Library returns home; a folder opens the file
picker scoped to that path. The scope applies before ranking in fuzzy search and
is passed to content/semantic search as well. **All folders** removes the scope.
Folder browsing uses the same catalog/search coverage as the picker, rather than
promising a complete filesystem listing. Deep paths collapse older ancestors into
an ellipsis menu; narrow screens put all containing folders in that menu. Arrow
keys choose a parent, Enter opens its picker, and Escape closes the menu and
returns focus. The current filename has `aria-current="page"` and exposes the full
path on hover. The trail follows the composition in the
[shadcn breadcrumb reference](https://ui.shadcn.com/docs/components/base/breadcrumb),
adapted to Reader's existing plain-JavaScript interface.

When the status line is too narrow for everything, items give way by declared
priority (`status-priority.mjs`). Every `#statusline` child carries
`data-status-priority`: `1` never gives way, and larger numbers give way first,
rightmost first within a number. After each resize, layout change or change to the
line's items, one pass brings back what gave way and hides items until nothing
reaches past the line's right edge and the current breadcrumb shows at least 64 px
(or all of its name). Items keep their content width (only the breadcrumb shrinks),
so a crowded line overflows, which the pass sees, instead of crushing the mode
label. Text-only changes, such as the position while scrolling, only hide more,
never bring items back. The current ranks:

| Priority | Items |
|---|---|
| 1 (always shown) | mode, split indicator, pending keys, command line, breadcrumb, Backstage |
| 2 | search chip, location list, pagination, speech, layout switch |
| 3 | outline button, version chip |
| 4 | prose-color chip, dark-mode switch |
| 5 | position percentage (the progress rail shows it) |
| 6 | section label (the outline button lists the sections) |
| 7 | keys hint |
| none declared | gives way before every declared item |

A new status item declares its own priority; one without a declaration gives way
first, so it can never push the mode or Backstage off screen. Media queries only
compact labels: below 700 px Backstage drops its text and the dark-mode switch is hidden (the
theme picker beside it still offers every light and dark variant), and
below 520 px the version chip drops its icon and speech drops its label. CSS
breakpoints alone cannot choose what stays, because they see the viewport, not how
wide the breadcrumb, speech label or version chip is; the line also cannot clip or
scroll, because the breadcrumb's folder menu opens above it. `tests/web_status_priority.cjs`
injects an extra item and checks 700, 390 and 320 px in both layouts.

The rail directly above the sticky footer uses shadcn Base UI **Progress**. Its separate seek target supports
click, Left/Right, Home and End. A shadcn **Popover** on hover or keyboard focus shows position
and estimated minutes remaining above the rail, based on visible text and the selected reading
pace. These values follow the current reading position, independently of the
pointer location. PDF estimates use pages remaining. Highlight/warning pips identify an owner
and open the corresponding thread. Seeking uses the document's scroll range or
the discrete spread index; it is a layout position, not a measure of comprehension.

### Two-page mode and automatic bookmarks

Choose **2 pages** in the footer or **Two pages** in settings. Text flows through
two facing columns at a fixed viewport height, continuing across successive
spreads. The document title flows as a full-size heading at the start of the
text, rather than repeating above each spread. Existing Markdown title headings
retain their source coordinates; a display title is generated only when absent.
Wheel input, horizontal touch scrolling and Vim page motions turn those
spreads. Narrow screens below 900 CSS pixels show one page at a time. Large code
blocks and tables retain their own overflow. Reduced-motion preferences disable
animated turns and GSAP smoothing.

A document with only one page of content keeps that page on the left with an empty
facing page; it is not centered.

Resizing the window reflows the columns. Reader remembers the first visible
character of the first visible block whenever you settle on a spread, and after a resize it
shows the spread holding that text rather than the same spread number. The
remembered text changes only when you move to another spread, so several
resizes in a row don't drift.

Annotation pins in two-page mode sit in the gutter right of their passage's column
(the outer margin for the last column), vertically centred on the passage's first
visible line and stacked per column in reading order, so they never cover the following words.
Only passages on the current spread get pins or a hover label: a spread is the book
viewport's box, not the window, so in a wide window the next spread's first column, which
lies clipped beyond the outer margin, shows no pin there. `node tests/web_spread_pin_pages.cjs`
(synthetic fixture with `--spread-pins`: a thread on every chapter) checks each spread at
several sizes, after resizes, through sliding and 3D turns, and in continuous reading.

**Page turn.** Turning one spread (j/k, h/l, wheel, Ctrl-d/f/u/b or the Pagination
previous/next pair) flips a real sheet in 3D. `controls/page-turn.js` bundles
Three.js and loads only once two-page reading starts. Until it loads, without WebGL,
in single-column narrow layouts, with reduced motion, or with **Page turn: Slide** in
Settings, spreads slide as before. Jumps of more than one spread always slide.

How it works: `web/src/page-turn/rasterize.ts` paints the outgoing page, the facing
page and the incoming page into canvases from the live layout. Each word is drawn at
the rectangle the browser already gave it, with its font, color, case, letter spacing
and underline. Block backgrounds and borders, CSS custom highlights, images and PDF
page canvases are painted too. Content inside a closed `<details>` is skipped. Inline
SVG, such as a diagram, is drawn from an image prepared ahead of the turn by
`web/src/page-turn/svg-images.ts`. Each outermost `svg` in the two-page article is
cloned with its CSS variables, color and font family resolved and inlined. The
page's same-origin `@font-face` files are embedded as data URLs (at most six,
1 MiB each). The clone is serialized and decoded into an `<img>`. Images are
refreshed after a diagram renders, after a theme change and after a resize. They
are cached per element and keyed by size, color and resolved variables. If an
image is not ready when a turn starts, a flat icon SVG (path, circle, ellipse, rect,
line, polyline and polygon with their computed stroke and fill, such as callout icons)
is drawn from its shapes instead; a diagram or formula is only ever drawn from its
image, so its box stays empty until the image is ready and nothing is drawn twice.
Gradients, shadows and transforms are not painted.
A full-window WebGL overlay then draws three things. The sheet is curled around an arc
of constant curvature, so its arc length never stretches; its free edge leads the
spine edge and the bottom corner leads the top. The facing page is drawn flat until
the sheet lands, and a soft shadow follows the free edge. The DOM moves to the new
spread beneath the overlay on the first frame. At the first and last frames every
shading term is exactly 1 and textures are sampled without color conversion, so the
overlay matches the page and is removed after about 0.9 s. A new turn during an
animation finishes the current one first. Annotation pins are hidden while a sheet
is in the air. Rasterizing a page costs tens of milliseconds on a typical page.

The footer uses shadcn **Pagination** to move between spreads. Facing pages are
labelled in pairs, such as **1–2** and **3–4**; a final unpaired page has one number.
Narrow screens label individual pages. The active page pair, wheel, Vim keys and
saved position all use the same reading position.

### The homepage issue

The homepage is the cover of this week's issue, chosen from the most recent
additions. `#issue=2026-W43` addresses a past issue; the bare homepage shows the
current one.

- **Masthead:** the issue number and its Monday-to-Sunday dates (ISO weeks, the
  same weeks as the inventory's `week` field), previous/next buttons and a **Past
  issues** list of the last twelve weeks that hold pieces.
- **Cover story:** a large serif headline with a kicker (Cover story · project ·
  type), a standfirst, and a byline with author, date, approximate reading time and
  read state. When the cover story has [bespoke art](#article-art), it is drawn
  above the kicker; otherwise the cover is typographic, with a small **Make cover
  art** button when a producer is available and automatic art is off.
- **Features:** up to four more pieces, each from a different project.
- **Summary:** counts of new and unread pieces and sections, and a link to the
  week's newsletter when one exists.
- **In this issue:** the rest of the window grouped by section, unread first; read
  pieces are dimmed. Six pieces per group show, and the rest expand. When there are
  more than six sections, one-piece sections share an **Elsewhere** group.
- **Footer:** how the pieces were chosen, and a link to the library statistics on
  Reader Admin.

Keys: **j** / **k** move between pieces (the cover, the features, then visible
contents rows), **Enter** opens one, **g c** returns to the cover, and **[** / **]**
step to the previous or next issue that holds pieces. Space e, the picker and search
behave as elsewhere. The entrance animation is skipped under reduced motion. The
layout uses only theme tokens and the theme's `--serif`/`--sans`.

**Layout by window width.** The issue fills the window, with outer margins that scale
from 40 to 120px (`clamp(…, 4vw, …)`); added width becomes columns, not longer lines.

- **1360px and wider:** a twelve-column spread plus a rail (260–400px). The cover takes
  eight columns and the first feature sits beside it as a second lead, bottom-aligned
  with the cover's byline; the other features share the next row in equal spans. The
  rail is sticky and scrolls on its own when taller than the window. It holds the
  counts, the newsletter link and a **Sections** index of the contents groups; a
  section button scrolls to that group and focuses it without changing the route.
  Contents columns are at least 280px wide, so wider windows gain columns (four at
  1920px, five at 2560px). Prose stays within its measure: the cover standfirst is
  capped at 58ch and feature standfirsts at 64ch. Headline sizes follow the cover's
  own width (container query units), capped at 132px.
- **1001–1359px:** the cover with the summary beside it, features in one row and
  contents in as many 260px columns as fit. The sections index is hidden.
- **1000px and narrower:** one column; the summary follows the cover and features
  pair up. At 640px and narrower, features stack and gutters are 16px, with no
  horizontal scroll.

**Selection** (`web_ui/magazine.mjs`, over the work inventory already loaded):

1. **Window.** The issue's ISO week. If it holds fewer than four candidates, it
   widens to the previous week too and says so ("A quiet week: covering Oct 12–25").
   If the bare homepage finds nothing in those two weeks, it shows the latest issue
   that has pieces and says so.
2. **Candidates** are dated works in the window, except works under
   `library/newsletters/` (the newsletter is a signal, and its working papers are
   not pieces) and works of an excluded type. The excluded types are set in
   Settings (**Leave out of the issue**, comma-separated, case-insensitive; default
   Task, Receipt, Manifest, Handoff). A repeated title counts once.
3. **Interest**, a sum of bounded terms: unread +1.0; recency in the window 0–0.5;
   kind of writing 0–0.4 (essays, perspectives and design pieces 0.4; reports,
   research, reflections and books 0.3; journals, reading notes, connections and
   guides 0.25; notes and documents 0.1; references 0.05; other typed works 0.15);
   engagement 0–0.4 (0.1 per other participant with any receipt for the work, 0.1
   per open margin thread); inbound references 0–0.3 (0.05 each, used when the
   inventory carries `inbound`); a link from the week's newsletter +0.5; and a
   penalty of up to −0.3 for text sources under about 300 words.
4. **Cover and features.** The cover is the highest score. Features are chosen in
   score order, skipping a section already used and any piece whose embedding is at
   least 0.97 similar to one already chosen (the Read next diversity threshold).
   A section is the first named project, else the work's top library folder. If
   fewer than three features remain, the section rule relaxes to fill three.
5. **Ties** break by newer date, then title, then path, so the issue is stable for
   the same works, reads and signals.

Reading time is source bytes ÷ 6 as words, at the Settings reading pace, shown as
"≈ N min" for Markdown and text sources only.

**Standfirsts** come from `GET /api/standfirst?path=…`, requested for the cover and
features only (at most 12 per view, three at a time). A `standfirst` frontmatter
string wins. Next comes a local-model standfirst that is current for the source's
exact SHA-256 (see [Local model](#reader-admin-local-model-any-openai-compatible-server)): the
route returns `source: "local-model"` with its `model`, and the cover or feature
shows a small `local model · <model>` mark under it (`data-reader-decoration`, text
only). Otherwise the first prose paragraph of the source is used, after the
frontmatter and the H1: headings, blockquotes, fenced code (including Mermaid),
tables, lists, HTML and images are skipped, and so are datelines (paragraphs
without a complete sentence, or with two or more ` · ` separators). A paragraph
that ends by introducing a list keeps only its complete sentences. The result is
plain text, capped at 60 words. The route reads at most 64 KiB of a Markdown or
text source of at most 4 MiB, validates the path like every library route, and
caches the source-derived result in memory by path and source digest (2,000
entries). The local-model output is looked up on every request, because outputs
arrive while the digest stays the same; an unreadable output cache falls back to
the opening paragraph. No standfirst is shown when none qualifies.

**Issue signals** come from `GET /api/issue?start=…&end=…` (a window of at most
62 days). It reads the top-level `library/newsletters/*.md` files (at most 200, each
at most 512 KiB) whose `newsletter_week_start`/`newsletter_week_end` overlap the
window, and returns them with the inventory works they link to (`picks`). It also
returns `near`: pairs of works dated in the window (at most 400) whose mean chunk
embeddings in the search index are at least 0.97 similar. Works the index has not
embedded yet are not compared. If the route fails, the issue is chosen without
these signals. `/api/library` rows also carry `voices` (other participants with a
receipt for the work, any version) and `threads` (open margin threads).

Section slots for rediscovery, connections and open questions appear only when
those features provide content; none is built in yet. Cover art from Mermaid
diagrams is not implemented.

### Article art

Featured articles get bespoke art: an agent reads the article, writes an **art
brief** (a short description of imagery, mood, palette relationships, motion and
composition rooted in the article's ideas), then turns the brief into a **scene
description** in Reader's declarative scene language. Reader validates the scene and
draws it with its own Three.js interpreter. No model-written code ever runs in the
page. The brief is shown beside the art as the **Artist's note**, with who made it.
It is decoration (`data-reader-decoration`): find, selection and annotations ignore it.

**Where it shows.**

- **Cover story:** the art, above the kicker (in the document it follows the
  headline). One live canvas per page.
- **Features:** a small still thumbnail above each feature's kicker, for pieces
  that have art.
- **Opening an article that has art** (#145): the art comes first, as a magazine
  feature opener. In continuous reading it is a full-width hero at the top of the
  page (`clamp(220px, min(78vh, 62vw), 980px)` tall) with the kicker, title and
  byline right below it, the Artist's note and the producer in a caption over its
  lower edge, and **Begin reading ↓**, which scrolls to the title. In two-page
  reading it fills the whole first spread, across both pages: the title, kicker,
  byline and any authored or local-model standfirst sit over the art for the eye
  (`aria-hidden`; the article's own title opens the text), with **Turn the page →**;
  the text begins on the next spread. One empty `.art-hero-spacer` page per column
  (two, or one in single-column two-page reading) keeps the text off the hero, so
  spread counts, bookmarks, heading and outline jumps, find and margin pins see an
  ordinary first spread. The hero is live where motion is allowed (paused when it
  is turned or scrolled away and in hidden tabs) and otherwise follows the states
  below; in two-page reading the still frame lies under the live canvas, and the page
  turn paints that image (it never reads back a WebGL canvas). The hero is
  decoration (`data-reader-decoration`), reserved before the reading position is
  restored, so a saved place deep in the text lands where it was. Its `/api/art`
  request goes out with the document's and waits at most 1.5 s; articles without
  art open exactly as before. **Space g** hides the hero (and art) for the rest of
  the tab's session; Space g again brings it back.
- **An open article:** **Space g** or `:art` shows the open article's art above
  everything else on its first page, and keeps showing art for articles opened later in this tab;
  Space g again hides it. A piece without art shows a calm placeholder that says
  who would make it and roughly how long it takes, with **Generate art**. When no
  voice or local model can make art, the placeholder says so and offers **Set up a
  voice**, which opens Reader Admin's Voices page (its *Agents and models*
  card lists the agent command lines Reader found); Generate art from the magazine
  then shows an information toast instead of an error.
  `:generate-art` commissions another version for the open article. Above the text
  (not as a hero) in two-page reading the art is a still image, so the page turn can
  rasterize it.

Pieces without art show nothing special. The RW-20 shape (the passages projected
through meaning-space) is no longer cover art; it remains as a data view, `:shape`
([Article shapes](#article-shapes-data-view)).

**The Artist's note.** **Artist's note** under the art opens the brief, its title, and
a provenance line: *Made by <voice or local model> (<model>) · for this edition |
for an earlier edition · date · time taken · tokens · cost*, as far as the producer
reported them (Claude Code reports a price; Codex and agy report tokens; the local
model is "local GPU"; "cost not reported" otherwise), and "repaired once" when the
validator sent the scene back. With several versions it shows *version n of m*,
**‹ Newer** / **Older ›**, **Keep this one** (the favorite) and **Make another
version**. The art's surface is `role="img"`, labelled with the artwork's title and
described (`aria-describedby`) by the note, so the brief is the text alternative.

**Focus and Regenerate this (#147).** **Focus** in the art's caption, a double click
(or double tap) on the art, **Space G** or `:art-focus` shows the article's art (or the
cover's, on the magazine) full screen, as a modal dialog. Where motion is allowed the
scene is live and can be turned: drag, or the arrow keys on the focused art; the wheel
or + and − zoom; 0 resets. Otherwise it is the still image (the stored still without
WebGL, else the note). Its **Artist's note** and **Prompt** card open over it (the card
opens on hover, touch long-press or its Prompt button). **Esc** or **Close** returns to the
same place in the article, in either layout, with focus back on the button that opened
it; the page's own keys do not act behind the view. **Regenerate this** opens a Prompt
Input (the shadcn AI Elements recipe: an Input Group with a textarea, a character count
to 2,000, an **Art made by** menu listing the runnable producers, and a send button;
Enter sends, Shift+Enter adds a line, Esc cancels). It is prefilled with the direction
the version on screen was made with or, when it had none, its Artist's note. Sending
queues a commission for the same article with that direction (`POST /api/art`
`direction`); the result is a new version beside the old ones, never a replacement. In
the static demo Regenerate this is disabled (*Needs Reader on your computer*).

A reader's direction is plain text of at most 2,000 characters (control characters are
dropped). It is appended, fenced with the run's nonce, after both the brief and the
scene prompts by the versioned template `art_prompts/direction.v1.md` (recorded as
`prompts.direction` only when a direction was given), and kept in the job, the run
log's `meta.json` and the version's `provenance.json` as `direction`. The prompt card
shows it as its own part; `/api/art/prompt` returns it as `direction`.

**How it was made (the prompt card, #146).** Hovering expanded art (the article
hero, the full-screen Focus view or the Space g view) for a moment, pressing the
caption's **Prompt** button (keyboard: it opens the card and moves focus into it;
Esc closes it and returns focus), or long-pressing it on a touch screen shows a card:
*How this art was made*, the artwork's title, *Made by <producer> (<model>) · date ·
prompts brief.v1 · scene.v1 · dsl.v1*, the first paragraph of the Artist's note, then
each stage's prompt exactly as it was sent (brief, scene and, when the scene was
repaired, repair), read from the version's archived run log. The instructions show
first; the quoted article, the quoted brief and the scene-language reference are
collapsed (`<details>`, with their length); **Copy** copies a stage's whole prompt.
Handcrafted art (the demo's) says *Handcrafted for the Reader demo; no model was
run.*; a version without a run log says *Prompt not recorded for this version.* The
card is one fixed element outside the article (`data-reader-decoration`, never
searched, selected or rasterized); it stays open while the pointer is over the art or
the card and closes on Esc, a click elsewhere, or leaving both.
Clicking or dragging the artwork cancels an automatic hover card; it does not
interrupt manipulation of the expanded scene.
On touch screens, a long press tolerates small finger jitter; moving more than
10 CSS pixels from the initial touch cancels it, including during pointer capture.

Cover previews and feature thumbnails do not open this card on hover or touch
long-press. Expand the cover with **Focus** (or **Space G**) to inspect it on hover;
the cover's explicit **Prompt** button also remains available. Closing Focus,
switching art versions and repainting the cover keep preview hover disabled.

**Which version is shown:** the favorite, if one was kept; else the newest version
for the current edition; else the newest for any earlier edition (labelled *for an
earlier edition*). A new edition never removes old art.

**Settings** (Reader Admin):

- **Article art** (on by default) shows art on the cover, features and with Space g.
- **Open articles with their art** (on by default) opens an article that has art on
  its hero; off, the art shows only with Space g, as before.
- **Art made by:** *Default* (the server's choice: the first runnable voice in
  `voices.json`, else the local model), any runnable voice, or **Local model**
  (the model configured for the local-model provider). Manual voices cannot make art.
- **Make art automatically:** *Off* (the default: only when you ask), *For each
  issue's cover story*, or *For the cover story and features*. The issue then
  commissions art once per page session for featured pieces that have no art for
  their current edition; the server also skips a piece with a commission queued and
  one whose edition failed in the last 24 hours.

**Jobs and toasts.** A commission is a background job; reading never waits for it.
While one runs, the page polls `GET /api/art/jobs` every 2 s and toasts *Making art
for ‘…’…* (with the stage), then *Art ready* (with who and how long), *failed* (with
the reason) or *cancelled*; the cover or the open article repaints when its art is
ready. The article's placeholder shows the running stage, elapsed time and **Cancel**.
**Reader Admin › Artwork** lists the last commissions (state, producer and
model, automatic or explicit, time, tokens and cost, the archived run's path) with
**Cancel** and **Open**.

**Pipeline** (`src/reader_mcp/art.py`, one worker thread per server, one commission
at a time per vault across Reader processes under `.reader/art/run.lock`, at most 20
waiting):

1. **Brief** (`art_prompts/brief.v1.md`): the article's text without frontmatter
   (at most 60,000 characters; longer articles are cut with a note), fenced as quoted
   data with a random nonce, plus the rules: no text, letters, numbers or faces in the
   scene; colors only as theme roles; slow, calm motion; a wide composition. The
   answer is `TITLE: …` and `BRIEF: …` (40–4,000 characters).
2. **Scene** (`art_prompts/scene.v1.md` with the language reference
   `art_prompts/dsl.v1.md`): one JSON object in a ```json fence.
3. **Repair** (`art_prompts/repair.v1.md`), once: when the validator refuses the
   scene, its errors (at most 20) go back with the scene. A second refusal fails the
   job and stores nothing.
4. **Save** a new version (below), then **commit** it with its run log.

A **voice** runs its own CLI and subscription with the argv from `voices.json`, once per
stage, in an empty workspace under `.reader/art/work/<job>/` (a fresh `git init`, for
CLIs that only run inside a repository) rather than in the vault: `{vault}` expands
to that workspace, `{sandbox_add_dirs}` is dropped, `{persona}` is the voice's persona
plus the art rules (do not run tools, read or change files, or launch agents), and the
article is inline. It is supervised like a chat turn (`voice_runner.supervise`): its own
process group, a CPU limit, the 4 GiB memory and 16 MiB output budgets, the free-disk
reserve, and a timeout of the voice's `timeout_seconds`, at most 600 s per stage. The
**local model** answers each stage through the OpenAI-compatible client
(`local_model.Client.chat`, at most 12,000 answer and 6,000 reasoning tokens, 600 s),
holding the workstation `host/gpu/` lock for each loopback call. A job that reaches
the low-disk reserve refuses to start, because LLM logs are never dropped.

**Run logs.** Every commission is archived forever under
`logs/llm/art/YYYY/MM/DD/<job id>/` (`llm_logs.RunLog`): `meta.json` (producer, model,
CLI version, redacted argv per stage, prompts used, outcome, usage, the art folder;
for the local model, its provider preset, the base URL's host only, whether it is
loopback and whether an API key was sent, which never appears in the log),
and per stage `<stage>-prompt.txt`, the CLI's `<stage>-stdout.jsonl` and
`<stage>-stderr.log` or the local model's `<stage>-response.txt` (and
`-reasoning.txt`), plus `scene-errors.txt` when a repair ran; all gzip-compressed when
the run ends.

**Storage.** Art is durable vault content beside its edition, committed, never
overwritten:

```
art/<path under library/>/<source sha256>/<generation>/scene.json        the validated scene
                                                      brief.md          the Artist's note (frontmatter: title, kind "Art brief", author, art_for, source_sha256, made_with, prompt, created)
                                                      provenance.json   producer, model, CLI version, prompts, stages, seconds, usage, repaired, counts, log path, Reader version
                                                      still.png|.webp   optional: the first still a browser drew
art/<path under library/>/favorite.json                                 the version you kept
```

`<generation>` is `YYYYMMDDTHHMMSSZ-<4 hex>`. A version is written in
`.reader/art/staging/` and renamed into place; an existing folder is never replaced.
Each version is committed with its run directory (`git add -A -f`, so ignore rules
cannot drop them): *Add art for <title>* with `Reader-Art: <path>@<sha12>/<generation>`
and `Reader-Log: art/<job id>` trailers, serialized with chat commits (the same flock
and the repository `.git/` git-locks key). A favorite and a still image are their own
small commits. Without Git, art is saved but not committed, and the job says so. Job
history (the last 60) is kept in `.reader/art/jobs.json`. One web server per vault owns
art: it holds `.reader/art/supervisor.lock` for its life, the same kind of lock as chat's
(flock, plus a heartbeat record so a host and a container on one vault see each other).
Only the owner adopts, runs or records jobs. It takes the lock at start when
`jobs.json` exists, and otherwise on its first art action, so a server that only reads
writes nothing. On taking it, the owner adopts waiting jobs and marks a job that was
running when its server stopped *failed* (sealing its log as interrupted). A job's
`owner_pid` is for display only; a run another process still holds `run.lock` for is
left alone. Any other server on the vault shows the owner's jobs read-only (fresh from
`jobs.json`, marked `foreign`, with no Cancel), the Art studio card says *Another
Reader server owns art for this vault; art is read-only here.*, and every
`POST /api/art` action answers **409** with that message. It takes over on its next
art action once the owner stops.

**The still image.** The first browser with WebGL to draw a version renders its frame
at `still.at` (960 × 480, WebP, else PNG) and posts it (`action: "still"`). The server
verifies it with Pillow (PNG or WebP, at most 2 MiB and 2048 × 1536), keeps the first
one only and commits it. Browsers without WebGL show that image; without one, they
show "This browser cannot draw 3D art here" and open the Artist's note.

#### The scene language

Defined once, in `src/reader_mcp/web_ui/art-scene.v1.json`, and interpreted the same
way by the server's validator (`art_scene.py`, before a version is stored) and the
page's (`art-scene.mjs`, again before anything is built). Unknown fields are errors
everywhere. Version 1 has:

- **Top level:** `reader_scene: 1` (required), `title`, `seed`, `background`, `fog`
  (linear or exponential), `camera` (position, target, fov 15–90 and motion: still, an
  orbit, a sway or a dolly), `still.at` (the moment, 0–60 s, used for stills and
  reduced motion), up to 8 `lights` (ambient, hemisphere, directional, point, spot),
  up to 32 named `materials`, `objects` (required) and up to 64 `links` (tethers drawn
  between two objects and redrawn as they move).
- **Colors** are theme roles, never literal colors: `bg`, `surface`, `raised`, `line`,
  `ink`, `muted`, `faint`, `accent`, `accent-ink`, `rust`, `warning`, `chart-1`…`chart-8`,
  and the derived `bright` (the lighter of page and ink) and `deep` (the darker), or
  `{token, mix, amount, lightness, saturation, hue}`, or `{light, dark}` to choose by
  the page's brightness. The page resolves them from the current theme's CSS
  variables, so the art fits every theme and repaints on a theme change. Additive
  blending becomes normal blending on light themes.
- **Materials:** basic, lambert, standard, physical or toon, with color, emissive,
  roughness, metalness, clearcoat, transmission, opacity, wireframe, flat shading,
  side and blending.
- **Nodes:** `mesh`, `group` (nested at most 6 deep), `instances` (an instanced mesh of
  up to 6,000 copies in a ring, spiral, helix, grid, sphere, scatter, line or path
  layout, with jitter, a scale range, facing and per-instance colors and motion: bob,
  spin, pulse or a traveling wave), `particles` (up to 24,000 points in a sphere,
  shell, box, disc or ring; still, drifting, swirling, rising, falling or breathing)
  and `line`. Every node has an optional `id`, `position`, `rotation`, `scale` and up
  to 8 animations.
- **Geometry:** box, sphere, the four Platonic solids with subdivision, torus, torus
  knot, cylinder, cone, capsule, plane (optionally with a traveling wave), circle,
  ring, lathe (a profile of up to 256 points), extrude (a shape of up to 256 points
  with holes and bevel), tube (a curve through up to 256 points), eight named
  parametric surfaces (klein, mobius, saddle, shell, helicoid, wave, dupin,
  spherical-harmonic) and custom meshes (up to 4,096 vertices and 8,192 triangles).
- **Animation** (every period 2–600 s, so nothing flashes): spin, oscillate (position,
  rotation, scale, opacity or glow), orbit (a point, or another object), wander (smooth
  noise), follow (a spring toward another object), look (face another object) and
  react (a value set by the distance to another object).
- **Budgets:** 256 KiB of JSON, 240 nodes, 400 animations, 6,000 instances, 24,000
  particles and an estimated 400,000 triangles in all; ids unique; every reference
  must exist; follow and orbit-around chains must be acyclic; face indices in range;
  every number finite and within its range. Errors name the path, such as
  `objects[2].geometry.radius: expected a number from 0.001 to 20` (at most 20).

**Rendering** (`web/src/art/art.ts`, `controls/art.js`, sharing the Three.js chunk
`controls/three/` with the page turn and the data view). Time is the only input: the
frame at `still.at` is the same everywhere for a theme (follow springs integrate with
a fixed step from t = 0). One WebGL renderer serves the page (neutral tone mapping, sRGB
output): at most one live canvas (the cover, or an article's art in continuous
reading) and still images for thumbnails, reduced motion and two-page reading, cached
per version, theme and size for the session. The live view runs at most 30 fps,
starts at `still.at` (so it continues the still seamlessly), pauses off-screen and in
hidden tabs, and becomes the still image when a build takes over 2.5 s, the scene holds
more than 600 GPU geometries and textures, the median update-and-submit time of frames
4–11 exceeds 34 ms, 90 frames run slow, or, after 2 s, the median interval between
frames stays above 125 ms (below 8 fps). A scene that builds more than 1.5 times the
triangle budget is refused. Under `prefers-reduced-motion` the art is the still image
and no animation frames run.

**Routes.**

- `GET /api/art?path=library/…[&edition=<sha256>&generation=<id>]`: `{path, sha256,
  art, versions, count, favorite, job}`. `art` is the version shown (or asked for):
  `{edition, generation, folder, scene, counts, brief, title, provenance, still,
  current, favorite}`, or null; `versions` lists up to 50, newest first; `job` is an
  active commission for the path. 404 for an unknown version.
- `GET /api/art/jobs`: `{jobs, active, ownership, producers, default, error}`;
  `ownership` is `{owner, writable, message}` (`writable`: this server owns art, or will
  on its first art action because no other server holds the lock); each producer is
  `{id, kind, label, available, cli, model, estimate_seconds}` (the median time of
  finished commissions).
- `GET /api/art/still?path=…&edition=…&generation=…`: the version's still image (404
  without one).
- `GET /api/art/prompt?path=…[&edition=…&generation=…]` (#146): the prompts that made
  a version (the shown one without `edition`/`generation`), read only: `{path, edition,
  generation, title, created_at, producer: {label, model, kind}, prompts, log,
  recorded, handcrafted, message, stages}`. Each stage is `{name, bytes, truncated,
  parts}`, its archived `<stage>-prompt.txt` (decompressed, at most 512 KiB, cut with
  `truncated: true`), split into `parts` `{kind, text, chars}` that join back to the
  prompt: `instructions`, `article` and `brief` (the nonce-fenced quotes) and
  `reference` (the prompt version's scene-language file). Only a run log under
  `logs/llm/art/` named by the version's provenance is read; anything else answers
  `recorded: false` with a message, as does a version without a log (`handcrafted:
  true` with its note when it has one). The same path, edition and generation checks
  as `/api/art` (400 for a malformed one, 404 for an unknown version or a piece
  without art); vault-relative paths only.
- `POST /api/art` (token, JSON; at most 3 MiB): `{action: "generate", path,
  producer?, direction?}` (a reader's direction, at most 2,000 characters; #147) (one active job per path: a repeat returns it), `{action: "commission",
  paths, producer?}` (at most 6, skipping as above: `{queued, skipped}`), `{action:
  "cancel", job}`, `{action: "favorite", path, edition, generation}` and `{action:
  "still", path, edition, generation, image}` (a data URL). 409 when another server
  owns art for the vault.

Paths go through `WebLibrary.path` (library files only, no symlinks); art folders
refuse symlinks; only Markdown and plain-text pieces of at least 200 characters
are commissioned.

**The demo vault.** `reader demo` stores handcrafted art for four of the week's
pieces (marked *Handcrafted for the Reader demo; no model was run*) and leaves
Montaigne's *Of Books* without; its scripted voices answer art prompts from
`bin/art.json` with handcrafted briefs and scenes, so Generate art works with no model.

**Not implemented: a free-form mode.** A mode in which a model writes Three.js code,
run only in a sandboxed iframe (`sandbox="allow-scripts"` without same-origin, a
CSP with no network, a vendored Three.js, `postMessage` for size and theme, and a
frame-time and memory kill switch), is designed in spec RW-43 but not built.

### Article shapes: the data view

A data view of an article, shown with `:shape`, separate from its [art](#article-art)
(it was the magazine's cover art until bespoke art replaced it). An article gets a
slowly moving Three.js figure computed from its own text: the path the argument takes through meaning-space, drawn as a ribbon
through the article's passages in reading order, with its key terms as floating
labels and its nearest works as faint stars in the direction their ideas lie. The
same source always yields the same shape, and articles on similar subjects look
alike. It is decoration (`data-reader-decoration`): find, selection and annotations
ignore it.

**Where it shows.**

- **An article's opening page:** `:shape` draws the open article's shape above its
  kicker (below its art, when that is shown) and keeps showing shapes for articles
  opened later in this tab; `:shape` again hides it. In two-page reading the figure is
  a still image, so the page turn can rasterize it. The magazine does not show shapes.

Only Markdown and plain-text pieces with at least 6 search passages get a shape;
shorter pieces would make a dot. Without a shape the layout is unchanged.

**What it shows.** The ribbon is a tube along a centripetal Catmull-Rom curve through
the projected passages, bright (`--chart-1`) where the article starts and cooler
(`--chart-2` toward `--bg`) as it goes. Each bead is one passage; beads swell with
passage length and with margin threads, and passages with threads glow in
`--accent`. Thin rings (`--muted`) mark passages where a level 2–6 heading starts (at most 40:
the shallowest heading levels that fit, else an even sample).
Four to seven key terms float near the passage where each matters most, in `--sans`
(`--ink` for the top three, `--muted` for the rest). Up to twelve related works are
faint points (`--muted`). The background is the page itself, and colours are read
from the current theme's tokens and redrawn on a theme change.

**Motion.** A slow orbit of 90 seconds per turn, a gentle drift whose depth grows with
the variance the second and third components explain, and beads breathing over seven
seconds with phases from a PRNG seeded by the source digest. Only the motion is
random; the frame at t = 0 is fixed for a source and theme. Under
`prefers-reduced-motion` the figure is that single still frame, as an image, and no
animation frames run. The live view is capped at 30 fps and pauses when it leaves
the viewport or the tab is hidden. If its first three frames after shader
compilation each take longer than 40 ms, it becomes the still image.

**Interaction.** Hovering a bead shows the passage's first line; clicking it moves
to that passage. Hovering a
star shows the related work's title; clicking opens it. A focused figure (status
line `SHAPE`) moves between passages with **←** / **→** (**Home** / **End**) and
between related works with **↑** / **↓**, announcing each in a live region; **Enter**
opens the current one. The figure's description (`aria-describedby`) lists the key
terms, every drawn passage's first line and the related works.

**Rendering.** `controls/shape.js` loads on demand and shares its Three.js chunk
(`controls/three/`) with the page turn. One WebGL renderer serves the page: at most
one live canvas (in continuous reading), and still images
(reduced motion, two-page reading) rendered by the same renderer
to PNG data URLs and cached for the session by path, digest, theme and size. When
nothing is live the renderer releases its WebGL context. Without WebGL (or if the
chunk fails to load) the figure is a 2D SVG of the same projection, seen from the
same angle, with the same hover, click and keys.

**Data: `GET /api/shape?path=library/…`** (read-only, expensive pool). For a
Markdown or text source of at most 4 MiB:

1. The source's passages come from the published format 2 search index, in reading
   order. A source the index does not hold yet uses the
   indexer's own passage windows without vectors. At most 400 passages are drawn;
   longer sources are evenly subsampled, keeping order, the first and the last.
2. **Projection.** When at least 90% of the drawn passages have vectors, they are
   centred and projected onto three principal components by SVD. Each component's
   sign is fixed so the first passage with a nonzero coordinate is positive, and the
   points are scaled into the unit sphere. `variance` is each component's share.
   Ribbons of 40 or more passages are smoothed by a centred moving average over
   ±(passages ÷ 80) neighbours in reading order (±5 at the 400 cap) and rescaled, so a
   long article draws the path of its argument rather than every step.
3. **Terms.** Words of at least three letters, without digits, outside the search
   stop words and a short list of subject-free words, are scored per passage by
   TF-IDF: term frequency in the passage times `log((N+1)/(df+1))`, where `df` is
   the number of index passages containing the word (the FTS vocabulary, read through
   a temporary `fts5vocab` table on the read-only connection, cached per index
   publication) and `N` the number of index passages. A word in every passage scores
   nothing. The top terms by total score (at least 4, at most 7, stopping below 40%
   of the best after four; plural repeats dropped) each sit at their strongest passage
   not adjacent to another label. A term keeps its capitalised form when most of its
   uses are capitalised mid-sentence.
4. **Neighbours.** The twelve works most related by Read next's scores (mean passage
   similarity plus 0.03 per shared project or topic, other editions above 0.985
   left out), projected through the same centre, basis and scale. Only a neighbour that
   lands within 0.05 of the centre (no meaningful direction) is dropped: the browser draws
   each star at a fixed radius along its direction, so it never meets the ribbon on screen,
   and a long document's passages fill the sphere.
5. **Threads:** placed (exact or relocated) margin threads per passage, by the source
   line where each anchor starts.
6. Response: `{path, sha256, seed, form, points, lines, weights, threads, headings,
   terms:[{text,i}], neighbours:[{path,title,xyz,score}], variance, excerpts, count,
   sampled, current, min_chunks, note, scope}`. `seed` is the first 32 bits of the
   source SHA-256; `lines` the drawn passages' first source lines; `excerpts` their
   first 90 characters, starting after the 150 characters each index passage repeats
   from the one before; `current` whether the index holds this exact digest. The
   response stays under 64 KiB (excerpts shorten to 48 characters, then drop, if
   needed). Results are cached in memory (256 entries) by path, digest, index
   publication and the `annotations/` folder's modification time.
7. **Without vectors** (an index built without embeddings, or not covering this
   source), `form: "terms"`: the passages lie along a helix whose turns, radius and
   phase come from the seed, with the same terms, rings, beads and threads and no
   neighbours. The figure says so ("Article shape · terms only") with the tooltip
   *Rebuild the search index for the full shape*.

No model is called and nothing leaves the machine; the route writes nothing.

### Reader Admin: indexes, the inbox, library statistics and settings

Reader Admin (formerly Behind the scenes) is a separate layout for administration,
not a page inside the article reader. A shadcn **Sidebar** lists its sections; a
header carries the sidebar trigger, a breadcrumb (*Reader Admin › Section*) and
**Back to Library**; the page shows one section at a time under its own heading.
Each section is its own hash route:

| Route | Section |
| --- | --- |
| `#admin` | Overview: attention needed, active work, the inbox and index health |
| `#admin/jobs`, `#admin/jobs/<uuid>` | Coding jobs from article prompts, and one job's trace and archive |
| `#admin/logs`, `#admin/logs/<kind>/<date>/<run-id>` | The LLM log archive, and one archived run |
| `#admin/repositories` | Which checkouts article prompts may run in |
| `#admin/voices` | The agent command lines chat voices and the librarian run (the *Agents and models* card) |
| `#admin/models` | The local model: provider, server, queue, outputs and task settings |
| `#admin/inbox` | Arrivals, receipts, claims and **You got mail** |
| `#admin/indexes` | Index cards, rebuilds, **Recent runs** and edition links |
| `#admin/artwork` | The Art studio |
| `#admin/library` | Holdings and reading statistics |
| `#admin/service` | The Reader service, its updater, and Companions |
| `#admin/settings` | Reading preferences and the Theme Editor |

The footer's **Backstage** button, `:backstage` (or `:admin`) and the legacy
`#backstage` address open the Overview; `#backstage` is shown as `#admin`.
**Space p**, `:settings` and `:set` with no option open Settings. Every section
opens at its own top with its heading focused (without scrolling), so Tab moves
into its controls, screen readers announce it, and leader keys keep working; no
field or filter takes focus just because a page opened. Choosing the open section
again, or Space p while on Settings, returns to its top. Browser Back and Forward
move between sections, and a reload or a direct link opens its section without
showing the Overview first. An unknown section (`#admin/no-such-page`) says so and
links to the Overview. The status line shows ADMIN mode and *Library › Reader Admin*.

Admin scrolls the window natively. The reading smoother, two-page pagination, the
progress meter, margins, the reading cursor and the article footer are not part of
it, and nothing in Admin saves a reading position. **Back to Library** (and browser
Back) returns to the view Admin was opened from: a document reopens at its saved
bookmark (not at the heading or passage it was once opened at), and the homepage,
an issue, Search or a scratch pad reopen as they were. The return target survives a
reload within the tab. In a split layout, Admin replaces the layout instead of
opening inside a pane: every pane saves its place, the panes close, and Back to
Library or browser Back restores the same layout and focused pane. A pane's
`Space p` or `:backstage` asks the window to open Admin, and a saved layout naming
`#backstage` opens the homepage in that pane.

The sidebar collapses with its trigger; collapsed, it leaves the Tab order. Below
768 px it is a sheet (a dialog named *Admin sections*); choosing a section closes
it and that page's heading takes focus. Reader's keys never act on typing in Admin
forms, and Space on a focused button, switch, select or checkbox activates it
rather than starting the leader. The sidebar uses the active theme's tokens, and
reduced motion removes its transitions.

Status is read, never assumed. The Overview summarizes what Reader already polls
(`/api/maintenance` and `/api/inbox`); opening it starts no check, rebuild, model
or inbox run. A tile says *Loading…* until its status arrives, and a status that
could not be read is shown as unavailable with the reason, never as zero or
healthy; if a later refresh fails, the page says the tiles show the earlier status.
Indexes and the Inbox show the same unavailable state, with their actions disabled.
In the static web demo, Service & tools, Voices and Models say that they need
Reader on your computer instead of showing empty controls.

#### Component system

Every Admin page is composed from real shadcn/ui components (style `base-nova`, Base UI primitives) added with the
shadcn CLI into `web/src/components/ui/`. Pages do not draw their own cards, lists, badges, callouts or tables. They
build up through atomic tiers in `web/src/theme/`:

| Tier | Folder | Parts |
| --- | --- | --- |
| Atoms | `theme/atoms/` | `StatusBadge` (a tone: ok, attention, error, active or neutral, mapped to a Badge variant), `RelativeTime`, `Elapsed`, `RunStateIcon`, `SectionHeading` |
| Molecules | `theme/molecules/` | `FactList` (grid or rows of Items), `Notice` (Alert), `EmptyState` (Empty), `LoadingState`, `Unavailable`, `RunRow` (Item), `Toolbar` (muted Item), `FilterSelect` and `FilterBar` (Field + Select), `Pager` |
| Organisms | `theme/organisms/` | `StatusCard` (full Card composition), `RunList` (ItemGroup), `ConfirmAction` (AlertDialog) |
| Templates | `theme/templates/` | `AdminHeader` (sidebar trigger, Breadcrumb, Back to Library), `AdminPage` (focusable h1, lede, Separator), `CardGrid` |

Pages live in `web/src/admin/pages/` (Inbox, Indexes, Coding jobs, LLM logs, Repositories, Voices, Library), with Overview in
`web/src/admin/overview.tsx` and the larger sections in their feature files (`local-model.tsx`, `server-card.tsx`,
`companions.tsx`, `art-studio.tsx`, and `SettingsForm` in `reader-controls.tsx`). Each page has a design sheet in
[`admin-design/`](admin-design/index.md) that states its focused activity, layout, composition, states and test hooks.

Colours, fonts and radii come only from semantic utilities (`bg-card`, `text-muted-foreground`, `text-destructive`,
`border-border`). `web/src/styles.css` maps them onto Reader's theme tokens with `@theme inline`, so every built-in,
famous and custom theme applies. The stylesheet imports `shadcn/tailwind.css`, the variants the components are written
for (for example, `data-horizontal` follows `data-orientation`). Reader loads no Tailwind preflight, and its page
stylesheet (`web_ui/style.css`) declares the layers `theme, base, reader-legacy, reader-slots, utilities`. The
`reader-slots` layer, defined in `styles.css`, removes legacy element rules (prose margins, heading fonts, link and
fieldset styles) from shadcn slots inside Admin and its alert dialogs, and still loses to every component utility.
Tests find parts by ids and `data-*` hooks, never by styling classes.

Outside Admin the same rules apply. Search, the reading queue, the Theme Editor, chat, the article prompt card, the
quiz, the writing prompt and What changed are composed from shadcn components, and each opts into the slot preflight
with `data-ui="shadcn"` (shadcn's portaled dialogs, sheets and popovers are always covered). Their design sheets are in
[`ui-design/`](ui-design/index.md). Surfaces still rendered by the plain-JavaScript modules use the vanilla bridge
(`web/src/vanilla-buttons.ts`): `data-button` markup takes `buttonVariants`, and plain `<kbd>` in Reader's chrome takes
Kbd's classes. `node tests/web_page_review.cjs [page …]` reviews these pages like the Admin harness does.

`node tests/web_admin_review.cjs [section …]` opens every Admin section (or the ones named) against the synthetic
fixture, on desktop (1440 × 900), tablet (iPad Mini) and phone (iPhone 13) profiles in a light and a dark theme. It
saves a full-page screenshot of each under `READER_SHOTS/admin-review/` (default `.reader/web-dev/`), and fails on a
page error, a console error or horizontal page overflow.

New sections are added in one place: the section registry in
`web/src/admin/sections.tsx` (id, title, icon, description, whether it needs Reader
on this computer, which route parameters it accepts, and its page). The route
syntax, `#admin/<section>[/<param>…]`, is parsed by `web_ui/admin-routes.mjs`.

**Indexes** shows one shadcn **Card** per rebuildable index, with a
state **Badge** (Current, Needs rebuild, Partial, Not built, Not configured, Error), its facts, and its rebuild
actions in the card footer:

| Index | Freshness check | Rebuild |
| --- | --- | --- |
| Search index | Compares every library file's size and mtime with `.reader/search.v2.sqlite3`, and counts text documents without embeddings (Partial). A run that stopped before finishing is Partial with "The last rebuild stopped before finishing; N passages saved. Run again to continue." With only a retired format 1 index, the card is Missing ("No search index: Reader no longer reads the format 1 index. Rebuild the search index to restore search") and search is unavailable until the rebuild writes `search.v2.sqlite3`. While `.reader/search.sqlite3` exists, the card adds "Old search index (format 1, no longer read): N MB · Remove". **Remove** runs the *Remove legacy search index* job, which refuses while an index run or another process holds the file (see [format 1 is retired](search.md#format-1-is-retired)). | **Rebuild with embeddings** or **Keywords only**, through the guarded `run_index` worker and its resource limits |
| Browse indexes | `Browse.run(check=True)`: navigation files that would change. Not configured without `indexes/settings.json`. | **Refresh** writes `indexes/` and the README dashboard in the vault; commit them afterwards |
| Catalog SQL mirror | `catalog check` against `.reader/catalog.sqlite3` | **Sync** (`catalog sync`) |
| Link graph | Compares every library file's size and mtime with `.reader/links.sqlite3` | **Refresh** re-reads only new and changed files ([Link previews and Linked from](#link-previews-and-linked-from)) |
| Other inventories | Counts works (`indexes/coverage.json`), inbox files, reading participants and annotation threads against their limits (10,000, 10,000, 100 and 5,000). Badge: Within limits, Near a limit (80 % or more), Over a limit | none |

Cards show usage against budgets so a ceiling is visible before it is hit. The
search card shows Passages (for example "61,204 of 400,000"), Database and
Embedding cache ("0.2 of 2 GiB"; MiB below a 1 GiB budget), and "N indexed by path
only" for machine files. The catalog card shows Library files ("9,052 of 50,000")
and Sources. Budgets come from `indexes/settings.json` → `search` (see
[search budgets](search.md#budgets-and-settings)). A search run that stopped at its
time limit finishes with "Stopped at the time limit; N passages saved. Run again to
continue." in its toast and in Recent runs. A failed run shows the worker's last
meaningful error line, not its log tail.

Opening the Indexes page runs a freshness check when the last one is older than two
minutes (the Overview never does). **Check again** reruns it, and every rebuild is followed by one. On a
large vault the browse check takes about ten seconds. A catalog check can refuse
outright: for example, an inventory over the 50,000-file / 2 GiB catalog limit, or
a duplicate `document_id`, shows as Error with that message. Jobs run one at a time in a background thread of
the web server. While one runs, every rebuild button is disabled. A second start
is refused with HTTP 429. **Recent runs** lists this server process's last 20 jobs
with their results or errors. Job history is not persisted; freshness is always
measured again.

Job toasts use shadcn **Sonner**. A start shows a loading toast, which the same
toast replaces with success (with a summary) or failure (with the error, shown for
12 seconds). The page polls `/api/maintenance` every 1.5 seconds while a job or
check runs, and otherwise every 15 seconds while the tab is visible, so toasts also
appear while you read elsewhere in the app. Every other app message, such as saved
replies and errors, uses the same Toaster.

The **Library** page holds the reading statistics that used to be the homepage (see
[Search, dashboard and shared discussion](#search-dashboard-and-shared-discussion)): six totals, the chart cards, the
works behind a selection, and unread discussion. It is a React page: `web_ui/dashboard.mjs` computes the model
(`libraryModel`) and `web/src/admin/pages/library.tsx` renders it, drawing the charts with D3.

When a request cannot reach the server at all (stopped, restarting, or the laptop
slept), the app shows one toast, *Reader isn’t reachable — retrying…*, with a
stable id so later failures replace it instead of stacking. It adds *Your last
change wasn’t saved.* once a write has failed, and the actions that failed raise no
toasts of their own. A probe (`GET /`) retries with backoff from 1 to 30 seconds;
the first success, or any request that reaches the server, replaces the toast with
*Reader is reachable again.*

The Settings page holds the preferences form in four cards: *You and the page* (reading name, palette), *Reading*
(layout, page turn, pace, recent files, prose colors, and switches for the atlas, activity, smooth scrolling, Read
next, Linked from and the outline rail), *The issue and article art* (excluded kinds of writing, article art, art
producer and automatic art) and *Inbox* (job permissions). Choices are shadcn **Select** controls. Escape dismisses
an open Select only, and Reader's global Vim commands yield to these controls. A save bar stays in view at the bottom
of the page. Preferences take effect when saved; you stay on the page, and a toast confirms the save. **Theme
Editor…**, in the toolbar above the form, opens the editor over the page.

### Inbox and You got mail

Reader Admin's **Inbox** page (`#admin/inbox`) holds two cards, *Librarian run* (You got mail, its live
transcript and report) and *Waiting to be filed* (the arrivals), and the Overview counts what is waiting. While mail waits, the footer button reads
**Backstage · N**. The card lists one row per top-level
arrival: a folder under `inbox/`, or a loose file. It uses the inbox runner's own
inventory: at most 10,000 files, excluding `inbox/README.md`, hidden files, symlinks
and empty folders. Each row shows:

- the title from `receipt.json`, else the document's frontmatter title or first H1, else the file name;
- author, project and report date from the receipt's provenance, and its source ("via …");
- receipt integrity: **Receipt intact** when every recorded file matches its size and
  SHA-256, **Changed since delivery** otherwise, or **No receipt** / **Unreadable receipt**
  (over 256 KiB, not JSON, or not a Reader receipt);
- the file count, total size and when it arrived (`received_at`, else the newest file time).

Opening a row previews its document (the receipt's `document`, else the first
`.md`, `.txt` or `.pdf`) at `#read=inbox/…`. A preview is plain reading: the kicker
reads *Inbox preview · not yet filed* and the breadcrumb *Library › Inbox · name*.
It writes no read receipt, bookmark, discussion or recent entry and shows no Read
next. The server's writers keep their library-only path rules, and only document,
file and link-resolution reads accept `inbox/` paths. A preview resolves links and
images only within its own bundle or the library.

**You got mail** starts the existing librarian inbox runner, the same supervisor
the Obsidian plugin's **Process inbox** starts. The server spawns
`python -m reader_mcp.inbox_runner --root VAULT --codex EXE --run-id ID --sandbox-mode MODE`
with explicit argv and no shell, as a detached process group, using its own
interpreter and package. It adds `--workstation-lock-store PATH` when
`READER_WORKSTATION_LOCK_STORE` is set. The run id is generated by the server, and
nothing from the browser reaches the librarian's fixed prompt. Codex is found as the
plugin finds it: `READER_CODEX` if set, else `codex` on `PATH`, `~/.local/bin`,
`~/.cargo/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. The supervisor's lock and
Upkeep claim check decide admission. The server waits up to 3 seconds for the
supervisor to report and returns its refusal when it refuses.

The button is disabled, with the reason beside it, when:

- the inbox is empty;
- a run is starting or running, from this tab, another tab or Obsidian;
- Upkeep intake claims are held ("Filing already assigned");
- a voice chat turn holds `.reader/voice-runner/run.lock` ("A voice chat turn is
  running in this vault"), the same check the supervisor makes;
- the last run is **interrupted**: its state says starting or running, but its
  supervisor process is gone. The card shows the documented recovery: confirm the
  recorded process group is gone, then remove only `.reader/inbox-runner/state.json`.
  The server never clears it;
- coordination files cannot be read, or Codex is not found.

While a run is active, a loading toast reads "The librarian is reading the mail…".
The card shows the **Activity** transcript (below) and **Stop**. Elapsed time appears once in the transcript header; a fallback counter appears only until the transcript is available. Activity uses distinct blue running indicators, green completion indicators and red failure indicators, derived from the active theme. Commands use stronger text, and librarian messages have a separate surface. Labels and icons retain the state information without relying on color. Stop writes `.reader/inbox-runner/cancel` ("Stop
requested by the Reader web user."), as the plugin does, and the supervisor stops
the process group within a second. When the run ends, the same toast becomes
"Mail filed: N arrivals" (with a **Report** action), "Inbox run stopped", or an
error carrying the runner's message. The card then shows the runner's message,
the commit, the librarian's report (`last-message.md`, its last 256 KiB) and the
finished transcript,
rendered as sanitized Markdown. The commit is a hash the report names that `git log`
confirms exists in the vault. Report links to `library/` or `inbox/` open in the
reader; absolute vault paths are shown vault-relative. After a run ends, the app
reloads `/api/library` and reruns the index freshness check. The page polls
`/api/inbox` every 2 seconds while a run is active and every 15 seconds otherwise,
and again whenever the tab becomes visible. It also announces runs started
elsewhere. If **You got mail** is refused because another tab or client already
started a run, the page reloads the inbox state and shows that run (transcript and
**Stop**) with an informational toast instead of an error.

**Inbox job permissions** in Settings matches the plugin's setting: **Sandboxed
workspace** (`workspace-write`, the default) or **Host access**
(`danger-full-access`), with the plugin's warning. The choice is stored in this
browser's preferences and sent with each start. Resource limits are the
supervisor's own: a 30-minute deadline, 50 GiB minimum free space, a 4 GiB
`.reader/` budget, 4 GiB RSS and 16 MiB of output. The supervisor copies whatever
Codex output is available, up to 64 KiB per read, so events reach `events.jsonl`
as Codex prints them. See `docs/inbox-runner.md` in the vault for the runner's
contract and recovery.

### Activity transcript

The run panel shows the librarian's work as a transcript built from shadcn's AI
Elements, Base UI variants. These are recipes, not packages: they compose the
registry items `trace`, `message`, `marker`, `hover-card`, `code-block`,
`collapsible`, `button` and `progress`, all added with `npx shadcn@4.22.1 add` and
depending only on Base UI, `cn` and Lucide. The docs' demos import the Vercel AI SDK
(`ai`, `@ai-sdk/react`) and suggest Streamdown for Markdown; Reader uses neither.
Agent messages render through the app's markdown-it and DOMPurify path, and all
other text renders as text.

`web/src/activity/reducer.ts` maps each Codex `exec --json` event to a neutral
`AgentEvent` and folds events into transcript items. Other producers can map their
own streams to `AgentEvent` and reuse the reducer and `ActivityTranscript`.

| Codex event (0.163.0) | Shown as |
| --- | --- |
| `item.*` `agent_message` | **Message** "Librarian", sanitized Markdown; headings are scaled to the transcript (a report's `# Title` is 17px, as in the report view). Vault paths it mentions (`library/…`, `inbox/…` documents) become **Inline Citation** chips: a hover card with the path and an Open button. |
| `reasoning` | **Reasoning**: "Thinking…", then "Thought" (with seconds when both ends were seen live), collapsed. |
| `command_execution` | **Tool** line: "Ran `cmd`", "Running `cmd`" with a spinner, or "`cmd` exited with code N". The `/bin/zsh -lc '…'` wrapper is removed from the title. Its body is the full command and a **Terminal** (Code Block) with the last 200 lines and **Show all N lines**. Failed commands open by themselves. |
| pytest or `node --test` output | **Test Results** inside the tool: passed, failed and skipped counts from pytest's final summary line or node's `ℹ pass`/`ℹ fail` lines, with failing test names. Other output stays a Terminal. |
| `file_change` | **File Tree**: added, modified and deleted paths by folder, single-child folders joined. `library/` and `inbox/` files open in the reader. |
| `todo_list` | **Plan** with checkmarks, updated in place. |
| `mcp_tool_call` | **Tool** "Called `server.tool`" with arguments and result or error. |
| `web_search` | **Sources**: queries and any page URLs Codex reports (links open in a new tab). |
| `collab_tool_call` | **Subagent** line with its prompt. |
| `error` (top level or item) | A muted warning line, "Codex: …" (Codex reports retries this way). |
| `turn.failed`, or a failed or interrupted run | **Stack Trace**: the message and the last 8 KiB of `stderr.log`. |
| `git commit` output `[branch abc1234] subject`, or the report's verified commit | **Checkpoint** marker "Committed abc1234 · subject" with a **Report** button. |
| `turn.completed` usage | **Context** hover card: tokens in and out, cached share, elapsed time. It sits in the header while live and closes the transcript when the run ends. |

Above the log, a **Chain of Thought** step line ("Step 2 of 3: File the documents")
follows the agent's own plan when it wrote one. Otherwise it infers six intake
stages from commands and changed paths: reading arrivals, filing, reading copies,
catalog, validation and commit. Patterns require an argument after the word, so a
grep pattern such as `'intake|reading-copy'` does not count as doing the work.
The inference is a heuristic, not a record of what the librarian completed. The
**Queue** lists the run's arrivals by receipt title. An arrival is marked filed when
a changed `library/` path names it, and, once the run ends, when the runner no
longer finds it in the inbox.

The log is a `role="log"` region with polite live updates. It follows the newest
item; scrolling up shows **Jump to latest**. With focus in the log, `j` and `k`
move between items and Enter opens one. Spinners have text equivalents. At phone
width each tool is one truncated line. The transcript is page decoration
(`data-reader-decoration`).

While a run is live the page polls `GET /api/inbox/events?after=OFFSET` every
second. It fetches further pages immediately while a response ends before the
stream's size, and stops when the response says `done`. A finished run is read
once when the Models page opens. Durations are measured from when the browser
received events, so a transcript loaded after the run shows none. Only the latest
run exists, because the supervisor keeps one runtime directory.

### Article prompts and coding jobs

An article can carry a self-contained repair prompt that a reader may run as a coding job (RW-44). In
plain Markdown, Obsidian and any other reader it stays an ordinary, copyable code block; Reader shows it as a
prompt card. The format is two HTML comments around one `text` fence:

````markdown
<!-- reader:prompt {"v":1,"id":"bound-parser-depth","title":"Bound parser nesting","repo":"owner/name","issue":277} -->

```text
Check the current state of issue #277 before changing anything. …
```

<!-- /reader:prompt -->
````

| Field | Contract |
| --- | --- |
| `v` | The integer `1`. Another version stays ordinary code. |
| `id` | 1–64 lowercase ASCII letters, digits and hyphens, unique in the document. |
| `title` | Plain text, at most 160 code points. |
| `repo` | A GitHub `owner/name`, resolved only through the local repository registry. |
| `issue` | A positive issue number in that repository, or `null`: Reader creates one if the finding is confirmed. |

The metadata is a flat JSON object of at most 2 KiB (strings, integers and `null`; no duplicate keys, no
other fields); the prompt is at most 32 KiB. The structure is read from markdown-it's block tokens before
sanitizing, never from rendered HTML: a top-level opener at column 0, then exactly one top-level `text` fence
at column 0, then the close marker, with only blank lines between. Markers inside fences, display math, lists,
quotes, other HTML or a wrapper that is already open, duplicate IDs, malformed or oversized metadata and unknown
fields leave the block as ordinary code. The server parses the same tokens with markdown-it-py and Reader's math
rule (`src/reader_mcp/prompt_blocks.py`; the browser's copy is `web_ui/prompt-blocks.mjs`), and
`tests/fixtures/prompt-blocks/agreement.json` records 700 generated documents on which both must agree. A valid
block renders inside a wrapper carrying a nonce made fresh for every render; cards mount only on wrappers with
that nonce, so raw HTML in an article cannot make one. Embedded documents, chat and the scratch pad show prompt
blocks as code.

**The card** shows the title, the repository, the issue (or *Create issue*), the prompt in an editor, **Copy**,
the coding agent and **Run → PR**, and states what a run will do before it starts: a new branch from the
registered base, the issue it links or creates, and a pull request opened only after verification. Editing
makes a run-local revision; the article is never rewritten (**Reset** restores the author's text). Typing stays
in the editor and Escape leaves it. Opening, hovering, expanding, searching or restoring the article never starts
anything: the card only reads `GET /api/jobs/actions`. An unregistered repository, a missing agent, another
server owning jobs, a past edition, an inbox preview and the static demo each keep the card readable and copyable
and say why it cannot run. After **Run → PR** the card shows the run's status, phase, **Stop**, its GitHub links
and an on-demand trace that opens by itself when a check fails; earlier runs of the block are listed below it.

**The workflow** is server-owned (`coding_jobs.py`, `coding_workflow.py`, `coding_publish.py`), one job at a time
per vault, by the one Reader server that holds `.reader/coding-jobs/supervisor.lock`:

1. *Admit.* `POST /api/jobs {"action":"submit","request_id","path","sha256","block_id","prompt","agent","predecessor"?}`.
   Reader re-reads the article, checks its SHA-256 (a changed article is refused as `stale`), parses it, finds the
   block and its registered repository, and archives the exact original and submitted prompts before any work.
   The same request UUID with the same input returns the same run (`duplicate: true`); with different input it is
   a 409 conflict, never an edit or a rerun. A rerun names its `predecessor`, a finished run of the same article and block
   (another is a 409), and reuses its verified issue.
2. *Preflight.* Registry identity (the checkout's remote and any push URL must be `github.com/owner/name`), the
   agent executable, the verification command (a bare name such as `python3` is resolved on Reader's `PATH`),
   the verification guard, free space for the archive and the worktree folder, GitHub login
   and push access through `gh`, the supplied issue (it must be an issue, not a pull request, in that repository),
   the base branch on the remote, and that the job's branch exists nowhere. Any refusal ends the run `blocked`.
3. *Isolate.* Fetch the base, pin its SHA and `git worktree add -b reader/<id>-<run> <root>/reader-<run-id> <sha>`
   (under the repository's `.git/` git-locks key when git-locks is installed). The user's checkout, its dirty files
   and its index are untouched; an existing branch or folder is never reused or reset.
4. *Agent.* The coding CLI runs in the worktree with Reader's fixed argv (Codex: `exec --cd <worktree> --sandbox
   <mode> --add-dir <git common dir>`; Claude Code: `-p --output-format stream-json --permission-mode <mode>`), the
   job brief and the prompt on stdin, in its own process group with time, memory, free-space and output limits.
   It investigates, edits and commits, and ends with a `reader-result` block: `implemented`, `already_fixed`
   or `blocked`, with a summary, evidence and issue/PR drafts. Reader checks the claim: the branch, a clean
   tree, ancestry from the pinned base, the commits and changed paths.
5. *Issue.* The verified supplied issue, or one Reader creates from the confirmed task with a
   `reader-run:<run-id>` marker and reads back. No article text, vault path or archive goes to GitHub.
6. *Verify.* The registry's command runs in the worktree, without a shell, under its git-locks keys when configured.
   A nonzero exit, a moved head or a dirty tree publishes nothing.
7. *Publish.* A create-only `git push --force-with-lease=refs/heads/<branch>: <remote> <verified sha>:refs/heads/<branch>`
   (the empty lease refuses a branch that already exists, so nothing is overwritten or fast-forwarded), the remote
   SHA read back, then a pull request with `Closes #N` and the marker, read back for repository, base, branch, head
   SHA and issue. Only then is the outcome **PR opened**. Nothing is merged.

Outcomes are `pr_opened`, `already_fixed`, `blocked`, `failed`, `cancelled`, `interrupted` and
`needs_reconciliation`; phases (`queued`, `preflight`, `worktree`, `agent`, `issue`, `verify`, `push`,
`pull_request`) are separate. A create request without a readable answer is reconciled by the marker (issues) or
the branch (pull requests), never repeated; when GitHub cannot settle it the run ends `needs_reconciliation`. A
remote branch that already exists at another commit (an agent that pushed by itself) is reconciled the same way.
**Stop** kills the owned process group; completed pushes and created issues stay recorded. Worktrees and branches
are kept after every outcome. A restart never relaunches an agent: unfinished runs are reconciled (a process group
the previous server left running is stopped when its recorded start time matches), pending creations are looked up,
and the run ends `interrupted`, `pr_opened` or `needs_reconciliation`; until an owner reconciles it, every view
already shows an unowned run as interrupted.

**Executor boundary.** A worktree isolates Git changes, not the filesystem, build caches or credentials. The
agent runs with the user's environment and the registry's permission mode; a CLI that keeps GitHub credentials
could publish by itself, so "do not push or open issues" in the brief is a cooperative rule, and the workflow
reconciles the remote before publishing instead of assuming it is untouched. The repository's own guarded
workflow and the configured verification command remain the resource and quality policy.

**Repository registry.** `<vault>/.reader/repositories.json` (schema 1) maps `owner/name` to `checkout`,
`remote`, `base`, `worktree_root` (outside the checkout and the vault), `agents` (`codex`, `claude`), optional
`executables` and `agent_modes` (Codex `workspace-write` or `danger-full-access`; Claude Code `acceptEdits` or
`bypassPermissions`), `agent_timeout_seconds` and `verify` (`argv`, `timeout_seconds`, optional `lock` with a
git-locks `store` and `keys`). A configured lock without git-locks installed blocks the job rather than running
the check unguarded. `GET /api/repositories?check=1` shows the registry with Git identity problems and host folders
as `~/…`; `POST /api/repositories` registers (after the identity check), removes or checks, from this Mac only.
No credential is stored: GitHub access is the `gh` login.

**Trace and archive.** Every run is archived under `logs/llm/coding-job/YYYY/MM/DD/<run-id>/` and kept forever:
`meta.json`, `request.json`, `prompt.txt`, `system.txt`, `stdout.jsonl`, `stderr.log`, `events.jsonl`,
`verify.log`, `git.log`, `last-message.md` and `result.json`, streamed as `.partial` and gzipped with sizes and
SHA-256 by `RunLog.finish()`, including failed, cancelled and interrupted runs. `meta.json` pins the source SHA,
block ID, prompt SHAs, repository, base and head SHAs, branch and worktree, issue and pull request, tool versions
and the outcome. All output a run produces counts against a 64 MiB budget; a full budget or a failed archive write
stops the process group and fails the run before any publication. `events.jsonl` holds the normalized events,
each with the run ID, a sequence number and a timestamp: phases, Reader's own steps (Git, checks, publication),
the agent's recognized CLI events, changed files, commits, GitHub results and the outcome. Unrecognized CLI output
stays in the raw logs only. The trace reuses the activity reducer and `ActivityTranscript` with job labels: phases
head the steps, Reader's steps and the agent's commands are Tool rows (failed ones open by themselves), GitHub
results are link rows.

`GET /api/jobs/stream?id=…&after=SEQ` is a Server-Sent Events stream: `hello` (the run), `event` frames with
`id: <seq>`, `ping` and `end`. The browser ignores frames at or below its cursor and fills a gap from
`GET /api/jobs/events?id=…&after=SEQ&limit=N` (memory while live, the archive otherwise, at most 512 KiB a page),
so a reload, the article and Reader Admin all show the same run. Other routes: `GET /api/jobs?repo=…&state=…&path=…&block=…&cursor=…`
(newest first, 50 a page), `GET /api/jobs/run?id=…`, `GET /api/jobs/artifact?id=…&name=…&limit=…` (bounded,
1 KiB–1 MiB, decompressed), `POST /api/jobs {"action":"stop","id"}`, and the LLM log inventory
`GET /api/logs?kind=…&cursor=…`, `/api/logs/run?path=…` and `/api/logs/artifact?path=…&name=…`, which page the
dated archive folders and read `meta.json` without decompressing anything. A second server answers job writes with
409 and shows runs read-only. None of these routes is exported to a static site.

**In Reader Admin** (RW-45's shell) the same runs have three sections: **Coding jobs** (`#admin/jobs`: filter by
repository, state and originating article; `#admin/jobs/<run-id>`: the shared job detail with its facts, trace,
Stop, commits, GitHub links and the archived artifacts as bounded previews with Copy and Download), **LLM logs**
(`#admin/logs`: every archived run of every kind, newest first, a page at a time; `#admin/logs/<kind>/<YYYY-MM-DD>/<run-id>`:
its metadata and artifacts) and **Repositories** (`#admin/repositories`: the registry with its identity checks, and
registration and removal from this Mac). The card's **Set up repository** and **Open in Reader Admin** go there.
In the static demo these sections say they need Reader.

### Reader Admin: Local model (any OpenAI-compatible server)

Reader Admin's **Models** page (`#admin/models`, after Voices) supervises a small work
queue for a model you run yourself: LM Studio, Ollama, llama.cpp's `llama-server`, or
any other server with an OpenAI-compatible API (vLLM, LocalAI, Jan and others). It suits bulk, private, judgment-light
language tasks. Outputs are suggestions labelled with their model; filing, catalog
writes and anything under a voice's name stay with the voices. Machine-written text
is a rebuildable cache and is never written into vault documents.

| Card | Shows | Controls |
| --- | --- | --- |
| Provider | Server preset, model, base URL, API key (only whether one is saved, and where), the remote opt-in, and a *This machine only* / *Leaves this machine* badge | **Save provider**, **Remove saved key** |
| *Provider* server, for LM Studio | State badge (Not installed, Server off, Starting…, Ready · *n* models loaded, Busy, Error with the CLI's message), CLI found or missing, port, loaded models and their memory, and every model on disk (`lms ls`) | **Start server** (`lms server start --port <port> --bind 127.0.0.1`), **Load** / **Unload** per model (`lms load <key> --yes --context-length 32768`, `lms unload <id>`), **Stop server…**, which asks for confirmation because other tools may share the server |
| *Provider* server, for any other provider | State badge (Not reachable, Ready · *n* models, Busy, Error with the server's message), base URL, port, and the models the server lists on `GET /v1/models`. When nothing answers: the command to start it yourself (`ollama serve`, `llama-server -m <model>.gguf --port 8080`) and a hint | — (Reader does not start, stop, load or unload other servers) |
| Now | The running item: task, title, path, model, elapsed time, tokens per second (LM Studio's reported rate when it sends one, otherwise measured from streamed tokens), token count and a streaming preview of the answer (or "Thinking…" with the reasoning tail). When idle, the last run's batch summary | **Pause queue** (finishes the current item first), **Cancel item** |
| Queue | Waiting items grouped by task, with counts ("Standfirsts · 142 waiting") and the next titles | **Run**, **Pause** and **Clear** per task; **Queue 20 recent** (the 20 newest eligible works; those already waiting or current count toward the 20, so repeating it adds nothing) and **Queue all** |
| Outputs in use | Per task: current, stale (source changed or gone) and cached counts, two marked samples, and cache size against its 256 MiB cap | **Remove *n* stale** |
| Recent | The last 50 finished items with outcome (done, rejected by validation, failed, cancelled), duration and model. Opening one shows the prompt version, source, rate, the output and why it was rejected | — |
| Tasks | Per task: enabled, model, trigger (on request; nightly and idle triggers are not available yet), and the search-embeddings backend | **Save task settings** |

Every piece of machine-written text carries a small `local model · <model>` mark
(`data-reader-decoration`, rendered as text, never HTML). The page polls
`/api/local-model` every second while an item or a server action runs and every six
seconds otherwise, only while Reader Admin's Models page is on screen and the tab is visible.
The global watcher (`/api/maintenance`, which carries a `local_model` summary without
probing LM Studio) shows one toast per run: a loading toast at start, then success
("Standfirsts: 20 done, 2 rejected"), failure, or a warning when the server stopped
while the queue was running. Items never toast individually.

**Providers.** A provider is a base URL ending in the API's version path (`/v1`);
Reader calls `GET <base>/models`, `POST <base>/chat/completions` and
`POST <base>/embeddings` on it. Presets fill the URL:

| Preset | Default base URL | Server control |
| --- | --- | --- |
| LM Studio (the default) | `http://127.0.0.1:1234/v1`, or `READER_LMSTUDIO_URL` | Start/stop and load/unload through `lms`, model state from `/api/v0/models` |
| Ollama | `http://127.0.0.1:11434/v1` | Start it yourself (`ollama serve`, `ollama pull <model>`); Ollama loads models on request |
| llama.cpp | `http://127.0.0.1:8080/v1` | Start it yourself (`llama-server -m <model>.gguf --port 8080`; add `--embeddings` for embeddings) |
| Other OpenAI-compatible server | none: enter its URL | Start it yourself |

Choosing a preset resets the URL to that preset's default; a saved URL equal to the
default is stored as "the preset's default" (`null`). A URL without a path means
`/v1`. Model discovery is `GET /v1/models`: Reader accepts the OpenAI shape
(`data[].id`) and llama.cpp's `models[].model|name`, skips rows without an id, and
treats names containing `embed`, `bge`, `minilm` or `e5-` as embedding models (the
API has no type field). The **Model** field suggests the discovered names and accepts
any name. Each task's model is either a specific model or *Provider model*, the
default for new installs; existing explicit task models keep working. Enqueueing
with no model anywhere is refused.

The chat client streams (`stream: true`, `stream_options.include_usage`) and accepts
what different servers send: `content` with reasoning in `reasoning_content` (LM
Studio, llama.cpp) or `reasoning` (Ollama), role-only and `content: null` chunks,
`:` keep-alive comments, a usage chunk with no choices, a rate from LM Studio's
`stats.tokens_per_second` or llama.cpp's `timings.predicted_per_second` (otherwise
measured from streamed tokens), and a plain JSON completion from a server that
ignores `stream` (a missing `finish_reason` with text counts as `stop`). An error
event in the stream fails the item with its message; a stream that ends before any
`finish_reason` or `[DONE]` counts as the server stopping. Error bodies in the
OpenAI shape (`{"error": {"message"}}`) or Ollama's are shown as the item's error; a
401 or 403 adds *check the API key*. Embedding rows without `index` are taken in
input order, and a 404 on `/embeddings` says that llama.cpp needs `--embeddings`.

**Loopback by default; the remote opt-in.** A base URL whose host is not
127.0.0.0/8, `::1` or `localhost` is refused unless **Allow a server on another
machine** is on in the same save. With it on and a non-loopback URL saved, a notice
heads the section (*Text leaves this machine. Document text and prompts are sent to
<host>. They leave this machine*, plus *unencrypted over http* for `http`), the
Provider badge reads *Leaves this machine*, and the embeddings setting notes that
search queries go there too. Turning the opt-in off while a remote URL is saved is
refused. A settings file edited by hand to name a remote URL without the opt-in is
refused when used (server state *Refused*). `READER_LMSTUDIO_URL` and the built-in
default can never be remote: a non-loopback value is refused at startup. URLs are
`http` or `https`, with no credentials, query or fragment, and at most six plain path
segments. The workstation GPU lock is taken only for loopback providers.

**API key.** Optional, sent as `Authorization: Bearer <key>`. `READER_LLM_API_KEY`
wins; otherwise the key is saved to `.reader/local-model/api-key` (mode 0600,
written atomically, never a symlink). When the vault is a git repository, saving is
refused unless `git check-ignore` confirms that file is ignored. The key is never in
`settings.json`, `/api/local-model`, the page or a log: status reports only
`{set, source: "file"|"environment"|null}`, and the key is replaced by `<redacted>`
in any error message a server echoes. Saving an empty key or **Remove saved key**
deletes the file. Changing the provider is refused while the queue runs.

**Queue and worker.** Enqueueing skips works already waiting and works with a cached
output for the same source hash, model and prompt version. Recent works come first.
Queued items wait until you press **Run**. One worker thread in the web server runs
one item at a time, in batches of up to ten items that share a model. It holds the
workstation `host/gpu/` git-locks key (lease 1,500 s, waiting up to 10 minutes) per
batch against a loopback provider, so other GPU users interleave; a remote provider
takes no lock. Without git-locks or a workstation store it holds `.reader/gpu.lock`
instead, which coordinates only this Reader's processes; the card then says *GPU
coordination: This Reader only* ([Companions](#reader-admin-companions)). A
configured store that is not a Git directory, or a store error, fails closed. For LM Studio only, before a batch Reader loads the batch's model if nothing
equivalent is loaded, keeps at most one model it loaded itself, and unloads that one
when the run ends. A model the user loaded stays loaded. If the server stops
mid-item, the item fails, the queue pauses and the warning toast appears. When the
web server shuts down, the in-flight request is cancelled and its item returns to
the queue. The journal survives restarts.

**Run logs.** Every batch that asks the model anything is archived forever, like a
chat turn, at `logs/llm/local-model/YYYY/MM/DD/<run id>-b<batch>/` (see [LLM
logs](#llm-logs)), and no batch starts while free disk is below the 50 GiB reserve:
**Run** is refused with *Reader refuses to start LLM runs while free disk space is
below 50 GiB*, and a run that reaches the reserve between batches stops as failed
with that message, its remaining items still waiting. A batch's directory holds:

- `request-template.json`: the method, the path relative to the base URL
  (`/chat/completions`), the `Accept` and `Content-Type` headers, the body without
  its messages (model, `stream`, `temperature`, `max_tokens`, `stream_options`) and
  whether an API key was sent.
- Per item, `item-NN-request.json` (item id, task, path, title, source SHA-256,
  model, prompt version, whether the source was truncated, and the exact messages)
  and `item-NN-response.json` (outcome and error, the answer and reasoning text,
  finish reason, usage, tokens and rate, seconds, and the accepted output; for a
  failed or cancelled request, whatever had streamed, marked `partial`).
- `meta.json`: the worker run id and batch number, provider preset and label, the
  base URL's **host only** and whether it is loopback, whether an API key was sent,
  model, prompt versions, per-item outcomes, counts and the batch outcome (`done`,
  `failed` with the error, or `interrupted` when Reader stopped).

The API key and the `Authorization` header never reach the archive: the template
omits credentials, and the key is replaced by `<redacted>` in anything a server
echoes. When the batch ends its directory is sealed (gzip) and committed on its own
with the subject `Log local model: <tasks> (<n> items)` and a `Reader-Log:
local-model/<run id>-b<batch>` trailer. A batch Reader stops is sealed `interrupted`
(after a crash, at the next start, and then committed with the next batch's log), and
a log whose commit failed is retried with the next one. Recent items
carry their log path (`log`) and each run its `logs` and last `commit` result.

**Tasks.**

| Task | Prompt version | Accepted output |
| --- | --- | --- |
| Standfirsts | `standfirst-v1` | At most 2 sentences and 60 words, no preamble or Markdown. Every number and quoted phrase must occur in the source, and so must every capitalized word that is not sentence-initial (acronyms and mixed-case names count anywhere). Works with an authored `standfirst` and non-text originals are skipped. |
| Key terms | `keyterms-v1` | A JSON array (or list) of 4–7 distinct terms of at most six words, each occurring in the source |

Reasoning models' `<think>` blocks and `reasoning_content` are never part of the
output. Rejections are recorded with their reason and the raw answer, and are not
cached.

**Consumers.** `LocalModel.standfirst(path, sha256)` returns the cached standfirst
that is current for that exact source digest (preferring the configured model and
prompt version) as `{standfirst, source: "local-model", model, prompt_version,
created_at}`, or `None`. The magazine's `/api/standfirst` consults it after an
authored frontmatter `standfirst` and before the opening paragraph, and the cover
marks those standfirsts `local model · <model>` (see Standfirsts above). A changed
source makes the output stale, so the opening paragraph returns until the work is
queued and run again.

**Search embeddings backend.** The Tasks card's *Search embeddings* setting is
`fastembed` (bge-small, the default) or `openai:<embedding model>`, served by the
configured provider. The older `lmstudio:<model>` spelling also uses the configured
provider and keeps its original signature, so existing indexes stay valid. The
backend identity is the index's `model` and embedding signature (for `openai:` the
signature includes the provider's base URL), so switching model or server re-embeds
every passage at the next **Rebuild with embeddings**; a keywords-only rebuild after
a switch is refused. With a provider backend, semantic search needs the server
running with that model, and nomic models get their `search_document:` /
`search_query:` prefixes.

**Limits and safety.** `READER_LMSTUDIO_URL` (default `http://127.0.0.1:1234/v1`; a
bare origin means its `/v1`) must be on 127.0.0.0/8, localhost or ::1; anything else
is refused at startup. Other providers follow the loopback rule above.
`lms` resolves from `READER_LMS` (no fallback when set), then `PATH`, then
`~/.lmstudio/bin/lms`, and runs with explicit argv, no shell, closed stdin, captured
output and a 60-second timeout (180 s for a load). Sources over 4 MiB are skipped.
Prompts carry at most about 24k tokens of source (96,000 characters), truncated at a
heading boundary. Each answer is capped at 1,024 visible tokens plus 3,072 reasoning
tokens, and each item times out after 120 seconds. The queue holds at most 5,000
waiting or running items. The output cache (SQLite `max_page_count`) is capped at
256 MiB, and work stops when `.reader/` exceeds its 4 GiB data budget; both are
checked before each batch. Documents are set off by `<document>` delimiters, with
any delimiters inside them defused, and the system prompt says never to follow
instructions inside them.

**Storage and recovery.** Everything lives in `.reader/local-model/`:
`api-key` (only when a key is saved; see above), `queue.jsonl` (an append-only journal of item states, compacted atomically when it
doubles; it keeps the last 200 finished items), `outputs.sqlite3` (key `(task,
source_sha256, model, prompt_version)`, with path, output and timestamp) and
`settings.json` (tasks, embeddings backend and `provider: {preset, base_url, model,
allow_remote}`). They are rebuildable: deleting the folder clears the queue, cached
outputs, task and provider settings and the saved key, and nothing else. A torn final journal line is
ignored. A journal over 32 MiB is refused with a message.

When the app runs from a checkout that has `scripts/reader_service.py`, a
**Service** section right after Indexes holds the **Server** card, fed by `GET /api/service`
(polled every 10 seconds on the page, every 2 seconds while an update or restart is
pending). It shows the running commit with its date and subject, the source branch,
the last update and its outcome, the next scheduled check, the Tailscale address
(a link when `tailscale serve` is on) and who you are signed in as: your tailnet
login through Tailscale, or *This Mac (local)*. **Update now** shows a loading toast
until the updater records an outcome (success, rollback, smoke failure, or a
waiting notice while an inbox run or rebuild is active). **Restart** shows a toast
until the server's start time changes. **Pause updates** / **Resume updates**
toggle scheduled updates. Without an installed service the card says so and its
buttons are disabled.

### Reader Admin: Companions

Reader works without each of its companion projects. **Companions**, on Reader
Admin's Service & tools page below Service, shows what each adds, whether it is present and how
to set it up:

| Companion | Adds | Setup from Reader |
| --- | --- | --- |
| [AI-TTS](https://github.com/flyingrobots/AI-TTS) | Read aloud (Space s) | Guided: its README commands with **Copy**; **Start…** when installed but its daemon is not answering |
| [Colorful Language](https://github.com/flyingrobots/colorful-language) | Prose colors (Space c) | **Install** / **Update**: builds the pinned 0.4.0 release (`61d0aa8`) |
| [wide-md](https://github.com/flyingrobots/wide-md) | Reading copies (`reader reading-copy`) | **Install** / **Reinstall**: runs `scripts/install_wide_md.py` |
| [git-locks](https://github.com/git-stunts/locks) | Coordination with other tools on this Mac | Guided: its README commands with **Copy** |

Each card shows a state (*Installed*, *Not found*, *Too old* or *Needs reinstall*,
*Daemon not running*, *Error*), the version, path and how it was found, its repository,
and the actions **Check again** and, for Colorful and git-locks, **Set path**. A card
whose install needs something missing says so: without `cargo` the Colorful and wide-md
cards explain how to get Rust (rustup.rs) instead of offering Install. An *Agents and
models* card lists the `claude`, `codex` and `agy` command lines (found path, shown as `~/…`, or *Not
found*, and the voices that use each; status only, since they need your own account)
and the current **GPU coordination** (below).

**The not-installed prompt.** A feature whose companion is missing never fails
silently and never shows an error toast for it. Space s (and the footer and selection
**Speak** buttons) without a running AI-TTS daemon, and Space c without a usable
Colorful, show one calm toast that names the feature and the companion, says what it
adds and links its repository, with **Install** where Reader can install it safely
(Colorful), **Start…** for an installed but stopped AI-TTS, otherwise **How to install**
(which opens its card with the commands showing), and **Don't show again**. Dismissal
is per companion in the browser (`localStorage` `reader.companions.dismissed.v1`);
afterwards the feature still says what is missing in one line.

**Installs.** Install, Update and Start run as maintenance jobs (one at a time; another
job or install is refused with 429), announced with a loading toast that follows each
step and a finished or failed toast, listed in Recent runs, with the log under the card
(**Install log**, the last 16 KiB of a log capped at 1 MiB in
`.reader/tooling/logs/<name>.log`). In the card, Install and Start first list what
will change; nothing uses sudo, and the sources are pinned constants: no request
names a URL or revision.

- *Colorful Language* clones `https://github.com/flyingrobots/colorful-language` into
  `<vault>/.reader/tooling/colorful-language` (or fetches an existing clone, refusing
  one with another origin or local edits), checks out the pinned commit and verifies
  `HEAD`, then runs `cargo build --locked --release -p colorful-cli --jobs 2` with
  `CARGO_TARGET_DIR=.reader/tooling/colorful-target` and `CARGO_INCREMENTAL=0`. The
  binary is copied to `.reader/tooling/bin/colorful`, must report 0.4.0 or newer, and
  its path is recorded in `.reader/companions.json`; `.reader/tooling/colorful.json`
  keeps the revision and SHA-256. Clone and fetch time out after 10 minutes, the build
  after 35. **Update** appears when the Reader-built copy is at another revision.
- *wide-md* runs `python scripts/install_wide_md.py` with `READER_ROOT` set to the
  vault (15-minute timeout); the script keeps its own pinned revision, lock, disk,
  memory and time limits ([reading copies](reading-copies.md)).
- *AI-TTS* is never installed by Reader: its installer builds a signed app and
  registers launch agents. When its CLI or launch agent
  (`~/Library/LaunchAgents/com.flyingrobots.ai-tts.plist`) is present but the socket
  does not answer, **Start…** runs `launchctl bootstrap gui/<uid> <plist>` (or
  `launchctl kickstart gui/<uid>/com.flyingrobots.ai-tts` when already loaded) and
  waits up to 20 s for the daemon.
- Rust builds take the workstation `host/heavy-work` key (`git-locks with`, lease
  2,400 s, waiting up to 10 minutes) when git-locks and a workstation store are present.
- An install needs 5 GiB of free disk and the tooling folder's `setup.lock`, shared
  with `install_wide_md.py`; each step runs with explicit argv in its own process group,
  killed at its timeout.

**Set path** accepts an absolute path, or one in the display form the card shows
(`~/…` or `<vault>/…`): for Colorful, an executable reporting 0.4.0 or
newer; for git-locks, the `git-locks` executable or a store (a Git directory ending in
`.git`). An empty path clears the setting. Paths are stored in `.reader/companions.json`
and only a browser on this Mac (a local request) may set them, since the server runs
the executable; allowed tailnet logins may check, install and start.

**Finding companions.** Colorful: `READER_COLORFUL`, the path set here, Reader's own
build, `PATH`, `~/.cargo/bin` and `~/.colorful-language/bin`. git-locks:
`READER_GIT_LOCKS` (a path, or `none` to hide it), the path set here, `PATH`, then
`~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`;
`READER_GIT_LOCKS_CANDIDATES` (folders separated by `:`, may be empty) replaces those
three folders. AI-TTS: its socket (`AI_TTS_SOCKET`, `AI_TTS_HOME` or
`~/Library/Application Support/ai-tts/ai-tts.sock`), the `ai-tts` CLI on `PATH` or in
`~/.local/bin`, and its launch agent. `cargo` and `git` come from `PATH`
(`~/.cargo/bin/cargo` and `/usr/bin/git` as fallbacks). The *Agents and models* card
looks `claude`, `codex` and `agy` up the way voices resolve them: `PATH`, then
`~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`, where `READER_CLI_CANDIDATES`
(folders separated by `:`, may be empty) replaces those three folders. Every probe uses
the environment Companions was given, so a test fixture never reports this Mac's tools.

**Without git-locks.** Reader keeps working; it then coordinates only its own processes:

| Caller | With git-locks | Without |
| --- | --- | --- |
| Chat and scratch pad commits | `git locks with … .git/` in the vault repository's default store | `.reader/chat-commit.lock` flock |
| Local model batches (loopback provider) | `host/gpu/` in the workstation store | `.reader/gpu.lock` flock (*GPU coordination: This Reader only*) |
| Companion Rust builds | `host/heavy-work` in the workstation store | No host lock |
| Inbox runner sandbox paths | Adds the store `git-locks store` reports | Git metadata only |
| `scripts/reader_service.py` Git changes | `.git/` key | `~/Library/Application Support/Reader/git.lock` flock |

The workstation store for host keys is, in order, `READER_GIT_LOCKS_STORE`, the store set
here and `GIT_LOCKS_STORE`; there is no built-in default.
A store that is chosen explicitly but is not a Git directory, or a git-locks store
error, fails closed (the batch or build stops with the reason); a missing git-locks or
no store at all falls back. Repository `.git/` keys never use `GIT_LOCKS_STORE`: it is
removed from their environment, because it names the host store.

**Routes.** `GET /api/companions` (optional `?name=ai-tts|colorful|wide-md|git-locks`)
returns `{companions: [{name, title, repo, feature, keys, enables, state, label,
version, path, origin, message, actions, install, start, guide, facts, job,
coordination}], cli, local_model, checked_at}`. `GET /api/companions/log?name=` returns
the log tail. `POST /api/companions` takes exactly `{"action": "check" | "install" |
"update" | "start" | "set-path", "name": ..., "path"?}`; install, update and start
return the maintenance job, which `GET /api/maintenance` then reports with a
`progress` line. `POST /api/maintenance` refuses the companion job kinds
(`install-colorful`, `update-colorful`, `install-wide-md`, `update-wide-md`,
`start-ai-tts`). All POSTs need the same-origin `X-Reader-Token`; a companion job does
not re-run the index freshness check.

### Read next

When a document finishes loading, Reader asks `/api/next` for up to three works
to read next and shows them in a **Read next** aside after the article:

1. **Related pool.** The 12 most related works in the grouped work inventory.
   Relatedness is the cosine similarity of the mean chunk embeddings of each
   work's primary source, from the existing search index, plus 0.03 for each
   shared project or topic. Works without embeddings match on shared projects and
   topics alone.
2. **Exclusions.** Another work with the same title before a trailing parenthetical
   is left out, as is any work whose text is near-identical (cosine ≥ 0.985):
   these are other editions, not new ideas.
3. **Order.** Unread works (for the current participant and current edition) come
   first, then the latest by date.
4. **Diversity.** A pick within cosine 0.97 of an earlier pick is skipped.
5. **Fill.** With fewer than three, the newest unread works fill the list as
   *New in the library*.

Each entry shows its title, an unread mark, author and date, and the reasons it
was chosen: *Similar ideas* and up to two shared projects/topics.

In continuous reading the aside sits between the article and its footer. In
two-page reading it is added to the end of the columns only when the spread count
does not grow, so it fills room left on the last spread (including an empty facing
page) and never adds a page. A window resize re-checks it: it is removed when the
new layout has no room and comes back when a later size does. It is
excluded from passage selection, find, bookmarks and the word count. Turn it off
with **Read next at the end of articles** in Settings. Suggestions are only as
good as the search index: on a vault where most text lacks embeddings, they rest
mostly on shared metadata until **Rebuild with embeddings** completes.

### Reading log

Under each document's title (Markdown, plain text, PDFs and images alike), one quiet
line says who has a read receipt for the document and when, for example
`◉ Agy today · ◐ Reader librarian (earlier edition) Oct 12 · ◉ You just now`.

- **Marks.** ◉ means the participant's receipt is for this exact edition (the
  SHA-256 of the current file). ◐ plus *(earlier edition)* means their receipt is
  for a different version of the same path, so a revision is never shown as
  already read.
- **Order.** Voices first, then you, then other agents, newest first within each
  group; at most four entries, then *+N more*. Times are relative within a week
  (*just now*, *12 min ago*, *today*, *yesterday*, *3 days ago*, by local day), then
  local dates; the title attribute holds the full local date and time with its zone.
- **Groups.** *You* is the requesting participant. *Voices* are the names in the
  vault's `voices.json` (`{"schema_version": 1, "voices": [{"name": …}, …]}`, at most
  64 KiB, not a symlink). A vault without `voices.json` has no voices: Reader
  ships no default roster. Names are matched exactly, so two identities that
  differ only by a suffix are separate participants with separate receipts.
  Everyone else is an *agent*.
- **Task agents.** An agent with fewer than 5 document receipts in the whole vault
  (`engagement.ONE_OFF_RECEIPTS`) is folded into one entry, *N task agents*;
  expanding it lists them by name. You and voices are never folded.
- **Expanded log.** The line is a keyboard-operable disclosure. It lists **Read
  this edition** and **Read an earlier edition**, each newest first. Participants
  without a receipt are not listed. A participant who owns or has commented on
  threads in the document gets an *N threads* link that opens the margins filtered
  to those threads. Earlier-edition rows carry `data-against="<sha256>"` for a
  later change view; no comparison is offered yet.
- **Empty and live state.** With no receipts the line reads *Not yet read by
  anyone. You'll be first.* Opening the document records your receipt as before
  (`/api/seen`), and the line then shows *You just now* without a reload.
- **Placement.** The line follows `.document-meta` and carries
  `data-reader-decoration`, so passage selection, annotations and find skip it. Its
  slot reserves one line before the response arrives, so the article does not move.
  In two-page reading (where the meta row is hidden) it stays in the first column
  under the title, on one line; at phone width it wraps.
- **Requests.** `/api/readers` is requested once per path, edition and participant
  per page session, in parallel with the discussion, and never delays the article.
  If it fails, the line says *Reading log unavailable*, the error is logged to the
  console and shown as a toast, and the document still opens.
- **Editions across files.** A receipt for another file of the same edition family
  (see Editions) that sorts before this one, such as `essay.md` for `essay.v2.md` or
  an original for its reading copy, counts as *(earlier edition)* when the
  participant has no receipt for this path (`WebLibrary.edition_paths`). A newer
  version never counts as earlier.
- **Privacy.** The log adds no data: receipts are local vault files committed with
  the vault. It does gather in one place who read what and when, so anyone who can
  open the vault can see each participant's reading times.

### Send to AI-TTS

Reader can hand the open document to the local AI-TTS
daemon, which speaks it through its own serialized playback queue. Reader never
plays audio itself, so AI-TTS holds, microphone interruption and other agents'
speech stay in force.

- **Entry points.** **Space s** opens a small menu: **Whole article** (`a`),
  **From here** (`f`) and **Selection** (`s`, enabled while a passage is
  selected). The document footer's **Send to AI-TTS** button sends the whole
  article (the footer is hidden in two-page reading; use Space s there). The
  selection toolbar's **Speak** sends only the selected passage.
- **What is spoken.** Markdown sends its source after the frontmatter with
  `content_format: "markdown"`; the daemon segments and strips the markup. Plain
  text sends its text as `plain_text`. PDFs send the extracted text of their text
  layers as `plain_text`; a PDF with no text layer is refused. The title is spoken
  first as its own sentence unless the text already begins with it (as a source
  H1 does). Selections are not supported for PDFs.
- **From here** starts at the first source block at the reading position, using the
  same capture as bookmarks: the block at the reading line in continuous reading,
  the first block on the visible spread in two-page reading, the visible page for a
  PDF, and the character at the reading line for plain text.
- **Feedback.** A toast reports *Queued for AI-TTS.* with the utterance id, or
  *…it plays when the pause ends.* when AI-TTS reports a playback hold
  (submission is accepted during a hold). A missing or silent daemon shows the
  [not-installed prompt](#reader-admin-companions) (*Read aloud needs AI-TTS* or
  *AI-TTS isn't running*, with setup); a daemon refusal shows its own message.
- **Now playing.** The status line shows a speaker glyph and *Queued*, *Queued ·
  held*, *Preparing speech*, *Speaking · 3 of 41* or *Paused · …* with
  pause/resume, previous/next segment and skip. It polls the daemon every two
  seconds while the page is visible and disappears when the utterance is
  `Played`, `Skipped`, `Cancelled` or `Failed`; a failure becomes an error toast.
  At phone width it collapses to the glyph and pause/resume.

Pause, resume, skip and segment steps act on AI-TTS's current playback, so Reader
enables them, and the server forwards them, only while the utterance it submitted
is the one AI-TTS reports as current (a narrow race remains between that check
and the command). Skip on a queued utterance cancels it instead. Reader controls
only the most recent 50 utterances it submitted during this server's lifetime;
other agents' speech cannot be controlled from the page. Segment progress comes
from the daemon's `status.current.active_segment` (`number`, `count`) while the
utterance is current, otherwise from `get`'s `completed_segments` and
`segment_count`. The daemon does not report a segment's source span, so the
passage being spoken is not highlighted.

Speech is always submitted with `origin` and `source` set to `Reader` (one stable
voice assignment), `sensitivity: "confidential"` and `priority: "normal"`. The
socket is `AI_TTS_SOCKET`, else `$AI_TTS_HOME/ai-tts.sock`, else
`~/Library/Application Support/ai-tts/ai-tts.sock`; a symlinked or non-socket path
is refused. Limits: 512 KiB of UTF-8 text per submission (the AI-TTS Zed client's
limit; the message suggests From here or a selection), one request line of at most
1 MiB, one response line of at most 4 MiB (`get` and `status` echo the utterance
text JSON-escaped), a 5-second socket timeout, and PDFs of at most 64 MiB and 5,000
pages. Document text is only spoken, never executed or followed as instructions.

### Docked side panels

The right-hand panels — In the margins (and Linked from), Versions, the Locations,
Registers and Marks lists, the reading queue, Chat and What changed — dock beside
the page when the window is wide enough to keep a comfortable reading column beside
them. An open panel becomes a column
at the right edge, the full height of the window, with no shadow or backdrop. The
page gives up that width: the article recenters in what is left, and the status line,
the summon button, the smooth-scrolling and two-page wrappers, split view, the art hero
and margin pins stop at the column's edge, and the find bar centres on the page. The page stays
interactive: it scrolls, selects and opens links while the panel is open, and a click
on the page leaves a docked What changed open.

`web_ui/dock.mjs` is the one mechanism. It watches the panels' `hidden` attributes
(and the What changed Sheet's `data-side`), and while one is open it sets
`data-dock="right"` and `--dock-width` on the root; the layout rules in `style.css`
and `web/src/styles.css` consume them. Each panel declares its width as
`--panel-width` (410 px for the margins, Versions and lists, 420 px for the queue,
440 px for Chat, 520 px for What changed). Panels open together share the column: the
widest sets its width, every docked panel takes it, and the one opened last is on top.
Code that clamps to the window uses `pageWidth()` (the window less the dock).

A dock change keeps the reader's place. In continuous reading the block at the reading
line (22% down the window) is measured before the column narrows and scrolled back to
the same line after, as a jump held by `place.mjs`. The dock then sends a `resize`, so
two-page reading repaginates from its first visible character, and pins, the outline
rail and split panes lay out again (a rail that no longer fits left of the narrower page
gives way to the Outline button's popover until the dock closes). When less than 900 px remains beside the dock,
two-page reading shows one page, as a window that narrow would (`data-dock-narrow`).
The page moves in one step rather than animating, so the reflow measures the final width.

A panel docks when at least 690 px of window remains beside it (`DOCK_ROOM`): the
article column is 773 px (65ch at 21 px) inside 40 px gutters, and 690 px keeps a
610 px column, about 55 characters a line. That is from 1100 px for the 410 px panels,
1130 px for Chat and 1210 px for What changed; from about 1280 px the column keeps its
full width. Narrower windows keep the overlay: the panel covers the right of the page
with a shadow, and becomes a bottom sheet at phone width, as before. The Theme Editor
is a full-width modal editor and never docks.

### Document outline

Long documents show their headings beside the text. The outline is built in the
browser after a document renders; it needs no server route.

- **Markdown entries:** `h1`–`h6` elements that carry `data-source-start`. Headings
  inside embedded documents (`.document-embed`) and the generated title placeholder
  (used only when the source has no H1) are excluded: the outline is the open
  document's own structure, and each embed's header links to its source instead
  (see [Embeds](#embeds)). At most 500 headings are
  listed. H4–H6 are shown when the outline has at most 150 entries; beyond that
  only H1–H3 are shown, behind **Show all levels**.
- **Heading ids:** each heading without an id gets a GitHub-style slug (lowercase,
  punctuation removed, spaces to hyphens). A slug already used anywhere in the page,
  including Reader's own element ids, gets a `-1`, `-2`… suffix. Existing ids are
  kept, so `#fragment` links resolve to these ids.
- **PDF entries:** `pdf.getOutline()`, flattened to three levels. Each destination,
  explicit or named, is resolved to a page with `getDestination` and
  `getPageIndex`; at most 500 entries. Entries whose destination does not resolve
  are left out; their children are kept. A PDF without an outline offers none.

**Where it appears.**

| Situation | Outline |
| --- | --- |
| Continuous reading, room left of the article (at least 206 px) | A fixed rail, 150–240 px wide, left of the article |
| Two-page reading, or a window too narrow for the rail | A popover from the footer's **Outline** button, with page labels (`p. 7–8`) in two-page mode |
| Width 700 px or less | A bottom sheet from the **Outline** button |

The rail shows by default only for documents with at least three headings or more
than 1,500 words, and only while the **Outline beside long documents** setting is
on. **Space o** (or the **Outline** button) toggles the rail and saves the setting
on this device. Opening it on a shorter document pins it for that document. In the
popover and sheet modes, Space o opens and closes the panel without changing the
setting. The rail never takes column space, so two-page pagination, bookmarks and
the page turn are unchanged. In zen mode the rail fades until hovered or focused.
Blocks after the article (Read next, Linked from, the footer) are wider than the
article column and start at the document's content edge, so the rail ends 16 px
left of that edge as well as 48 px left of the article; a window too narrow for
that uses the popover. When a document fails to load
after its rail appeared, the rail and footer section title are cleared with the
article.

**Active section.** In continuous reading the active heading is the last one at or
above the reading line at 22 % of the viewport height, the same line bookmarks use.
Section progress is `(line − section top) / (next section top − section top)`. In
two-page reading a heading's spread is `floor((x + 2) / stride)`; the active heading
is the last on or before the current spread, and progress counts spreads. Both are
recomputed in the reading animation frame and on reflow. With smooth scrolling,
ScrollSmoother's own updates also drive that frame, so the label and rail settle
on the section shown after the eased scroll finishes rather than where window
scrolling stopped. After a jump, the target
stays active while its spread is showing (several headings can share a spread) or,
in continuous reading, when the target is too near the end to reach the line. The
active entry carries `aria-current="location"`, stays scrolled into view in the
rail, has a thin progress bar under it, and its title is shown in the footer next to
the position percentage.

**Moving.** Choosing an entry, `]]` (next heading) and `[[` (start of the current
section, then the previous heading) move with `reading.reveal()`; `]]` in the last
section stays put and says it is the last heading: two-page reading
turns to the spread (curl for one spread, slide otherwise), and continuous reading
scrolls the heading to the reading line with the smooth-scrolling setting. Both
keys are two-key sequences with the same 650 ms window as `gg`. In the popover and
sheet, `j`/`k`, arrows, Home and End move between entries, Enter chooses one, and
Escape closes. The rail is a `<nav aria-label="Document outline">` of links; focus
reaches it only with Tab or Space o, which focuses the active entry.

### Link previews and Linked from

**Previews.** Pausing about 350 ms over a local link in the article, or focusing it
with Tab, opens a small popover (`#link-preview`). It shows the target's project, title,
an unread mark for the current participant and edition, its authors, the heading a
`#fragment` names, and about 300 characters of plain text from that heading (or from
the top, after the title). Escape, moving away, scrolling or clicking closes it. An
external link shows only its host, and a link that does not resolve says *Not in the
library* with the reason. No preview opens while text is selected, during a page turn,
or for links in Read next, Linked from, margin threads or the side panel. At phone
width (640 px or less) the popover is a bottom sheet inside 16 px gutters. Previews are
cached per page load for up to 200 links. The excerpt is escaped plain text: Markdown
and HTML are stripped on the server and never rendered.

**Linked from.** After the article and before Read next, a `data-reader-decoration`
section lists the documents that link here, most links first: the title, the number of
links, and the heading of the first one. It shows 12 rows and a **Show all N** button
for the rest, up to 200. A row opens the citing document at that heading. Before the
graph exists the section says *Building the link graph…* and asks again until the
quiet first build finishes; with no links it says *No other library document links
here yet.*; when files changed since the last refresh, a note links to Behind the
scenes. In two-page reading the section is placed only when the spread count does
not grow. Otherwise a one-line **Linked from N documents** button takes its place (if
that fits) and opens the list in the side panel. Asides keep a stable order whichever
answer arrives first: Linked from, then Read next. Turn it off with **Linked from at
the end of articles** in Settings.

**Headings and fragments.** Rendered headings carry `data-heading-slug`: a GitHub-style
slug of their text (lowercased; characters other than letters, numbers, `_`, `-` and
spaces removed; spaces become `-`), with repeats numbered `-1`, `-2` in document order.
A link's `#fragment` opens at an element with that id, else the heading with that slug
or whose text slugs to it, as wikilinks write it (`[[note#Some heading]]`). The graph
computes the same slugs from source (`links.slug`) for ATX headings, setext headings
(the whole paragraph above `===` or `---`) and `<h1>`–`<h6>` in HTML, numbering repeats
across all of them, so the two agree. Links inside fenced, inline and indented code
blocks are not counted; an indented line that continues a list item or a paragraph is
not code. Headings inside other containers (block quotes, list items) are not slugged
by the graph.

**The link graph.** `reader_mcp.links.LinkGraph` keeps `.reader/links.sqlite3`, a
rebuildable cache that is never committed:

| Table | Holds |
| --- | --- |
| `files` | Every library file a reader could open: path, size, `mtime` (ns), SHA-256 and title of parsed Markdown, status (`parsed`, `path-only`, `file`, `unreadable`) |
| `links` | Resolved links: source, target, kind (`link`, `wikilink`, `embed`), target fragment, source heading and its slug (`anchor`), line, label, raw target, method (`path` or `name`) |
| `unresolved` | Links that do not resolve, with a reason: `missing`, `ambiguous` or `outside` (it leaves `library/`) |
| `settings` | Version, `built_at`, inventory fingerprint, counts |

- *Walk.* Same rules as the search indexer: no dot names, no symlinks, regular files
  up to 256 MiB. Only `.md` and `.markdown` files are parsed; frontmatter, fenced code
  and inline code are skipped. Recorded: `[text](target)` and reference definitions
  (`link`), `[[target#heading|label]]` (`wikilink`), and `![[target]]` and
  `![alt](image)` (`embed`). External, `mailto:` and same-page `#` targets, and
  footnotes, are not links.
- *Resolution.* `links.Resolver`, the same function `/api/resolve` uses for a click:
  the path relative to the source's folder (`library/…` and `/…` from the vault root),
  then with `.md` appended; then a unique work primary whose path ends with the
  target; then a unique library file whose path ends with it (a bare basename, as
  Obsidian resolves wikilinks). Percent-encoding and angle brackets are removed first,
  as the browser does.
- *Refresh.* A file is re-read only when its size or mtime changed; its rows are
  replaced. Deleted files drop their rows. When files are added or removed, or the
  work inventory changes, only unresolved rows, name-resolved rows and rows aimed at
  removed files are resolved again. The whole refresh is one transaction: a failure
  keeps the previous graph and is reported on Reader Admin.
- *Jobs.* The refresh is the `links` maintenance job. The first `/api/links` request
  on a vault without a graph starts it as a *quiet* job: no toasts, and only the Link
  graph card is re-checked afterwards. **Refresh** on the card is an ordinary job
  with toasts. `/api/links` reports `stale` from a freshness check cached for 30 s.
- *Bounds.* At most 100,000 library files listed, 10,000 Markdown files parsed (the
  rest are path-only), 4 MiB per parsed file, 500,000 link rows and a 256 MiB store
  (SQLite `max_page_count`), within the `.reader` budget.

The open question of catalog notes is not settled: a work's catalog note links to its
primary, so every catalogued work has inbound links. They count like any other link.

### Editions

A document's **edition family** is every file the vault links to it: the
original, reading copies, numbered versions and preserved originals. The
version chip and the version explorer (below) show the family; the original is
never hidden or replaced. Opening a sibling is normal navigation, so `h`
returns and bookmarks and receipts remain per path and edition.

`/api/editions?path=…` (`src/reader_mcp/editions.py`) builds families from what
the vault already records:

1. **Reading copies.** A file with `reading_source: <vault path>` and
   `kind: reading-copy` (or a `.reading.md` name). Its source may be any regular
   library file, such as a `.log`.
2. **Versions.** `previous_version:` is used as a vault path when it starts with
   `library/`. Otherwise it is resolved relative to the declaring file's folder,
   then the bundle root (the first two folders under `library/`). The
   `<stem>.vN.md` ↔ `<stem>.md` names in one folder also link versions. A
   version's number comes from `.vN.md`, then a `vN` folder name on a linked
   file, then `document_revision`, and otherwise 1.
3. **Preserved originals.** `…/original/<rel>` ↔ `…/<rel>` in the same bundle
   (labels *Preserved original* and *Filed copy*).
4. **Catalog notes.** `catalog/metadata/<library-relative path>.md`, or for a
   Markdown target that is missing, the note's `document_path` or `source`
   (including inside `original_frontmatter` / `original_metadata`). A catalog
   note describes a file and is not an edition: it is listed as *Catalog note*
   with its path but is not opened, since the reader serves only `library/`.

Roles are `original`, `reading-copy` and `version`. Members are ordered by
version number, then role, then path. When one edition is filed in two folders,
both entries name their folder. `newer` names the highest version when the
current file (or the version a reading copy was made from) is lower; a tie
prefers the current folder. Families are capped at 32 members; the rest are
counted in `more`. References that cannot be resolved, including those that
would leave `library/` or cross a symlink, are listed in `unresolved`, never
guessed. **Reader Admin → Indexes → Edition links** shows the family count, index
build time and every unresolved reference (`/api/editions/diagnostics`).

The index covers regular, non-hidden, non-symlinked Markdown under `library/` and
`catalog/metadata/`: at most 20,000 files, at most 8 KiB of each header (read
1 KiB at a time up to the closing delimiter) and 16 MiB of header bytes in all.
YAML is parsed only for headers that declare `reading_source` or
`previous_version`, and later for family members. If a limit is reached the
index is marked `partial`. It is held in memory and keyed by the
`(path, size, mtime_ns)` signature of those files. That signature is rechecked
at most every 60 s, so a new edition can take up to a minute to appear. Nothing
is written or repaired.

### Versions: the chip, its twin and the explorer

**The version chip.** Under the title meta, one bordered chip says which version
you are reading: `v1 of 3`, `Reading copy of v2`, `Reading copy of the
original`, `Original · 1 reading copy`, or, for a file without siblings whose
path has at least two commits in the vault's git history, `Current · 7
revisions`. Beside it, **Newer v3 available · Open v3 · Compare v1 → v3** when a
higher version exists (the chip's dot turns `--accent`), and **You read this on
Oct 16** (or **You read v2 on …**) when your receipt matches a family member's
current bytes. The chip replaces the frontmatter's "Edition N" meta item, which
still shows when there is no chip. A file with no siblings and at most one
commit shows nothing. The line is `data-reader-decoration` (excluded from
selection, find and word counts). The text never waits for `/api/versions` (a
cold `--follow` history lookup can take longer than rendering the document):
if the timeline is already here when the document is, the chip is part of the
first layout; otherwise the page renders without it, and once the reading
position is restored the chip line is inserted where it would have been (and
replaces "Edition N"), the status twin and the explorer fill in, and the reader
is kept on the same block (scroll offset, or the spread holding it in two-page
reading). Historical versions and inbox previews never get a chip.

**The status twin.** The status bar shows a compact twin of the chip: `v1/3`,
`copy`, `orig`, `7 rev`, or `@3f2a1c9` on a historical version. It is
`--accent` when a newer version exists and `--warning` on a historical version.
Clicking it opens the explorer.

**The explorer.** **Space v**, the chip or the twin opens a right-side panel
(the thread panel's frame; at ≤ 640 px a bottom sheet across the width). Its
timeline lists the family in edition order, each with date, author, tags
(*reading*, *you read Oct 16*, *newest*, *edited since last commit*) and small
reader dots (`--own` for you, `--other` for other participants) when a
participant's receipt matches that file's current bytes. Under each edition, a
collapsible **History** lists the commits that changed the file, newest first:
date, subject, short hash, *same as file* for the commit whose blob equals the
working copy, and reader dots when a receipt's SHA-256 matches that commit's
content. The rail marks ● where you are, ◐ what you last read and ★ the newest
version. The history of the edition you are on starts open. A catalog note is
listed as a note, not an edition.

Keys inside the panel: `j`/`k`, arrows, Home and End move between items and
History toggles; Enter opens; `c` marks the selected item as one side of a
comparison and `c` on a second item opens the changes panel for *first → second*
(either direction; `c` on the marked item, Escape or *cancel* clears the mark);
Escape closes. Each row also has a compare button (⇄). **Compare with current**
compares the selected item (or the historical version you are on) with the
current file of the document you are reading. Opening an edition or commit keeps
the explorer open on the new position. The status line shows `VERSIONS` mode.

**Historical versions.** Opening a commit renders the file as it was at that
commit, read-only, with the same Markdown renderer and sanitizer. A banner reads
"Historical version · Oct 12 · commit 3f2a1c9 · <subject> · Return to current".
No receipt (`/api/seen`), bookmark, annotation, discussion, selection tools or
Read next or Linked from list is attached; the "what changed" banner is not shown.
The reading log stays (it describes the current file's readers) but never adds
*You just now*, since nothing is marked read. The outline rail works as usual.
Chat refuses with "Chats are about the current file", and Send to AI-TTS (Space s,
the footer button) refuses with "Send to AI-TTS reads the current file; open the
current version to listen", because speech re-reads and hash-checks the current
file. Inbox previews (`inbox/…`) have no versions, so they show no chip and never
request `/api/versions`. The hash route
`#read=<path>@<commit>` makes historical versions linkable and survives
reloads; `navigate(path, {commit})` does the same in code. A commit equal to the
working copy opens the current file instead. Only Markdown and plain text can be
opened historically.

**Comparisons.** The explorer's comparisons use the RW-06 changes panel. When the
newer side of a comparison is the version on screen, clicking a change seeks to
it; otherwise a toast says which version to open to see it in place.

`/api/versions?path=…&participant=…[&hashes=1]` (`src/reader_mcp/versions.py`)
returns the `/api/editions` family (each member with `author`, `revisions`,
`history` status `ok`/`truncated`/`timeout`/`unavailable`, `uncommitted` and
`readers`), `newer`, `catalog`, `history: {path: [{commit, short, date, author,
subject, blob, status, at?, from?, matches_current?, sha256?, readers?}]}`,
`read: {participant, path, label, version, at, where: current|commit|earlier,
commit?}`, `git`, `hashes`, `hashes_partial`, `stats` and `limits`. Each member's
history is `git log --follow --raw` (author date, author name, subject), at most
50 commits per path and 200 per family (a 32-member family gets 6 each); members
are read in parallel by up to four `git` processes, all within 2 s per request.
Merge commits and deletions are skipped. Logs are cached in memory (256
entries) per `HEAD` commit, so a new commit invalidates them. `hashes=1` adds the
SHA-256 of each listed blob, which places receipts on historical commits: blobs
over 4 MiB are skipped, at most 32 MiB is hashed per request, and hashes are
cached by blob id (4,096 entries). The explorer requests hashes when it opens.

`/api/version?path=…&commit=…` returns the file at that commit in the shape of
`/api/document` plus `historical: true`, `commit`, `short`, `date`, `author` and
`subject`; `item` and `bookmark` are null. `commit` must be 7–40 lowercase
hexadecimal characters and must appear in that path's own history (as listed by
`/api/versions`); an ambiguous prefix is refused. No caller-supplied revision
expression reaches git: the blob id comes from the log and is read with
`git cat-file blob`. Blobs over 4 MiB are refused.

`/api/changes?a=<ref>&b=<ref>` compares any two versions, where a ref is a
library path (the current file) or `<path>@<commit>` (that file at a commit in
its history). It returns `a` and `b` (`path`, and `commit`, `short`, `date` for
historical refs), `status`, `stats`, `hunks`, `truncated`, and `annotations` when
`b` is a current file. The RW-06 forms (`path=…[&against=…|&successor=1]`) are
unchanged.

All git access is the RW-06 read-only runner: `rev-parse`, `log` and
`cat-file` only, no shell, a fixed environment, `GIT_OPTIONAL_LOCKS=0` and
`GIT_CEILING_DIRECTORIES` at the vault root; nothing is checked out and no
index, ref or temporary file is written. At most two explorer lookups run at
once; a third waits up to 3 s, then gets HTTP 429. Restoring an old version is a
librarian action and is not offered. PDFs have history in the timeline but are
neither opened historically nor compared.

### What changed since you read it

Every receipt in `engagement/` records the SHA-256 of the bytes a participant
read. When you open a Markdown or plain-text document whose receipt names a
different hash, a banner under the title says **Changed since you read it on
Oct 12 · 3 sections changed** with **Show changes** and **Mark as caught up**.
Opening such a document no longer records the new edition silently. **Mark as
caught up** records it (the usual `/api/seen` receipt), so the banner goes away
and the work shows as read. Documents you have not read, or whose receipt
matches, are marked read on display as before. If the edition you read cannot
be recovered, the banner says the earlier edition isn't in the vault history and
offers only **Mark as caught up**. When another participant's receipt names a
different edition whose prose differs, **Compare with what Agy read** appears (in
the banner, or in a quieter line when your own receipt is current). Prose is
compared as body blocks with whitespace collapsed, so editions that differ only
in frontmatter or line wrapping count as the same text: another reader's such
edition is not offered (an edition that cannot be recovered still is), and your
own shows a quiet **Edited since you read it** note with only **Mark as caught
up**. The diff matches blocks by the same normalized text. The version chip's newer-version
note offers **Compare v2 → v3**. The banner is `data-reader-decoration` and
part of the first layout.

The changes panel is a Sheet: beside the article on wide screens (no backdrop,
so the article stays usable) and from the bottom at phone width. It lists the
diff in source order. Reworded paragraphs show inline word changes (removed text
struck through with a `--warning` decoration, added text tinted with `--accent`),
removed paragraphs are struck through and added ones carry an `--accent` rule.
Unchanged runs collapse to "12 unchanged paragraphs". Clicking a change scrolls
(or turns) to the corresponding block, found by its `data-source-start` range,
and outlines it briefly. At the top, a summary of the current annotation
locations reads, for example, "Your highlight: relocated. Agy's warning: its
passage was removed." (`exact`, `relocated`, `orphaned` or `ambiguous`, from the
existing annotation anchoring).

`/api/changes?path=…&participant=…[&against=<participant>|&successor=1]`
(`src/reader_mcp/changes.py`) returns `status` (`changed`, `unchanged`,
`unavailable` or `unread`), `read_at`, `read_version`, `current_version`,
`others` (up to five other participants whose receipt names another edition),
`stats`, `hunks` and `annotations`. `against` names a participant present in
`engagement/` with a receipt for this path; anything else is refused.
`successor=1` compares the current file with the Editions `newer` version, both
read from the working tree.

**Recovery.** The edition read is looked up in the vault's git history,
read-only. `git log --follow --raw` lists blob ids for the newest 200 commits
that touched the path. `git cat-file --batch-check` drops blobs over 4 MiB, and
one `git cat-file --batch` process streams the rest, newest first, until a blob
hashes to the receipt. The search stops after 200 commits or 2 s. Git runs
without a shell, with a fixed environment (`GIT_OPTIONAL_LOCKS=0`, no global or
system config, no pager or prompts), and with `GIT_CEILING_DIRECTORIES` set so
only a repository at the vault root is used. Nothing is checked out and no
index, ref or temporary file is written. Merge commits contribute no diff of
their own, and uncommitted older bytes cannot be recovered. Recovered text is
kept in a 64-entry, 32 MiB in-memory LRU keyed by SHA-256. At most two searches
run at once; a third waits up to 3 s, then gets HTTP 429.

**Diff.** Both texts lose their frontmatter (the reader's `bodyOf` rule) and
split into blocks at blank lines, with fenced code kept whole. `difflib`
`SequenceMatcher` aligns blocks. Within a replaced run, pairs with similarity
≥ 0.5 become reworded hunks with a word diff; others become a removal plus an
addition. Hunk offsets are code points into the new text. Each side may hold at
most 4 MiB and 5,000 blocks. The response keeps whole hunks up to 1 MiB and sets
`truncated` ("Diff too large; showing the first N changes"). The panel shows
text with structure, not rendered Markdown. PDF and catalog-metadata diffs are
not included.

### Chat with the voices

**Space m**, or **Chat** in the margins panel, opens a chat panel for the open
document: a right-side panel, and a bottom sheet at phone width. It is built from
shadcn base-nova MessageScroller, Message, Bubble and Input Group, with the
mention list on Base UI Autocomplete (the free-text member of the Combobox family,
styled with the shadcn Combobox parts), bundled locally. The panel lists the document's chats newest first in a
Select, reopens the newest, and **+** starts a new one. Esc or Space m closes it.
A first message in a panel that has no chat joins the document's newest chat if
another tab started one meanwhile (`create` with `reuse: true`, checked under the
store lock); only **+** starts a second chat.

- **Who answers.** Type `@` to choose from the enabled voices; Enter inserts the
  highlighted one. Voices mentioned in a message answer in mention order. A message
  with no mention is answered by one voice drawn uniformly at random from the
  enabled voices with an installed CLI, and the reply records `chosen_by: random`.
  A message mentioning only voices that cannot run (a manual or disabled voice) gets
  no turn; a toast names the manual voice and its paste control.
- **Manual voices.** A voice with `"cli": null` (or `manual: true`) has no local CLI:
  you paste its replies. The composer's paste control is labelled from the registry
  (**Paste Wren's reply** for a manual voice named Wren); with several manual voices it
  reads **Paste a reply** and the paste form has a picker; with none it is hidden.
  Saving stores the text as a message authored by that voice with
  `runtime: {manual: true}`. A pasted reply that @mentions a voice routes to it; an
  unmentioned paste triggers nothing.
- **Voices talking to voices.** A reply that @mentions another voice queues that
  voice's turn. One message starts at most three turns in total, counting these
  hops, so voices cannot loop.
- **Replying to a voice.** Every voice message has **Reply to @Voice**; `r` on a
  focused voice message does the same. It puts `@alias ` at the start of the
  composer (replacing a leading mention), focuses it with the caret after the
  mention, and shows a *Replying to* chip with the first 80 characters of that
  message (× cancels). The sent message carries `reply_to` and shows a quote bar
  that scrolls to and briefly highlights the original. A reply with no mention goes
  to the voice it answers (`routing.chosen_by: reply`). Replying to a manual voice
  reminds you to paste its answer.
- **Chime-ins.** The Select under the chat title sets, per chat,
  `settings.chime_ins`: **Chime-ins off**, **Voices raise hands** (the default) or
  **Voices speak freely**. After an addressed exchange (a message with mentions or a
  reply, not a random pick or a pasted message) has no turns left, every other
  enabled voice with a CLI, in registry order, gets a *listening check*: one at a
  time, never while an ordinary turn is queued, with a 90-second timeout (or the
  voice's shorter one). The check answers `PASS` or `HAND: <reason>` (one line, at
  most 140 characters); anything else counts as `PASS`. A `HAND` is stored as a
  message with `kind: hand` and shows as a card with **Let them speak** and **Not
  now**; in Speak freely the first `HAND` speaks at once and the remaining checks
  stop. Letting a voice speak queues a chime-in turn (`kind: chime_in`, shown
  *chimed in*), told that it was not addressed and why it raised its hand. At most
  one chime-in follows each message, chime-ins never start listening checks (their
  own @mentions still route, within the three-turn cap), and accepting one expires
  the other hands. `PASS` adds only a *listened: …* note to the reply's footer. A
  raised hand expires after 10 minutes or when you send or paste the next message;
  sending or pasting also drops pending checks, and typing in the composer stops
  them (and any the exchange has not started yet). A toast batches new hands (*✋ 1 voice has something to add*).
- **Listening checks are read-only in effect.** Their prompt forbids changes, and the
  runner records changed paths and commits as for any turn. A check that changes or
  commits anything has its answer discarded, adds a warning to the reply's footer
  and a toast, and is logged in `.reader/voice-runner/listening.jsonl` (rotated at
  1 MiB) with every other check's outcome. Its changes are left in place for you to
  inspect.
- **Turn states.** Each pending turn shows *Queued (n ahead)*, *Waiting for the inbox
  run to finish*, or *Thinking…* with its streamed text, its elapsed time against
  its timeout (for example *0:42 of 10 min*; the clock stops at the timeout), and a
  **Cancel** button that kills its process group. A finished reply shows its author, runtime (CLI, version and model
  when known), duration against the timeout, the files it changed (library paths are
  links) and its commits. Failed, timed-out and cancelled replies keep their partial
  text and offer **Retry** once. Their footer names the reason: *CLI error* (non-zero
  exit or signal, with the stderr tail), *Unreadable output* (exit 0, but no line of
  stdout was an event of the voice's `stream` kind), *No output*, *No reply*, *CLI
  reported failure* (agy's `result.status` was not `SUCCESS`), *Timed out* (naming
  the `timeout_seconds` limit), *Stopped by a resource limit*, *Not started: low disk
  space*, or *Interrupted* (the server stopped mid-turn). A reply that finished
  without agy's final `result` event is kept as the streamed text, with a note.
- **Raw output.** Every voice reply, and every running turn, has a **Show raw
  output** disclosure, collapsed by default. Open, it reads the turn's archived
  stdout and stderr and, while the turn runs, appends `raw` frames from the chat's
  event stream. **Steps** lists the session, tool calls (name, parameters, output or
  error, duration), reply text collapsed to one row per response step (expandable),
  and the result (status, duration, turns, tokens), for agy, Claude Code and Codex
  output; other lines appear as they are. **Events** shows one JSON event per line.
  The stderr, the prompt and the system prompt follow, then the archive path, status,
  exit code and argv. The disclosure stays open when its turn finishes. Cancelling a turn that is
  still queued or waiting also records a cancelled reply (*Cancelled before it
  started.*), so its message is never left unanswered. Toasts announce each turn's
  start, failures, changed files, and, while the panel is closed, finished replies.
- **Several tabs and lost connections.** Every open panel on a chat follows the
  same stream: messages sent from another tab arrive as `posted` events, and each
  `hello` and `ping` carries the chat's revision and pending turn IDs, so a panel
  that disagrees reloads the chat and keeps only the turns the server still has.
  If the stream errors and does not reopen within 5 seconds, or stays silent for
  2.5 heartbeats (at least 3 seconds), pending turns show *Lost connection to
  Reader* with **Retry** (reconnect) instead of their clock, and one toast says
  so. The browser keeps reconnecting; the first event after that clears the state,
  toasts *Reconnected to Reader.* and reloads the chat. A running turn still shown
  two heartbeats past its timeout also triggers a reload.
- **Rendering.** Messages use the document's markdown-it and DOMPurify pipeline,
  without images, media or form controls; external links open in a new tab. The
  panel carries `data-reader-decoration`, so it is outside annotations and find.

**Authority and privacy.** Voices run with the authority they have in a normal
Reader session in this vault, as configured in `voices.json`: they may read, write
and commit. Every turn records its changed paths (from `git status` before and
after, excluding `chats/`, `logs/llm/` and `.reader/`) and the commits it made, leaving out
Reader's own commits (a `Reader-Chat` commit of chats and logs, a `Reader-Log` commit
that touches only `logs/llm/`, such as the local-model worker's, or a `Reader-Art` commit
that touches only `logs/llm/` and the `art/` folders its trailers name: a commission, a
favorite or a still). Paths that only Reader's own commits touched are not listed as
the turn's changed paths. Each turn sends
the document's identity, the chat transcript and anything the voice chooses to read
to that voice's provider (Anthropic, OpenAI or Google). Nothing is excluded.

#### Voice registry

`voices.json` at the vault root lists the voices. Reader ships no default: a vault
without it has no runnable voices, and the panel says so. Copy
[`templates/voices.json`](../templates/voices.json) to the vault to configure the
Reader librarian (Codex), Agy (agy), Claude (Claude Code) and Kai (manual). Each
entry has:

| Field | Meaning |
| --- | --- |
| `name`, `mention` | Display name and single-word `@` aliases (case-insensitive, unique) |
| `enabled` | `false` hides the voice from routing and random choice |
| `cli` | Executable name or absolute path; `null` with `manual: true` for paste-only voices. Names resolve on `PATH`, then `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin` (`READER_CLI_CANDIDATES` replaces those folders) |
| `argv` | Arguments. `{vault}`, `{prompt}`, `{persona}` and `{last_message}` are replaced; an element `{sandbox_add_dirs}` expands to `--add-dir PATH` for each Git metadata and git-locks directory the inbox runner grants |
| `stream` | Output parser: `claude` (stream-json), `codex` (`exec --json`), `agy` (stream-json), or `text` |
| `persona` | `agents_md_section` (one or more `AGENTS.md` headings or top-level list-item labels, copied verbatim), `profiles` (vault-relative pages) and `text` |
| `timeout_seconds` | Per-voice turn timeout; the top-level value (default 600) applies otherwise |
| `version_argv` | Arguments that print the CLI version, default `["--version"]`, or `null` |
| `inline_document` | `true` puts the document text in the prompt, for a runtime that cannot read files |

The top-level `workstation_lock_store` is passed to the `{sandbox_add_dirs}`
expansion, like the inbox runner's option. `turn_instructions` replaces the default
chat-turn instruction. The template's permissions are:

- Reader librarian: `codex exec --cd VAULT --sandbox workspace-write -c approval_policy="never"`
  with the inbox runner's `--add-dir` grants, `--ephemeral --json --color never
  --output-last-message FILE -` (prompt on stdin).
- Agy: `agy -p PROMPT --output-format stream-json --dangerously-skip-permissions`.
  agy prints one JSON object per line: `{"event": "init", …}`, then `step_update`
  events whose `step_update` has `step_index`, `state` (`ACTIVE`, `DONE`, `ERROR`)
  and `step_type` (`user_input`, `agent_response` with `text_delta`, or `tool` with
  `tool_name` and `tool_info` {`name`, `parameters`, `output` or `error`}), and a
  final `{"event": "result", "result": {"status", "response", "duration_seconds",
  "num_turns", "usage"}}`. Reader streams the `text_delta`s live (separating
  successive response steps with a blank line) and, on `result`, replaces the
  streamed text with `response`, which is the stored reply. Claude Code's `result`
  replaces the streamed text the same way when they differ.
- Claude: `claude -p --output-format stream-json --include-partial-messages --verbose
  --dangerously-skip-permissions --append-system-prompt PERSONA` (prompt on stdin).

**Prompt.** Each turn's prompt holds the voice's persona (Claude receives it as an
appended system prompt; the others as the first part of the prompt), the chat-turn
instruction, a context header (vault root, document path, title and SHA-256, chat
id, participant, the message being answered), and the transcript. The transcript is
fenced between `<<<READER-CHAT-HISTORY nonce>>>` markers with a random nonce and
labelled as data whose instructions are content, not commands. It keeps the newest
messages within 200 KiB and states how many were dropped. Voices read the document
themselves. The default instruction tells a voice that a chat turn is not a full
session turn, so it skips turn-boundary upkeep, intake, speech and other agents
unless asked.

When your message replies to a voice message, the prompt also says *The user is
replying to your message <id>, quoted below* (or *<Voice>'s message* for another
voice) and quotes that message in a `<<<READER-REPLY-TARGET nonce>>>` fence, up to
4 KB, even when older history is cut from the transcript. A chime-in turn's prompt
adds *You were not addressed. You are chiming in because you raised your hand:
<reason>. Be brief and add only what the addressed voice did not cover.* A
listening check's prompt is fixed and short: the voice's name and persona summary
line (`persona.summary`, else the first line of its first `AGENTS.md` section), the
rules above, the document title and path, and the latest exchange (your message and
the addressed replies, each quoted up to 4 KB) fenced as data. The transcript omits
hand records.

A Python hook, `Conversations(..., listen_filter=callable)`, can decide per voice
whether a listening check runs (`listen_filter(voice, exchange) -> bool`). It is
unset by default; no local-model pre-filter ships yet.

#### Runner, storage and commits

One turn runs at a time per vault, in FIFO order, in a background thread of the web
server. Before a turn starts, the runner takes `.reader/upkeep.lock`, waits while
the inbox runner holds its run lock, and then holds `.reader/voice-runner/run.lock`
for the whole turn; the inbox runner refuses to start while that lock is held. Each
turn runs in its own process group with stdin from the prompt file (or `{prompt}`),
`TMPDIR` under `.reader/voice-runner/tmp`, a CPU limit, and checks for free disk
(50 GiB reserve), process-group RSS (4 GiB), `.reader` data (4 GiB) and output
(16 MiB). Timeouts (`timeout_seconds`, default 600 s = 10 minutes) are the only
cost bound; a timeout or Cancel sends SIGKILL to the whole group. A turn does not
start while free disk is below the 50 GiB reserve: it fails at once with *Not
started: low disk space*, because its log could not be kept. `state.json` (in
`.reader/voice-runner/`) holds the active and queued turns, their partial text and
their log paths.

#### One chat owner per vault

One Reader web server per vault owns chat; it holds
`.reader/voice-runner/supervisor.lock` (an exclusive `flock`) for the rest of its
life, and the kernel releases it when that server exits or crashes. Only the owner
recovers interrupted turns, runs turns, writes `state.json` and changes chats. A
server takes the lock at start when `state.json` exists (there may be turns to
recover), and otherwise on its first chat action, so a server that only reads
writes nothing to the vault.

Any other server on the same vault (a second preview, a measurement or debugging
server, a test harness) serves chat read-only: chat lists, chats and raw output load,
but it never calls recovery or writes `state.json`, does not expire stale raised
hands, and does not see the owner's live turns (they appear once finished and
stored). Every chat action (`create`, `send`, `paste`, `cancel`, `retry`, `hand`,
`settings`, `hush`) answers **409** with *Another Reader server owns chat for this
vault; chat is read-only here. Use the server that owns it, or stop that server
first.* `/api/chats` and `/api/chat` report `owner: {owner, writable, message}`;
`writable` is true when this server owns chat or will on its first action. When it
is false the chat panel shows the message above the composer, and a refused send
keeps your draft. Once the owner stops, the next chat action on another server takes
the lock, recovers the old turns and proceeds.

Recovery rewrites `state.json` only when it actually marked a turn interrupted (or
sealed an interrupted listening check's log); a start with nothing to recover leaves
the file's bytes unchanged.

**Host and container on one vault.** Do not serve one vault from both the Mac and a
Docker container. `flock` is not shared reliably between the host and a Linux VM
through a bind mount, so the owner also keeps a heartbeat record in the lock file
(`pid`, `host`, `started_at`, `heartbeat`, rewritten every 10 s and zeroed on a clean
stop). A record from another host name with a heartbeat younger than 30 s counts as
held, so the second server is read-only. After the other side crashes, chat stays
read-only for up to 30 s. A process group named in a recovered turn's error belongs
to the owner's PID namespace, so inspect it on that side.

#### LLM logs

Every voice turn's raw artifacts are archived in the vault, permanently, at
`logs/llm/chat/<YYYY>/<MM>/<DD>/<turn-id>/` (UTC start date). By the user's explicit
decision this archive is never pruned, expired or size-capped; it is an approved
exception to the default 128 MiB log budget. Low disk space stops new runs instead.
`src/reader_mcp/llm_logs.py` defines the layout for the kinds `chat`, `listen`,
`inbox`, `local-model` and `art`. Voice chat turns (`chat`), listening checks
(`listen`), art commissions (`art`, by a voice or the local model; see
[Article art](#article-art)) and the local-model worker's batches (`local-model`; see
[Run logs](#reader-admin-local-model-any-openai-compatible-server) under Local
model) use it; the inbox runner does not yet. Embedding requests (search over the
provider's embedding model) are not LLM runs and are not archived: they return
vectors rather than text, their inputs are every passage of the library at each
re-embed (archiving them would copy the corpus into the vault again on every
rebuild, forever) or a search query, and the index already records the model and the
provider's signature.

- While a run is in progress its artifacts are streamed uncompressed as
  `prompt.txt.partial`, `system.txt.partial` (the persona), `stdout.jsonl.partial`
  and `stderr.log.partial`, beside a `meta.json` with status `running`. A CLI may
  write its own file there (Codex's `last-message.md`). A crash leaves these
  readable; the next server start seals the run as `interrupted`.
- On completion every artifact is gzip-compressed to `<name>.gz` and `meta.json`
  (plain JSON) records schema 1: kind, run and turn ids, chat id, voice, document
  path, CLI and version, model, session id, argv (the prompt and persona appear as
  `<prompt.txt>` and `<system.txt>`; values of secret-looking flags and
  `KEY=VALUE` arguments, and token-shaped strings, are `<redacted>`), cwd,
  timeout, start and end times, exit code, status, failure and error, warning,
  stdout lines read and understood, changed paths, commits, Reader's version, and
  each file's size and SHA-256.
- The finished run directory is committed with the turn's chat commit: `git add -A
  -f` of the directory (so the compressed files replace any partials a voice may
  have committed), with the trailer `Reader-Log: chat/<turn-id>`. Like chat
  commits, it never lands while a voice's turn runs.
- Runners other than chat commit their own run directories with
  `llm_logs.commit`: exactly the listed paths, `git add -A -f`, one `Reader-Log:
  <kind>/<run-id>` trailer per run, serialized with chat commits (the vault's `.git/`
  git-locks key when git-locks is installed, and always
  `.reader/voice-runner/chat-commit.lock`).
- `/api/chats` and `/api/chat` report `llm_logs` (`bytes` and `runs` under
  `logs/llm/`, cached for 30 seconds and refreshed when a turn ends); the chat
  panel's footer shows it. If the chat owner (see [one chat owner per
vault](#one-chat-owner-per-vault)) stops during a turn, its next start, or the next
server to take ownership, records that turn as failed (naming any process group that
may still run) so it can be retried.

Chats are stored as `chats/<uuid>.json` (schema 1: document path and SHA-256 at
creation, title, starting participant, revision, optional `settings.chime_ins`, and
messages with author, body, mentions, `reply_to` (validated against the chat),
routing, runtime and turn record). Additive fields, still schema 1: `kind`
(`message`, `chime_in` or `hand`), `root` (the message of yours that began the
exchange), on hands `reason` and `state` (`raised`, `accepted`, `declined` or
`expired`, with `decided_at`), on chime-ins `reason` and `hand_id`, and on replies
`listening: {voices, warnings}`. Hand states and listening notes are updated in
place under the same lock. Writes take
`.reader/chats.lock`, replace the file atomically and accept idempotent request IDs.
Limits: 2,000 messages and 8 MiB per chat, 64 KiB per message (longer replies are
truncated with a note), 5,000 chats. Only finished messages are written; streamed
text lives in memory and `state.json`.

After every message you write or paste and every finished turn, the server commits
only that chat file (and any LLM log directories of its turns and listening checks), with the subject `Chat: <title> — you wrote` (or `— <voice>
replied`, `— <voice> turn failed`, `— <voice> raised a hand`, `— voices listened`,
`— let <voice> speak`, `— chime-ins <setting>`, and so on) and the trailers `Reader-Chat: <id>`
and, for a voice, `Reader-Voice: <voice>`, plus one `Reader-Log: chat/<turn-id>` or
`Reader-Log: listen/<turn-id>` per archived run. Listening-check logs ride along with
the chat's next commit rather than adding commits of their own. The vault's configured Git user is the
author. Commits run `git add` and `git commit -- chats/<id>.json` inside `git locks
with … .git/` from the vault root (in the vault repository's default store, never
`GIT_LOCKS_STORE`) when git-locks is installed, or under `.reader/chat-commit.lock`
otherwise. Chat commits wait while a voice's turn runs and land
before the next turn starts, so they never interleave with a voice's own Git
operations, and they are never counted as the voice's commits. A vault that is not
a Git repository keeps its chats uncommitted. A failed commit raises a toast and a note in the panel. Voices'
own commits keep their usual attribution.

### Prose colors (Colorful Language)

**Space c** paints the grammar of the open document's prose with
[Colorful Language](https://github.com/flyingrobots/colorful-language), "IDE-grade
syntax highlighting for English prose". Colorful is an optional, local,
deterministic Rust CLI (a closed-class lexicon, a proper-noun heuristic and a small
contextual disambiguator; no model, nothing leaves the machine). Reader neither
vendors nor builds it.
Colors apply to the current edition only: a historical version (`path@commit`) and an
inbox preview are never colored, and Space c says so. Callout titles, like every
`data-reader-decoration` element, are never colored.

| Press | Effect |
| --- | --- |
| **Space c** | Steps the open document Off → Subtle → Clear → Vivid → Off |

The choice holds for that document until you change the Settings default, which
**Prose colors** (Off, Subtle, Clear, Vivid; Clear unless changed) in Reader Admin
sets for every document. Settings saved before the intensity scale map Skim to Subtle and
Full to Vivid. The footer shows an `abc` chip while colors are on. Settings also reports
which Colorful binary and version Reader found, or why it found none. When the Settings
default turns colors on as a document opens and Colorful is missing, nothing is said; Space
c explains.

**Intensities.** Each is a CSS class on `<body>` (`prose-subtle`, `prose-clear`,
`prose-vivid`), so switching sends no request. A custom highlight can set only `color`,
`background-color`, `text-decoration` and `text-shadow`, so the scale uses hue, lightness,
underlines and background washes rather than weight or size.

- **Subtle:** function words and punctuation fade a little toward `--muted`; proper nouns,
  numbers and quotation marks take a faint tint of their role color. Every role reads at
  4.5:1 or more.
- **Clear (default):** function words and punctuation recede strongly, to about 3:1 on the
  page (`--prose-recede`, between 3.0:1 and 3.3:1). This is WCAG's large-text level, and a
  deliberate choice: the receding words are de-emphasized structure whose meaning the
  sentence carries anyway, while the content words, which carry the meaning, stay at 7:1 or
  more (`--prose-content`, the theme's ink raised to 7:1 when it is below it). Proper nouns
  and acronyms take the accent's hue, numbers and quotation marks their own hues, each at
  4.5:1 or more.
- **Vivid:** every role Colorful emits gets its own saturated hue, as in its CLI: function
  words ("keywords"), proper nouns ("types", also underlined), quotation marks ("strings"),
  numbers, punctuation (muted), and the nouns, verbs, adjectives and adverbs of Colorful's
  seed lexicon and contextual rules. The passage between paired quotation marks gets a
  soft background wash (`reader-prose-quoted`, computed in the browser: curly and
  guillemet marks pair by shape, straight double quotes alternate, unpaired marks are
  ignored). Every role reads at 4.5:1 or more, also over the wash, and is at least 0.08
  ΔE_OK from every other role, ink and muted.

Colorful's open-class lexicon is a 16-word seed list, so nouns, verbs, adjectives and
adverbs are almost never colored in ordinary prose (well under 1% of words). Unlisted content words stay in the content ink, so Vivid mostly shows
function words, names, numbers and quotes. The Prose colors description in Settings says
so.

**What is colored.** Paragraphs, list items, blockquotes, headings, table cells,
definition lists and captions of Markdown documents, and PDF text layers. Code
blocks, inline code, keyboard and sample text, math (`.katex`, MathJax, `<math>`),
diagrams (`svg`, `.mermaid`, the Diagram source disclosure) and every
`[data-reader-decoration]` element (kicker, byline, Read next, embed headers and
notes) stay uncolored. Embedded documents are colored like the text around them,
including embeds that load after the document (`rescan()`). Plain-text and image documents are not colored.

**How it paints.** The DOM is never changed. Each prose block is projected like
find (whitespace runs become one space, excluded content is skipped) and sent to
the server. Each returned token becomes a `Range` inside one text node, added to
one CSS custom highlight per role (`reader-prose-function`, `-proper`, `-quote`,
`-number`, `-punct`, `-noun`, `-verb`, `-adjective`, `-adverb`) with priority −1.
Selection, find, annotations and warnings therefore paint over prose colors, and
anchors, bookmarks and read receipts are unaffected. Highlights are invisible to
assistive technology, and the document reads the same with them off.

Blocks are requested visible-first through an IntersectionObserver (in two-page
reading, rooted at the book viewport with one spread of margin), in batches of at
most 96 KiB and 400 blocks. The rest of the document fills in when the browser is
idle. Results are cached in the page by text, so turning colors off and on, or
switching style, reuses the painted ranges.

**PDFs.** A PDF page's text layer is transparent over its rendered image, which is
always white. Reader colors the layer's words with a tint behind them at a fixed
lightness instead of revealing the layer's glyphs: Vivid tints every role, Subtle
and Clear only names, numbers and quotes. Function words cannot recede in a PDF. A page re-rendered after eviction is colored again
from the cache.

**Two-page reading.** The page-turn rasterizer reads each role's current ink,
wash and underline (`--prose-ink-<role>`, `--prose-bg-<role>`, `--prose-line-<role>` on
`<body>`) and draws words split at role boundaries, so the 3D sheet shows the same
colors. Find and annotation inks win. PDF tints are not
rasterized; the sheet shows the PDF page without them.

**Theme colors.** Prose colors are derived per theme, never stored (the `prose`
and `prose_derived` lists in `theme-tokens.json`), by `proseColors()` in
`web/src/theme/color.ts`:

- The eight role colors `--prose-function`, `--prose-proper`, `--prose-quote`,
  `--prose-number`, `--prose-noun`, `--prose-verb`, `--prose-adjective` and
  `--prose-adverb` are Vivid's. They are chosen greedily in OKLCH, proper nouns first. The
  proper-noun role starts from the accent. Each other role tries the unused theme colors
  (secondary emphasis, charts) within 40° of its target hue, then synthesized hues stepping
  away from it. Each candidate's chroma is raised to at least 0.11 (0.12 for names) and its
  lightness moved to 5:1 on the page, headroom for the quote wash. The first candidate at
  least 0.11 ΔE_OK from ink, content ink, muted and the roles already chosen wins (names
  also 0.14 from the ink, so they stand out in Clear), otherwise the most separated one.
  Function words, a third of all words, also keep at least 60° of hue from the names.
- `--prose-punct` (muted at 4.5:1), `--prose-recede` (muted's hue moved toward the page
  until just above 3:1), `--prose-content` (ink at 7:1), `--prose-subtle-function`,
  `--prose-subtle-proper`, `--prose-subtle-number` and `--prose-subtle-quote` (OKLab mixes
  with ink at 4.5:1), `--prose-wash` (the quote color at the highest alpha, up to 0.2 dark
  or 0.22 light, that keeps ink and every role at 4.5:1 over it) and `--prose-underline`.

Famous and custom theme stylesheets carry the derived values; built-in themes get them at
runtime from the cascade, at zero specificity. The Theme Editor's *Prose colors (derived)*
group checks each intensity's paint against its floor (3:1 for Clear's receding words, 7:1
for content words, 4.5:1 for every colored role), Vivid's closest pair of roles (0.08
ΔE_OK) and text over the wash. The browser test checks the same floors in all 22 built-in
themes.

**Finding Colorful.** The server uses, in order: `READER_COLORFUL` (a path to the
binary), the path set in Reader Admin, Service & tools (`.reader/companions.json`),
the copy Reader built (`.reader/tooling/bin/colorful`), `colorful` on `PATH`,
`~/.cargo/bin/colorful`, and `~/.colorful-language/bin/colorful` (Colorful's
`scripts/install-local.sh`). It runs `colorful --version` once per binary identity
(path, inode, mtime, size) and requires 0.4.0 or newer; an older binary
reads *Too old* in Companions and prose colors stay off, since the v0.3.0 tag
reports a version but its artifacts fail the schema-hash check below. **Install** in
[Companions](#reader-admin-companions) builds the pinned release; by hand, in a
clone: `cargo install --path crates/colorful-cli --locked`.

Without a usable binary, Space c shows the [not-installed
prompt](#reader-admin-companions) with Install. The page renders normally.

**Server route.** `GET /api/prose` reports discovery: `available`, `version`,
`path`, `origin` and a `message` when unavailable. `POST /api/prose` takes exactly
`{"path", "sha256", "segments": [{"id", "text"}]}`:

1. The path must pass the usual library path checks, and `sha256` must be its
   current digest.
2. There are 1–2,000 segments with unique ids (`[A-Za-z0-9_-]{1,40}`). Each is at
   most 128 KiB of UTF-8, and a request at most 512 KiB (the body limit for this
   route is 1 MiB). An edition gets at most 4 MiB of uncached text per server
   process. Line breaks inside a segment are replaced by spaces, in place.
3. Segments not in the server cache are joined with blank lines and passed to
   `colorful ir -` on stdin, with explicit argv and no shell. At most two run at
   once. Each run has a 10-second timeout, a 16 MiB output cap and a 64 KiB stderr
   cap.
4. The `colorful.syntax/v1` artifact passes a port of Colorful's reference
   admission gate (`consumers/graft-projection.mjs`) before anything is used: exact
   shape, enums and 32-bit integers; contract version; byte length; UTF-8; token
   ranges in order, in bounds, non-empty, on character boundaries and not
   overlapping; unique occurrence ids; legal token axes; the outline graph; ranges
   in diagnostics and derivation; non-empty, unique derivation; the pinned
   `schemaHash` and `vocabularyHash` (those of Colorful 0.4.0); and
   `contentHash` against the bytes sent. One failure rejects the whole artifact
   (HTTP 400, `Colorful output rejected: … (E_CODE)`). The page stops coloring
   that document and shows the message; earlier batches stay painted.
5. Tokens map to Reader roles by the same axes as Colorful's vocabulary:
   FUNCTION → function, PROPER_NOUN_CANDIDATE → proper, CONTENT with an
   open-class kind → noun/verb/adjective/adverb, NUMBER, PUNCTUATION and QUOTE.
   Plain CONTENT is left unstyled. The response is
   `{"segments": {id: [[start, end, role], …]}, "version", "roles"}`, with offsets
   in UTF-16 code units of each segment.

The server caches each segment's spans in memory, keyed by the text's SHA-256 and
the Colorful version and binary path (the vocabulary hash is pinned), up to about
64 MiB. An unavailable binary answers HTTP 409 with `"unavailable": true`.

**Limits.** Colorful's open-class seed lexicon is small, so nouns, verbs,
adjectives and adverbs appear only for listed words and its contextual patterns.
A token across a segment separator, a block over 128 KiB and text after the
4 MiB edition budget stay uncolored. Colorful's lint
diagnostics are not shown.

### Reading queue and history

**Space r** opens the **Reading queue** in the right-hand panel (a bottom sheet
below 700 px). It has two tabs, **Up next** and **History**, switched with `Tab`,
`1` or `2`; Escape closes it. The panel always opens on Up next. Opening it closes a
thread panel, and opening a thread closes it.

**Up next** has three sections:

- **Now reading** is the open document with its progress. With nothing open, it
  shows the latest unfinished document from History as *Pick up where you left off*.
- **Queued by you** lists the documents you added, in your order, with title,
  unread mark, author and project, and an estimated reading time (primary-source
  bytes ÷ 6 words, at your reading pace; none for PDFs and images).
- **Suggested** lists voice suggestions first, labelled with the voice's name and
  reason, then about ten generated suggestions, each with its reason.

Keys in the panel: `j`/`k` (or arrows) move, Enter opens the item, `J`/`K` or
Alt+↑/↓ reorder your queue, `x` removes an item (a generated suggestion is
dismissed and stays away), `p` (or `q`) adds a suggestion to your queue, and `c`
clears your queued items after an inline confirmation (`Enter`/`y` confirms,
`Esc`/`n` keeps them). Rows under the pointer become the active row, as in the
file picker. Other single-letter keys stay in the panel rather than moving the
page behind it; the Space leader still works there.

**Adding.** `q` on a focused document link (Read next items, the issue's cover,
features and contents, which `j`/`k` focus) or on a file picker row adds it, as
does the small **+ Queue** button on each Read next item, under the cover story and
each feature, and on each work on the Search page. On Search, `q` adds the work of
the active passage (its primary source) and keeps you on the page. **Space q** is
unbound (reserved for open questions). A toast confirms the position: *Added to your queue · 4th*, or
*Already in your queue · 2nd*. **Space n** opens the first queued document from
anywhere, like skipping to the next track; with an empty queue it says so. When
the queue is not empty, the Read next aside leads with **Next in your queue →**.
Space n never fires by itself at the end of an article.

**Opening a queued document takes it out of Up next**: it becomes Now reading and
appears in History, the way a played track leaves a play queue. This answers the
spec's open question differently from the proposal (remove on finish): a document
opened by accident leaves the queue too, and can be resumed from History.

**Suggestions** (`WebLibrary.suggest_queue`, cached per participant for 60 s or
until the queue or the latest opens change):

1. **Seeds** are the five latest documents in History.
2. **Candidates** are each seed's Read next candidates (`Related.suggest`, six per
   seed), scored by relatedness ÷ (1 + 0.5 × seed rank), plus 0.15 when unread.
3. **One cross-project slot** is reserved first: the most similar work whose
   projects are disjoint from every seed's, with cosine at or above the 90th
   percentile of that seed's similarity row (*From another project · like X*).
   Without embeddings it falls back to the newest unread work from another
   project (*From another project · P*).
4. **Related picks** are taken round-robin over the seeds, best first, at most two
   per seed and seven in all (*Because you read X*), so the list reflects several
   recent reads.
5. **Newest unread works** fill the rest, at least two (*New in P*). With no
   History, the whole list is newest unread works.
6. **Exclusions:** queued, dismissed and finished documents, the seeds, any work
   whose title matches a seed's or a pick's before a trailing parenthetical, any
   work within cosine 0.985 of a seed (another edition), and any within 0.97 of a
   pick. The open document is not suggested.

The kinds interleave as related, related, new, related, other project, related,
new, then the rest.

**History** lists one row per document at its latest open, newest first, grouped
by local day (*Today*, *Yesterday*, *Oct 21*). Each row shows the time it was last
opened, its progress (*62% · 9 min left*, or *Finished* at 97% or more of the
current edition), and **Changed** when the edition differs from the one last
opened. A saved position counts as 100% once the document's last block (or its
last spread) has been in view for 3 seconds after opening, so a document that
fits on one screen can finish without scrolling. Enter resumes at the saved position (the bookmark). `f` or the buttons
toggle between all opens and finished ones only. `x` removes a row after a
confirmation that says the read receipt and reading position stay; it appends a
`hidden` entry and deletes nothing, and opening the document again brings the row
back. Pages hold 40 rows; moving past the last row, or **Show earlier**, loads more.

History is derived, not stored separately. It joins:

- an append-only open log, `history/<sha256(participant)>.jsonl`, of
  `{path, sha256, at}` lines written by `POST /api/history` when a document opens;
- read receipts (`engagement/`): a document receipt's time also counts as an open,
  because the web app marks a document read when it opens, so History reaches back
  before the log existed;
- bookmarks (`bookmarks/`) for progress.

The log never contains document text. Past 5,000 lines it is compacted, under the
lock, to the latest open and latest hide per document (and at most 4,000 lines).
A torn final line is skipped.

The queue is `queues/<sha256(participant)>.json`:
`{schema_version: 1, participant, items: [{path, added_at, added_by, reason?, pinned_at?}], dismissed, requests, updated_at}`.
Items you added (or pinned) form *Queued by you* in list order; items another name
added stay under Suggested until you pin them, and keep `added_by` afterwards.
Writes hold the shared annotation lock used by receipts and bookmarks and replace
the file atomically. Limits: 500 items, 64 KiB per file, reasons of 1–300
characters, 200 remembered dismissals and the last 64 request ids (a repeated
`request_id` returns the queue unchanged). Only current library documents can be
queued or logged: inbox paths, symlinks, missing files and anything `WebLibrary.path`
refuses are rejected.

**Voices** add suggestions with the CLI, which requires a reason when `--by` names
someone other than the participant:

```sh
reader --root "$VAULT" queue add library/path.md --participant You --by Agy --reason "Read this beside the T0 contract"
reader --root "$VAULT" queue list --participant You
```

Inviting voices to do this routinely is not configured here.

### Split view

The window splits into up to four panes, side by side or stacked, each a full
Reader with its own place, bookmarks, read receipts, find highlights and margin
threads. Keys go to the focused pane, which has a 2px accent edge.

| Keys | Action |
| --- | --- |
| `Ctrl-w v` / `Ctrl-w s` | Split side by side / stacked. The new pane shows the same document and opens the file picker; `Esc` keeps the document. |
| `Ctrl-w w` / `Ctrl-w h j k l` | Next pane / the pane in that direction, by geometry. |
| `Ctrl-w x` / `Ctrl-w =` | Swap with the next pane / equal sizes. |
| `Ctrl-w o` / `Ctrl-w q` | Keep only the focused pane / close it. |
| `Ctrl-w f`, Shift-click | Open the focused (or clicked) library link in the other pane, splitting first if there is one pane; the target pane takes focus. |
| `Space W` | The same prefix as `Ctrl-w`, for browsers that reserve Ctrl-W (Linux and Windows close the tab). |
| `:vsplit [doc]` / `:split [doc]` | Split side by side / stacked; with a document name (fuzzy, as `:open`, with Tab completion) the new pane opens it and skips the picker. |
| `:set scrollbind` / `:set noscrollbind` | Scroll the focused pane with the next pane / stop (`:set scrollbind!` toggles); the divider's ⇅ button does the same. `:set` alone opens Settings in Reader Admin. |

The window keys are rows in the RW-18 keymap (group *Split view* in the help); `Ctrl`
may stay held for the second key (`Ctrl-w Ctrl-w`). They never run while focus is in
a text field or the scratch pad's editor. In a pane, `Ctrl-w` keys and the window
commands are posted to the shell, which owns the layout; `?`, `Space m`, `Space r`
and `Space n` open the shell's help, chat and queue. A pane's `:` command line shows
in the pane's own status bar while you type. While split, the shell itself keeps only
the leader, `?`, `:` and Ctrl keys; any other key returns focus to the focused pane.

Dragging a divider resizes its neighbours; panes stay at least 320px wide and
200px tall, and a split that would go below that is refused with a toast. A fifth
pane is refused ("Up to 4 panes."). Below 700px splitting is refused, and an
existing split shows only the focused pane until the window widens.

**How it works.** While a split exists, the top document is a shell: it hides its
own article and lays out same-origin `<iframe src="/?pane=1#read=…">` panes, each
running the unchanged app in embedded mode (`web_ui/split.mjs`). Every pane has its
own state, `#article`, `CSS.highlights` registry, reading controller and key
handler, and `innerHeight` and every `@media` rule measure the pane, so two-page
reading in a 637px pane uses one column. When one pane is left (`Ctrl-w o`, or
`q` on a two-pane split) the shell asks each pane to save its place, removes the
iframes and opens that pane's document itself, so single-pane Reader has no iframe.

- **Embedded mode.** `?pane=1` hides the pane's status bar and summon button,
  navigates with `history.replaceState` (a pane never adds to the window's session
  history; `h` / `l` still walk its own visit list), forwards `Ctrl-w` sequences,
  `?`, `Space m`, `Space r` and `Space n` to the shell, sends toasts to the shell's
  toaster, and retries a read once after a 429. A background pane never takes the
  keyboard by itself. Bookmarks, receipts and annotations post from the pane as the
  same participant.
- **The shell.** One status bar shows the focused pane's mode, breadcrumb and
  position, with `2/3` for the pane number and `⇅` while it scrolls with a
  neighbour. Help, chat, the queue and toasts open over the window and act on the
  focused pane; a document chosen in the shell's picker, queue or breadcrumb opens
  in the focused pane. Theme and preference changes reach every pane through the
  `localStorage` `storage` event (and a `prefs-changed` message); a layout change
  reopens each pane's document in the new layout.
- **Layout and history.** The layout tree (rows and columns with fractional sizes)
  is kept in `#split=<json>`: pane routes are paths only (`#read=<path>` with an
  optional heading, `#search`, `#issue=…`, `#scratch` or
  `#scratch=<id>`), never search text or passage terms. Reader Admin is never a pane
  route: it replaces the whole layout (see [Reader Admin](#reader-admin-indexes-the-inbox-library-statistics-and-settings)). A scratch pad pane keeps its
  draft id, so a restored layout reopens that draft. Reload restores the tree and focus. Creating a split adds one
  history entry; browser Back leaves the split for the single view before it, and
  Forward restores it. Panes load 250 ms apart.
- **Messages.** `postMessage` with `targetOrigin` set to the page origin; receivers
  check `event.origin` and `event.source` against known frames and ignore messages
  over 64 KiB. Pane → shell: `status`, `doc`, `toast`, `focus-request`,
  `window-key`, `open-in-split`, `scroll`, `saved`. Shell → pane: `focus`, `blur`,
  `open`, `scroll-to`, `prefs-changed`, `save`.
- **Page turns.** Only the focused pane loads the Three.js page turner; a pane that
  loses focus disposes its WebGL context and turns spreads by sliding until focused.

**Synchronized scrolling.** The `⇅` button on a divider links the two panes beside
it (and unlinks them). The focused pane reports the `data-source-start` of its
topmost visible block, how far into it the view is and the block's position, once
per frame; the linked pane lines the matching block up at the same height:

- the same file at the same version: the same source offset;
- two versions (the same path, or the pair from *Compare side by side*): the offset
  is mapped across the block hunks of `/api/changes?a=&b=`, fetched once per pair
  (hunks carry `old_start`/`old_end` as well as `new_start`/`new_end`);
- different documents: the nearest preceding heading with the same normalized text,
  level and repeat, else the same fraction of the document.

In two-page mode the follower turns to the matching spread.

**Compare side by side.** In the Versions panel (`Space v`), choose a version and
press *Compare side by side*: it opens left of the current one in a vertical split,
scrolling together.

Limits and boundaries: at most four panes, each a full app instance with its own
`/api/library` load; no per-pane themes; no splits on phones; `:set scrollbind` binds the focused pane
with the next one in reading order (choose another pair with the divider button).

Checks: `node --test tests/split.test.mjs` (tree operations, layout, routes, hunk
mapping, heading fallback) and `node tests/web_split.cjs` (synthetic fixture with
`--links --editions --versions`).

### Scratch pad

`Space w` opens a new Markdown buffer at `#scratch=<id>`; `#scratch` opens the latest
draft. Back and reload work. The buffer is a monospace Markdown source editor
(CodeMirror 6 with Vim keys from `@replit/codemirror-vim`, Markdown syntax highlighting
in theme tokens) beside a live preview drawn by the document renderer (the same
markdown-it pipeline, DOMPurify, KaTeX and Mermaid diagrams as library documents), updated
150 ms after typing stops. The preview marks and scrolls to the cursor's block through
`data-source-start`, whose code-point offsets map directly to the buffer. Links,
local images and embeds in the preview resolve as they will once saved: from the
notebook folder (`library/notebook/`, even before the first save creates it).

- **Layouts.** *Side by side*, *Source* and *Preview*; the bar's layout button or
  `:preview` cycles them. Below 900px a buffer opens in Source; at phone width the
  layout is one column with 16px gutters.
- **Keys.** Inside the editor Vim owns the keys: modes, `/`, registers, and the Ex
  commands `:w` (save on this device), `:write vault` (the save dialog), `:preview`,
  `:drafts`, `:cite` (insert your last selected passage as a quote linked from the
  notebook), `:enew`, `:e scratch` and `:e scratch=<id>`. In insert mode, `Ctrl-r`
  then a register name (`a`–`z` or `"`) inserts that Reader register (a passage
  yanked with `"ay` in VISUAL) as a cited quote linked from the notebook; Vim's own
  `Ctrl-r` registers are not used there. On the page command line, `:enew` opens a
  new buffer and `:e scratch` / `:e scratch=<id>` a draft. Escape in insert or visual
  mode returns to normal mode; Escape in normal mode leaves the editor for Reader
  NORMAL, where `Space` keys work again. The status line shows `SCRATCH · INSERT` (or
  NORMAL, VISUAL), the word count and the save state: *Unsaved*, *Saved on this
  device*, *Not saved on this device* or *In vault*.
- **Drafts.** Drafts are kept in this browser's IndexedDB (`reader-scratch`, store
  `drafts`, `{id, title, body, created, updated, responds_to?, base?, vault_path?}`),
  800 ms after typing stops and when the page is hidden. No draft text reaches the
  server before a vault save. *Drafts* (or `:drafts`) lists them; `j` `k` move,
  `Enter` opens, `x` deletes after confirmation. A browser keeps at most 200 drafts and
  asks before removing the oldest. Without IndexedDB the editor still works and says
  *Not saved on this device*.
- **Save to vault** (`:write vault` or the button) asks for the title, slug, status
  (draft or published) and an optional *responds to* path, which defaults to the
  document you opened the buffer from. It shows the path, then `POST /api/writing`
  writes `library/notebook/YYYY-MM-DD-<slug>.md` and toasts once committed:

  ```yaml
  title: "On splits"
  author: "Ada Example"        # git config user.name in the vault, else the participant
  participant: "You"
  date: 2026-10-24
  kind: Notebook
  status: draft
  responds_to: "library/…md"   # optional, with responds_to_sha256
  document_revision: 1
  tags: [you/writing]
  ```

  An existing path is never overwritten: the server answers 409 with a free
  `<slug>-2` suggestion, which the dialog fills in. The file is written to a temporary
  file and hard-linked into place (which fails if the name appeared meanwhile), then
  only that file is committed through `git locks with … .git/ --wait 120` when git-locks
  is installed (and a flock shared with chat commits), with `Reader-Writing: <path>` and
  `Reader-Participant: <participant>` trailers. A failed or timed-out commit leaves the
  file written but uncommitted and says so. The server never edits `library/index.md`,
  `writings/` or browse indexes: filing into collection navigation is librarian upkeep.
- **New versions.** A draft saved once, or opened with *Edit in scratch* on a notebook
  piece, saves as `<name>.v2.md` (then `.v3.md` …) beside the original, with
  `document_revision` incremented, `previous_version` and an optional
  `what_shifted` note. The original bytes never change, and the save is refused (409)
  when the base file's sha256 changed since the draft opened.
- **Ask a voice to respond** appears after a vault save: it opens a chat about the
  saved piece with a request to respond in the composer.

Limits: 64 KiB per body (UTF-8), 200-character one-line titles, slugs
`[a-z0-9-]{1,60}`, one write per request, idempotent by `request_id` for the life
of the server process, and writes only under `library/notebook/` (a symlinked
`library/` or `library/notebook/` is refused). The editor is the lazy
`controls/editor.js` chunk (`web/src/markdown-editor.ts`, a reusable
`createMarkdownEditor(parent, options)`), requested only when a buffer opens.

Checks: `pytest tests/test_writing.py`, `node --test tests/scratch.test.mjs` and
`node tests/web_scratch.cjs` (synthetic fixture with `--writing`: a temporary Git
vault with flock-only commits).

### Obsidian callouts

Markdown blockquotes that begin with an Obsidian callout marker render as callouts
instead of showing the marker literally:

```markdown
> [!tip] Optional title with *inline* Markdown
> Body text.

> [!info]- Folded, closed until opened
> > [!warning]+ Nested and foldable, open by default
> > Inner body.
```

- Types follow Obsidian's built-in set and aliases: note; abstract (summary, tldr);
  info; todo; tip (hint, important); success (check, done); question (help, faq);
  warning (caution, attention); failure (fail, missing); danger (error); bug;
  example; quote (cite). Identifiers are case-insensitive, so GitHub-style
  `> [!NOTE]` alerts render too. Unknown identifiers render as `note` and keep
  their own name as the default title.
- Without a title, the identifier in title case is the title (`[!faq]` shows
  "Faq"). `-` folds the callout closed and `+` open, using `<details>`; a callout
  without either has a static header. Nesting follows blockquote depth.
- Each callout is an `<aside class="callout" role="note" data-callout="<type>">`
  (`data-callout-alias` keeps an alias or unknown identifier). Its header holds the
  type's Lucide icon (the icon set Obsidian uses) and the title. Colors use theme
  tokens only: `--accent` for most types, `--rust` for question, `--warning` for
  warning, failure, danger and bug, and `--muted` for quote, over a 7% tint of that
  color on `--bg`. Title and body text meet 4.5:1 in every built-in theme.

How it works: `web_ui/callouts.mjs` is a markdown-it plugin. After block parsing
it recognizes a blockquote whose first paragraph's first line is the marker,
records the callout on the blockquote tokens, and removes the marker line from
that paragraph. The paragraph's source map then starts at its first body line, or
the paragraph is dropped when the marker stood alone. Body blocks keep
markdown-it's own `data-source-start`/`data-source-end`, so highlights, warnings,
new selections and reading positions anchor exactly as in any blockquote. The
header carries `data-reader-decoration`, so find, selection and annotation
projection skip the marker and title; a selection inside the header does not
offer annotation. The aside itself keeps the blockquote's full source range.
After sanitizing, `mountCallouts()` from the controls bundle clones each icon
from templates rendered once. Find and thread jumps open a folded callout that
contains their target. A folded body's highlights have no on-screen rectangle
while it is closed, so its margin pins are hidden until it opens; opening or
closing re-measures the layout and pins. Custom callout CSS types, callout
metadata (`[!type|meta]`) and Obsidian's custom per-type colors are not supported.

### Embeds

Obsidian embeds render in place, live, as the embedded document's own text:

```markdown
![[Note]]                   the whole note (after its frontmatter)
![[folder/Note.md#Heading]] a section: the heading to the next heading of the same or a higher level
![[Note#Part#Detail]]       a heading inside another heading's section
![[Note#^block-id]]         the block that ends with ` ^block-id`
![[#Heading]]               a section of this document
![[Note|Shown name]]        an alias, shown in the embed's header
![[picture.png|300]]        an image, 300 px wide (`|300x200` sets both sides)
![[paper.pdf#page=3]]       one PDF page (page 1 without `#page=`)
```

**Resolution** is the link resolver's (`links.Resolver`, the same one a click and
the link graph use): a path relative to the embedding document, a `library/…` or
`/…` path from the vault root, the path with `.md` appended, or a unique basename
or path suffix. An ambiguous name (two `twin.md`) is not guessed; write a longer
path. A name without a known file extension is a note, so `![[v1.2 notes]]` is
`v1.2 notes.md`.

**Fragments** follow Obsidian. Headings match by text (case and spacing ignored)
or by slug, ATX and setext headings both; `#` lines inside code are not headings
and never end a section. A block id names a paragraph, a list item with its child
items, a quote or callout, or, on a line of its own, the block just above it (a
table, a list). Block ids are hidden in rendered text, embedded or not. A fragment
that matches nothing shows a note.

**What an embed looks like.** A paragraph of nothing but embeds becomes the embeds
themselves (`<div class="document-embed">`); an embed inside a sentence is a
`<span class="document-embed">` shown as a block. Each has a small header, *from
<title or alias> · <fragment> ↗*, that opens the embedded document at that
section (or the PDF at that page). The header and every note are
`data-reader-decoration`, so find, selection, annotation and prose colors skip
them. Images are ordinary `<img class="embed-image">` elements with the requested
size. A PDF page is drawn into a static canvas a viewport before it scrolls into
view (at most 12 PDF embeds per document; the rest show their header only).

**Notes in place of an embed** say why nothing is shown: no document matches;
more than one document matches; the document embeds itself (a cycle, shown once);
embedded more than 4 levels deep; too large to embed (over 512,000 characters);
nothing matches the section; this kind of file can't be embedded (audio, video,
CSV and other non-Markdown files); only the first 200 embeds in a document are
shown.

**Never an embed:** `![[…]]` inside fenced, indented or inline code, inside an
HTML comment, or after a backslash (`\![[note]]` is a `!` and a wikilink).
`[[…]]` wikilinks are markdown-it inline rules too, so code keeps them literally.

**Annotations.** Each embedded fragment renders with the embedded file's own
source offsets (`data-source-start`/`end` in its code points) inside
`.embedded-content[data-source-path]`. A highlight, comment or warning made inside
an embed is stored on the embedded file, at its own offsets, and appears when that
file is opened directly. The open document's margins also show the embedded
files' threads that fall inside the embedded fragments (each thread once; margins
of at most 24 embedded files, four requests at a time), and the thread list marks
them *in <title>*. A selection that crosses an embed's edge cannot be anchored and
says so. Links and images inside an embed resolve from the embedded file, so
relative links keep working wherever the note is embedded.

**Find, the cursor, outline, two-page mode.** Find (`/`) searches embedded text
that has loaded. The reading cursor and VISUAL read through embeds. Embedded
headings are not in the outline. In two-page mode embeds flow through the columns,
every deferred embed loads in the background (there is no scroll position to wait
for), and the page-turn rasterizer paints them like any other text, images and
canvases. Send to AI-TTS speaks the open document's own text, without its embeds.

**Loading.** The document's first 16 embeds resolve in one `/api/embeds` request,
which returns their nested embeds too (the server tree), before first paint. Later
embeds show *Embedded document · loads as you read* and load 16 at a time as they
come within 1,200 px of the viewport (an `IntersectionObserver`), so nothing is
silently dropped. A nested embed the server did not resolve (over its budget, or
a markdown-it/scanner disagreement) is requested the same way.

**`GET /api/embeds`** `?from=<path>&target=<inner text>…&ancestor=<path#fragment>…&depth=<n>`
returns `{documents, nodes, limits}`. `documents` maps each embedded Markdown path
to `{text, sha256, title}` once per response; each node carries `raw`, `target`,
`fragment`, `alias`, `kind` (`markdown`, `image`, `pdf`, `audio`, `video`,
`other`), `width`, `height`, `page`, `status` (`ok`, `missing`, `ambiguous`,
`cycle`, `depth`, `too-large`, `no-fragment`, `unsupported`, `deferred`, `error`),
and when resolved `path`, `title`, the fragment's code point range `start`/`end`
in `documents[path].text`, and `children` (its nested embeds, in order). Limits:
64 targets per request, 4 levels below the open document, 256 nodes and 8,000,000
characters of document text per response (later nodes are `deferred`), 512,000
characters per embedded file. `ancestor` keys (at most 5) detect cycles across
requests. Decoded files are cached by path and SHA-256 (64 entries). The route is
read-only and uses the library's path validation; `from` may be an inbox preview,
targets resolve in `library/`.

**Conformance corpus.** `tests/fixtures/transclusion/corpus.json` holds synthetic
files and the expected parse, scan, fragment and tree results; `tests/test_embeds.py`
(Python, `src/reader_mcp/embeds.py`) and `tests/embeds.test.mjs` (markdown-it,
`web_ui/embeds.mjs`) both run it, so the server scanner and the renderer agree on
which `![[` are embeds. The browser behavior is `tests/web_transclusion.cjs`
(fixture `tests/web_fixture.py --transclusion`), which also opens a 50-embed
document and prints its timings.

Not supported: audio and video players, `.canvas` files, Obsidian's
`![[note#heading|alias]]` display variants beyond the header caption, embed
search queries (```` ```query ````), and editing embedded text in place. The
scratch pad preview has no file yet, so it resolves embeds and local images from
the folder it saves into (`from=library/notebook/`; see `/api/resolve-batch`).

### Document controls

The footer's shadcn **Switch** is labelled **Dark mode**. Checked means dark;
unchecked means light. It swaps within Ink/Paper, Orchid or Harvest and retains the
chosen palette family. The Settings section's independent switches control atlas, activity
and smooth scrolling.

Every action button uses shadcn [**Button**](https://ui.shadcn.com/docs/components/base/button),
and related actions sit in a [**Button Group**](https://ui.shadcn.com/docs/components/base/button-group).
The groups are search methods, find previous/next/close, the selection toolbar's
Highlight/Comment/Warn, and the Theme Editor's Light/Dark toggles. React controls
render the components directly. Markup from the plain-JavaScript renderer declares
`data-button="<variant> <size> [round]"` or `data-button-group`, and
`web/src/vanilla-buttons.ts` applies the same `buttonVariants`/`buttonGroupVariants`
classes and `data-slot` attributes. A MutationObserver covers templates rendered
later. Toggle buttons with `aria-pressed` gain a pressed style. Row-shaped controls
are not converted: document tree rows (already Button), thread list items, dashboard
total cells and margin items, chart segments, breadcrumb links, folder menu items,
annotation pins and progress pips. They follow their own list, breadcrumb or chart
patterns.

Every fenced code block uses the shadcn [**Code Block**](https://ui.shadcn.com/docs/components/base/code-block):
in documents and embedded documents, the Mermaid **Diagram source**, the scratch-pad
preview, chat messages, inbox reports and activity prose. Raw CLI output, stderr and
prompts in chat raw output, and the theme preview use the React component directly
(small, wrapped, with a floating copy button).

- **Markup.** `web/src/code-blocks.ts` renders the React CodeBlock, CodeBlockHeader,
  CodeBlockTitle, CodeBlockActions, CodeBlockCopyButton and CodeBlockContent once into a
  detached prototype and gives every markdown-it fence those parts' classes and
  `data-slot` attributes (`mountCodeBlocks` for rendered containers,
  `decorateCodeBlocks` for HTML strings before they are inserted). The fence's own
  `<code>` element moves into the block with its text node and its
  `data-source-start`/`data-source-end` offsets (fences are mapped like paragraphs), so
  find, selection, annotations and the reading position see the exact source text.
  At most 4,000 blocks per container are converted.
- **Header and copy.** The header shows the language (`Python`, `Mermaid`, `Text` for an
  unlabelled fence) and a copy button labelled **Copy code**. The button copies the exact
  fence text, shows a check for two seconds and raises a toast ("Copied 6 lines of
  code."); it is a normal focusable button (Tab, Enter or Space). Without the Clipboard
  API (an insecure origin) it falls back to `document.execCommand('copy')`, and a refusal
  raises an error toast. The header is decoration (`data-reader-decoration`).
- **Line numbers.** Document and preview blocks with two to 5,000 lines get a number
  gutter: one decoration element per block (`aria-hidden`, not selectable, not found by
  find). Long lines scroll horizontally inside the block, never the page. Chat, inbox
  reports and activity prose wrap long lines and have no numbers. The component's own
  numbering (one CodeBlockLine element per line) is not used: on the 2 MB benchmark
  document its thousands of line elements made layout about eight times slower than
  plain `<pre>`.
- **Syntax highlighting.** [Shiki](https://shiki.style) 4.5.0 with its JavaScript
  regular-expression engine (no WebAssembly) tokenizes blocks in Bash/Shell, C, CSS,
  Diff, HTML, JavaScript, JSON, JSX, Markdown, Mermaid, PowerShell, Python, Rust, SQL,
  TOML, TSX, TypeScript and YAML (plus common aliases such as `sh`, `py`, `ts`, `yml`,
  `rs`). Other languages and unlabelled fences stay plain. The tokenizer
  (`controls/highlight.js`, about 125 KB, 40 KB gzipped) and each grammar
  (`controls/highlight/<language>-<hash>.js`, 3–180 KB) load the first time a block in
  that language comes within about two screens of the viewport (an
  IntersectionObserver), and blocks are tokenized in idle-time batches of about 12 ms.
  Blocks over 100,000 characters are not highlighted. Tokens become CSS custom
  highlights (`reader-syntax-keyword`, `-string`, `-string-expression`, `-constant`,
  `-function`, `-parameter`, `-punctuation`, `-comment`, `-link`) over the unchanged
  text node: highlighting never changes the DOM, so it cannot move an annotation, a find
  match or a selection. Their priority is below annotations and find.
- **Theme colors.** `--code-<role>` (style.css) maps each role to the theme's derived
  prose colors (`--prose-function`, `--prose-quote`, `--prose-number`, …), which hold
  4.5:1 on the page (the browser suite checks all 22 bundled themes); comments and punctuation
  use `--muted`. A theme change recolors without re-highlighting. The block's background
  is the page color, so these ratios hold inside it.
- **Two-page mode.** Blocks avoid column breaks and scroll inside the column. The
  page-turn rasterizer paints the syntax colors (it reads `--code-<role>`) and the
  gutter; the turn lasts under a second.

Existing source-format limitations on annotation anchoring still apply.

Actual shadcn **Skeleton** placeholders appear during library, document and search
requests. They are removed when content or an error arrives. They contain no
invented statistics. Component roots are disposed when their route is replaced.

PDFs use locally vendored PDF.js. Original PDF pages appear as facing pages, with
selectable text and document find. The renderer keeps at most six live page
surfaces; each canvas is capped at four million pixels and device scale 2. PDF
reading is limited to 5,000 pages and the server's 256 MiB source limit. Password
protected or unsupported files can be opened through the original-file link.
PDF passage annotations are not implemented.

The reader saves each participant's position after a short pause in scrolling,
once the smooth renderer has caught up with the native scroll position. This
keeps an intermediate animation frame from replacing a restored bookmark.
Navigation and hiding the browser page still save the currently visible place
immediately. It restores a matching
source edition before revealing the document. Text positions include a source
block offset and relative position, with a normalized progress fallback. PDF
positions include an explicit page number. A saved spread index is reused when
the current number of spreads matches. Layout changes use the source/page anchor
where possible. A changed source SHA-256 starts at the beginning with a notice;
the reader never guesses that an old coordinate identifies the new passage.

Bookmark records live in the private vault's `bookmarks/<participant-sha256>.json`.
Schema version 1 stores the participant and a path-keyed `items` mapping. Each
item contains `source_sha256`, `progress`, `source_offset`, `pdf_page`,
`block_fraction`, `layout`, `spread_count` and `updated_at`. Writes use the existing
annotation lock and atomic replacement. Limits are 100 participants, 10,000
positions per participant and 4 MiB per participant record. Positions are separate
from read receipts. Last-moment saves on browser termination are best effort;
waiting for the short scroll debounce or navigating normally allows a confirmed
save. Back up this directory with the rest of the private vault.

## Search page

**Space /** opens Search from anywhere (the route is `#search=…`). The picker's `/`
filter stays for quick navigation by name. The page remembers its query and filters
for the browser session, and the URL carries them, so a search is linkable:
`#search=` holds an encoded query string with `q`, `mode` (`words` or `meaning`;
Best is the default and is omitted), repeated `project`, `author` and `type`,
`from`/`to` (YYYY-MM-DD), `read` (`unread` or `read`), `folder` and `machine=1`.
Requests also send `from_at`/`to_at`, the browser's local midnights at the start of
`from` and after `to` (ISO timestamps with a zone); works with an `arrival_time` match
by that instant, and others by their catalog date.
A hand-typed `#search=receipts` or `#search=open%20questions` (a value with no `=`)
is taken as the query itself; a malformed escape is read literally.

- **Modes.** **Best** blends exact words and meaning by reciprocal-rank fusion.
  **Exact words** ranks passages by FTS5 bm25 and file names. **Meaning** ranks
  passages by cosine similarity to the query. Typing searches after 200 ms
  (450 ms for Meaning). The count, passages shown and index date appear under the
  field.
- **Results.** Each result is a catalog work, ordered by its best passage. It shows
  the title, authors, first project, date, an unread pip, and up to three passages
  of at most 320 characters, cut around the densest cluster of query words. Excerpts
  are plain text with frontmatter and common Markdown markup removed; matched words
  are CSS custom highlights (`reader-search-term`, and `reader-search-active` for the
  selected passage) over theme tokens, never markup. Each passage is labelled with
  its line, or its page for PDFs. A passage without the query's literal words is
  marked "Related, not exact".
- **Grouping.** A file belongs to the inventory work whose primary or catalog path
  it is, whose reading copy it is (`name.reading.md`), or whose bundle folder holds
  it (the folder of a catalog `index.md` or receipt, deepest first). Other files
  stand alone, titled from their frontmatter. Copies of one passage show once.
- **Filters.** A left rail on wide screens, or a bottom sheet (Filters) below
  860 px, offers Project, Author and Type as multi-select facets with work counts,
  Date presets (week, month, year: rolling 7, 30 and 365 days) or a range, Read state
  (All, Unread, Read for the current participant and exact current edition),
  subfolders of the current scope, and Include machine files (off by default; on,
  path-only receipts, logs and code can match by file name). A facet's own counts
  ignore its own selection, so other values stay choosable; the other filters
  apply. When the candidate pool was full, the rail says the counts cover the top
  500 passages.
- **Keys.** In the field, ↓ moves to the results, Enter opens the selected passage
  and Esc moves to the results (or back, when there are none). On the results,
  `j`/`k` move between passages, `J`/`K` between works, Enter opens the passage,
  `o` opens it in a new browser tab and keeps you on Search, `/` returns to the
  field, `h` goes back and Esc returns to where you were. Esc on any other page
  control (a mode button, facet or filter) moves to the results, or the field when
  there are none; a second Esc goes back. If that query is still running, focus
  lands on the results it brings once they render (the field when there are none),
  unless you have moved elsewhere meanwhile.
- **Opening a passage.** The document opens at the indexed line: Markdown scrolls to
  (or, in two-page mode, turns to the spread of) the smallest block containing that
  line; plain text uses the line itself; PDFs go to the page. Every whole-word
  occurrence of the query's words gets the find highlight, the first at or after
  the passage is current, and `n`/`N` step through them. The status line shows
  "From search: ‹query› · n of m · Esc to clear"; Esc clears it. Passage links are
  `#read=<path>&at=<json>` with `line`, `page`, `terms` and `query`.
- **States.** An empty query shows recent searches (eight, in this browser's local
  storage, `reader.search.recent.v1`) and the most common topics among your unread
  works. No results offers Meaning or clearing filters. A run that stopped before
  finishing, or sources that changed since indexing, show a note linking to Behind
  the scenes; changed sources' passages are hidden. If the embedding model or vectors
  are unavailable, Best and Meaning say so and show exact-word matches. Search never
  rebuilds the index itself.

`GET /api/search/page` takes `q` (1–1,000 characters), `mode` (`best`, `words` or
`meaning`), the filters above as query parameters, `offset` (0–500) and `limit`
(1–50 works, default 20). It returns `{works:[{id, title, primary, authors, projects,
types, date, read, score, passages:[{path, page, start_line, end_line, line, excerpt,
spans, matched_by, literal}]}], terms, facets:{project, author, type, folder}, total,
facet_scope, pool, indexed_at, complete, semantic, warnings}`. `spans` are `[start,
end)` Unicode code-point offsets into `excerpt`. Ranking runs once over the published
index snapshot (`Search.passages`) in `.reader/search.v2.sqlite3`; with only the retired
format 1 file present the page asks for a rebuild. It takes at most 2,000 passages per channel and a
pool of 500 chunks, after the folder and machine-file scope and the work filters.
Words in a short stopword list are dropped unless the query has no others. Meaning keeps passages with cosine similarity of at least 0.62 and within 0.08 of the best match, at most 300 (100 in Best, so exact words lead); bge-small-en-v1.5 similarities on a real library cluster near 0.53, and even a nonsense query reaches about 0.67, so a passage marked related is a lead, not a claim. Meaning
vectors are normalized once per published index version and reused while it is
unchanged. Passage searches share the server's search lock with content and semantic
search: a second one waits up to 8 seconds (`SEARCH_WAIT`) and is then refused with
HTTP 429. The page retries any 429 on this route (the search lock's or the server's
busy gate) after 0.5, 1, 2, 4 and 8 seconds, keeping its loading state, and if the
search never runs it shows *Search couldn't finish*, never the no-match note.

## Search, dashboard and shared discussion

The Library section of Reader Admin is a grid of up to twelve interactive D3 statistics panels, with
summary totals above and an editions list below. Panels cover recorded arrivals
over twelve weeks, reading marks over 28 local days, read/unread status, first
topic, primary format, first document type, authors, first project, primary-source
byte sizes, unread topics, discussion state and the optional topic atlas.
The activity and atlas settings control their corresponding panels.

Select a chart segment, bar or legend item to browse the works behind it; the
summary totals continue to describe the entire current catalog. Clear selection
restores the latest additions. Author bars credit each distinct coauthor, while
topic/project/type charts use one label per work. The atlas groups by first topic,
with one dot per work; hover inspects it and clicking opens the source. Discussion
totals count actual threads, warning/highlight kinds, comments and resolved state.
Discussion selections list matching catalog primaries; source attachments can
have threads without appearing as an independent catalog work.

Dates are recorded arrival/filing dates, never inferred publication dates. Undated
works are excluded from time charts. Reading activity counts each current edition
by its latest exact-version mark, rather than visits, duration or a first-read
history. Primary-source size counts bytes and excludes attachments; it does not
estimate page counts, words or reading time. The inventory's snapshot date remains
visible so these charts do not imply automatic catalog refresh.

The catalog comes from `indexes/coverage.json`, with bounded browse discovery as
a fallback. Fuzzy search covers title, path and author in that inventory. Content
and semantic search use the existing SQLite index and report its date, warnings
and errors. A missing, stale or resource-blocked index is not silently rebuilt or
substituted with fake semantic results. Search results are capped at 30.
The server runs one content or semantic search at a time (the index engine is not
shared between concurrent queries); another waits up to 8 seconds (`SEARCH_WAIT`)
for it and is then refused with HTTP 429. The Documents picker retries a 429 after
0.5, 1, 2, 4 and 8 seconds, showing *Another search is running; retrying…*, and,
if the search never runs, says so instead of showing the no-results note. The search
page waits and retries the same way (see `GET /api/search/page` above).

Opening a document automatically records the displayed source version as read for
the selected participant. Opening a thread records its inspected current highlight,
comments and aggregate version. Other voices' receipts remain independent.
Changing the participant changes these receipts and bookmarks, not source content.
The setting is a trusted local identity selection, not a login or impersonation
defense. See [engagement](engagement.md).

Select a Markdown passage for the floating Highlight / Comment / Warn toolbar.
The toolbar appears after a mouse selection, after a touch selection settles
(`touchend`, or 450 ms after the last `selectionchange`, so dragged selection
handles also count), and from the keyboard: with a passage selected, `a` or
`Enter` shows the toolbar and focuses Highlight. On coarse (touch) pointers the
toolbar sits below the selection, clear of the browser's own selection menu.
A phrase that repeats inside one block is anchored at the repeat you selected:
the toolbar counts earlier repeats in the block's rendered text and uses the
matching source occurrence, refusing only when the rendered and source counts
disagree.
Background colors distinguish your highlights and other participants' highlights;
warnings have a red underline. Margin buttons and top-rail pips open discussion
with owners, replies and seen-by labels. Opening a thread moves focus to its heading
(the reply box is a few Tab stops away); Escape or × returns focus to the pip, pin
or control that opened it. Space t focuses the first thread in the list, `j` / `k`
or arrows move between threads and Enter opens one. A new comment or warning opens
its thread with focus inside it. Source offsets use Unicode code points
and a source SHA guard. Ambiguous or unsupported formatted selections are refused,
and orphaned anchors retain their quotes without an invented inline position.
Quotes in thread panels, the thread list, the annotation form and Unread discussion
cards are displayed as plain prose: Markdown markers (emphasis, code spans, links,
heading and list markers) are dropped for display; the stored anchor keeps the raw
source span. Counts use singular or plural nouns ("1 comment", "2 comments").
Original document bytes are never rewritten. See [annotations](annotations.md).
Margins anchor on source text, so loading them never validates the document's
catalog metadata: a legacy, partial or malformed header (for example a versioned
header without `type`) simply contributes no stable `document_id`.

A failing secondary request never replaces a document that has rendered (or is
rendering): versions and editions, what changed, the reading log, images and embeds,
margins, the read mark, the history/queue log, prose colors, diagrams, Linked from
and Read next each degrade on their own, with a quiet (non-error) toast such as
"Margins could not load: …" where a reader would otherwise miss something. Any other
failure after first paint also keeps the article and toasts quietly. Only a failure
to load the document itself (or its historical version) replaces the page with
"Document unavailable".

Markdown is sanitized before display. Local images and Obsidian embeds (see
[Embeds](#embeds)) are supported; external images do not load automatically.
Mermaid blocks are drawn as diagrams and TeX is typeset (see below).

Rendering scales linearly with document size. Block source coordinates come from
one code-point index built per render (a binary search per block), local image
targets resolve through `/api/resolve-batch` (at most 64 targets and about
12 KB of query per request, two requests at a time), and embeds resolve through
`/api/embeds` (one request for the first 16 and their nested embeds). The source projection that annotation
painting and passage selection use is built on first need, not before display.
Image loads trigger at most one scroll/pin reflow per animation frame. Mermaid diagrams are drawn and TeX is
typeset after first paint (see Diagrams and Math below). A document is
still sanitized in full before it is shown, so sanitizing remains proportional to its size.

In continuous reading, top-level paragraphs, headings, code blocks, tables, rules,
callouts, display formulas and diagrams carry `content-visibility: auto` (`style.css`), so
the browser lays out and paints only those near the window. On the synthetic 2 MB
benchmark a warm open is shown after about 0.6 s instead of 1.2 s. Lists, quotes, embeds and other
blocks whose children's margins collapse through them are not contained, because containment
would change their spacing. Margin pins, two-page columns (`body.two-page`) and PDF pages are
never contained, so pagination, the page turn and PDF reading lay out as before.

A skipped block counts as an estimated height until it is first laid out. Paragraphs and headings
estimate theirs from their text length; other blocks count as 240 px.
`contain-intrinsic-size: auto` then remembers each block's real height. `place.mjs` keeps what you
see steady while estimates turn into real heights:

- **Jumps hold their target.** A jump Reader makes in continuous reading (find, a heading link,
  the outline, `]]`/`[[`, an opened passage, a bookmark, the jump list, VISUAL motions)
  passes its element or range to `scrollToPosition`. A `ResizeObserver` on the top-level
  blocks re-seeks after each height change, so the target lands on the line it was sent to. A
  bookmark lands at its fraction of the block, measured on the block's settled height. The hold
  ends when you wheel, touch, click or press a key, or scroll the page yourself (a scrollbar drag),
  or when another jump or document replaces it.
- **`gg` and `G` hold the page's start and end.** They hold the edge itself, not a block, so `gg`
  ends at the top while the blocks it glides over settle (smooth scrolling has no scroll anchoring
  to keep its destination), and `G` follows the end as Read next and other end blocks arrive after
  it and lengthen the page.
- **Jumps measure what is shown.** With smooth scrolling the article glides behind the scroll
  position, so a jump computed from a block's on-screen position adds the shown offset
  (`shownTop()` in `place.mjs`, the content wrapper's offset), not `scrollY`. A find hit or
  heading taken mid-glide then lands at its line instead of off by the distance left to glide.
- **The smoother measures before a jump past its end.** ScrollSmoother maps the scroll position
  onto the page height it measured at its last refresh, and refreshes only once the article stops
  changing height. A jump whose target lies past that measure (blocks laid out taller than their
  estimates) refreshes the smoother's ScrollTrigger first (`smoothTo()` in `app.mjs`); otherwise
  the page glides to the old end and, if the refresh lands after the glide, waits there until the
  next scroll.
- **Smooth scrolling keeps the first block in view.** ScrollSmoother moves the article inside a
  fixed wrapper, which the browser's scroll anchoring cannot see. There, when blocks above the
  window change height, the view moves by the same amount, so scrolling up past blocks never laid
  out keeps the text still. `drawLate()` leaves that case, and any held jump, to `place.mjs`.
  Native scrolling relies on the browser's own scroll anchoring.
- **Pins follow.** Margin pins are positioned again after every block height change, and the
  progress pips shortly after.

The scrollbar length and the position percentage are estimates until the blocks are laid out.
`tests/web_content_visibility.cjs` checks the gain (at least 20% on warm opens) and the invariants
in native and smooth scrolling. With and without the rule, it compares source coordinates, pins
beside their passages, find, heading and outline jumps, the bookmark, the reading cursor's text,
the spacing of every block type, and steady scrolling up.

Find projects the article's visible text once (typed arrays of UTF-16 offsets, not
per-character objects) and keeps that projection until the article's text changes: a
`MutationObserver` on `#article` drops it on any text or element change (and on a
`data-reader-decoration` attribute change), except changes inside pins or decorations
and pins alone being added or removed. That covers a render, an
edition, embeds mounting (lazy ones too), late math, drawn diagrams and highlighted
code. A keystroke in find then only searches the cached text (about 2 ms on the 2 MB
benchmark); rebuilding after a change takes under 0.1 s there. Literal document find is capped at 2,000
matches; when more exist the count reads `1 / 2000+`. PDF find stops at 15 seconds, 32 MiB of extracted text or 2,000 matches,
reports partial coverage (its count also ends in `+`), and refuses pages above 200,000 text characters. It does
not perform OCR.

### Diagrams

Mermaid fences (```` ```mermaid ````) in Markdown documents and in embedded documents
are drawn by [Pele](https://pele.run) 1.10.0. Pele is a synchronous Mermaid renderer
with no runtime dependencies that targets Mermaid 12.1.0 syntax. `renderMarkdown`
wraps each fence in a `figure.reader-diagram`. The figure holds a canvas for the
drawing and a collapsed **Diagram source** disclosure containing the original code
block, with its copy button. The canvas and the summary are decoration
(`data-reader-decoration`); the code block keeps the fence text. Find therefore
matches diagram labels on their source lines, never in the drawing, and annotation
offsets of surrounding passages are unchanged.

- **Loading.** `controls/diagrams.js` (Pele's `pele/lazy` entry and shared core, about 39 KB) loads by
  dynamic `import()` only when a document contains a Mermaid fence. Each diagram type
  is a separate chunk under `controls/diagrams/`, so a document downloads only the
  renderers it uses. Until the drawing is ready the canvas shows a skeleton of
  estimated height. If the chunk fails to load, every diagram shows its source and a
  toast reports it.
- **Rendering.** Diagrams render one per idle slice (`requestIdleCallback` with a
  60 ms timeout, or `setTimeout`). `mount()` adapts the layout to the column width and
  re-renders when that width changes. The top-level document's diagrams (and its
  embeds') render after the reading position is restored and its math is typeset, so
  first paint never waits for them; when they finish, the block that was first in view is kept in view (unless
  you moved meanwhile) and spread counts are re-measured.
- **Errors and limits.** A diagram that does not parse, an unsupported type, a source
  over 64 KiB, or any diagram after the first 64 in a document shows its source
  expanded, with a muted line: "Couldn't draw this diagram: <reason>". Other diagrams
  and text are unaffected.
- **Safety.** Pele escapes text, filters links and styles, and limits source and
  output size. Reader renders with `links: false` and `images: false`, so links in
  diagrams are inert and nothing is fetched. It also passes Pele's SVG through
  DOMPurify's SVG profile, without `a`, `image`, `use`, `foreignObject` or `script`.
- **Theming.** `web/src/styles.css` maps Pele's variables to Reader tokens on
  `.reader-diagram`: `--pele-bg` to `--bg`, `--pele-fg` and `--pele-line` to `--ink`,
  `--pele-muted` to `--muted`, `--pele-surface` to `--surface`, `--pele-surface-alt`
  to `--raised`, `--pele-border` to `--line`, `--pele-accent` to `--accent`, and
  `--pele-font`/`--pele-font-mono` to `--sans`/`--mono`. `--pele-series-1..8` map to
  `--chart-1..8`. The radius is 6px. A theme change, including a live Theme Editor
  edit, recolors diagrams without re-rendering them.
- **Accessibility.** The canvas has `role="img"`. Its `aria-label` is built from the
  diagram's first line and up to 24 text labels. It is described by the source
  disclosure (`aria-describedby`).
- **Full size.** Click a diagram, or focus it with Tab and press Enter, to open it in
  a dialog at its natural size, enlarged up to 3× to fill the window. Escape closes it.
- **Layout.** A figure never breaks across columns. In two-page reading its drawing
  is limited to 58% of the viewport height and scaled to fit, so it stays within one
  column. At phone width the drawing scales to the column, and anything wider
  scrolls inside the figure rather than the page.
- **Page turn.** Diagrams appear on the turning sheet through the SVG image path
  described under **Page turn**.

Not supported: Mermaid inside PDFs or images, editing diagrams, diagram icons or
remote images, and Mermaid features that Pele does not implement. Those show their
source with Pele's error.

### Math

Display math (`$$…$$`, `\[…\]`) and inline math (`$…$`, `\(…\)`) in Markdown and
embedded documents are typeset by [KaTeX](https://katex.org) 0.19.1. Currency and
code stay exactly as written.

- **Syntax.** `web_ui/math.mjs` is a markdown-it plugin.
  - *Display math:* a line that starts with `$$` or `\[`. It closes at `$$` or `\]`
    ending the same line or a later one. An unclosed opener stays text. The block keeps
    `data-source-start` and `data-source-end` like a paragraph.
  - *`\(…\)`:* always math.
  - *`$…$`:* math only when all of these hold:
    - the opening `$` is not escaped, not preceded by a letter or digit, and not
      followed by whitespace, a digit or another `$`;
    - the closing `$` is the next unescaped `$` on the same line, is not preceded by
      whitespace, and is not followed by a letter, digit or `$`;
    - the content is TeX-ish: it contains `\`, `^`, `_`, `{` or `=`, a letter next to
      an operator (`+ - * / < >`), a spaced operator between operands (`k + 3`), or a
      Greek letter, arrow or mathematical symbol.
    A well-formed pair that is not TeX-ish is prose, and its closing `$` cannot open
    another span. Code spans and fences are never scanned.
  - *Opting out:* frontmatter `math: false` (also `no` or `off`) disables `$…$`
    detection for that document; `\(…\)` and display math still work.
- **Rendering.** Math becomes `.reader-math` placeholders carrying `data-tex`, which
  show the TeX until typeset. `controls/math.js` (KaTeX, about 264 KB) and
  `controls/katex/katex.css` load only for documents with math. The CSS references
  only the woff2 fonts copied into `controls/katex/fonts/`. KaTeX runs with
  `output: 'htmlAndMathml'`, `trust: false` (no `\href`, `\url` or `\htmlClass`),
  `strict: 'warn'`, `maxSize: 20` and `maxExpand: 1000`, in idle slices of about 12 ms.
  At most 2,000 formulas per document are typeset; the rest keep their TeX, and a
  toast says "Showing the first 2,000 formulas."
- **After first paint.** An open document (and the embeds mounted with it) is shown
  with its TeX placeholders as soon as the reading position is restored; typesetting
  starts afterwards, before its diagrams are drawn. Formulas within about a window
  (or a spread) of the reader go first. While heights change, the block that was first
  in view is kept in place at most every 100 ms and once at the end (spread counts are
  re-measured in two-page mode), unless you scroll, press a key or click meanwhile. When
  Reader moves you (a heading link, a passage from search, find or a thread), two-page
  mode keeps that target in view instead; continuous reading stops re-seeking and
  relies on the browser's scroll anchoring.
  When typesetting ends, highlights and an open find are drawn again from the typeset
  text, so TeX found in a placeholder is no longer a hit. Prose colors never color a
  formula. Embeds that load later, and the scratch preview, typeset as they render.
- **Errors.** A formula KaTeX rejects, such as an undefined macro, shows its original
  TeX in monospace with a dotted `--warning` underline. Its title gives KaTeX's
  message. Custom macros defined elsewhere (for example in another tool's preamble)
  are not available.
- **Annotations, find and copying.** The typeset KaTeX markup is decoration. Find,
  selection anchoring and highlight painting skip it, and a highlight beside inline
  math anchors to the surrounding text. Copying a selection that touches a formula
  copies the formula's TeX (`$…$` or `$$…$$`), with the rest of the selected text
  unchanged. KaTeX's MathML carries the semantics for screen readers.
- **Layout.** Formulas use the text color and size, so every theme works. Display
  math is centered and scrolls horizontally inside itself when wider than the
  column. In two-page reading it never breaks across columns, and a block taller
  than 60% of the viewport scrolls inside itself.
- **Page turn.** KaTeX HTML is drawn like other text, at the browser's glyph
  rectangles; fraction rules are borders, and KaTeX's SVG radicals and arrows use
  the SVG image path. The hidden MathML is skipped.

Not supported: math in PDFs (the PDF layer renders its own), `mhchem`, equation
numbering and cross-references, and author-defined macros.

## Local API and protection boundary

GET endpoints provide `/api/library`, `/api/document`, `/api/search`,
`/api/search/page` (the search page),
`/api/discussion`, `/api/resolve`, `/api/resolve-batch`, `/api/file`, `/api/maintenance` (job and
freshness status, plus a `local_model` run summary), `/api/local-model` (server
status, now, queue, recent, outputs, settings), `/api/next?path=…&participant=…` (Read next) and `/api/prose`
(Colorful discovery),
`/api/chats?path=…` (a document's chats and the public voice list), `/api/chat?id=…`
(one chat with its pending turns),
`/api/editions?path=…` (edition family), `/api/editions/diagnostics`,
`/api/versions?path=…` (family with git history), `/api/version?path=…&commit=…`
(a historical version), `/api/changes?a=…&b=…` (any two versions),
`/api/changes?path=…&participant=…` (what changed since a receipt) and
`/api/readers?path=…&participant=…` (the reading log),
`/api/links?path=…` (Linked from: `state` of `building`, `failed` or `ready`, up to 200
`inbound` rows of `{source, title, count, heading, fragment, line}`, `inbound_count`,
`inbound_links`, `outbound_count`, `unresolved_count`, `built_at`, `stale`),
`/api/preview?path=…&fragment=…&participant=…` (`{path, title, authors, project, read,
kind, heading, excerpt}`, excerpt at most 600 characters; an `inbox/` arrival is previewed
read-only with `read: true`, so it shows no unread mark), `/api/link-counts`
(inbound links, inbound source documents and outbound links per work primary) and `/api/speak/<id>` (progress of a
Reader-submitted AI-TTS utterance). `/api/readers` is read-only;
it reads every receipt once through `Engagement.receipts()` (at most 100
participants of 8 MiB each), compares each `document:<path>` receipt with the
cached digest of the current file, and counts threads per participant from the
document's annotation inventory. It returns `{path, version, participant,
readers: [{participant, group: voice|you|agent, state: current|earlier, at,
version, threads, folded}], folded, one_off_threshold}`; a malformed receipt file
or `voices.json` returns 400. `/api/standfirst?path=…` and `/api/issue?start=…&end=…` (the homepage issue) are
read-only as well, as is `/api/inbox` (arrivals, runner state, claims, whether Codex is
installed as `codex: {name, installed}`, and the reason a start is blocked), as is `/api/inbox/events?after=OFFSET` (the
activity transcript's event stream). Document GET alone is read-only.
`/api/resolve-batch?from=…&target=…&target=…` resolves up to 64 links from one
library document (or inbox arrival, which may resolve its own bundle's attachments) in order, returning `{"results": [...]}` with either the
`/api/resolve` result or `{"error": …}` per target; unresolved targets share one
inventory read, and more than 64 targets are refused. A draft with no file yet
passes its folder with a trailing slash (`from=library/notebook/`) to this route,
`/api/resolve` and `/api/embeds`: links resolve as from a file in that folder. The
folder must be a real, existing library folder (normalized, no hidden or `..`
parts, no symlinks on the way); the one exception is `library/notebook/` before the
scratch pad's first save creates it. A GET never creates it. A missing source
*document* still answers 404.
`/api/chat/raw?id=…&turn=…` returns one turn's (or listening check's) archived output, decompressed:
`stdout` (at most 4 MiB, with `stdout_truncated`; the archive keeps all of it),
`stderr`, `prompt` (1 MiB each), `system` (256 KiB), `meta`, `log` (the archive
path, or `null` for a turn that never started) and `running`. It needs no token;
the Host and Origin checks apply, and the log path must match the archive layout
with no symlinks. The archive keeps the real working directory, argv and prompt; the
answer shows the vault folder as `<vault>` and the home folder as `~`.
`/api/chat/stream?id=…` is a Server-Sent Events stream of `hello`, `state`,
`started`, `delta` (with a text offset; offset 0 replaces the streamed text),
`raw` (`{turn_id, stream: stdout|stderr, n, text, cut}`: each CLI line of a reply or
chime-in as it arrives, numbered per stream, cut at 2 KiB; listening checks send none), `posted` (`{message, revision}`: a newly stored user or pasted
message), `done`, `message` (a new hand, an updated
hand state or listening note), `warning` (a discarded listening check) and `commit`
events for one chat.
`hello` and `ping` carry `{revision, pending, interval}`: the chat file's revision,
the IDs of its queued and running turns, and the heartbeat in seconds. An idle
stream sends `ping` every 15 seconds (`WebServer.chat_heartbeat`; the browser
fixture's `--chat-heartbeat N` shortens it). At most four streams may be open, they use
neither request pool, and each closes after an hour (the browser reconnects). A stream
checks its connection every `WebServer.chat_hangup_check` seconds (0.25) and frees its
slot as soon as the client hangs up, rather than at the next failed `ping`.
POST `/api/chat` takes `{"action": "create"|"send"|"paste"|"cancel"|"retry"|"hand"|"settings"|"hush", …}`
and an optional `participant`. `send` accepts `reply_to` (a message id in the same
chat, otherwise 400); `paste` takes `body` and an optional `voice`, which must name a
manual voice in `voices.json` (default: the first one; 400 when there is none); `hand` takes `message_id` and `decision` (`accept` or
`decline`); `settings` takes `chime_ins` (`off`, `hands` or `free`); `hush` stops the
chat's listening checks, including those the current exchange has not queued yet.
A reply's follow-up turns and listening checks are queued before its `done` event,
and a listening check's `done` follows its `message` note on the reply. Pending turns carry `kind` (`turn`, `chime_in` or
`listen`); listening checks never stream text.
`/api/queue?participant=…&current=…` (`{now, queued, suggested, updated_at}` and
`/api/history?participant=…&cursor=…&tz=…&filter=finished` (paged day groups; `tz`
is a UTC offset in minutes, ±840, for clients that want server grouping; the web app
regroups by the local day of each `opened_at`) are read-only views as well.
The browser explicitly POSTs `/api/seen` after display. POST `/api/annotations`
uses the existing annotation dispatch contract; POST `/api/bookmark` verifies the
current source digest before persisting a position. POST `/api/maintenance`
accepts exactly `{"action": "start", "kind": …}` with a kind of `check`, `search`,
`search-keyword`, `browse`, `catalog` or `links`. POST `/api/local-model` accepts
`{"action": …}` with `server-start`, `server-stop`, `load {model}`, `unload {model}`,
`enqueue {task, scope: recent|all|path, path?}`, `run {task?}`, `pause {task?}`,
`cancel {id}`, `clear {task}`, `prune {task}` or `settings {settings}`, where
`settings` may hold `tasks`, `embedding_backend` and `provider {preset, base_url,
model, allow_remote, api_key}`; any other field is refused. The four server actions
are refused for any provider other than LM Studio on this machine. Stopping the
server is refused while the queue runs. POST `/api/speak` accepts
`{path, source_sha256, scope: "article"|"from"|"selection", start?, end?, page?}`,
re-reads and hash-checks the exact edition (as bookmarks do) and slices it by
source code-point offsets (`page` for a PDF's From here). POST `/api/speak/<id>`
accepts exactly `{"action": …}` with `pause`, `resume`, `skip`, `next_segment`,
`previous_segment` or `cancel`. A foreign id is refused with 403; an unavailable
daemon answers 503 with `unavailable: true`. POST `/api/inbox` accepts exactly
`{"action": "start", "sandbox_mode": "workspace-write" | "danger-full-access"}` or
`{"action": "stop"}`. A start returns the run id, the argv and the supervisor's first
state; a start while a run is active is a state conflict, refused with HTTP 409
(*The librarian is already reading the mail.*), and other refusals
with HTTP 400. Receipts, state and claims are read at most 256 KiB (claims 1 MiB),
reports their last 256 KiB, without following symlinks. `/api/inbox/events` reads at
most 256 KiB of `events.jsonl` per call from a byte offset (0 to 8 MiB, the
supervisor's stream cap) and returns only whole lines as parsed JSON, with
`next_offset`, `size`, `done`, the run id, status, arrival names and, once done,
the arrivals still remaining. A line still being written is held back until it
ends, or until the run is over. A line longer than one read, or one that is not
JSON, becomes a `reader.skipped` marker, and the next call resynchronizes at the
following newline. Long `aggregated_output`, `text` and `message` strings keep
their first 16 KiB and last 48 KiB (`reader_truncated` gives the original length).
Any other field over 64 KiB is dropped and named in `reader_dropped`. Vault paths
in file changes and agent messages are shown vault-relative. Nothing is read while
the run is `starting`, because the supervisor has not yet cleared the previous
run's stream. An offset past the end means a newer run cleared it (`reset`).
Failed, interrupted and stopped runs add the runner message and the last 8 KiB of
`stderr.log`. The route refuses symlinked `.reader/`, runtime directories and
event files. POST `/api/prose` colors visible prose of
the current edition (see Prose colors). POST `/api/queue` takes
`{participant, action: add|remove|move|pin|clear, path, index?, request_id, added_by?, reason?, current?}`
and returns the queue view. POST `/api/history` takes `{participant, action: "open", path, sha256}`
(the digest must match the current source) or `{participant, action: "hide", path}`. POST `/api/writing` takes
`{action: "save", body, title, slug, status, responds_to?, base?, shifted?, participant?, request_id}` and
writes one notebook file (see Scratch pad); 409 means the target exists (with `suggestion`) or the base changed. Source-file GET supports a
single bounded byte range for PDF loading. A well-formed library path with nothing
at it returns 404 (`No document at this path…`); other refused paths return 400.
`GET /api/health` returns
`{status, version, commit, pid, started_at, now, busy}`, where `busy` lists active
work a restart must not interrupt (a maintenance job, or an inbox run holding
`.reader/inbox-runner/run.lock`). `GET /api/service` returns the service script's
`status --json`, the requester's identity and the health record. POST
`/api/service` accepts exactly `{"action": "update" | "restart" | "pause" | "resume"}`
and runs the service script with explicit argv and a 20-second timeout.

Every request, static assets included, is identified before routing
(`src/reader_mcp/web_access.py`). A request with none of the proxy headers
(`X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `Forwarded` or any
`Tailscale-*` identity header) is *local*: its Host must be exactly
`127.0.0.1:port` or `localhost:port`, and any Origin `http://127.0.0.1:port` or
`http://localhost:port`. Any request carrying a proxy header is *proxied*, and is
refused unless the web config sets `trusted_proxy` to `tailscale`, the Host and
`X-Forwarded-Host` agree on a name in `allowed_hosts`, there is no
`Tailscale-Funnel-Request`, `Tailscale-User-Login` (RFC 2047-decoded, compared
case-insensitively) is in `allowed_logins`, and any Origin is in `allowed_origins`.
Tailscale passes the client's Host header through unchanged, so a proxied request
is recognized by its forwarding headers, never by its Host; a tailnet peer that
names `127.0.0.1` is still proxied and refused. Identity headers on a loopback
Host are therefore refused rather than trusted.

**No host paths in answers.** Because the same answers reach allowed tailnet browsers,
no `/api/*` answer names a host folder (#105). Search results carry the vault-relative
`path` only; the MCP tools, which serve local agents, keep `absolute_path`. Executables
are reported as `{name, installed}` (`codex` in `/api/inbox`, `server.cli` in
`/api/local-model`). Where a path is the information itself (a Companions card's path,
socket, store and setup commands; a chat turn's raw output; the inbox activity
transcript, report and stderr; error messages), it is shown with the vault as `<vault>`
and the home folder as `~` (`src/reader_mcp/display.py`); locations outside both, such
as `/opt/homebrew/bin`, stay as they are. `tests/test_api_paths.py` starts the
synthetic fixture, walks every GET route the router names (read from `web.py`, so new
routes are covered) and fails if any answer contains the fixture vault, the home
folder, the code checkout or the Python executable. A refused request gets 403: JSON
for `/api/*`, a plain *Not allowed* page otherwise. Writes also require JSON plus a
random session token, issued with `/api/library`; Reader sets no cookies. After a restart, an open tab refreshes its token through the small, uncached `GET /api/token` endpoint and retries its unchanged JSON request once. Refresh is triggered only by HTTP 403 with `code: reader_token_expired`, emitted before reading a request body or running an action. Concurrent writes in a tab share that refresh. Other permission errors, invalid content types, failed refreshes and uncertain network failures do not replay an action. The token endpoint retains the normal Host, Origin and proxy identity checks. CSP limits scripts, workers and
connections to this origin; raw files are sandboxed. Library paths must be
normalized, nonhidden and free of symlinks. Text documents are limited to 4 MiB,
other originals to 256 MiB, inventories to 10,000 works and POST bodies to 128 KiB
(1 MiB for `/api/prose`).
Every request is first identified by `web_access` (local Host/Origin rules, or a
Tailscale-proxied allow-listed login); a refused requester gets 403 before taking or
waiting for any slot. Admission then has three tiers: `/`, `/assets/`, `/fonts/` and
`/api/health` are never gated; writes (every POST, including `/api/maintenance`,
`/api/local-model`, `/api/inbox`, `/api/prose`, `/api/chat` and `/api/service`) and
expensive GETs (`/api/search`, `/api/search/page`, `/api/next`, `/api/prose`,
`/api/service`, `/api/chat`, `/api/chats` and `/api/chat/raw`) share eight slots and are refused immediately with HTTP 429 when all
are busy; other GET reads share 32 slots and wait up to five seconds before a 429.
`/api/chat/stream` (Server-Sent Events) takes no slot in either pool; it has its own
limit of four open streams. The listen backlog is 64, so a page load's parallel asset
connections are queued rather than reset. Connections time out after 30 seconds.
This is not a public network service or a multiuser authorization system.

If startup fails, check the configured vault, port availability and Python
environment. A missing work inventory can be regenerated with `reader browse`;
full-text recovery uses the existing search guide and its unchanged resource
guards. Corrupt bookmark or receipt records produce an explicit error: preserve
the record for inspection and restore it from backup rather than resetting other
participants. Browser-local layout, theme and dashboard preferences use
`reader.preferences.v1` in local storage; clearing it resets only those choices.

## Always-on service and Tailscale

`scripts/reader_service.py` (standard library only) runs Reader web as a macOS
LaunchAgent from a dedicated *live* worktree, keeps it on a source branch through a
smoke-gated updater, and optionally publishes it on your tailnet. Every subcommand
prints one JSON object.

| Command | Effect |
| --- | --- |
| `install [--repo R] [--live L] [--python P] [--vault V] [--source B] [--port N] [--env K=V]… [--skip-smoke]` | Creates the live worktree at the source commit if it is missing (after a smoke test), writes both plists atomically, backs up any existing plist it replaces, and loads them with `launchctl bootstrap gui/$UID`. Refuses a port already used by another process. |
| `uninstall [--remove-worktree]` | Boots out both agents, restores replaced plists (reloading them if they were loaded before install) or removes ours, and archives the state file. Tailscale is left to `tailscale off`. |
| `status [--json]` | Agents, paused flag, live and source commits, commit date and subject, last 10 updates, last and next check, Tailscale state. |
| `update [--now]` | The update gate below. Scheduled runs respect *pause* and skip a commit that already failed; `--now` (and a requested update) does neither. |
| `request-update` | Marks an update as requested and kickstarts the updater agent (without `-k`, so a running update is never killed). The Server card's **Update now**. |
| `restart` | `launchctl kickstart -k` the web agent, then waits for health. The card uses `restart --detach`, which restarts from a separate session after the request returns. |
| `pause`, `resume` | Stop or resume scheduled updates. |
| `smoke COMMIT [--repo R]` | Runs the update gate's smoke test for one commit, installing nothing. |
| `tailscale on \| off \| status` | Publishes Reader on the tailnet, reverts that, or reports it. |

Defaults: the repo is the checkout's common Git repository (the main
`reader-code`), the interpreter `REPO/.venv/bin/python`, the vault `READER_ROOT`
or `REPO/.reader/config.json`, the live worktree the existing install recorded
(else `~/Library/Application Support/Reader/live`, outside any checkout), the
source `preview/integration` and the port 8766. Executable paths (launchctl,
tailscale, git, git-locks) are resolved at install and recorded; tailscale and
git-locks are optional, and without git-locks the script's Git changes serialize on
`~/Library/Application Support/Reader/git.lock` (`READER_SERVICE_GIT_LOCKS=none` hides it);
`READER_SERVICE_LAUNCHCTL`, `READER_SERVICE_TAILSCALE`, `READER_SERVICE_GIT` and
`READER_SERVICE_GIT_LOCKS` override them (the tests use fakes).

**Agents.** `~/Library/LaunchAgents/com.flyingrobots.reader.web.plist` runs
`PYTHON LIVE/scripts/start_web.py --port 8766` in the live worktree with
`RunAtLoad`, `KeepAlive`, `ProcessType` Interactive and `ThrottleInterval` 10.
`com.flyingrobots.reader.updater.plist` runs `PYTHON LIVE/scripts/reader_service.py
update` every 600 seconds (`StartInterval`, Background, low-priority I/O). Both set
`PATH` (the installer's absolute `PATH` entries, then `/opt/homebrew/bin`,
`/usr/local/bin`, the system directories and `~/.local/bin`), `READER_ROOT`, `PYTHONPATH=LIVE/src` (ahead of the editable install of the
main checkout), and pass through `GIT_LOCKS_STORE` and every `READER_*` variable
present at install except `READER_SERVICE_*`. The script's own worktree and checkout
changes take the repo `.git/` key in the repository's default git-locks store, with
`GIT_LOCKS_STORE` removed from their environment. Logs: `~/Library/Logs/Reader/web.log`,
`updater.log` and `updates.jsonl`, each rotated by copy-and-truncate at 16 MiB with
three generations, checked on every updater run. State and backups live in
`~/Library/Application Support/Reader/` (`service.json`, `backups/`).

**The update gate.** Runs hold `update.lock` so they never overlap.

1. Resolve the source branch in the repo; stop if the live worktree is already there.
2. Add a temporary detached worktree for that commit (under the repo `.git/`
   git-locks key) and, with a 120-second total budget, run `python -m pytest -q
   tests/test_web.py` there, then start `tests/web_fixture.py` (a synthetic vault)
   and GET `/`, `/api/library` and the first listed document. The worktree is
   always removed.
3. While `/api/health` reports busy work, wait (polling every 15 s) up to 30
   minutes; then record *deferred* and retry at the next interval.
4. Refuse a live worktree with local changes; otherwise `git checkout --detach`
   it under the `.git/` lock, `launchctl kickstart -k` the web agent, and wait up
   to 60 seconds for `/api/health` to report the new commit.
5. If it does not, check out the previous commit, restart, and record
   *rolled-back* (or *rollback-failed*). The failed commit is not retried by
   scheduled runs.

Every attempted update, and every requested or `--now` run, appends its outcome to
`updates.jsonl`; scheduled runs that find nothing to do (current, paused, or a
commit that already failed) only refresh the last-check time.
The updater runs from the live worktree, so it is itself code that passed the
gate. New Python dependencies are not installed by the updater: the interpreter
is the main checkout's environment, and the smoke test runs in it, so a commit
that needs a missing dependency fails its gate.

**Tailscale.** `tailscale on` reads `Self.DNSName` and the owner's login
(`Self.UserID` → `User[…].LoginName`) from `tailscale status --json`, backs up
`tailscale serve status --json` and any existing web config, runs
`tailscale serve --bg --https=443 http://127.0.0.1:PORT`, verifies that every other
serve entry (for example an existing TCP forward) is unchanged, and writes
`<vault>/.reader/web-config.json`:

```json
{"allowed_hosts": ["HOST.TAILNET.ts.net"], "allowed_origins": ["https://HOST.TAILNET.ts.net"],
 "trusted_proxy": "tailscale", "allowed_logins": ["owner@example.com"]}
```

An existing `allowed_logins` list is kept; edit it to allow other logins. It
refuses when port 443 already serves something else, has a raw TCP forward, or has
Funnel enabled, and the script never runs `tailscale funnel`. `tailscale off` runs
`tailscale serve --https=443 off` (only for a handler it added), checks the other
entries again and restores the backed-up web config (or removes the one it created).
The config is re-read when it changes; `READER_WEB_ALLOWED_HOSTS`,
`READER_WEB_ALLOWED_ORIGINS`, `READER_WEB_ALLOWED_LOGINS` (comma-separated) and
`READER_WEB_TRUSTED_PROXY` override it. A malformed, oversized or symlinked config
refuses proxied requests and leaves local ones working. HTTPS needs MagicDNS and
HTTPS certificates enabled for the tailnet; Tailscale prompts for that on first use.
Identity headers are absent for tagged devices, which are therefore refused.

**Trusted front (off by default).** For the TypeScript port's strangler front
([plan](port/plan.md#migration-strategy-strangler-front)), the server can run behind
a front that owns the public port. Set `READER_WEB_FRONT_SECRET` (at least 32
characters) in the server's environment to turn it on; without it nothing below
applies and the `X-Reader-Front-Secret` and `X-Reader-Identity` headers are ignored,
so a client never gains an identity by sending them. With it set:

- Every request, pages and assets included, must carry the secret in
  `X-Reader-Front-Secret`, compared in constant time. A missing or wrong secret is
  a 403 (`Requests must come through the Reader front`); the request is refused,
  not served as local. The secret never appears in responses or logs.
- `X-Reader-Identity` carries the front's verdict as JSON, either
  `{"via": "local", "login": null, "name": null}` or
  `{"via": "tailscale", "login": "user@example.com", "name": "A Tester"}` (name
  optional). A missing, oversized or malformed identity is a 403. That identity is
  what handlers see, so a tailnet user stays a tailnet user across the hop (for
  example, still unable to set companion paths).
- The front forwards the client's `Host` and `Origin` unchanged, and the server
  re-checks them against the identity: a local identity needs a
  `127.0.0.1:<port>` or `localhost:<port>` Host (the front's port) and, if Origin is
  sent, `http://` plus that Host; a tailscale identity needs `trusted_proxy`
  `tailscale`, a Host in `allowed_hosts`, a login in `allowed_logins` and an Origin
  in `allowed_origins`, as for a direct proxied request. Forwarding and Tailscale
  identity headers are the front's business and are not consulted, but a
  `Tailscale-Funnel-Request` marker is still refused.
- Writes still need `X-Reader-Token` and a JSON body. `READER_WEB_FRONT_TOKEN`
  (at least 32 characters, honoured only with the secret) sets that token, so the
  front can hand out one token that survives a restart of this server; without it
  the server makes its own, as usual.
- A secret or token shorter than 32 characters stops the server at start and
  refuses every request if it changes later; the message names the variable, never
  its value.

The front must strip any client-sent `X-Reader-Front-Secret` and
`X-Reader-Identity` before setting its own; `tests/contract/security.test.mjs`
checks that a client sending them gains nothing.

**Installable app.** `/assets/manifest.webmanifest` (standalone, `start_url` `/`),
PNG icons in `web_ui/icons/` rendered from `mark.svg` by `scripts/render_icons.cjs`,
an `apple-touch-icon`, and a `theme-color` meta tag that follows the theme's
`--bg`. On iPhone use **Share › Add to Home Screen** on the tailnet address.

**Recovery.** If the web agent crash-loops, read `web.log`, then `status`; `update
--now` retries, and `git -C LIVE checkout --detach <good commit>` (`LIVE` is
`status`'s live worktree)
followed by `restart` pins a known-good commit. `uninstall` and `tailscale off`
revert what they changed.

## Development and validation

The small React/Base UI controls layer lives in `web/`; the document renderer,
dashboard, source coordinates and persistence remain in the existing modules.
`web/components.json` selects the official `base-nova` registry. Generated component
sources are retained under `web/src/components/ui/` and composed in
`web/src/reader-controls.tsx`; the Documents tree composition lives in
`web/src/document-tree.tsx`. Existing theme tokens feed Tailwind semantic colors;
Tailwind preflight is not enabled. Explicit cascade layers keep legacy styles
from overriding the component utilities.

From `web/`, use the locked dependencies and regenerate the checked-in assets:

```sh
npm ci
npm run check
npm run build
```

Run these within the workstation's shared build lock and project resource guard.
The build emits local JS/CSS, bundled license notices and a SHA-256 source/output
register under `src/reader_mcp/web_ui/controls/`. `controls/licenses/` and the
`dependencies` map in `controls/build-meta.json` are rebuilt from scratch on every
build and list exactly the npm packages with bytes in an output (esbuild's
`metafile.outputs[*].inputs[*].bytesInOutput > 0`, in `web/licenses.mjs`), plus
Tailwind CSS, tw-animate-css and KaTeX, whose CSS and fonts are copied outside
esbuild, and the shadcn/ui license. A package esbuild reads but tree-shakes out
entirely is not listed, and a removed dependency's license disappears with it;
`web_ui/vendor/` files keep their own license copies. Commit those assets together with
their editable sources and lockfile. To recover from missing or stale controls,
rebuild from the lockfile; do not substitute a CDN script or loosen the CSP.

`scripts/vendor_web.py` refreshes pinned npm tarballs without running install
scripts. It verifies registry SHA-512 integrity and records SHA-256 asset hashes
in `web_ui/vendor/manifest.json`. Review dependency changes and retained licenses;
[third-party notices](../THIRD_PARTY_NOTICES.md) describe the exceptions to Reader's
own Apache license. Browser assets ship inside the Python package.

Tracked files stay repo-relative: `tests/test_no_absolute_paths.py` scans every
tracked text file (except lockfiles and the built `web_ui/controls` and `web_ui/vendor`
bytes) and fails on macOS, Linux and Windows home-folder paths, a checkout under a
home `git` folder, the macOS temporary folder, and names of sibling checkouts or
worktrees of this repository (outside the changelog), apart from a short allowlist
that gives a reason for each entry and is itself checked for stale entries. Reader's
own locations outside the vault are the app data, log and LaunchAgents folders under
`~/Library`, the AI-TTS socket and tool caches.

Browser suites (`tests/web_*.cjs`) load Playwright from the repository's own
development dependency: run `npm ci` once at the repository root, which installs the
exact `playwright-core` pinned in the root `package.json` and `package-lock.json`.
It is a development-only dependency and is not shipped with Reader, so it is not
listed in the third-party notices. `playwright-core` downloads no browser; the suites
drive the installed Google Chrome (`/Applications/Google Chrome.app` on macOS). Three
environment variables override the defaults: `READER_CHROME` names another Chrome or
Chromium executable (required off macOS), `READER_PLAYWRIGHT` loads a different
`playwright-core` checkout by absolute path, and `READER_PYTHON` names the Python
that runs the fixture server (default `.venv/bin/python`).

Python tests import this checkout's `src` first: `tests/conftest.py` puts its absolute
path at the front of `sys.path` and `PYTHONPATH` (so subprocesses started from another
directory see it too) and stops the run if `reader_mcp` still resolves elsewhere, for
example from a shared virtual environment that is an editable install of another
worktree.

Synthetic checks, without opening the configured vault:

```sh
.venv/bin/python -m pytest -q tests/test_no_absolute_paths.py
.venv/bin/python -m pytest -q tests/test_web.py
node --test tests/web_logic.test.mjs tests/callouts.test.mjs
node tests/web_browser.cjs
node tests/web_breadcrumbs.cjs
node tests/web_search_retry.cjs
node --test tests/dashboard.test.mjs tests/magazine.test.mjs
node tests/web_dashboard.cjs
node tests/web_magazine.cjs
.venv/bin/python -m pytest -q tests/test_demo.py
node tests/web_demo.cjs
.venv/bin/python -m pytest -q tests/test_static_demo.py
node tests/web_static_demo.cjs
node tests/web_static_demo_ui.cjs
node tests/web_static_chat.cjs
node tests/web_controls.cjs
node tests/web_documents.cjs
node tests/web_source.cjs
.venv/bin/python -m pytest -q tests/test_themes.py
node tests/web_themes.cjs
node tests/web_page_turn.cjs
node tests/web_spread_pin_pages.cjs
node tests/web_shape.cjs
node tests/web_art.cjs
node --test tests/art_scene.test.mjs
.venv/bin/python -m pytest -q tests/test_art.py
node tests/web_diagrams.cjs
node tests/web_code_block.cjs
node --test tests/math.test.mjs
node tests/web_math.cjs
.venv/bin/python -m pytest -q tests/test_maintenance.py tests/test_related.py tests/test_index_scale.py tests/test_shape.py
node tests/web_backstage.cjs
node --test tests/admin_routes.test.mjs
node tests/web_admin.cjs
node --test tests/reading_log.test.mjs
node tests/web_reading_log.cjs
node --test tests/dates.test.mjs
node tests/web_dates.cjs   # America/Los_Angeles and Asia/Tokyo

.venv/bin/python -m pytest -q tests/test_speech.py
node tests/web_speech.cjs

.venv/bin/python -m pytest -q tests/test_inbox_view.py tests/test_inbox_runner.py
node --test tests/activity.test.mjs
node tests/web_inbox.cjs

node tests/web_outline.cjs

.venv/bin/python -m pytest -q tests/test_links.py
node tests/web_links.cjs

.venv/bin/python -m pytest -q tests/test_editions.py
node tests/web_editions.cjs
.venv/bin/python -m pytest -q tests/test_changes.py
node tests/web_changes.cjs
.venv/bin/python -m pytest -q tests/test_chats.py tests/test_llm_logs.py
node tests/web_chat.cjs
.venv/bin/python -m pytest -q tests/test_local_model.py tests/test_local_provider.py
node tests/web_local_model.cjs
node tests/web_local_provider.cjs
node tests/web_index_scale.cjs
.venv/bin/python -m pytest -q tests/test_versions.py
node tests/web_versions.cjs
node tests/web_versions_late.cjs
.venv/bin/python -m pytest -q tests/test_search_page.py
node tests/web_search_page.cjs
.venv/bin/python -m pytest -q tests/test_prose.py
node tests/web_prose.cjs
.venv/bin/python -m pytest -q tests/test_queue.py
node tests/web_queue.cjs
node tests/web_perf.cjs
node tests/web_resilience.cjs
.venv/bin/python -m pytest -q tests/test_service.py
node tests/web_service.cjs
node tests/web_callouts.cjs
node tests/web_offline.cjs
node tests/web_chat_sync.cjs
node tests/web_selection.cjs
node tests/web_modal.cjs
node tests/web_spread_resize.cjs
node tests/web_outline_fixes.cjs
node tests/web_routes.cjs
node tests/web_threads.cjs
node tests/web_focus.cjs
node tests/web_search_fixes.cjs
node tests/web_find_cap.cjs
node tests/web_spread_pins.cjs
.venv/bin/python -m pytest -q tests/test_companions.py
node tests/web_companions.cjs
```

### Browser flakes: condition waits and the stress loop

Browser suites wait on conditions, not fixed sleeps, before they assert state.
`tests/web_wait.cjs` provides `waitFor(page, label, condition, {timeout, arg})`: the
condition runs in the page (or a frame) and returns named values, and the wait ends
when all are truthy (names starting with `_` are only reported). On timeout it throws
with the label, every value, the focused element, the route and the 429/5xx responses
the page's context received (`watch(page)` records them). `settled(page)` waits until
the page height and scroll position hold still for two frames. The condition is sent
as a function, never as a string, because Reader's CSP has no `unsafe-eval`.

Suites never depend on when they run. `reader_mcp/clock.py` is the clock behind
Reader's calendar answers (the library's and history's `today`, the inventory date,
read and comment timestamps); `READER_TEST_CLOCK` (an ISO instant with an offset,
set only by tests) starts it at that instant and lets it advance in real time.
Timeouts and durations keep the real clocks. The `--magazine` fixture pins it to
Wednesday 2026-10-21 12:00 UTC, dates the issue's pieces from it and reports it as
`now` on its first line; the suites that show the issue (`web_magazine`, `web_art`,
`web_art_owner`, `web_art_prompt`, `web_shape`) pass that to `pinDate(context, now)`
from `tests/web_clock.cjs`, which starts the page's `Date` at the same instant. It
changes only `Date`: Playwright's clock also replaces timers, `requestAnimationFrame`
and `performance.now` with timer-driven fakes, which changes what frame-rate,
transition and hover-delay checks measure. Suites that need to step timers use
`page.clock` directly (`web_dates`).

Chrome 156 and later report a CSP violation when any parser in the page, inert
ones included, meets an inline event handler, so DOMPurify parsing a fixture's
untrusted `<img onerror>` logs one although nothing runs. `sanitizerReport(message)`
in `tests/web_wait.cjs` is true for that report only (raised from
`/assets/vendor/purify.min.js`); suites whose documents contain such markup skip it
in their console-error checks and still fail on every other console error.

`scripts/browser-stress.mjs` repeats named suites, optionally under CPU load, to
measure flakes:

```sh
node scripts/browser-stress.mjs --iterations 10 --burners 16 web_page_turn
```

Each iteration runs every named suite once, in order, each as its own process group.
`--burners N` starts N busy-loop worker threads for the run (default: CPU count − 2;
`0` for none). `--timeout` caps each suite run (240 s; SIGTERM, then SIGKILL),
`--deadline` stops starting suites after that many minutes (5: ten repeats of one
suite tell more than a long campaign, and a short run does not hold up other work),
and logs are capped at 2 MiB per run and `--log-budget` MiB in total (128); passing
logs are deleted unless `--keep-passing`. Suites get an owned `TMPDIR` under `--out`
(default `$TMPDIR/browser-stress-<time>`), and leftover `reader-web-fixture-*` folders there
are counted and removed. `scripts/browser-stress-track.cjs` is preloaded to count
429 and 5xx responses per run without changing what the suite does. The summary
(per suite: runs, failures, the failing line and message, 429s; fixture counts; log
bytes) is printed and written to `summary.json`; the exit status is 1 when any run
failed.

`tests/test_companions.py` and `web_companions.cjs` use `tests/fake_toolchain.py`:
fake `git`, `cargo`, `git-locks` and `launchctl` that record their argv. The fake
`cargo build` writes a `colorful` that runs `fake_colorful.py`, so prose colors work
after a fake install; nothing is cloned, built or started, and AI-TTS and launchd are
never touched. Every case runs with git-locks hidden (`PATH=/usr/bin:/bin`,
`READER_GIT_LOCKS_CANDIDATES=` and no store), covering chat, voice-turn and scratch pad
commits, the inbox runner's sandbox paths, the GPU lock and a local-model batch. The
browser fixture's `--no-git-locks` does the same for the server, and `--companions`
supplies the fake tools, a missing Colorful and a stand-in `install_wide_md.py`;
`web_companions.cjs` runs both with `--chat --writing --local-model`.

`tests/test_prose.py` and `web_prose.cjs` use `tests/fake_colorful.py`, a small
stand-in that emits `colorful.syntax/v1` artifacts from fixed word lists and has
modes that corrupt the artifact or the process (reversed, overlapping,
out-of-bounds and mid-character ranges, wrong version or hashes, illegal axes, an
outline cycle, a hang, an output flood, an old version, a failure exit). The
browser fixture takes `--prose` (fake CLI), `--prose-missing` (no binary) or
`--prose-real` (normal discovery, for example with `READER_COLORFUL`). One pytest
case runs the real binary when discovery finds it and is skipped otherwise:

```sh
READER_COLORFUL=/path/to/colorful-language/target/release/colorful \
  .venv/bin/python -m pytest -q tests/test_prose.py
```

`web_reading_log.cjs` starts the fixture with `--reading-log`: Reader librarian
reads `thought.md`, the file is revised, then Agy and two one-off task agents read
the new edition, and Agy owns a thread. It checks marks and order, keyboard
expansion, folding, the thread filter, find exclusion, 390 px width, contrast of
the log's text in all 22 built-in themes, the PDF empty state before *You just
now*, two-page placement and the unavailable state.

`web_inbox.cjs` starts the fixture with `--inbox`: two receipted bundles, a loose
file and a fake Codex executable set through `READER_CODEX`. The fake replays
`tests/fixtures/codex-exec-scripted.jsonl`, a scripted `codex exec --json` sequence
covering every transcript component, and files the arrivals at its file change. In
the fixture vault, `.fake-pause` holds the replay after the failing test run so the
live transcript can be inspected, `.fake-slow` waits a minute (for Stop), and
`.fake-fail` exits 1 with a traceback on stderr. The browser test also checks
WCAG contrast of the transcript's prose, lines, errors and terminal text in every
theme. `tests/activity.test.mjs` runs the reducer on that sequence and on
`tests/fixtures/codex-exec-real.jsonl`, a synthetic transcript in the event shape of a
real Codex 0.163.0 inbox run, with placeholder paths and IDs and command output replaced by byte counts. The real supervisor runs against the
disposable vault; neither test invokes the real Codex CLI. A model-driven run on a
real inbox is a separate live acceptance.

`web_outline.cjs` starts the fixture with `--outline`, which adds a document with
an embedded document, a two-heading note, a 161-heading document for level folding and an eight-page PDF with a nested
outline and a named destination, beside the 44-chapter document and the
outline-free PDF. `web_outline_fixes.cjs` adds `--maintenance` so Read next
appears at the end of the 44-chapter document.

`tests/test_changes.py` builds a temporary git repository as the vault and
checks that recovery leaves its index, refs and status untouched.
`web_changes.cjs` starts the fixture with `--changes --editions`: the fixture
commits a document, records receipts for the tester and Agy plus two
annotations, then changes the working copy. Both need `git` on `PATH`.

`web_editions.cjs` starts the fixture with `--editions`: a v1/v2/v3 essay chain
(vault-path and sibling-relative `previous_version`), a reading copy of v2 and a
catalog note for v2.

Chat tests never run a model CLI. `tests/fake_voice.py` is a stand-in that prints
deterministic Claude-, Codex-, agy- or text-style output, or unreadable JSON, and
can sleep, hang, spawn a grandchild, write or commit a file, or exit non-zero. Its
agy style copies the shapes of real agy stream-json (interim narration, tool steps
that succeed and fail, a streamed draft, `result.response`, a missing result or a
failed status). Setting `READER_AGY_SAMPLE` to a saved real agy stdout file also
checks the parser against it; the test is skipped otherwise, and such files are
private and never committed. It recognizes listening
checks and answers them with `--listen` (default `PASS`, or `HAND: …`), optionally
writing `--listen-write PATH`, and answers chime-in turns with `--chime-reply`. `tests/chat_vault.py`
builds temporary Git vaults whose `voices.json` points at it, and a git-locks shim
records lock invocations without touching a real lock store. `web_chat.cjs` starts
the fixture with `--chat`, which adds the fake voices plus a hanging *Sloth* voice
for the cancel check and a *Garbled* voice whose output Reader cannot read, makes
the fake Agy raise a hand in listening checks, and seeds the random choice. `web_chat_sync.cjs` adds `--chat-heartbeat 0.5`, opens
one document's chat in two tabs, then stops the fixture with `SIGSTOP`/`SIGCONT`
and finally `SIGKILL` to check the lost-connection state. A live check needs the real
`voices.json` and authenticated CLIs.

Local-model checks never touch the real LM Studio. `tests/fake_lmstudio.py` is a
fake OpenAI-compatible loopback server (streamed SSE with chunked encoding,
`/v1/models`, `/api/v0/models`, `/v1/embeddings`) and a fake `lms` whose `server
start` spawns that server on the requested port. Its answers are built from the
document's own words, with planted markers for an invented name/number and a slow
answer. The GPU lock is injected (`LocalModel(gpu_lock=…)`), so tests never use the
workstation store. Every browser fixture gets a dead port and a missing CLI unless
started with `--local-model`, which installs the fakes and three extra notes.

`tests/fake_openai_servers.py` runs in-process fakes of Ollama's and llama.cpp's
OpenAI-compatible APIs with their response shapes and omissions (no rate or usage
unless asked for Ollama, `reasoning` versus `reasoning_content`, llama.cpp's
`timings`, a `content: null` first chunk, embeddings without `index`, a plain JSON
answer without `finish_reason`, Ollama's 404 for a missing model), plus switches for
an API key, an error event and a cut stream. Its `guarded_connect` lets only
running fakes answer, so a real server on 11434 or 8080 is never contacted;
`loopback_connect` routes a "remote" URL to a fake. `tests/test_local_provider.py`
uses them; the fixture flag `--local-provider` starts both fakes, prints their URLs
as `providers`, refuses every other loopback port and answers non-loopback URLs with
the fake Ollama, so `web_local_provider.cjs` exercises the remote opt-in without
leaving the machine.

`web_search_page.cjs` starts the fixture with `--search-page`. It adds works across
projects, authors, types and dates, a reading copy, a catalog bundle with a machine
receipt and one read work, and builds a real format 2 index whose vectors come from a
deterministic concept-word model (plumbing evidence, not semantic quality). It writes
`search-paper.png`, `search-ink.png`, `search-gruvbox-dark.png`, `search-phone.png`
and `search-phone-filters.png`.

`web_index_scale.cjs` starts the fixture with `--index-scale`. It builds a real
keyword-only format 2 index with small budgets, including one machine file, beside a
leftover synthetic format 1 file. It checks the budget, machine-file and inventory facts,
then the "Old search index (format 1, no longer read)" note and its explicit removal. Its embedding rebuild is a
synthetic run that stops at its time limit, to check the toast and Recent runs.

`tests/test_versions.py` builds a temporary git vault holding a v1/v2/v3 family
(v1 committed twice) and checks combined family and history, the per-path and
family caps, the time bound, a vault without git, content at a commit, refused
revision expressions and foreign commits, any-to-any comparisons, the hash
budget, the routes, and that index, refs, status and `.git` are unchanged.
`web_versions.cjs` starts the fixture with `--editions --versions`, which commits
that family in git (v1 on Oct 12, revised on Oct 15 with v2, v3 and the reading
copy). It checks the chip and twin, the Space v timeline, a read-only historical
version (no POST at all while it is open), comparisons in both directions,
two-page stability and the phone sheet. `web_versions_late.cjs` uses the same
fixture and delays every `/api/versions` answer by 2 s (a Playwright route): the
article must be visible before the timeline arrives and within 600 ms of asking
for it, the chip and twin follow, a saved place stays on the same paragraph in
scroll and two-page reading, and edition and `@commit` deep links open what they
name. All three need `git` on `PATH`.

`web_queue.cjs` starts the fixture with `--queue` (the Read next works plus a
longer document in another project). It checks the panel, keys, toasts, reorder
across a reload, Space n, History progress and resume, hiding a row without
touching the receipt, rendered text contrast of the panel in all 22 built-in
themes, the phone bottom sheet, and that no request leaves the origin.

`web_perf.cjs` starts the fixture with `--perf`, which adds a synthetic ~2 MB
document (400 sections with emoji prose, 200 code blocks, 100 local images, two
Mermaid fences and a late annotation). It fails if continuous or two-page first
render exceeds 5 s (`READER_PERF_FIRST_RENDER_MS`), a find exceeds 2.5 s
(`READER_PERF_FIND_MS`) or the median of later find keystrokes exceeds 30 ms
(`READER_PERF_KEYSTROKE_MS`). It checks that find sees article text added, edited
and removed after its projection was built, that its hits are the ranges the older
per-character projection gave, and checks exact code-point anchors, two batched resolve
requests, the annotation highlight, resume after reopening and a page turn. The
ceilings are deliberately generous; the run prints the measured times.

`web_resilience.cjs` starts the fixture with `--resilience`, which adds a
versioned document without `type`. It checks that its margins load, that failing
discussion, read-mark and Read next requests keep the article visible with quiet
toasts, and that 48 concurrent asset and read fetches all succeed.

`tests/test_service.py` runs `reader_service.py` against fake `launchctl`,
`tailscale`, `git` and `git-locks` executables with a temporary HOME, a stand-in
health server and per-commit worktree templates whose smoke tests pass or fail.
It never touches launchd, Tailscale, `~/Library` or a real repository.
`web_service.cjs` starts the fixture with `--service`, a fake service whose
requested update lands one second later.

`web_routes.cjs` starts the fixture with `--fragments`, which adds a document with a
heading far from its start and a document linking to it.

`web_backstage.cjs` starts the fixture with `--maintenance`. It replaces the
embedding rebuild with a 1.2-second synthetic job and makes catalog sync fail, so
the success and error toasts are deterministic. The keyword-only rebuild and the
freshness check run for real against the disposable fixture vault.
`web_offline.cjs` aborts every request at the network level with Playwright routing
to check the coalesced unreachable toast and its recovery.

Speech checks never reach the real AI-TTS daemon or play audio. `tests/fake_aitts.py`
is a synthetic AF_UNIX daemon with the AI-TTS response shapes; `test_speech.py`
points `AI_TTS_SOCKET` at it in a short `/tmp` folder (macOS limits socket paths to
104 bytes). The browser fixture always sets `AI_TTS_SOCKET` to its own folder; with
`--speech` it starts the fake daemon there, advancing playback one segment every
0.7 seconds, and prints the folder so `web_speech.cjs` can read `requests.jsonl`
and create the `held` and `down` flag files. A manual smoke test against the real
daemon submits a short document and confirms `ai-tts get <id>` reaches `Played`.


`web_magazine.cjs` starts the fixture with `--magazine`: pieces dated this week and
one and two weeks earlier (relative to the run date), a newsletter for this week
that links two of them, one read piece and an excluded Task. It checks the cover,
features, standfirst, keys, issue URLs, the dashboard on Reader Admin's Library page, the
contrast of the issue's text against the page in all 22 built-in themes, the
sections index jump, and, at 1920 and 2560px, that there is no horizontal scroll, the
content spans at least 85% of the window with 32px margins, the rail and second lead
sit beside the cover, standfirsts stay within 75ch and contents gain columns (at
least four, then five). It also checks 1280px and phone width. `web_dashboard.cjs` opens the dashboard at `#admin/library`.

`web_links.cjs` starts the fixture with `--links`: 13 citing notes and a link sampler
pointing at `library/thought.md`, with a heading fragment, a wikilink, an external and a
missing link. The link graph builds for real, quietly, on the first document opened.

`web_modal.cjs` starts the fixture with `--modal --search-page`: a note with
footnote markers, links, a table and a figure beside the synthetic thought and the
indexed search-page documents. It checks that the generated help lists every
mapped key, VISUAL highlight anchoring with unchanged source bytes, VISUAL LINE
comments, `]c`, counts, command-line completion, history and suggestions, no key
capture while typing, marks, `''`, Ctrl-o, registers and Ctrl-r, `:grep` with
`]q`, footnotes, `]l` with `K`, `]f`, `gd` and two-page VISUAL turning the spread,
with no page errors or external requests. `node --test tests/keys.test.mjs` covers
the parser: counts, registers, timeouts, the leader, declining rows and Escape.

`web_page_turn.cjs` launches Chrome with SwiftShader WebGL (`--use-angle=swiftshader`),
so it needs no GPU.

`web_shape.cjs` also runs on SwiftShader. It starts the fixture with `--magazine
--shapes`: the cover becomes a long synthetic essay that wanders through invented
topics and returns to its start, one feature a tight note on one topic, plus short
related works, indexed with `tests/shape_fixture.py`'s deterministic topic model.
It checks that the magazine draws no shapes, then the data view (`:shape`) on an
article: a still under reduced motion (one frame, identical pixels across reloads),
its order and description, arrows, hover and click to a passage, two articles
(different pixels), a short piece, the live canvas (at most 30 fps), the SVG without
WebGL, 390px, and, in a second fixture run with `--shapes-terms` (an index without
vectors), the term form.

`web_art.cjs` runs on SwiftShader with `--magazine --art`: a Git vault with one fake
voice (`tests/fake_voice.py --art-scene`, answering art prompts slowly enough to
watch) and handcrafted art stored for the cover and one feature. It checks the still
cover and thumbnail under reduced motion, the order, label and description (the
brief), the Artist's note and provenance, the still image captured for later, a
theme repaint, the live canvas (at most 30 fps, paused off-screen, update-and-submit
median under 34 ms and at least 8 fps, printed), a scene at the edge of every budget
(kept moving or turned into a still by the kill switch, printed), the stored still
without WebGL and the unavailable note without one, a scene refused by the page's
validator, the placeholder → Generate art → job toasts → art flow, `:generate-art`,
versions and a favorite, the Art studio card and settings, 390px, and, with
`--art-none`, automatic commissions once and the setting off. `tests/test_art.py`
covers the validator (shared fixtures, the recorded fuzz corpus and a fresh fuzz
campaign), the pipeline with fake voices and a fake local model (storage, logs,
commits, repair, failure, cancel, versions, favorites, stills, recovery, refusals,
low disk) and the routes; `tests/art_scene.test.mjs` checks that the page's validator
gives exactly the same errors on the same fixtures (`tests/art_fuzz.py` regenerates
`tests/fixtures/art/fuzz.json`). `tests/test_shape.py`
covers the route: determinism, sign-fixed projection, the 400-passage cap, the term
form, neighbours in the same basis, thread weights, the 64 KiB bound and refusals.

Theme and font checks use a fake Google Fonts fetcher (`tests/test_themes.py`
`FakeFonts`, also passed to the browser fixture with `--themes`) and never contact
the network.

The browser harness launches a disposable synthetic server on an ephemeral port,
closes its browser and server at completion, and writes screenshots under ignored
`.reader/web-dev/`. Respect the project's shared-resource locks and storage/runtime
guards when running campaigns. The fixture never loads the configured private vault.

### Article quizzes

**Test yourself**, the margins’ **Quiz** button, **Space x** and `:quiz` open a quiz for the current article. Generation uses configured voices; multiple choice is graded locally and optional short answers can be reviewed by a voice. Results appear in the reading log without changing read status. See [the complete quiz contract](quizzes.md) for source verification, edition behavior, storage, API, limits and recovery.
