# Case file: PR #168, article coding jobs and Reader Admin

| | |
|---|---|
| **Case** | `2026-10-27-pr-168-coding-jobs-admin` |
| **Date** | 2026-10-27 |
| **Subject** | flyingrobots/reader PR #168 (RW-44 article coding jobs, RW-45 Reader Admin, #165 per-checkout worker names), first-parent diff `b462c23..06add3e` (110 files, +8,834 / −437) |
| **Subject SHA** | `06add3e` (merge commit on `main`) |
| **Evidence SHAs** | reader `06add3e`; base `b462c23` |

⚠️ ALL VERDICTS HEREIN ARE VALID ONLY FOR THE COMMITS ABOVE.

## Executive deduction

The most consequential finding is on the ordinary path, not a failure path. The agent's draft text goes into the pull request body unfiltered. A verified PR can therefore also say `Fixes #1`, and still reach `pr_opened`. Merging it then silently closes an unrelated issue (Moriarty S3, proven by test). Two independent pairs of detectives found the rest. The publication core holds: create-only push, read-back gate, and Stop gates on push and PR. What fails are the edges where a write fails, Reader shuts down or the server crashes, and the user documentation understates what a job does to the repository, GitHub and the model provider.

## Report card

| Measure | Witness | Grade | Basis |
|---|---|---|---|
| Fidelity | HOLMES ×3 | **B−** | Server C+ (16 drifts in 36 claims), web UI B+ (7 drifts), docs and tests B− (9 drifts, 10 test gaps) |
| Clarity | WATSON | **B−** | Maintainer docstrings excellent. The user-facing safety and setup story is scattered, overstated in five places, and missing from the README's privacy section. |
| Resilience | MORIARTY | **B−** | 7 strikes landed (6 by failing test, 1 by code citation) against 8 attack vectors that held |
| **Overall** | Front office | **B−** | No strike is fatal: none loses data or publishes against the user's Stop on the ordinary path. Two P2 defects (S1, S6) and a convergent P2 (Holmes-1 §1) keep the grade from rising, and the ordinary-path S3 is cheap but real. |

## Adjudication

The findings are deduplicated below. Where two detectives reached a finding independently, I say so; that convergence is the strongest evidence in this file.

