# Design sheet: Versions timeline

The body of the Versions panel (`Space v`, or the version chip). Source: `web/src/versions-timeline.tsx`; the model is `timelineModel` in `src/reader_mcp/web_ui/versions.mjs`, which renders it into `#versions-body` with `renderVersionsTimeline`.

## Focused activity

**Find the version you mean, and compare two.** The timeline lists a document's editions (versions, reading copies, the original), each with its git history. It shows where you are (●), what you read (◐) and the newest edition (★). `j`/`k` move, `Enter` opens, and `c` marks one version and then compares it with a second.

## Composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Button` (Compare with current, Compare side by side, Open vN, the per-row compare icon, cancel), `Badge` (reading, you read, newest, edited, same as file), `Kbd` |
| Molecules (shadcn) | `Collapsible` for each edition's history, open where you are, with content kept mounted |

`versions.mjs` keeps the state (the version marked to compare from, the last focused row), the keyboard model and the click handling. It reads them from the rendered `data-*` attributes, so the component holds no state of its own. The root is keyed by document, so each document opens with its own history disclosures. The panel around it is still the shared side panel (see the audit).

## Test hooks

`[data-vt-item=file|commit|history]` with `data-ref`, `aria-current` and `data-marked`; `[data-vt-edition]`, `[data-vt-name]`, `[data-vt-mark]`, `[data-vt-tag=here|read|newest|edited|same]`, `[data-vt-when]`, `[data-vt-subject]`, `[data-vt-reader=own|other]`, `[data-vt-note]`, `[data-versions-hint]`, `[data-compare-ref]`, `[data-compare-current]`, `[data-compare-split]`, `[data-open-ref]`, `[data-unmark]`.
