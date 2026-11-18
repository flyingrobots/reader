# Coding jobs and Reader Admin validation

RW-44 turns an article's `reader:prompt` block into a prompt card that can start one coding job: a new branch and worktree in a registered repository, a linked issue, a supervised coding agent, a guarded verification command and a pull request opened only after Reader verifies the pushed head. RW-45 replaces Behind the scenes with Reader Admin, a sidebar layout with one routed page per section. RW-44's Coding jobs, LLM logs and Repositories pages are Admin sections. Both branches were merged with current main and the per-checkout worker names (#165) before these checks.

## Checks on 2026-10-27

All checks ran at `f604a55` or on source identical to it.

- **Bounded runner:** `formatter`, `web` (Node tests, web type check and production build), `node` (plugin) and `python` passed. Python passed 937 tests with two optional skips, once alone and once alongside the browser suites.
- **Contract suite:** 147 of 147 passed on the pinned demo vault (`npm run test:contract`). Every existing golden shape is unchanged. New goldens cover the coding-job and LLM-log routes. `docs/port/surface.md` reports no route without contract coverage, and the inventory now lists every SSE route, including `/api/jobs/stream`.
- **Browser suites:** all 71 browser suites ran headless in the installed Chrome, one at a time, each with a 300-second limit. 68 passed. `web_backstage`, `web_links` and `web_versions_late` failed with the same assertions on current main without this change, so they are main's failures (see Remaining gates).

The synthetic coding fixture uses a local Git remote, a fake coding CLI and a fake GitHub. No real model, repository or GitHub account was used.

## Defects found during integration

- **Render loop after Run:** `useJob` gave `useSyncExternalStore` a new subscribe function on every render. A loaded run's resubscription publishes at once, so after **Run → PR** the card re-rendered without end (React error 185) and unmounted. The subscribe and snapshot functions are now stable per run ID. `web_coding_jobs` was RED at `03fa533` and GREEN in three consecutive runs afterwards.
- **Sidebar bullets:** Reader's Tailwind build has no preflight, so the Admin sidebar menu kept the browser's list bullets. The new list-style assertion was RED before the fix and GREEN after it.
- **Phone-width label:** at 390 px the prompt card's footer squeezed "As written" to one letter per line (140 px tall). The footer now wraps instead. The one-line assertion was RED before the fix and GREEN after it.
- **Lock keys default:** the Repositories form prefilled the lock keys with `host/heavy-work`. It is now empty, with a per-project key as the placeholder.
- **Job stream hang-ups:** job event streams now wait in short slices and stop when the client hangs up, as chat streams do since #152.

## Determinism

`web_admin`'s return-scroll check failed in about half of its runs after the merge. There were two causes:

- **Real-time glides:** the smoother glides in real time, so the place saved on leaving depended on how far a glide had got.
- **Estimated heights:** with `content-visibility: auto`, block heights depended on which blocks Chrome happened to render during a glide.

The check now runs on a paused Playwright page clock, advanced explicitly, with every block laid out; `web_content_visibility.cjs` still covers the estimated layout. It requires the same block at the same depth (within 5%). It passed 18 of 18 runs, 12 of them under a concurrent Python container run.

## Screenshots

`web_coding_jobs` captures:

- the prompt card, the opened pull request with its trace and a failed verification
- the Coding jobs, job, LLM logs and Repositories pages
- the card at phone width

They are written to `READER_SHOTS` (default `.reader/web-dev`), are not tracked, and were reviewed for this checkpoint.

## Remaining gates

- **Current-head CI and Code Lawyer review:** both are required before merge.
- **Main's three failing browser suites:** these are tracked separately.
  - `web_backstage` and `web_links` expect the footer immediately after Read next or Linked from (#166).
  - `web_versions_late` restores Paragraph 20 about 95 px from where a quick timeline does (#167).
- **No real end-to-end run:** a real coding agent against a real GitHub repository has not been exercised. Only the fixture's fake agent and fake GitHub have.

## Post-merge addendum (2026-11-16)

This addendum adds to the record above. It does not change it. The checks above ran at `f604a55`. That commit is 66 commits before the merge (`git rev-list --count f604a55..06add3e` gives `66`).

- **Merge commit:** [#168](https://github.com/flyingrobots/reader/pull/168) merged as `06add3e`. Its parents are `b462c23` (main) and `ba8a5a2` (the PR head).
- **Current-head CI:** the `checks` workflow passed on `ba8a5a2`, for the [pull_request run](https://github.com/flyingrobots/reader/actions/runs/40514700829) and the [push run](https://github.com/flyingrobots/reader/actions/runs/40514692466). CodeRabbit did not review the PR. The "Current-head CI" gate in Remaining gates is now met.
- **Code Lawyer review:** the [Code Lawyer Activity Summary](https://github.com/flyingrobots/reader/pull/168#issuecomment-6443432120) covers `ba8a5a2`. It lists 51 findings. Each has the outcome "fixed". A local Codex review ran for four rounds, because CodeRabbit could not review 102 files.
- **Branches:** the first paragraph says "Both branches". These are `feat/rw-44-article-coding-jobs` (RW-44) and `feat/rw-45-admin-dashboard` (RW-45). RW-45 merged into RW-44 at `705dbf5`. The per-checkout worker names came from `fix/worktree-container-names` (#165), merged at `03fa533`.

### Review fixes after `f604a55`

These commits are on the PR's first-parent history (`git log --first-parent f604a55..ba8a5a2`). The Code Lawyer summary gives the finding for each.

`9421c3b`, `3610c18`, `0de22b1`, `2fbfeba`, `db48587`, `482bf54`, `5aa9b35`, `4f8a7b3`, `7fa100d`, `5c62351`, `46ad510`, `cb22ae0`, `9bb751b`, `7668dd9`, `4ab6d86`, `f42bf43`, `b636d3c`, `72d1f36`, `f719f17`, `70ad826`, `f6203da`, `f5b35ae`, `57ee07e`, `1d25170`, `cf8b9c9`, `2a92406`, `ccbe250`, `9d4ca93`, `32816f3`, `2800ab9`, `f09a544`, `340ff63`, `6e9dffe`, `3ae04a1`, `3786b33`, `e6b0184`, `bd7da65`, `da28a77`, `b0ca234`, `09d3418`, `1271a8c`, `55bd484`, `775e7ce`, `d3d36f5`, `398a9ab`, `b03e041`, `320e74d`, `3648d34`, `d104f50`, `696cf4a`, `8820ee4`.

The other first-parent commits are not review fixes: `bdb271a` (this record), `c757589`, `4ad1254`, `c5dad1d` and `5f6094f` (surface inventory regenerations), and the merges `ccf0738` and `ba8a5a2`.

### Counts

The counts above (937 Python tests, 147 contract cases, 71 browser suites) are from `f604a55`. They were not re-run at `ba8a5a2` or `06add3e`. Do not read them as current. The CI result above is the only test result at the PR head.

### Remaining gates now

- The CI and Code Lawyer gate is met, as stated above.
- This addendum does not check the state of #166 and #167.
- A real end-to-end run is still not recorded here.
