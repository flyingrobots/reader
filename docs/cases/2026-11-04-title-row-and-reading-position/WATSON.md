# Deposition of Dr. John H. Watson: first pass, blind

I read as a maintainer and as the person holding the phone. No other detective's work was seen. The commit messages are the best writing in the set: short, plain, and mostly saying why. Trouble starts when you try to change the behaviour using only what's in the tree, because the reference doc still describes the old behaviour in three places. The code carries its reasoning in single unbroken lines. On the person's side, desktop is pleasant, but "one row" isn't true on a phone, and the reading log's "You just now" says less than the sentence it replaced.

## What I examined

- **Commits:** full `git show` of all six, plus the surrounding code and docs at 71f0041e.
- **Screenshots:** `.reader/web-dev/` doesn't exist in this checkout, so I drove `tests/web_fixture.py --editions --versions` from scratch scripts, using synthetic data and the default theme.
- **Checkout state:** `git status` was clean afterwards.
- **Not done:** I ran no test suites. I couldn't confirm the rendered help row, because my selector matched nothing. Claim 15 therefore rests on the source.
- **Graft tools:** none were available to me, so I used plain Read and Bash.

Evidence, all measured at HEAD:

| Scene | Observation | File |
|---|---|---|
| Title row, 1300 px, v1 | All controls on one line: Ada, Oct 12, Read aloud, Source, `v1 of 3`, Newer v3 available, Open v3, Compare v1 → v3. Reading log `You just now` below. | `<scratchpad>/desk-v1.png` |
| Title row, 390 px, v1 | **Three lines:** byline, date and two buttons; then the chip; then the "Newer" text | `<scratchpad>/phone-v1.png` |
| Title row, 390 px, v3 | Two lines | `<scratchpad>/phone-v3.png` |
| Issue page, Explorer closed, 390 and 320 px | 0 px overflow | `<scratchpad>/issue-390.png` |
| Issue page, Explorer open, 390 px | 0 px overflow; issue column 211 px wide | `<scratchpad>/issue-explorer-390.png` |
| Issue page, Explorer open, 320 px | **33 px overflow**; the masthead's forward arrow is out of view | `<scratchpad>/issue-explorer-320.png` |

The 320 px Explorer measurement used a plain viewport rather than full mobile emulation.

## What serves the reader well

- **Commit 39417c9c** names the earlier commit it corrects and says what went wrong for the person: "reopening the document moved past them." That is good traceability, and honest about a 13-minute-old regression.
- **Commit 19cb589d** states the human consequence in one line: "the footer and Read next counted as reading still to do."
- **`versions.mjs#42`** is the kind of comment I want, because it gives the reason and not the mechanism.
- **The two new code comments** at `reading.mjs#18` and `reading.mjs#150` are also clear.
- **The new scenarios' test messages** read as sentences, e.g. "halfway through the article reads as halfway" and "the footer stays at 100%".
- **Commit 71f0041e** admits suites "had fallen behind" and doesn't dress it up.
- **The desktop row** is tidy, and the type matches across controls.

## Audience fit

- **Maintainer:** the commit log is good. The reference doc misleads, and the tests are hard to find and hard to read.
- **Person using the app:** the changes are real improvements on desktop. Phone behaviour is undersold in the docs and oversold in the commit, and some labels assume you already know the app.
- **Tone and honesty:** warm and plain throughout. Nothing is spun. The honesty gaps are omissions, not claims made in bad faith.

## Stumbles

### Documentation contradicts the code

