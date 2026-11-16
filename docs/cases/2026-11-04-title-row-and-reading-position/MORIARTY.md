# Testimony of Moriarty: six commits at `71f0041e`

How charming: 91 suites in green, and a reader who opens a long table is told she has finished it before she has read a row. The suites are honest, but they only ask about the documents they were given. I took documents from the rest of the world.

**Method.** I used a real fixture and real Chrome. Most probes rewrote `/api/document` text in the browser. Mutants were applied and restored, and "old span" means `readingSpan` replaced by `scrollSpan`.

## Strikes

### High

**S1. Trailing tables and embeds are erased from "reading". Progress hits 100% almost at once.**
- **Cause:** `lastBlock` takes the last element with `data-source-start`, and it excludes embeds (`src/reader_mcp/web_ui/reading.mjs#17@71f0041e`). Source positions go only on paragraphs, headings, blockquotes, lists, math and fences (`src/reader_mcp/web_ui/app.mjs#94@71f0041e`), so tables have none.
- **Three paragraphs plus a 120-row table:**

| Scroll position (of 5776) | New code | Old span |
|---|---|---|
| 578 | 100% | 10% |
| 1444 | 100% | 25% |
| 2888 | 100% | 50% |

- **Five paragraphs plus four embeds:** 100% at y=560 of 5603, and slider End stops at y=212. I did not run this case under the old span, but the mechanism is the same.
- **Also affected:** `seek`, pips, `50%` and split `docFraction`, since they share the span (`reading.mjs#19,#109,#213@71f0041e`).
- **Likely repair:** measure the content bottom of `#article`. The probe's `articleBottom` already gives it.

**S2. The margin fallback jumps a reader past whole embeds and tables.**
- **Cause:** inside an embed or table no block covers the save line, but one has already gone by, so the next block is saved with fraction 0 (`reading.mjs#151@71f0041e`).
- **Mid-embed:** at y=2438 (inside `many/note-02`) it saved offset 1325. Reopening landed at y=4179 on "After the embeds.", which is 1741px forward.
- **Mid-table:** y=3111 became y=5610 on reopen, which is 2499px forward. Even there, `elementFromPoint` still reported the table, so the landing is not exact either.
- **Regression:** the old diff saved `source_offset: null` and restored by share. I read that from the diff and did not run it. Commit `9759c6e2` assumes the gap is a margin, but it can be a whole table.

**S3. "Keep a reader at the top... at the top" holds only in short windows.**
- **Cause:** the source H1 is itself a block. Once the window is tall enough, the save line passes below the H1, so `blocks.some(bottom<=line)` is true while at y=0 (`reading.mjs#151@71f0041e`).
- **Same flow as the commit's test, on two real fixture documents with identical numbers:**

| Window height | Saved | Reopen y | Title top (should be 132) |
|---|---|---|---|
| 520, 700, 800, 900 | null or H1 | 0 | 132 |
| 1000 | next block, f=0 | **117** | **15** |
| 1100 | same | **95** | 37 |
| 1200 | same | **73** | 59 |
| 1300 | same | **51** | 81 |
| 1400 | same | **29** | 103 |
| 1600 | paragraph | 0 | 132 |

- **Why the test passed:** the suite's viewport is 520px (`tests/web_versions_late.cjs#15@71f0041e`), which the table shows is safe.
- **Likely repair:** skip the fallback when `shownTop` is about 0, or have the rule ignore the title block.

### Medium

**S4. The issue-page CSS fixes this fixture, not the class of overflow.** The media query reads the viewport, while the overflow comes from the column (`src/reader_mcp/web_ui/style.css#191@71f0041e`).
- **File Explorer open:**

| Viewport width | Overflow |
|---|---|
| 320 | **33px** |
| 390 | 0 |
| 640 | 0 |
| 641 | **57px** |
| 700 | **25px** |
| 760 and wider | 0 |

- **Other overflow:** with stats injected as `12,345`, the 390px width overflows 13px. Each number needs 104px of a 75px cell.
- **Dead code:** `.issue-footer{flex-wrap:wrap}` and `#issue-backstage{flex:0 1 auto}` have no effect, because a later rule in the same block sets `display:block` (computed `block`).
- **In its favour:** the override stops at 640 (computed `nowrap` at 641), and there is no overflow at nine widths with the Explorer closed.

**S5. Two-page PDFs shrank, and no commit message says so.** The meta row used to be hidden and now takes a line (`style.css#51@71f0041e`). Restoring the old rule gives this comparison:

