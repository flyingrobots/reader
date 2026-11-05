# Case file: the title row and reading position

- **Date:** 2026-11-04
- **Subject:** `flyingrobots/reader` commits 9759c6e2, 1f0beac9, 19cb589d, 39417c9c, 7bb3ef66, 71f0041e
- **Evidence:** the checkout pinned at `71f0041e`

⚠️ ALL VERDICTS HEREIN ARE VALID ONLY FOR THE COMMITS ABOVE.

## Executive Deduction

The reading-position work fails on ordinary documents: an article ending in a table or embed reads 100% almost at once, and a reader inside one reopens far ahead. "A reader at the top stays at the top" is false for documents with their own title on phones and tall windows. The title row and the suite repairs mostly hold, and the green run is real.

## Report Card

| Measure | Witness | Grade |
|---|---|---|
| Fidelity | Holmes: 29 claims, 24 confirmed, 4 drift, 1 unverifiable | C+ |
| Clarity | Watson: 30 stumbles, one later retracted | C+ |
| Resilience | Moriarty: 14 strikes landed (3 high, 4 medium, 7 low), 2 conjectures | C- |
| **Overall** | Capped at C by Moriarty's fatal strikes | **C** |

## Adjudication

- **Top of document:** Holmes (drift 1) and Moriarty (S3) reached this independently, with different viewports and matching causes. Upheld as the same finding.
- **Coverage of the margin rule:** Watson's stumble 25 said nothing pinned the rule. Moriarty's mutants disproved it and Watson retracted it. Ruled for Moriarty.
- **"Reading log already says":** Holmes (drift 2), Moriarty (S10) and Watson (stumble 26) agree. Moriarty rated it low; I rule it worth repairing, because the removal was unrequested and the stated reason is false.
- **`web_service`:** Holmes (drift 4) and Moriarty (S8) agree, and a mutant proves it. The commit overstated; upheld.
- **"Finished" threshold:** Holmes reports it as reverse drift, Moriarty's S6 as a bypass, and Watson's D3 proposes accepting the rescale. Ruled: fix the 1px bypass (S6), accept that finished now means 97% of the article.
- **Old bookmarks (S14):** accepted and disclosed; not migrated. They reach only offset-less bookmarks.
- **CONTESTED:** nothing left unruled.

## The Repair Menu

Watson's, in this order. Details are in `WATSON.md`.

1. R1, R2, R3: measure the article's real end; fall forward only across a real margin; a suite that covers both. **Must land.**
2. D1: show your earlier read date on a later day (restores information 1f0beac9 removed unasked).
3. D2: restore two-page PDF height (undoes a side effect of 1f0beac9).
4. R6, R8, R9: Source hidden in two-page reading; restore loosened assertions; hoist the span out of the pips loop.
5. R7: make the issue page follow its column.
6. R4, R5: correct the stale docs; changelog entry.
7. Left for later: D5 (labels, taste) and O1–O7.

## Ship Verdict

**REQUIRES INVESTIGATION.** Sound after R1–R3. These commits are already on `main`, so the repairs go through a PR and are reviewed there.

## Chain of custody

- **Landed before review:** the commits were pushed directly to `main` before this review. There was no PR to review. The findings were live on the user's server while it ran.
- **Paths edited:** testimonies are verbatim except for paths, because this repository is public. Paths inside the repository are repo-relative. Evidence the detectives kept in a temporary directory is copied to `evidence/` and linked from there; the new suite's path points to where it landed.
- **Tooling:** Graft tools were not available to the detectives. Cross-examination (`--cross-examine`) was not requested and did not run.
- **Not covered:** non-Chrome browsers, hero documents under the repairs, the speech playing state, historical view layout, and a dedicated split `docFraction` probe.
- **Detective errors kept:** Watson's stumble 25 stands in his first deposition with its retraction in the second.
- **Author's errors kept:** before this review the author told the user only two suites failed, having cut the output short, and shipped the regression Holmes found while claiming to have fixed it.