1. **The seek description is stale.** It still says "Seeking uses the document's scroll range," while 19cb589d moved seeking to the article's end, and `End` now deliberately stops short of the footer. A maintainer reading §Progress gets the old rule. `docs/web.md#525@71f0041e`, against `src/reader_mcp/web_ui/reading.mjs#109@71f0041e`
2. **The chip's placement is stale.** "Under the title meta, one bordered chip" is wrong: the chip now sits inside the row. `docs/web.md#2289@71f0041e`. The same error is in the CSS comment at `src/reader_mcp/web_ui/style.css#273@71f0041e`. 1f0beac9 edited `docs/web.md`, but only at the Placement bullet.
3. **The doc still promises a removed sentence.** It says "**You read this on Oct 16**", which 1f0beac9 deleted. `docs/web.md#2294@71f0041e`, against `src/reader_mcp/web_ui/versions.mjs#43@71f0041e`
4. **The dot's behaviour is half-documented.** The docs describe the dot only as turning accent when a newer version exists, but it is now hidden altogether otherwise. Neither the commit message nor a comment mentions this. `docs/web.md#2294@71f0041e`, `src/reader_mcp/web_ui/style.css#274@71f0041e`
5. **"Coming into view" misled me.** I first took it to mean the top of the last block appearing. The code uses the block's *bottom* edge reaching the viewport's bottom, so "fully in view" is what it means. The commit message of 19cb589d says the same misleading thing. `docs/web.md#3470@71f0041e`, `src/reader_mcp/web_ui/reading.mjs#19@71f0041e`
6. **The suite description doesn't list the new scenarios.** See stumble 12 for where they live. `docs/web.md#4603@71f0041e`
7. **Two comments in untouched tests now look false.** Both still treat "a reading line between two blocks saves no block" as a current fact, which 9759c6e2 ended. Their retry logic may now do nothing, and a maintainer can't tell. I didn't run them. `tests/web_content_visibility.cjs#144@71f0041e`, `tests/web_admin.cjs#130@71f0041e`
8. **The changelog says nothing.** None of the six commits touch it, although `## Unreleased` carries user-visible changes and was updated as recently as 2026-11-01. A person who misses "You read this on…" has nowhere to look. `CHANGELOG.md#3@71f0041e`

### Commit messages and framing

9. **"Share one line" is untrue on a phone.** At 390 px I measured three lines. "At one height" is also loose, since the byline measures 16 px and the controls 26 px. The CSS comment gets it right ("then its controls at one height"), and the only hint of wrapping is that the phone assertion quietly leaves out the chip. `docs/web.md#1968@71f0041e`, `src/reader_mcp/web_ui/style.css#106@71f0041e`, `tests/web_reading_log.cjs#49@71f0041e`
10. **The title of 7bb3ef66 overpromises, and the message gives no width.** "27px sideways" names no viewport, so I couldn't reproduce the claim from the words. I measured 0 px at 390 and 33 px at 320 with the Explorer open, and 320 is plainly a narrow phone. Whether 320 was in scope isn't stated anywhere. `src/reader_mcp/web_ui/style.css#191@71f0041e`
11. **The stated condition of 7bb3ef66 has no test.** The commit adds no test at all and bundles an unrelated keyboard help change. The existing phone overflow checks don't open the Explorer, so "with the File Explorer open" stays unguarded. `tests/web_page_review.cjs#15@71f0041e`, `tests/web_magazine.cjs#125@71f0041e`, `src/reader_mcp/web_ui/app.mjs#1491@71f0041e`
12. **Progress and bookmark tests live in the wrong suite.** They sit in a suite named and headed for slow version timelines, and its closing pass message doesn't mention them. I'd never look there for progress behaviour, and a green run wouldn't tell me they ran. `tests/web_versions_late.cjs#1@71f0041e`, `tests/web_versions_late.cjs#96@71f0041e`, `tests/web_versions_late.cjs#105@71f0041e`, `tests/web_versions_late.cjs#118@71f0041e`
13. **The title of 39417c9c took me two reads.** "Keep a reader at the top of a document at the top" says it once you've parsed it. The body rescues it. The new comment in the code shows the plainer version already existed: `src/reader_mcp/web_ui/reading.mjs#150@71f0041e`
14. **An old stored value gets a new meaning, unannounced.** 19cb589d says "the saved share" now runs to the article's end, but not that existing bookmarks with no block will be replayed through the new range. Those bookmarks were saved against the old denominator. I didn't trace other readers of the stored value. A maintainer deserves that sentence either way. `src/reader_mcp/web_ui/reading.mjs#195@71f0041e`, `src/reader_mcp/web_ui/reading.mjs#109@71f0041e`
15. **"Keyboard help now also names the Space , e spelling" has no reason given.** The docs list a third spelling, "comma, then e", which the help label omits, and the same panel also goes by "Documents browser" and "picker". Four names for one door. `src/reader_mcp/web_ui/app.mjs#1490@71f0041e`, `docs/web.md#71@71f0041e`, `README.md#258@71f0041e`, `docs/web.md#621@71f0041e`
16. **The grab-bag commit 71f0041e doesn't say which suites failed or how.** Ten suites get one paragraph, and a reader can't tell a stale test from a behaviour change being accepted. Examples are the shift from `'1'` to `'1–2'` and `#help[open]` to `#help`, neither explained where it happens. "Default Chrome path" is a macOS-only absolute path, though the repo uses it widely. `tests/web_page_review.cjs#14@71f0041e`, `tests/web_split_explorer.cjs#8@71f0041e`
17. **The historical banner moved, and nobody says so.** It now comes after the reading log, not before. The message of 1f0beac9 doesn't mention it, and historical view is a page where people need orientation first. `src/reader_mcp/web_ui/app.mjs#568@71f0041e`

