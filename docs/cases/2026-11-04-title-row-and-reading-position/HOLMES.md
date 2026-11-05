# Testimony of Sherlock Holmes: six commits on `flyingrobots/reader`, pinned at 71f0041e

Most of this ledger balances, Watson, but one headline does not. Commit 39417c9c announces that a reader at the top stays at the top. On a phone, or in any window about 1000px tall or more, a document with its own `# Title` reopens with the title moved away. I watched it happen.

**Method.**
- I read every diff and the surrounding code.
- I did not run the browser suites.
- I ran two small probes of my own in Chrome against throwaway fixtures, including one stylesheet counterfactual served by network route.
- Logs are at [`evidence/probe.log`](evidence/probe.log) and [`evidence/probe2.log`](evidence/probe2.log).
- `git status --short` in the pinned checkout listed nothing after either probe.

## The four drifts

### 1. "Keep a reader at the top of a document at the top" (39417c9c): DRIFT, and a live bug

The guard falls forward once any block has passed the save line:

`if(!target&&blocks.some(el=>el.getBoundingClientRect().bottom<=line))…` (`src/reader_mcp/web_ui/reading.mjs#151@71f0041e`)

The flaw is that a document's own `# Title` *is* such a block:
- The source H1 is adopted as the title and is not marked as decoration, because only a generated placeholder gets that attribute (`src/reader_mcp/web_ui/app.mjs#590@71f0041e`, `src/reader_mcp/web_ui/app.mjs#592@71f0041e`).
- `capture` filters only `.document-embed` from its blocks (`src/reader_mcp/web_ui/reading.mjs#139@71f0041e`).
- Observed: the H1 carries `data-source-start="163"`.

So once the H1's bottom is above the line, the title itself counts as "gone by", and the first paragraph is named. I measured this with the suite's own gesture: scroll to 1, scroll to 0, reload.

