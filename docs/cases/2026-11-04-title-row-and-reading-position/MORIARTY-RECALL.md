# Testimony of Moriarty, recalled: PR #238 at `281574c9`

The patient has improved, and the suites still pass at 94/94. The repair guards the inside of a table but not the 24 pixels above it, and the guard itself can be deleted without any suite noticing.

**A correction against myself comes first.** My S5 compared the new layout with only one CSS rule restored. Before `1f0beac9`, the speech slot and chip sat outside `.document-meta`, so they stayed visible in two-page PDFs. That comes from reading the old template and CSS; I did not run it. So S5 overstated the loss, and the repair followed it into R5 below.

## Vector 1: did the old strikes close?

| Strike | Status | Evidence |
|---|---|---|
| S1 trailing table or embed | **Closed** | Table reads 12/29/58/100% at 10/25/50/100% of the page. End reaches the foot of the last embed at 100% |
| S2 jump past embed or table | **Partly** | Mid-embed and mid-table hold on short documents. See R1 and R2 |
| S3 top moves | **Mostly** | 600–2200px scan in 60px steps: only heights 1680, 1740, 1920 fail, by 3–18px (three of four document shapes) |
| S4 issue overflow | **Closed for overflow** | 23 widths from 320 to 2560, Explorer on and off: 0 overflow. See R6 for layout |
| S6 1px finish | **Exact fit closed** | One-screen post is 0.0015. Near-fit remains, see R11 |
| S7 inert slider | **Closed** | End goes to y=665, 100% |

## Strikes

### High

**R1. The margin above a table or embed still jumps the whole thing.** `inContent` asks only whether something covers the line, and a margin is covered by nothing. `blocks.find(top>line)` then skips every element with no source position (`src/reader_mcp/web_ui/reading.mjs#156-157@281574c9`).

| Line falls in | Gap | Before | Saved | After reopen |
|---|---|---|---|---|
| Margin above 5057px table | 24px | y=987 | block after the table | y=5966 |
| Margin above 1110px embed | 38px | y=994 | block after the embed | y=2047 |

Likely repair: use the next direct child of `#article` after the line, and keep the share if it has no source position.

**R2. The share fallback fails when the page has not settled, and the repair now relies on it.**
- **`library/many.md`:** a reader in `note-20` at y=25463 saved share 0.616. The page's range was 42112 then and 24109 at restore, because embeds load lazily. Reopening landed at y=14377 in `note-11`, nine embeds back and 11086px away. It stayed there 1.5 seconds later.
- **Before the repair:** by mechanism it would have jumped to the next host paragraph, at most one embed forward. I did not run that case.
- **Long article (98,000px), reader mid-table:** y=49085 became y=50529, with the table's foot at 127px and "After the table." under the save line. The reader was put out of the table.

Likely repair: save an anchor for tables and embeds, such as the nearest preceding block plus an offset, or wait and hold until they settle.

**R3. The core of the S2 repair has no test.** With `!inContent&&` deleted, `web_reading_position` and all `web_content_visibility` suites pass, 5/5. The test named "inside a table the next block is not this place" (`tests/web_reading_position.cjs#53@281574c9`) uses `TRAILING_TABLE` (`#11`), which has no next block to jump to. There is no mid-embed reopen test, and the margin test uses only paragraphs (`#39`).

### Medium

**R4. A widened `endVisible` marks download-only attachments finished.** `lastBlock` now matches any direct child (`reading.mjs#18@281574c9`), and `endVisible` turns that into a finish after the dwell (`reading.mjs#30@281574c9`).

| Document | Old `lastBlock` posts | New posts |
|---|---|---|
| "Available as a file" attachment (simulated `.zip`) | none | `[1]`, History `finished: true` |
| `dot.png` | none | `[1]` |

Three seconds on a download link is not reading it. HTML preview frames are unverified, because my patch did not set `preview_url`. CONJECTURE: a frame that fits the window finishes the same way. To test, open a real HTML attachment in a tall window.

**R5. Two-page PDFs lost their pointer path to Read aloud and the chip.** This is the overcorrection from my S5 (`src/reader_mcp/web_ui/style.css#51@281574c9`).
- **Row:** `#speak-article`, the chip and `.version-newer` all have no boxes.
- **Status bar:** it has no idle Read aloud control.
- **What remains:** `Space s`, then `a` still queues speech, and the `v1/3` twin stays visible with its accent. I did not click the twin.
- **Gain:** the page height returned to 580px.
- **Judgement:** a pointer user or tablet reader has lost a control for 36px. Keep the two controls and hide the rest, or add an idle control to the status bar.

### Low

**R6. The stylesheet comment overclaims.** It says these layouts follow the column, but the wide rules still follow the window and win because they come later (`style.css#199@281574c9`). At 1500px with Explorer and docked queue, the column is 728px and the grid has 13 tracks. The cover is 208px, "round s run" breaks mid-word, and the rail is clipped at the right (screenshot). The old rules already had the media query, so the crush itself is not new, and there is no page overflow.

**R7. No fallback without container queries or `:has`.** With the `#main:has(.issue)` rule removed, simulating a browser that rejects it, `.issue-cover` is not visible at 390px and `web_magazine` fails. The phone page has lost its cover story. Reader's docs state no browser floor that I could find.