### Dense code and tests

18. **The block-selection logic needs real effort.** The fallback condition sits under two stacked comments, and the first ("not just a share of the page's height") only makes sense once you know line 195's fallback exists. The first comment describes 9759c6e2's intent and the second the exception, with no sign they're one rule. `src/reader_mcp/web_ui/reading.mjs#148@71f0041e`, `reading.mjs#149-151@71f0041e`
19. **`progress` packs three branches and an unexplained case into one line.** `scrollY>0?1:0` covers an article already finished on the first screen, which I worked out only by deriving it. `src/reader_mcp/web_ui/reading.mjs#20@71f0041e`
20. **Mixed scroll sources.** Line 20 divides `scrollY` by a span computed with `shownTop(state.smoother)`. I can't tell whether this is deliberate. Conjecture: harmless when no smooth renderer is active, and worth a sentence if smoothing lags. `src/reader_mcp/web_ui/reading.mjs#19-20@71f0041e`
21. **Two mobile rules in 7bb3ef66 look like repairs but can't take effect.** `.issue-footer{flex-wrap:wrap}` and `flex:0 1 auto` share a media rule with a later `.issue-footer{display:block}`. I measured the footer as `display:block`. A maintainer will think they matter. The whole phone layout also sits on one line, so the diff reads as a wall. `src/reader_mcp/web_ui/style.css#191@71f0041e`
22. **The huge one-line template hides the row's structure.** The diff for 1f0beac9 replaced one enormous line with another, so you can't see what moved. The order of the row is the point of the commit, and the source doesn't show it. The separate selector list at `app.mjs#595` also dropped two classes without comment. `src/reader_mcp/web_ui/app.mjs#568@71f0041e`, `src/reader_mcp/web_ui/app.mjs#595@71f0041e`
23. **The spacing numbers are unexplained.** `-.2em`, `margin-right:6px`, `44px` and `32px` come with only "the body closer to the title". The `-.2em` in particular invites someone to delete it. `src/reader_mcp/web_ui/style.css#108-109@71f0041e`, `style.css#112@71f0041e`
24. **Cryptic test idioms.** `{hasText:/^. ?You/}` hides what the leading character is. `tests/web_versions.cjs#35@71f0041e`. The top-of-document test doesn't say why it uses `tidal.v3.md`, or why it scrolls to 1 and back (presumably to force a save). `tests/web_versions_late.cjs#98@71f0041e`. The service suite's voice-503 exception is buried at the end of a very long line. `tests/web_service.cjs#16@71f0041e`
25. **The between-blocks case has no test in these commits.** 9759c6e2 has no test, and 39417c9c pins only the top-of-document exception. Only the exception is protected, not the rule. `src/reader_mcp/web_ui/reading.mjs#151@71f0041e`, `tests/web_versions_late.cjs#96@71f0041e`

### What the person sees