| Window | Page height, new | Page height, old rule |
|---|---|---|
| 1300×800 | 544px | 580px |
| 1000×520 | 280px | 316px (11% taller) |

**S6. A one-pixel scroll marks a document finished, bypassing the dwell.**
- **Cause:** `savedProgress` falls through to `progress()`, which now returns 1 when `span` is 0 and `scrollY>0` (`reading.mjs#20,#28@71f0041e`). The server treats 0.97 or more as finished (`src/reader_mcp/web.py#69,#1009@71f0041e`).
- **Measured:** on a one-screen document, `scrollTo(0,1)` posted `progress: 1` within 700ms, against a 3-second dwell.
- **Precedent:** `endVisible` already ignored embeds after the dwell, so that half of the "finished" error predates these commits. S1 removes the wait.

**S7. The slider is inert on one-screen documents.** At 1300×500 with 665px of scrollable page:
- Slider End leaves y=0 and 0%.
- `50%` does nothing.
- 1px of scrolling jumps the bar from 0 to 100.

### Low

**S8. `web_service` does not expect a 503; it tolerates anything.** The filter drops every console error located at that URL (`tests/web_service.cjs#16@71f0041e`), and nothing asserts the status or a retry. A mutant raising `RuntimeError` in the handler (`web.py#1623@71f0041e`) produced a server traceback, and the suite still passed. The commit message's "expects the voice field's 503" overstates it.

**S9. "End stops where the article ends" is proven only on settled layout.**
- **Measured:** a 40-paragraph document's first End press lands with the last block's bottom at 2362 in an 800px window (69%). A second press reaches it, and one long smooth case needed three.
- **Honest limit:** the old span also stopped short (80%), so this class is older. The new code lands slightly shorter, and the new test and commit language hide the gap.

**S10. "Which the reading log already says" is false.**
- **What the log says:** on open it reads "You just now", while `/api/versions` still carried `at: 2026-10-25T00:16Z`.
- **What was lost:** the old chip stated the earlier read. That date now appears only in the Space v panel ("you read Oct 24").
- **Lost coverage:** the only remaining `.version-read` assertion is `count()==0` (`tests/web_versions.cjs#35@71f0041e`). The sibling-edition branch (`src/reader_mcp/web_ui/versions.mjs#43@71f0041e`) lost its local-day test.

**S11. The docs are wrong about two-page mode.** `docs/web.md#1971@71f0041e` says the row keeps only Read aloud and the chip. Source stays visible: computed `display:flex`, width 60, and visible in the screenshot. My inference, not separately proven, is that the Button's `inline-flex` in the `utilities` layer beats the `reader-legacy` rule (`style.css#1@71f0041e`).

**S12. The issue fix's only regression catch is accidental.**
- The commit added no test.
- With the CSS reverted, the full `web_page_review` fails with 27px, but only on `help-phone` and `issue-phone`. Standalone `web_page_review.cjs issue` passes on the reverted CSS.
- My inference is that the Explorer state leaks from the earlier `picker` section.

**S13. `web_links` is looser than before.** `/Links20/` became `/20/` (`tests/web_links.cjs#121@71f0041e`), so 120 or 200 also pass. This comes from reading the regex; no mutant was run.

**S14. Old bookmarks restore on the new scale.** A saved `progress: .9` with a null offset should sit at y≈4029 on the old scale, but it landed at y=3470, 559px back. This reaches only offset-less bookmarks. Stored progress is not rescaled anywhere in the six diffs; I read this from the code and did not inspect stored data.

**CONJECTURE: pip cost.**
- **Measured:** `readingSpan` rescans all blocks per call, 1.0ms at 5,001 blocks and 4.1ms at 20,001. `pips()` calls it once per thread (`reading.mjs#213@71f0041e`).
- **Extrapolated, not measured:** 500 threads on 5,000 blocks would cost about 0.5 seconds.
- **Experiment:** seed that fixture and time `pips()`. Hoisting `span` out of the loop would remove the cost.

**CONJECTURE: closed folds in other browsers.** Chrome reports real rects for closed `<details>` content. A browser returning zero rects would satisfy `bottom<=line` at the top of the document and collapse `readingSpan`.
- **Experiment:** repeat scenario B of the probes in Safari and Firefox.

## Attacks attempted and failed