| Viewport | Line | H1 (top–bottom) | Saved `source_offset` | Reopen `scrollY` |
|---|---|---|---|---|
| 1300×520 (the suite's window) | 114 | 132–200 | null | 0 |
| 1300×700, 1440×800, 1440×900 | 154–198 | 132–206 | 163 (the H1) | 0 |
| **1440×1000** | 220 | 132–206 | **189** | **126** |
| **1920×1200** | 264 | 132–206 | **189** | **82** |
| **390×664 (phone)** | 146 | 102–141 | **189** | **135** |

- **Why the test misses it.** It runs only at 1300×520, where the line sits above the H1 (`tests/web_versions_late.cjs#15@71f0041e`, `tests/web_versions_late.cjs#96@71f0041e`, `tests/web_versions_late.cjs#103@71f0041e`).
- **Origin.** Deduction from the diffs, not measured: 9759c6e2 introduced this behaviour, since its parent saved no block here and restored by share.
- **What holds.** Documents whose title is generated have no such block. That follows from the code, but I did not probe it, nor any document with a hero.

### 2. "…which the reading log already says" (1f0beac9, and `src/reader_mcp/web_ui/versions.mjs#42@71f0041e`): DRIFT

The log does not say when you read this file on a return visit:
- Every open overwrites your timestamp (`src/reader_mcp/engagement.py#156@71f0041e`).
- The docs promise the line then shows *You just now* (`docs/web.md#1967@71f0041e`).
- Observed after a reload: `["◉ You just now","6 task agents"]`.

The removed chip could show the earlier date, because `/api/versions` is requested before the read mark is recorded (`src/reader_mcp/web_ui/app.mjs#556@71f0041e`, `src/reader_mcp/web_ui/app.mjs#622@71f0041e`). The date is not lost outright, since the Space v timeline still shows a read tag (`tests/web_dates.cjs#37@71f0041e`). It has left the page, though, and the message claims otherwise.

### 3. "share one line" and "the title's one row" (1f0beac9, `docs/web.md#1968@71f0041e`): DRIFT at phone width

`.document-meta` has `flex-wrap:wrap` (`src/reader_mcp/web_ui/style.css#11@71f0041e`). At 390px the probe measured:
- Read aloud and Source at top 162;
- the chip at 194;
- "Newer v3" at 226.

That is three rows. At 900px and 1300px it is one row, as claimed. The phone test asserts one control size, not one row (`tests/web_reading_log.cjs#50@71f0041e`).

### 4. "The service suite expects the voice field's 503" (71f0041e): DRIFT

The suite tolerates the failure and does not expect it. It discards every console error located at `/api/speech-voices`, whatever the status, and never asserts 503 or the retry button (`tests/web_service.cjs#16@71f0041e`). A 500 would pass silently, and so would a working daemon. The server behaviour itself is real (`src/reader_mcp/web.py#1762@71f0041e`, `src/reader_mcp/speech.py#52@71f0041e`, `web/src/speech-voice.tsx#28@71f0041e`), and the retry is tested elsewhere (`tests/web_voice_recovery.cjs#21@71f0041e`).

## What 71f0041e did to each assertion

| Suite | Before → after | Status |
|---|---|---|
| `web_backstage` | `'1'` → `'1–2'`, plus one `Pages …` link only (`tests/web_backstage.cjs#70@71f0041e`; label `web/src/reader-controls.tsx#166@71f0041e`) | **Verified, stronger** |
| `web_companions` | `#companion-cli button` → `#companion-cli [data-cli] button` (`tests/web_companions.cjs#59@71f0041e`) | **Verified, narrower.** The excluded button is the help "About Agent command lines" (probe2). An install button outside a row would now escape. |
| `web_index_scale` facts | Card facts → inspector table cells (`tests/web_index_scale.cjs#18@71f0041e`; `web/src/admin/pages/indexes.tsx#114@71f0041e`, `web/src/admin/pages/indexes.tsx#117@71f0041e`) | **Verified differently.** Value expectations unchanged. |
| `web_index_scale` limits has no jobs | Unchanged selector (`tests/web_index_scale.cjs#31@71f0041e`) | **Still verified.** Actions remain in the row and limits has `actions:[]` (`web/src/admin/pages/indexes.tsx#109@71f0041e`, `web/src/backstage.tsx#44@71f0041e`). The message still says "card". |
| `web_index_scale` legacy notice and contrast | Now read through the inspector (`tests/web_index_scale.cjs#32@71f0041e`, `tests/web_index_scale.cjs#46@71f0041e`) | **Verified differently**, same criteria. |
| `web_links` | `/Links20/` → `/20/` in `[data-fact=links]` (`tests/web_links.cjs#121@71f0041e`) | **Slightly loosened.** 120 or 200 would pass. A later toast separately asserts "20 links" (`tests/web_links.cjs#124@71f0041e`). |
| `web_page_review` | `#help[open]` → `#help` (`tests/web_page_review.cjs#14@71f0041e`) | **Verified.** Probe: `#help` count 0 before opening, 1 after; `[open]` 0, `[data-open]` 1. The old selector could never match. |
| `web_search_retry` | Undefined `until` → fake-clock loop (`tests/web_search_retry.cjs#26@71f0041e`) | **Verified, restored.** The parent has one `until` use and no definition, so this line never asserted anything. |
| `web_service` | All console errors → all except that URL | **Partly lost.** See drift 4. |
| `web_static_demo` | `week-43` → computed name (`tests/web_static_demo.cjs#84@71f0041e`, `tests/web_static_demo.cjs#86@71f0041e`) | **Verified.** The formula matches Python `isocalendar` on all 4,383 days of 2020–2031. Conjecture: a DST or midnight edge is possible, because the test subtracts 5×24h while `src/reader_mcp/demo/build.py#198@71f0041e` subtracts calendar days. |
| `web_split_explorer`, `web_voice_recovery` | Chrome path default only (line 8 of each) | **No assertion changed** |

Commit 1f0beac9 also changed assertions, outside your specific question:
- The chip's local-date assertion in `web_dates` was removed outright (`tests/web_dates.cjs#34@71f0041e`).
- `web_versions` swapped a date regex for a wait on a "You" entry (`tests/web_versions.cjs#35@71f0041e`), so your own read date is no longer asserted in that test.

## Reverse drift: what the messages and docs omit

1. **"Finished" moved, unannounced.**
   - The server treats saved progress ≥ 0.97 as finished (`src/reader_mcp/web.py#69@71f0041e`, `src/reader_mcp/web.py#1009@71f0041e`, `src/reader_mcp/web.py#1113@71f0041e`).
   - Commit 19cb589d rescaled that share. At 97.5% of the article the probe saved 0.975, where the old formula gives 0.676, with the last block not yet fully visible (bottom 822 in an 800px window).
   - In an article that fits one screen with page below it, a 1px scroll saved **progress 1 after 462 ms** (`src/reader_mcp/web_ui/reading.mjs#20@71f0041e`).
   - The comment "finished after a short dwell" (`src/reader_mcp/web_ui/reading.mjs#21@71f0041e`) no longer tells the whole story.
2. **`docs/web.md` version chip section is stale.** It still says "Under the title meta", describes **You read this on Oct 16**, and implies the dot always shows (`docs/web.md#2289@71f0041e`, `docs/web.md#2294@71f0041e`). The chip is now inside the meta row, that text is gone, and the dot is hidden unless a newer edition exists (`src/reader_mcp/web_ui/style.css#274@71f0041e`).
3. **`docs/web.md#2008@71f0041e`** still places Read aloud "below the article title and metadata". It is now within the metadata row.
4. **`docs/capabilities.md#207@71f0041e`, `docs/capabilities.md#209@71f0041e`** still say the chip says "when you read it". That now holds only for a sibling edition.
5. **`src/reader_mcp/web_ui/style.css#273@71f0041e`** still reads "one chip under the title meta".
6. **`docs/web.md#4603@71f0041e`** and the suite's header omit the new top-of-document and progress checks.
7. **Sibling reads are rarer than the message suggests.** `read_marker` prefers this file's receipt (`src/reader_mcp/versions.py#297@71f0041e`). Probe: "You read v1 on Nov 4" appeared on the first open of v2 and was gone after reload. No test covers this path; `web_versions` asserts only the count of 0.
8. **Smaller items:**
   - Saved shares from before 19cb589d now restore on the new scale (`src/reader_mcp/web_ui/reading.mjs#195@71f0041e`).
   - `progress()` now scans the article's blocks on every scroll update (`src/reader_mcp/web_ui/reading.mjs#17@71f0041e`, `src/reader_mcp/web_ui/reading.mjs#225@71f0041e`). Cost not measured.
   - `.issue-footer{flex-wrap:wrap}` is inert, because the same media block sets `display:block` (`src/reader_mcp/web_ui/style.css#191@71f0041e`; probe computed `block`).
   - 9759c6e2 and 7bb3ef66 added no regression tests.

## Verdict table

| # | Commit | Claim | Verdict | Evidence |
|---|---|---|---|---|
| 1 | 9759c6e2 | The line can land between blocks | CONFIRMED | `reading.mjs#148@71f0041e`; probe gap 18.9px |
| 2 | 9759c6e2 | No block was recorded, so restore went by share | CONFIRMED | `reading.mjs#195@71f0041e`; parent diff |
| 3 | 9759c6e2 | Now keeps the next block | CONFIRMED | Saved 1074; restored within 0.42px of the line |
| 4 | 1f0beac9 | One line / "one row" | **DRIFT** (phone) | Tops 162, 194, 226 at 390px |
| 5 | 1f0beac9 | Controls at one height, interface type | CONFIRMED | `style.css#110@71f0041e`; `web_editions.cjs#35@71f0041e`. Applies to the idle button only; the playback control is not matched by that selector |
| 6 | 1f0beac9 | Log directly below | CONFIRMED | `app.mjs#568@71f0041e`; `web_editions.cjs#32@71f0041e` |
| 7 | 1f0beac9 | Body closer to title | CONFIRMED | `style.css#112@71f0041e` (64→44), `style.css#116@71f0041e` (46→32) |
| 8 | 1f0beac9 | Read aloud no longer serif | CONFIRMED | Probe: Manrope |
| 9 | 1f0beac9 | Chip stops repeating your read of this file | CONFIRMED | `versions.mjs#43@71f0041e`; probe |
| 10 | 1f0beac9 | Reading log already says when | **DRIFT** | `engagement.py#156@71f0041e`; "You just now" |
| 11 | 1f0beac9 | Still reports a sibling read | CONFIRMED | Probe; first open only, untested |
| 12 | 1f0beac9 | Two-page keeps only Read aloud and chip | CONFIRMED | `style.css#51@71f0041e` |
| 13 | 1f0beac9 | Late chip lands at the end of the row | CONFIRMED | `app.mjs#655@71f0041e` |
| 14 | 19cb589d | The old span ran to the page bottom | CONFIRMED | Parent used `scrollSpan` throughout |
| 15 | 19cb589d | Bar, seek, pips and saved share use the new span | CONFIRMED | `reading.mjs#61@71f0041e`, `#109`, `#213`, `#28`. Only bar and seek have direct tests |
| 16 | 19cb589d | Ends when the last block comes into view | CONFIRMED | `reading.mjs#19@71f0041e`. Means its bottom edge is in view |
| 17 | 19cb589d | Footer and Read next add nothing | CONFIRMED | `app.mjs#945@71f0041e`; `web_versions_late.cjs#115@71f0041e`. The suite sets `nextReads:false` (`#24`), so Read next is confirmed by code only |
| 18 | 39417c9c | The old fallback fired above the first block | CONFIRMED | 9759c6e2 diff |
| 19 | 39417c9c | **A reader at the top stays at the top** | **DRIFT** | Table in drift 1 |
| 20 | 39417c9c | Falls forward only after a block has gone by | CONFIRMED | `reading.mjs#151@71f0041e`. Literally true, and that is the hole |
| 21 | 7bb3ef66 | 27px sideways with the Explorer open on a phone | CONFIRMED | Old CSS: scrollWidth 417 of 390. HEAD: 390 |
| 22 | 7bb3ef66 | Stats and footer link could not wrap | CONFIRMED | Computed `column`/`nowrap` → `row`/`normal` |
| 23 | 7bb3ef66 | Help names `Space , e` | CONFIRMED | Probe `dt`: "Space e / Space , e"; `keys.mjs#289@71f0041e` |
| 24 | 71f0041e | "Back to green" | UNVERIFIABLE | Not run under my charter; another detective owns it |
| 25 | 71f0041e | Admin redesign, dialog help, pagination, journal | CONFIRMED | Table above; `src/reader_mcp/demo/build.py#472@71f0041e` |
| 26 | 71f0041e | Two suites get the default Chrome | CONFIRMED | `web_split_explorer.cjs#8@71f0041e`; `web_voice_recovery.cjs#8@71f0041e` |
| 27 | 71f0041e | Missing helper replaced by fake clock | CONFIRMED | `web_search_retry.cjs#26@71f0041e`; parent |
| 28 | 71f0041e | Service suite "expects" the 503 | **DRIFT** | `web_service.cjs#16@71f0041e` |
| 29 | 71f0041e | Visiting measures nothing (test comment) | CONFIRMED | `checks` starts empty, `src/reader_mcp/maintenance.py#67@71f0041e`. Conjecture: the state `web_links` sees comes from the quiet job at `src/reader_mcp/web.py#710@71f0041e`; not fully traced |

No claim was PLANNED. Paths in the table are shortened after first full citation elsewhere in this testimony.

**Drift count:** 4 claim drifts out of 29 claims, 1 unverifiable, 24 confirmed. Beyond those, 4 stale document or comment locations (reverse items 2–5) and one unannounced behaviour change that matters (item 1).

**Worst drift:** claim 19. A headline fix that does not hold on phones or tall windows for any document with a source H1, regressing from the behaviour before 9759c6e2 and protected by a test at the single viewport where it works.

**Fidelity grade: C+.** Most prose is accurate, and the 27px figure is exact to the pixel. But one headline is false in the common case, one justification is wrong, and the chip docs were left describing the old design.

```
VERDICT
target: flyingrobots/reader main; 9759c6e2 1f0beac9 19cb589d 39417c9c 7bb3ef66 71f0041e
pin: 71f0041e
claims: 29
confirmed: 24
drift: 4
planned: 0
unverifiable: 1
reverse_drift_significant: 1 (finished threshold and dwell bypass)
stale_locations: 4 (docs/web.md chip section, docs/web.md#2008, docs/capabilities.md#207-209, style.css#273)
worst: 39417c9c "stay at the top" fails for source-H1 documents at 390x664, 1440x1000, 1920x1200
test_assertions_71f0041e: 1 partly lost (web_service), 1 loosened (web_links), 1 narrowed (web_companions), rest verified, restored or unchanged
limits: browser suites not run; old reading.mjs not executed; hero documents not probed
grade: C+
```