26. **`You just now ⌄` is a fragment, with no verb.** It replaced a full sentence for the common case. The commit justifies this with "which the reading log already says", but the log says it less plainly. Worse, the receipt is written on open, so the bare phrase also hides that it may mean only "you opened this". `docs/web.md#1967@71f0041e`, `src/reader_mcp/web_ui/versions.mjs#42@71f0041e`
27. **Three controls look alike and behave differently.** Read aloud acts on the spot, Source leaves for a raw file in a new tab, and the chip opens a panel. The test even celebrates "one kind of control". Only the chip's caret hints at any difference. `src/reader_mcp/web_ui/style.css#110@71f0041e`, `tests/web_editions.cjs#35@71f0041e`
28. **"Source" is a bare word whose explanation is hover-only.** The tooltip ("Open the raw source file · Space u") doesn't exist on a phone, and the footer calls the same URL "Open original". `src/reader_mcp/web_ui/app.mjs#568@71f0041e`
29. **The right end of the progress bar no longer reaches the page end.** I welcome that for the reading figure. But pressing `End` won't take you to Read next, and no user-facing text says so. `tests/web_versions_late.cjs#111@71f0041e`, `docs/web.md#525@71f0041e`
30. **Phone row and footer finish.** The "Newer" text lands alone on its own line with no visual tie to the chip above it (phone-v1 screenshot). On the issue page, "Library statistics are in Reader Admin ↗" sits visibly indented from the paragraph above it (about 25 px against 16 px, by eye from the screenshot). Conjecture: the button's padding survives from its old flex context. `src/reader_mcp/web_ui/style.css#274@71f0041e`, `src/reader_mcp/web_ui/style.css#191@71f0041e`

## VERDICT

```
WITNESS:        Watson, first deposition (blind)
TARGET:         flyingrobots/reader, 9759c6e2..71f0041e (six commits), pinned at 71f0041e
CLARITY GRADE:  C+
  Commit prose:           B+   (says why; "one line" and "narrow phone" overreach)
  Code and test legibility: C  (dense one-liners; tests in the wrong suite; dead CSS)
  Reference docs:         C-   (three passages now describe removed behaviour)
  UI wording, desktop:    B
  UI wording, phone:      C+   (row wraps to three lines; bare "You just now"; "Source")
MOST MISLEADING:
  - docs/web.md#525, #2289 and #2294 contradict the code
  - "share one line" (1f0beac9), against three lines measured at 390 px
  - 7bb3ef66's title, against 33 px overflow measured at 320 px with the Explorer open
HONESTY OF FRAMING: Good faith throughout; the gaps are omissions, not spin.
  Undisclosed: the bookmark share's new meaning, the historical banner move, the dot hiding.
STUMBLES:       30
LIMITS:         No test suites run; help row not confirmed rendered; synthetic fixture,
                default theme; other readers of saved progress not traced.
REPAIRS:        None offered, per charter. Available for recall.
```

## Second Deposition — The Repair Menu

Three strikes are fatal to what the commits say, so no comment or doc edit can stand in for a code fix:

- **S1 is fatal to 19cb589d.** Any article ending in a table or embed reads 100% almost at once, and `End` doesn't move. The share is saved, and the server treats 0.97 as finished, so unread work gets marked finished.
- **S2 is fatal to 9759c6e2.** A reader inside a table or embed reopens up to 2499 px forward, per Moriarty.
- **S3 is fatal to 39417c9c's headline.** On phones and on windows 1000–1400 px tall, the reader doesn't stay at the top.

I recommend repairing rather than reverting, because the fix is small and tested. If it can't land soon, revert 19cb589d, 39417c9c and 9759c6e2 together. From my memory notes, not checked here, a push to `main` reaches the live preview in about 10 minutes, so these may already be serving.

**A retraction:** my stumble 25 said nothing pinned the between-blocks case. Moriarty showed that removing the fallback fails `tests/web_versions_late.cjs#71@71f0041e`, so I withdraw it. His negative result stands for that existing scenario. My R5 test adds an explicit assertion on which block is saved.

### How I verified this

- **Setup:** I applied the edits to a scratch `git archive` of 71f0041e. The pinned checkout stayed clean.
- **Files:**
  - Patch for the existing files: `<scratchpad>/watson-repairs.patch` (passes `git apply --check` at 71f0041e)
  - New suite: `<scratchpad>/watson-repair/tests/web_reading_position.cjs`