**Vector 1: progress**
- **Footnotes:** Reader renders `[^n]:` definitions as ordinary paragraphs with source positions, so they count.
- **PDFs:** continuous progress is roughly linear, and End lands at y=6607, exactly the last page's end.
- **Trailing closed fold, Chrome:** correct.
- **Smooth scrolling:** during a glide the percentage follows the target, and `shownTop` keeps the span stable. End behaves as in plain scrolling.
- **Per-frame cost:** the median was 0.2ms at 501 blocks, 1.1ms at 5,001 and 4.2ms at 20,001. That is acceptable.
- **Split `docFraction`:** `seek` is reached only when no offset or heading matches (`src/reader_mcp/web_ui/split.mjs#435@71f0041e`), and `web_split` passes. I did not run a dedicated probe, so this is unbroken rather than proven.

**Vector 2: bookmarks**
- **Margin coverage:** removing the fallback fails `web_versions_late` at line 71, and restoring `target??=` also fails it. The tests bite.
- **Nested document order:** I found no failure for lists or blockquotes, because their tops rise in DOM order. S2 is a coverage gap, not an ordering one.

**Vector 3: title row**
- **Phone width:** no overflow at 320 or 390, with the newer-version chip or with speech showing "Queued". The later playing state was not reached.
- **Speech layout:** a 2px shift on desktop. In two-page mode the row grows 34px, but pagination stayed 1–2, 3–4, 5–6.
- **Historical views:** my probe did not reach one, so I claim nothing beyond `web_versions` passing and the guard in `placeLateChip`.

**Vector 5: tests**
- **`web_page_review` `#help`:** not vacuous. With the key changed to a no-op, six help runs time out.
- **`web_backstage`:** every pagination item carries `Pages …`, so the count assertion is real.
- **`web_search_retry`:** it keeps `pageCalls===6`, and the fake clock is sound.
- **`web_index_scale`:** I read it and found no weakening, but ran no mutant.
- **`web_companions`:** an install button inside a row is still caught. One placed elsewhere in the card would escape, which I leave as a shrug.
- **`web_static_demo`:** the JS and Python week numbers agreed at 289,296 instants across six zones from 2026 to 2036, with no mismatches. Only a build crossing local midnight into a new week remains, and that is CONJECTURE.

**Vector 6: the green claim**
- The commit claim holds: **91/91 passed** in 201 seconds on this checkout.
- The Chrome defaults match other suites.

## Cleanup
- `git status --short` is clean at `71f0041e`.
- Generated data is 88 MiB in the ignored `.reader/`, plus 5.6 MiB in a session scratch directory.
- I did not push, commit or fetch, and I did not touch the live checkout or port 8766.

## Strikes landed

| # | Strike | Severity |
|---|---|---|
| S1 | Tables and embeds excluded from the progress span | High |
| S2 | Bookmark jumps past embeds and tables | High |
| S3 | Top-of-document bookmark moves at 1000–1400px windows | High |
| S4 | Issue overflow class not fixed; dead CSS | Medium |
| S5 | Two-page PDF pages shrink, undisclosed | Medium |
| S6 | Finished on a 1px scroll, dwell bypassed | Medium |
| S7 | Slider inert on one-screen documents | Medium |
| S8 | `web_service` tolerates any failure | Low |
| S9 | First End press stops short | Low |
| S10 | Read date lost from the page; coverage dropped | Low |
| S11 | Docs wrong about two-page Source | Low |
| S12 | Issue regression catch is accidental | Low |
| S13 | `web_links` regex loosened | Low |
| S14 | Old bookmarks restore on the new scale | Low |

**Resilience grade: C-.** The suites and much of the title row hold up. The reading-position work, which is the point of three of these commits, fails on ordinary documents and ordinary monitor sizes.

```
VERDICT
target: 9759c6e2 1f0beac9 19cb589d 39417c9c 7bb3ef66 71f0041e @ 71f0041e
decision: CHANGES_REQUIRED
strikes: {high: 3, medium: 4, low: 7, conjectures: 2}
vector_quota:
  1_progress: met (S1, S6, S7, S9, S14)
  2_bookmark: met in substance (S2, S3, S14 counts for restore; surrender on document-order failures)
  3_title_row: met (S5, S10, S11)
  4_issue_css: partial (S4, S12; surrender on regressions at normal widths)
  5_test_weakening: partial (S8, S13, S10 coverage; itemized surrender on the rest)
  6_overstatement: met (S3, S8, S10, S11)
must_fix_before_trusting_progress: [S1, S2, S3]
should_fix: [S4, S5, S6, S7]
claims_upheld: ["91/91 browser suites green", "web_page_review #help is not vacuous", "demo week calculation agrees across 2026-2036 in 6 zones"]
not_verified: ["historical view layout", "speech playing state", "dedicated split docFraction probe", "non-Chrome browsers", "actual pips() timing"]
worktree_clean: true
```