**R8. A slow `/api/versions` loses the earlier read.** With 2-second and 4-second delays, the response carried the receipt just written by opening. With no delay, the note was correct. By inference, in production that means no note, not a false one. The fixture's server clock (Oct 21) differs from the browser's (Nov 4), so the "Oct 21" text it showed is an artifact.

**R9. No year on the note.** A 2024 read says "You last read this on Feb 10". A read exactly a year ago is suppressed, because `day()` compares strings without years (`src/reader_mcp/web_ui/versions.mjs#11,#45@281574c9`).

**R10. The `!important` fix has no test.** Removing it passes `web_reading_position`, `web_browser`, `web_editions` and `web_source`, so the S11 fix is unguarded. I did not re-measure the Source control in text two-page mode.

**R11. Near-fit discontinuity.** The span jumps from the page's 799px to under 3px once the article overflows.
- With fractional overflow (rounded to 0), a 1px scroll posted `progress: 1`.
- With 1px overflow, a 1px scroll reads 68%.
- With 3px overflow, a 3px scroll reads 86%.

The article's end is nearly in view in all of these, so it is a small lie, but the dwell is still bypassed.

**R12. Per-frame cost doubled.** The new expression took 2.1ms at 5,000 blocks and 9.5ms at 20,000, against 1.1 and 4.2 before. Walking back from `lastElementChild` would make it nearly constant. This is measured on a replica of the expression, not by timing the app's own frame.

## Attacks attempted and failed

**Vector 2: regressions**
- **PDFs:** pages are direct children, and tall ones post no early dwell.
- **Hero art and shape figures:** they are decorated and prepended, so they cannot become `lastBlock`. This is from reading the code.
- **Documents with only decorations:** `last` is undefined and the page's range is used. This is from reading the code.
- **Late embeds:** with a 6-second delay, no early finish was posted, because the document showed its embeds only after they resolved.
- **Footnotes:** still ordinary paragraphs. Trailing images sit inside paragraphs and were not run separately.
- **Lists and blockquotes at the top:** the "list first" shape passed the whole height scan.
- **`.document-title`:** removing the exclusion fails at 1440×1000, so the rule is doing real work.

**Vector 3: containment**
- **Fixed and sticky:** no fixed descendants in `#main` on the issue page. Art focus and the prompt card go on `body`.
- **Sticky rail:** identical with and without containment, 189 then -145.
- **Container removal:** `#main` returns to `normal` on document pages.
- **Phone:** a long title fits, with no overflow.

**Vector 4: the chip**
- **Local day:** correct in the Los Angeles case, and the sibling note works.
- **Midnight:** only an opening straddling midnight with a late chip could describe the current read as earlier. CONJECTURE. To test, pin the clock across midnight with a delayed versions response.
- **`!important` in two-page text mode:** the exemptions leave speech and the chip alone, from reading the CSS.

**Vector 5: tests that bite**

| Reverted or removed | Result |
|---|---|
| Old `lastBlock` | Fails |
| `\|\|page` | Fails |
| Title exclusion | Fails |
| Last-read note | Fails |
| Today guard | Fails, first at the table-reopen assertion |
| PDF hide | Fails in `web_browser` |
| Container rule | Fails in `web_magazine` |
| Voices handler raising | Fails in `web_service` |

The today-guard failure suggests a return reader's extra note can move a share restore. I did not measure by how much.

**Also holding:** the case file contains no local paths.

## Cleanup
- `git status --short` is clean at `281574c9`, with no push, commit or fetch.
- I killed one orphaned fixture of my own.
- Three other fixture processes belong to other checkouts or test runs, so I left them alone.
- `.reader/` holds 86 MiB of ignored data.

## Strikes landed

| # | Strike | Severity |
|---|---|---|
| R1 | Margin above a table or embed jumps past it | High |
| R2 | Share restore fails on unsettled pages | High |
| R3 | `inContent` deletion survives every suite | High |
| R4 | Attachments finished after dwell | Medium |
| R5 | Two-page PDF loses pointer Read aloud and chip | Medium |
| R6–R12 | Column claim, no fallback, late read loss, no year, untested `!important`, near-fit, frame cost | Low |

**Resilience grade: C+.** It is a real improvement over the C- I gave the old commits, and most of the new tests bite. The bookmark repair still loses the reader's place in ordinary embed-heavy documents.

```
VERDICT
target: PR #238 fix/reading-position @ 281574c9 (repair 48b8648d)
should_merge: NO, not yet
decision: CHANGES_REQUIRED
blocking:
  - R1: margin above a table or embed still jumps past it
  - R3: add mid-table and mid-embed reopen tests that fail without inContent
  - R4: attachments must not finish by dwell
decide_before_merge:
  - R2: share restore on lazy-embed documents needs an anchor, or the regression accepted in writing
  - R5: Read aloud and chip on two-page PDFs; S5 overstated the loss, so 36px may not be worth it
may_follow_later: [R6, R7, R8, R9, R10, R11, R12]
closed: [S1, S4 overflow, S7, S6 exact fit, S10, S8, S13]
partly_closed: [S2, S3]
upheld: ["94/94 browser suites green", "most new tests fail when reverted"]
not_verified: ["HTML preview dwell", "non-Chrome browsers beyond simulated rule removal", "Source hidden in text two-page", "twin click on two-page PDF", "pre-1f0beac9 PDF layout was read, not run"]
retraction: "S5 overstated; the earlier layout showed Read aloud and the chip"
worktree_clean: true
```