- **Full run:** 92/92 browser suites passed with R1–R9 together, including the new suite.
- **RED:** the new suite fails against 71f0041e at its first assertion, the 1440×1000 top-of-document case. The other cases are RED by the before-and-after table below.
- **Limits:**
  - I tested the repairs combined, not one commit at a time.
  - Chrome only.
  - Documents with a hero image weren't probed.

| Scenario | 71f0041e | With repairs |
|---|---|---|
| Reopen from top: 1440×1000, 1920×1200, 390×664, 1300×1400 | y = 126, 82, 135, 29 | y = 0 at all four |
| Trailing 120-row table, bar at 25% of page | 100% | 27% |
| Same table, slider `End` | y = 0 | y = 4746, table foot exactly at the window's bottom |
| Reader mid-table, reopen | saved progress 1, reopens y = 0 | saved 0.599, reopens y = 2841 (exact) |
| 12 trailing real embeds, `End` | y = 0, 0% | y = 2513, last embed's foot at the window's bottom, 100% |
| One-screen article, 1 px scroll | saved progress 1 | saved 0.0036 |
| One-screen article, `End` | y = 0 | y = 281 (page end) |
| Margin between blocks (control) | next block; reopens within 9 px | unchanged |
| Two-page Source button | visible, 60 px | hidden |
| Issue page, Explorer open, 320 / 360 / 641 / 700 px | 33 / 11 / 57 / 25 px over | 0 at all, also 390, 640, 760, 900, 1000, 1360 |
| Issue page, Explorer open, stats as `12,345` | 3–151 px over at 360–760 px | 0 |

### Must land before these commits can be trusted

**R1. CODE: measure the article's real end. Effort: 20 min. Closes S1, S6, S7, Holmes's dwell-bypass finding, my stumble 19.**

Edit `src/reader_mcp/web_ui/reading.mjs#17-20@71f0041e`:

```js
const lastBlock=()=>[...document.querySelectorAll('#article > :not([data-reader-decoration],.annotation-pin)')].filter(el=>el.getClientRects().length).at(-1);
const readingSpan=()=>{const last=lastBlock(),page=scrollSpan();return last?Math.min(page,Math.max(0,last.getBoundingClientRect().bottom+shownTop(state.smoother)-innerHeight))||page:page;};
// in progress():
return span?clamp(scrollY/span):0;
```

`endVisible` uses `lastBlock` too, so the dwell also waits for trailing tables and embeds. The patch adds comments explaining the page-range fallback.

**R2. CODE: fall forward only across a real margin, and not because of the title. Effort: 15 min. Closes S2, S3, Holmes drift 1, my stumble 18.**

Edit `src/reader_mcp/web_ui/reading.mjs#151@71f0041e`:

```js
if(!target){
  const covers=el=>{const r=el.getBoundingClientRect();return r.top<=line&&r.bottom>line;};
  const inContent=[...document.querySelectorAll('#article > :not(.annotation-pin)')].some(covers);
  if(!inContent&&blocks.some(el=>!el.matches('.document-title')&&el.getBoundingClientRect().bottom<=line))target=blocks.find(el=>el.getBoundingClientRect().top>line);
}
```

- **Prerequisite:** R1 is needed for the mid-table acceptance check, because the saved share is meaningless without it. The top-of-document guard is independent of R1.
- **Follow-up, not tried:** add `table_open` to the source-map list at `src/reader_mcp/web_ui/app.mjs#94@71f0041e`. Tables would then have exact block anchors. It touches annotations and find, so it needs its own change.

**R3. TEST: a suite that covers these behaviours. Effort: included, ready to copy. Closes the test half of S1, S2, S3, S6, S7, Holmes's sibling-read gap, my stumbles 6 and 12.**

Add `tests/web_reading_position.cjs`. It covers:
- the top of a document at six window sizes
- the saved block for a margin
- a trailing table, including `End` and reopening mid-table
- a one-screen article
- the sibling-edition read on the chip

Land it with R1 and R2. Trailing embeds aren't in this suite yet. I measured them by probe only, so add that case.

### Should land

These are independent of each other unless noted, and ordered by yield per effort.

**R4. DOCS: correct the stale descriptions. Effort: 15 min. Closes Holmes drift 3 and reverse items 2–6, my stumbles 1–6, 9, 14, 29.**