1. **Extra closing references in the PR body** (Moriarty S3; Watson's menu, Issue 4). **CONFIRMED** by test_m3 (`('pr_opened', ['1', '277'])`).
   - **Ruling:** P2, not the P3 Moriarty assigned. It needs no failure at all, and agents commonly write "Fixes #N". This ranks it first.
2. **Admission save failure leaves a phantom queued run** (Holmes-1 §4 ≡ Moriarty S1). **CONFIRMED**, convergent, test_m1. P2.
3. **A Reader shutdown is recorded as "Stopped by you"** (Holmes-1 §3 ≡ Moriarty S2). **CONFIRMED**, convergent, test_m2. P3.
   - **Ruling:** ranked high regardless. It happens on every restart while a job runs, and it blames the user.
4. **An archive failure after a GitHub write ends `failed`, and a rerun duplicates the issue** (Holmes-1 §1).
   - **Ruling:** **CONFIRMED by reading.** It is cited line by line (`coding_publish.py#212,#226@06add3e`, `coding_jobs.py#294-295,#349-350@06add3e`), but no detective ran a test. P2, with the effort Watson estimates. The follow-up issue must open with a RED test.
5. **Recovery skips a left-over process group whose leader has exited** (Moriarty S6). **CONFIRMED**, test_m6. P2.
   - The hostname-drift addendum stays **CONJECTURE**, with Moriarty's proposed experiment.
6. **`finish()` raises; recovery relabels a sealed outcome** (Holmes-1 §2; Moriarty S5).
   - **Ruling:** these are two faces of one function. Watson's merge into one issue is accepted. S5 is CONFIRMED by test_m5. Holmes-1 §2 is CONFIRMED by reading; whether an oversized record is reachable remains Holmes's conjecture.
7. **Stop semantics** (Holmes-1 §3; Moriarty S4).
   - **Ruling:** S4 is CONFIRMED by test_m4 and is P5, record hygiene only. The in-flight PR and push are CONFIRMED by reading. Moriarty's "Stop versus an in-flight `gh` create" stays CONJECTURE.
8. **"No article text … goes to GitHub"** (Watson #9 ≡ Holmes-1 §6 ≡ Holmes-3 §II.6 ≡ Moriarty S7). **CONFIRMED** drift: four-way convergence, the strongest in the case.
9. **Push vocabulary.**
   - Watson (#8) calls the three accounts a conflict. Holmes-3 holds that `docs/capabilities.md#363` "holds in substance".
   - **Ruling:** both are right. "Pushes normally" in `CHANGELOG.md#5@06add3e` is a **DRIFT** (Holmes-3's worst). The capabilities sentence is true but must be worded so it does not appear to contradict web.md. Issue 8 aligns all three.
10. **Host folders outside home.**
    - Holmes-1 §6 and Holmes-3 §II.7 report a drift. Moriarty conceded it as the documented exception (`docs/web.md#3826-3827@06add3e`).
    - **Ruling:** the docs contradict themselves (`#3819-3820` against `#3826-3827`), so this is a **DRIFT in the documentation**, not proof of a code defect. The decision belongs to the maintainer (Issue 16).
11. **"The user's checkout … untouched"** (Watson #7). **CONFIRMED** as an overstatement: the agent is given write access to the shared `.git` (`coding_workflow.py#243@06add3e`). Whether an agent misuses it is Watson's labelled conjecture.
12. **Admin sidebar from detail routes** (Holmes-2 #7). **CONFIRMED by reading** (`web/src/admin/admin-shell.tsx#28@06add3e`). No detective ran the browser suite.
13. **Validation record** (Watson #20–22 ≡ Holmes-3 §IV). **CONFIRMED** stale, convergent.
14. **Per-checkout validation lock** (Watson #26 ≡ Holmes-1 §8). **CONFIRMED**, convergent. It is a resource-discipline decision, not a claim drift (`docs/separate-vault.md#33@06add3e` is honest).

**CONTESTED:** none. The one disagreement (item 10) was ruled on as a documentation contradiction.

## The repair menu (re-ordered by adjudication)

Watson's 21 issues are kept as he scoped them. Only the order changes: findings that happen on the ordinary path move above those that need a disk failure or a crash. The full text of each issue is in `WATSON.md`, second deposition.

| Rank | Watson # | Type | Effort | Issue |
|---|---|---|---|---|
| 1 | 4 | code | S–M | A PR Reader opens must close exactly the job's issue |
| 2 | 3 | code | S | A Reader shutdown ends a running job `interrupted`, not `cancelled` |
| 3 | 8 | doc (+ decision) | M | What a coding job does to your repository, GitHub account and model provider, and how to set one up |
| 4 | 1 | code | M–L | An archive failure after a GitHub write ends `needs_reconciliation`, never `failed` |
| 5 | 2 | code | S–M | A failed run save at admission leaves no queued orphan, and Stop does not acknowledge it |
| 6 | 5 | code | M | Recovery stops a left-over process group even after its leader exited |
| 7 | 10 | code | S | Reader Admin: choosing the open section returns to its list and its top |
| 8 | 9 | code | S | Reader Admin: remove the remaining "Behind the scenes" labels |
| 9 | 6 | code | M | `finish()` never raises, and a recovered run keeps its sealed outcome |
| 10 | 7 | code + doc | M | Stop reports in-flight effects truthfully and leaves no pending intent |
| 11 | 11 | code | S | The repository identity check uses the effective push URL |
| 12 | 12 | code | M | A broken or slow recovery never prevents Reader from starting |
| 13 | 13 | code | M | Runs that need reconciliation appear under Attention; job views stay current |
| 14 | 17 | doc | S | Reader Admin and coding-job reference matches the shipped behaviour |
| 15 | 18 | doc | S | Validation record: post-merge addendum at 06add3e |
| 16 | 16 | decision | M | Make the host-folder and credential claims true, or narrow them |
| 17 | 14 | decision + code | S–M | Per-checkout worker names, but one host-wide heavy-work lock |
| 18 | 15 | code | M | Bounded scratch space; listings whose cost does not grow with history |
| 19 | 19 | test | M | Coding-job guard rails fail when removed |
| 20 | 20 | test | M | Pin populated coding-job, repository and LLM-log contract shapes |
| 21 | 21 | decision | M | Authorise one real agent job against a sandbox GitHub repository (after ranks 1, 2, 4 and 5) |

**Regression tests ready to adopt:** Moriarty's probes in `moriarty_probe.py`.
- `test_m1` → rank 5
- `test_m2` → rank 2
- `test_m3` → rank 1
- `test_m4` → rank 10
- `test_m5` → rank 9
- `test_m6` → rank 6

## Ship verdict

**REQUIRES INVESTIGATION.** The change is sound after the named repairs. It is already merged and live.

- **Before trusting a job's PR:** ranks 1 and 2 should land first.
- **Before a real (non-sandbox) repository is registered:** rank 3 should land first.
- **Before the failure paths are relied on:** ranks 4 to 6.

## Chain of custody

- **Tools.** Graft MCP tools were not available to any detective. All fell back to Read and Bash, as the standing order allows.
- **Probe runs.** No HOLMES or WATSON ran tests or Docker. Only MORIARTY ran probes: one bounded run, `6 failed in 13.63s`. The worker was removed and no tracked files changed. His probe file is preserved here as `moriarty_probe.py`.
- **A detective's deviation.** MORIARTY took a git-locks key (`host/docker/reader-python-checks-case-wt/`) for his run. The owner had told this session not to use git-locks. It was a single bounded run with no harm done, but it was a deviation from instruction, and it is recorded here.
- **Transport.** The harness flagged Watson's first deposition for an instruction-like pattern ("bypass-permissions"). That is the name of a Claude Code mode he was analysing, not an instruction.
  - Testimony transport escaped `<`, `>` and `&` as HTML entities. The front office restored them when bundling.
  - HOLMES-1 ended his testimony with a progress-report footer, kept verbatim.
- **Not covered.**
  - No real coding agent or real GitHub repository was exercised (rank 21).
  - No browser suite was run during the investigation. HOLMES-2's UI findings are code readings.
  - HOLMES-3's test counts are `def test_` greps, not runs.
  - Built controls in `src/reader_mcp/web_ui/controls/`, the static-demo export and performance were out of scope.
- **Before the investigation.** A fifth adversarial Codex review round was stopped before it finished, at the owner's request, in favour of shipping and this audit.