The patch edits:
- `docs/web.md#525@71f0041e`, `#1968`, `#2008`, `#2289`, `#2294`, `#3470`, `#4603`
- `docs/capabilities.md#207@71f0041e`
- the CSS comment at `src/reader_mcp/web_ui/style.css#273@71f0041e`
- the code comment at `src/reader_mcp/web_ui/versions.mjs#42@71f0041e`, whose reason is false

Two caveats:
- The wording assumes R1, R2 and R3. If D1 below goes the other way, the chip passages change.
- The patch leaves one long unwrapped line near `docs/web.md#2296`. Rewrap it when landing.

**R5. DOCS: changelog entry. Effort: 5 min. Closes my stumbles 8 and 14, and the disclosure half of S14.**

Edit `CHANGELOG.md#3@71f0041e`. Don't rewrite pushed commit messages. Let this entry and the docs carry the corrections, including the ones for my stumbles 13, 16 and 17 where relevant.

**R6. CSS: hide Source in two-page reading, as the docs say. Effort: 2 min. Closes S11.**

Edit `src/reader_mcp/web_ui/style.css#51@71f0041e`, splitting the rule so the meta children use `display:none!important`. A later `utilities` layer otherwise wins. The docs already promise this, so I'd change the code and not the docs.

**R7. CSS + TEST: make the issue page follow its column, not the window. Effort: 30 min. Closes S4, S12, my stumbles 10, 11, 21, 30.**

Edit `src/reader_mcp/web_ui/style.css#190-191@71f0041e`:
- Add `#main:has(.issue){container:issue-column/inline-size}`.
- Change the two `@media` rules to `@container issue-column (…)`.
- Remove the dead `flex-wrap` and `flex`.
- Change the stats to a wrapping flex row, and add `minmax(0,1fr)` on the masthead and `flex-wrap` on `.issue-nav`.

Add a check in `tests/web_magazine.cjs` that opens the Explorer and asserts no overflow at five widths with five-digit stats.

- **Side effects to look at:**
  - With the Explorer open, the narrower layouts now apply at wider windows.
  - At 320 px, the forward arrow wraps to a second line.
  - I set `padding-inline:0` on the footer link but didn't remeasure its indent.

**R8. TEST: restore what 71f0041e loosened. Effort: 5 min. Closes S8, S13, Holmes drift 4.**

- `tests/web_service.cjs#16@71f0041e`: excuse only messages matching `status of 503`, and wait for the "Retry voices" button after `#admin/service` loads.
- `tests/web_links.cjs#121@71f0041e`: assert the last `td` equals `'20'`.

**R9. CODE: hoist `readingSpan()` out of the pips loop. Effort: 2 min. Closes Moriarty's pip-cost conjecture cheaply.**

Edit `src/reader_mcp/web_ui/reading.mjs#207-213@71f0041e`. The cost itself is unmeasured, but the edit is safe and simpler.

### Needs the user's decision

**D1. UX: should the page show your earlier read date? Closes S10, Holmes drift 2, my stumble 26, and the lost local-date test.**

Today the log says "You just now" on every open, and the earlier date is only in Space v. **I recommend restoring it when the read was on an earlier day.** It's no longer a repeat of the log, because the log never shows it.

Edit `src/reader_mcp/web_ui/versions.mjs#43@71f0041e`. The condition becomes:

```js
read?.where==='current'&&read.at&&(read.path!==current?.path||day(read.at)!==day(new Date().toISOString()))
```

The text becomes `You last read this on Oct 16` for this file. With a forced earlier date the chip rendered that sentence, and it stayed hidden on a same-day open. I tried this by network route only, so it needs tests in `web_dates`. If the user declines, R4's wording stands.

**D2. UX: should two-page PDFs keep the row? Closes S5.**

Pages shrink by 36 px, from 316 to 280 on a 1000×520 window. **I recommend hiding the row for two-page PDFs**, since the page is the point and Read aloud (Space s) and the version twin remain available. A probe restored the height to 316 with this rule:

```css
body.two-page .document-shell:has(#article.pdf-document) .document-meta{display:none}
```

The alternative is to accept it and disclose it.

**D3. PRODUCT: "finished" now means 97% of the article. Closes Holmes's reverse-drift item 1.**

**I recommend accepting this**, since the footer was never reading. R4 documents it. I rejected capping saved progress before the dwell. Scrolling to the end of an article 153 px taller than the window saved 1 at once on the patched build, and by my reading the old code also saved 1 at the page bottom. That is an explicit gesture, and a cap would couple the client to the server's threshold.

**D4. DATA: false "finished" states already saved. Effort: none if accepted.**

From `src/reader_mcp/web.py#1003-1009@71f0041e`, "finished" is derived from the latest bookmark, so the next correct save overwrites it. Documents not reopened stay wrong, and nothing marks which ones. **I recommend accepting self-healing unless the user cares about the short window.** I read that one call site only; Holmes also cites `web.py#1113`.

**D5. UX: labels and control styling. Closes my stumbles 15, 27, 28.**

These are taste, and I'd do them only if the user wants them:
- Rename Source to `Open original`, matching the footer.
- Give the chip a slightly different look from the action buttons.
- Settle on one name for the File Explorer, since "Documents browser" at `README.md#258@71f0041e` is the plain outlier.

### Optional

| # | Type | Repair | Closes | Effort |
|---|---|---|---|---|
| O1 | Test | Move the two scenarios out of `tests/web_versions_late.cjs#96@71f0041e` and `#105`, leaving its header true | my stumble 12 | 10 min |
| O2 | Code | First `End` press stops short on unsettled layout. Investigate first: re-seek once rendered blocks settle. Measured again on a long document: first press y = 3551, second y = 4460. Older class of bug, so no edit proposed | S9 | 1 hr |
| O3 | Test | Replace `/^. ?You/` with a named selector and explain the `v3` and scroll-to-1 gestures | my stumble 24 | 10 min |
| O4 | Docs | Add a sentence on the historical banner's new order, and comment `-.2em` | my stumbles 17, 23 | 5 min |
| O5 | Code | Break up the title row template at `src/reader_mcp/web_ui/app.mjs#568@71f0041e`. Only when that code is next changed | my stumble 22 | 30 min |
| O6 | Test | Repeat closed-fold behaviour in Safari and Firefox | Moriarty's conjecture | 30 min |
| O7 | Test | Check the playing-state speech control's height, which the row's selector doesn't match | Holmes claim 5 | 15 min |

### Deliberately not repaired

- **S14, old bookmarks on the new scale:** a migration isn't worth it. This affects only offset-less bookmarks, by a few hundred pixels. Disclosure in R4 and R5 is enough.
- **Pushed commit messages (my stumbles 13, 16):** leave history alone.
- **Mixed `scrollY` and `shownTop` (my stumble 20):** Moriarty's smooth-scroll attack failed, and `web_smoothing` passes with the patch. No evidence of harm.
- **`web_companions` narrowing, `web_static_demo` midnight edge:** both detectives found nothing beyond a shrug or a conjecture.
- **`tests/web_admin.cjs#130@71f0041e`:** the comment's intent is still true, though its retry may now be idle. I fixed only the plainly false one in `web_content_visibility`.

### Landing order

1. **R1, R2 and R3 as one change.** They need to land together, so I'd make one commit, with R9 optional inside it.
2. **R4 and R5 next.** They describe the behaviour R1–R3 create.
3. **R6, R7 and R8 in any order.**
4. **D1 and D2 after the user answers.**

```
VERDICT
witness: Watson, second deposition
fatal_to_claims: [19cb589d via S1, 9759c6e2 via S2, 39417c9c via S3]
must_land: [R1, R2, R3]
should_land: [R4, R5, R6, R7, R8, R9]
user_decisions: {D1: restore earlier-day date, D2: hide row on two-page PDFs, D3: accept 97% of article, D4: accept self-healing, D5: taste}
optional: [O1, O2, O3, O4, O5, O6, O7]
verification: R1-R9 combined, 92/92 suites on a scratch export; new suite RED at 71f0041e
not_verified: repairs in isolation, non-Chrome browsers, hero documents, D1/D2 under the full suites
retraction: my stumble 25
pinned_checkout: unchanged
```
