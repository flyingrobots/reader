# First deposition of Dr. John H. Watson: PR #168 (RW-44 coding jobs, RW-45 Reader Admin, per-checkout worker names)

*Pinned: reader @ 06add3e (base b462c23). Graft tools were not in my kit, so I read with plain Read and git. I made no edits and ran no tests, Docker or network calls.*

I read this change the way a patient reads a discharge letter. First I asked what I can do now, what it will cost me, and whom I call if it goes wrong. Only after that did I ask how the surgeon did it. Half the time the letter answers well. The other half it answers the surgeon's questions instead.

## 1. As a Reader user who writes articles and wants to run a coding job

### What reads well (credit where due)

- **The basic promise is plain and true to the code.** Nothing runs when you view an article. The README says so at `README.md#121-129@06add3e`, and the card says so at `docs/web.md#1350-1351@06add3e`. The card's own pre-run sentence is the best single piece of user prose in the PR: "Run → PR works on a new branch from … links issue #N … opens a pull request only after Reader verifies the change. Nothing is merged." (`web/src/jobs/prompt-card.tsx#85-86@06add3e`).
- **The format is shown before it is specified.** The `reader:prompt` example sits at `docs/web.md#1316-1324@06add3e`, followed by a field table at `#1326-1332`. That is the right order for an author.
- **The "Executor boundary" paragraph is honest** (`docs/web.md#1399-1403@06add3e`). It admits that a worktree isolates Git changes, "not the filesystem, build caches or credentials". It also admits that "do not push" is "a cooperative rule". `docs/capabilities.md#363@06add3e` repeats this and says the real GitHub path is unexercised. Both are good, adult framing.
- **Shipped fact is kept apart from what remains unproven.** Three places say plainly that no real agent or real GitHub has been exercised: `CHANGELOG.md#5@06add3e` (last clause), `docs/capabilities.md#363@06add3e` and `activity/rw-44-validation.md#13,#48@06add3e`. No grandiosity there.

### Where I stumbled

**(a) There is no setup path.** A user who wants to run their first job has to put the prerequisites together from three places:
- the Preflight list: `gh` login with push access, the agent executable, the verification command and git-locks (`docs/web.md#1365-1369@06add3e`);
- the Registry paragraph (`#1405-1412`);
- the Admin Repositories section (`#1441-1442`).

The README's "To get / Install / Then" table (`README.md#210-217@06add3e`) has rows for chat voices, the librarian, the local model and read aloud. It has no row for coding jobs. The README's coding-jobs section (`README.md#121-129@06add3e`) also does not link to `docs/web.md#article-prompts-and-coding-jobs`. The reader is left to infer that the next sentence's "each documented in docs/web.md" covers it.

**(b) The risky modes are named but never explained, and their default is not stated.** `docs/web.md#1407-1408@06add3e` lists Codex `workspace-write` or `danger-full-access`, and Claude Code `acceptEdits` or `bypassPermissions`. It does not say what each grants, or which one applies when the field is left out.
- The code defaults to the first, safer mode: `src/reader_mcp/repositories.py#130@06add3e` uses `MODES[name][0]`, and `MODES` is defined at `#37`.
- The Register form has no mode field at all (`web/src/jobs/admin.tsx#152-170@06add3e`). So the dangerous modes can only be reached by hand-editing `.reader/repositories.json`.

That is reassuring news, and the documentation withholds it.

**(c) The documented argv is a paraphrase that leaves out risk-relevant flags.**
- The docs show Codex as `exec --cd <worktree> --sandbox <mode> --add-dir <git common dir>`, and Claude Code with no `--add-dir` (`docs/web.md#1373-1374@06add3e`).
- The code also passes `-c approval_policy="never"` to Codex (`src/reader_mcp/coding_agents.py#47@06add3e`).
- The code gives Claude Code `--add-dir` too (`#53-54`).
- The writable set is the checkout's Git common directory plus any git-locks store (`src/reader_mcp/coding_workflow.py#243@06add3e`).

A reader who sees "argv" expects the exact command line. Being told the agent can write to your main repository's shared `.git` (refs, config, hooks) is material.

**(d) The reassurance "the user's checkout … untouched" is narrower than it reads.** `docs/web.md#1371-1372@06add3e` says "The user's checkout, its dirty files and its index are untouched." That is true of Reader's own Git operations. But the agent is handed write access to the same Git common directory (item c). The boundary paragraph 28 lines later partly corrects this, but nobody reads a reassurance and its correction together. *(Conjecture: whether an agent would ever alter the main checkout's refs or hooks is behaviour, not documentation. The point here is only that the sentence overstates.)*

**(e) Three different accounts of how Reader pushes.**
- `CHANGELOG.md#5@06add3e` says Reader "pushes normally".
- `docs/web.md#1383-1385@06add3e` says it is a create-only `git push --force-with-lease=refs/heads/<branch>: …` and explains the empty lease.
- `docs/capabilities.md#363@06add3e` says a job "never … force-pushes".

The three can be reconciled once you understand an empty lease. On first reading, though, the docs appear to contradict each other on the one subject a cautious user checks first. "Normally" is simply wrong as a description of the flag.

**(f) "No article text … goes to GitHub" is overstated.** `docs/web.md#1380@06add3e` makes that claim, but:
- When the agent supplies no title, the issue title falls back to the prompt block's author-written `title` (`src/reader_mcp/coding_publish.py#81@06add3e`).
- Issue and PR bodies are the agent's drafts, derived from the article's prompt, filtered only for paths (`#82`, `#204`, and `coding_workflow.py#81-86@06add3e`).

What is true is narrower: Reader never copies the article or its prompt verbatim, and it strips local paths. The word "No" promises more than that.

**(g) The README privacy section was not updated.** `README.md#228-247@06add3e` still describes only voice turns, under both "What leaves your machine" and "Logs are kept". Coding jobs add new outflows that a privacy section must name:
- repository code and the prompt go to the agent's provider;
- issues, PRs and branches go to GitHub under your `gh` identity;
- the agent runs with your environment (`docs/web.md#1400@06add3e`).

They also add a new permanent archive. That archive is committed to the vault's Git (`src/reader_mcp/coding_jobs.py#334-342@06add3e`). The docs say "archived … kept forever" (`docs/web.md#1414@06add3e`) but never say "committed".

**(h) The LLM logs reference is stale.** `docs/web.md#2537-2538@06add3e` still lists only `chat`, `listen`, `inbox`, `local-model` and `art`. The code's `KINDS` includes `coding-job`, and also `quiz`, `quiz-review` and `prompt` (`src/reader_mcp/llm_logs.py#27@06add3e`).

**(i) There is no authoring guidance beyond the contract.** No skill, template or how-to mentions `reader:prompt` (`git grep` over tracked `*.md` finds only CHANGELOG, docs/web.md and the validation note). An author learns what makes a block parse. They do not learn what makes a good self-contained prompt, or that Reader prepends a brief telling the agent to follow the repository's AGENTS.md (`src/reader_mcp/coding_agents.py#60-82@06add3e`).

**(j) "From this Mac only" is unexplained.** It appears at `docs/web.md#1411@06add3e` and `src/reader_mcp/coding_api.py#126@06add3e`. The real test is `identity.via == 'local'` (`coding_api.py#125`). The docs never say what that means for a phone over Tailscale, or for a non-Mac host.

### Reader Admin (RW-45)

**(k) A rename slip.** "Reader Admin (formerly Reader Admin)" at `docs/web.md#1059@06add3e`. It should say "formerly Behind the scenes".

**(l) The route table omits three sections, and they are the first three in the sidebar.** The table at `docs/web.md#1065-1075@06add3e` lists nine routes. The changelog's route list at `CHANGELOG.md#7@06add3e` lists the same nine. Neither includes `jobs`, `logs` or `repositories`, yet they sit second to fourth in the registry (`web/src/admin/sections.tsx#68-74@06add3e`). They turn up only at `docs/web.md#1437-1443@06add3e`. The README's section inventory (`README.md#107-113@06add3e`) omits them too.

**(m) Three names for one thing.** The footer button is still "Backstage", the feature is "Reader Admin", and the commands are `:backstage`/`:admin` (`docs/web.md#1077@06add3e`). That is liveable, but nobody states the rule ("the button keeps its old name").

**(n) User-visible leftovers of the old name, in a file this PR did not touch.** `web/src/search-page.tsx#108@06add3e` has a button labelled "Rebuild in Behind the scenes", and `#136` has "Open Behind the scenes". A user who reads the README's new vocabulary will meet the old one on the search page.

## 2. As a maintainer

### Module docstrings: the strongest writing in the PR

The docstrings are first-rate: short, causal, and honest about limits.
- `coding_agents.py#1-10` states "a claim to verify, never as proof".
- `coding_workflow.py#1-13` and `coding_publish.py#1-7` set out what is never done and why `pr_opened` is earned.
- `github.py#1-7` covers `Uncertain` versus `GitHubError`.
- `coding_store.py#1-12` and `prompt_blocks.py#1-25` cover the store and the parser.

A maintainer can read the design from them alone. Two exceptions:

- **(o)** The example in the `repositories.py` docstring uses `"keys": ["host/heavy-work"]` (`src/reader_mcp/repositories.py#14@06add3e`). The validation note records removing exactly that default from the form as a defect ("Lock keys default", `activity/rw-44-validation.md#20@06add3e`). The docstring now teaches what the form was fixed to stop suggesting.
- **(p)** `coding_api.py#1-5` calls POST `/api/repositories` "from this Mac". That is the same unexplained phrase as item (j).

### `activity/rw-44-validation.md`

The note is well structured: checks, defects found (each with RED/GREEN), determinism, remaining gates. "Defects found during integration" is the most useful section for a maintainer. But:

- **(q) The evidence is pinned at a pre-merge commit.** "All checks ran at `f604a55` or on source identical to it" (`#7`). The target is 06add3e, and the note does not say how "identical" was established. *(Holmes to verify.)*
- **(r) The remaining gates are frozen in pre-merge tense.** "Current-head CI and Code Lawyer review: both are required before merge" (`#44`). Now that the PR is merged, a maintainer cannot tell from the note whether those gates were met.
- **(s) "Both branches were merged with current main…" (`#3`).** It does not say which branches, or what "current main" was.
- **(t) The screenshot evidence is untracked.** The screenshots "are not tracked, and were reviewed for this checkpoint" (`#40`). That is honest, but a later reader cannot reproduce it.

### Changelog form

- **(u) `CHANGELOG.md#5@06add3e` is one paragraph of roughly 450 words.** It mixes user-visible behaviour with internals: markdown-it-py, the 700-document corpus, SSE cursors, `check_container.py` kinds, the test fakes. A user scanning release notes cannot find the safety facts.
- **(v) The same entry calls `/api/jobs` read-only.** It lists `/api/jobs` among "New read-only routes", while POST `/api/jobs` submits and stops runs (`docs/web.md#1359@06add3e`, `#1432`).
- **(w) The README misnames the check.** It says a job "runs the repository's own guarded check" (`README.md#126@06add3e`). The check is actually the command the user registered (`docs/web.md#1381@06add3e`: "The registry's command"). This matters because it puts responsibility on the person who registered the repository.

### Per-checkout worker names

- **(x) The changelog does not mention that the lock became per-checkout.** `CHANGELOG.md#9@06add3e` says worktrees "no longer collide". It does not say that the validation lock is now per checkout. The lock sits under `ROOT/.reader/review` (the `RUNTIME` constant near the top of `scripts/check_container.py@06add3e`, with `with (RUNTIME / 'validation.lock')` inside `main`). As a result, separate worktrees now run heavy validation *concurrently*. `docs/separate-vault.md#33@06add3e` does say this ("serializes workers within one checkout"), so the docs are honest. The changelog presents only the benefit and leaves out the resource cost.

## Overall assessment

The architecture prose is careful and largely truthful, and the maintainer docstrings earn an A. The user-facing documentation is a different story.
- The safety facts (permission modes, approval policy, push semantics, what reaches GitHub and the provider, archive commits) are scattered and in places overstated or missing.
- Setup has no path.
- The README privacy section was not updated for a feature that runs agents on your repository under your GitHub login.

The honesty about what has not been tested is exemplary. The honesty about what *will* happen when you press the button is good in one paragraph and patchy everywhere else.

**Clarity grade: B−**

### Numbered stumble list

1. No setup path or prerequisites row for coding jobs. `README.md#210-217@06add3e`; the pieces are scattered across `docs/web.md#1365-1369,#1405-1412,#1441-1442@06add3e`.
2. The README coding-jobs section does not link to its doc section. `README.md#121-129@06add3e`
3. The dangerous modes are named but not explained, and the default is not stated. `docs/web.md#1407-1408@06add3e`; the code defaults to safe at `src/reader_mcp/repositories.py#130@06add3e`.
4. It is undocumented that the UI cannot select the dangerous modes. `web/src/jobs/admin.tsx#152-170@06add3e`
5. The documented argv omits Codex `approval_policy="never"` and Claude Code's `--add-dir`. `docs/web.md#1373-1374@06add3e` against `src/reader_mcp/coding_agents.py#47,#53-54@06add3e`
6. The agent can write to the checkout's Git common directory, and this is not said in plain words. `src/reader_mcp/coding_workflow.py#243@06add3e`
7. "The user's checkout … untouched" overstates. `docs/web.md#1371-1372@06add3e`
8. Push vocabulary conflicts. "Pushes normally" (`CHANGELOG.md#5@06add3e`), `--force-with-lease` (`docs/web.md#1383@06add3e`) and "never … force-pushes" (`docs/capabilities.md#363@06add3e`).
9. "No article text … goes to GitHub" overstates. `docs/web.md#1380@06add3e` against `src/reader_mcp/coding_publish.py#81-82,#204@06add3e`
10. The README privacy and logs bullets ignore coding jobs. `README.md#228-247@06add3e`
11. It is undocumented that coding-job archives are committed to the vault's Git. `src/reader_mcp/coding_jobs.py#334-342@06add3e` against `docs/web.md#1414@06add3e`
12. The LLM logs kinds list is stale. `docs/web.md#2537-2538@06add3e` against `src/reader_mcp/llm_logs.py#27@06add3e`
13. There is no authoring guidance for `reader:prompt` beyond the parse contract. `docs/web.md#1326-1344@06add3e`
14. "From this Mac only" is unexplained. `docs/web.md#1411@06add3e`, `src/reader_mcp/coding_api.py#125-126@06add3e`
15. "Reader Admin (formerly Reader Admin)". `docs/web.md#1059@06add3e`
16. The route tables and README inventory omit Coding jobs, LLM logs and Repositories. `docs/web.md#1065-1075@06add3e`, `CHANGELOG.md#7@06add3e`, `README.md#107-113@06add3e` against `web/src/admin/sections.tsx#68-74@06add3e`
17. "Backstage" versus "Reader Admin": the naming rule is never stated. `docs/web.md#1077@06add3e`
18. User-visible "Behind the scenes" buttons remain on the search page. `web/src/search-page.tsx#108,#136@06add3e`
19. The registry docstring example teaches `host/heavy-work`, which the validation note says was removed from the form as a defect. `src/reader_mcp/repositories.py#14@06add3e` against `activity/rw-44-validation.md#20@06add3e`
20. The validation evidence is pinned at `f604a55`, not the head, and "identical" is not demonstrated. `activity/rw-44-validation.md#7@06add3e`
21. The validation note's remaining gates are frozen in pre-merge tense. `activity/rw-44-validation.md#44@06add3e`
22. "Both branches" and "current main" are not identified. `activity/rw-44-validation.md#3@06add3e`
23. The RW-44 changelog entry is a 450-word mixed-audience paragraph. `CHANGELOG.md#5@06add3e`
24. The changelog lists `/api/jobs` as a "read-only route" though POST submits and stops. `CHANGELOG.md#5@06add3e` against `docs/web.md#1359,#1432@06add3e`
25. "The repository's own guarded check" misattributes the user-registered command. `README.md#126@06add3e` against `docs/web.md#1381@06add3e`
26. The changelog leaves out that the validation lock is now per-checkout, so worktrees validate concurrently; only `docs/separate-vault.md#33@06add3e` says so. `CHANGELOG.md#9@06add3e`

```
VERDICT
witness: Dr. John H. Watson (first deposition, blind)
target: flyingrobots/reader PR #168, 06add3e^1..06add3e (base b462c23)
clarity_grade: B-
strongest: module docstrings (coding_*.py, github.py, prompt_blocks.py); executor-boundary honesty; explicit "no real E2E run" disclosure
weakest: user safety/setup story: modes, argv, push semantics, GitHub/provider outflows, archive commits, privacy section
misleading_statements: 5  (#7 checkout untouched, #8 push vocabulary, #9 "no article text", #24 read-only /api/jobs, #25 "repository's own check")
omissions: 9  (#1, #3, #4, #5, #6, #10, #11, #13, #26)
stale_or_slip: 7  (#12, #15, #16, #18, #19, #21, #22)
structure_audience: 5  (#2, #14, #17, #20, #23)
stumbles_total: 26
needs_holmes: #9 (what text reaches GitHub), #11 (archive commit), #20 (f604a55 ≡ 06add3e)
repairs_written: none (first deposition)
```

## Second Deposition — The Repair Menu

# Second deposition of Dr. John H. Watson: the Repair Menu

*reader @ 06add3e (base b462c23). Read-only: I read the four testimonies and Moriarty's probe file, and changed nothing.*

The patient is already discharged and walking about. That changes the order of treatment. You do not start with the bedside manner while two wounds are still weeping. Two of these findings are serious and come first, and I will say so plainly. After them come the quick wins, then the documentation, which matters a great deal to the people who will press **Run → PR**, then the tidying.

## Where the detectives converged

Five or six findings were reached independently by two or three of us. Those are the best-supported repairs on the menu.

| Finding | Detectives | Evidence |
|---|---|---|
| A failed save at admission leaves a phantom queued run | Holmes-1 §4, Moriarty S1 | `src/reader_mcp/coding_jobs.py#223@06add3e`; Moriarty's test_m1 fails |
| A graceful shutdown is recorded as "Stopped by you" (`cancelled`) | Holmes-1 §3, Moriarty S2 | `coding_jobs.py#290@06add3e`; test_m2 fails |
| "No article text … goes to GitHub" overstates | Watson #9, Holmes-1 §6, Holmes-3 §II.6, Moriarty S7 | `docs/web.md#1380@06add3e`, against `src/reader_mcp/coding_publish.py#81,#203@06add3e` |
| The changelog's "pushes normally" | Watson #8, Holmes-3 §II.1 | `CHANGELOG.md#5@06add3e` |
| The documented argv is incomplete | Watson #5, Holmes-1 §8 | `docs/web.md#1373-1374@06add3e`, against `src/reader_mcp/coding_agents.py#47,#53-55@06add3e` |
| Host folders outside home are shown raw | Holmes-1 §6, Holmes-3 §II.7; Moriarty *checked and conceded* it is the documented exception | `src/reader_mcp/display.py#5-6@06add3e` |

Some findings did not converge. Moriarty conceded the host-folder point because `docs/web.md#3826-3827` documents the exception, while Holmes-3 holds that `#3819-3820` promises otherwise. The docs say both things, so the repair is a decision plus a doc fix, not necessarily code.

Moriarty's probe tests (`moriarty_probe.py`, run as `tests/test_moriarty_probe.py`) are ready-made RED tests. Each code issue below that fixes a strike should adopt its matching probe as the regression test.

## Serious: fix first

### Issue 1: A GitHub effect followed by an archive failure is recorded as `failed`, and a rerun duplicates the issue
**Type:** code fix. **Effort:** M–L. **Source:** Holmes-1 §1, his "worst drift". Not independently confirmed by test, but cited line by line.

**The failure.** An issue, a pull request or a pushed branch can exist on GitHub while the run record says `failed`. The pending intent is left in a *finished* record, which recovery never revisits (`coding_jobs.py#349-350@06add3e`). A rerun inherits only `predecessor['issue']` (`coding_jobs.py#193-194@06add3e`), so it **creates a second issue**. This breaks the module's own promise, "Publication is reconciled, never assumed" (`coding_publish.py#3@06add3e`), and the doc's "fails the run before any publication" (`docs/web.md#1419-1420@06add3e`).

**Concrete edits:**
- In `execute` (`coding_jobs.py#294-295`), when `CaptureFailed` arrives after any intent was saved (`issue_pending`, `push.sent`, `pr_pending`), end the run `needs_reconciliation`, not `failed`. Keep the intent in the record.
- Reorder the evidence writes so the GitHub result is saved to the run record *before* the emit that may fail:
  - after `create_pull_request` (`coding_publish.py#212` → `#226`);
  - after `create_issue` (`#90` → `#110-111`);
  - after the `git.log` write following the push (`coding_workflow.py#99-106`).
- In `recover()`, also visit finished runs whose `issue_pending` or `pr_pending` is still set.
- For a rerun, settle the predecessor's `issue_pending` by marker (the reconciliation already used at `coding_jobs.py#414-422`) before creating anything.
- Amend `docs/web.md#1419-1420` to say what happens when a write fails *after* publication.

**Tests:** fault-inject `Capture.write` to fail immediately after each fake GitHub create and after the push. Assert `needs_reconciliation`, that the intent is kept, and that a rerun creates no second issue.

**Proposed title:** *Coding jobs: an archive failure after a GitHub write must end `needs_reconciliation`, never `failed`*

### Issue 2: A failed save at admission leaves a phantom queued run, and Stop falsely reports success
**Type:** code fix. **Effort:** S–M. **Source:** Holmes-1 §4 and Moriarty S1 (test_m1 fails), converged.

**The failure.** One request UUID can own two run records. The orphan shows `queued` with a live Stop button, never runs, and Stop answers `stopped: true` without stopping anything. This breaks the doc's "same request UUID … returns the same run" (`docs/web.md#1362@06add3e`). Commit 696cf4a fixed only the receipt half.

**Concrete edits:**
- Move `self.store.save(run)` (`coding_jobs.py#223`) inside the rollback `try` at `#224-235`.
- On failure, drop the record from `Store.unsaved` (`coding_store.py#84-88`) so that `retry()` (`#97-104`) cannot resurrect it. Close the capture and the live log.
- `stop()` (`coding_jobs.py#250-254`) must answer `stopped: false` (or a 404) for a run that is neither queued nor active.

**Tests:** adopt test_m1.

**Proposed title:** *Coding jobs: a failed run save at admission must leave no queued orphan, and Stop must not acknowledge it*

## Quick, high-yield code fixes

### Issue 3: Shutting down Reader is recorded as "Stopped by you"
**Type:** code fix. **Effort:** S. **Source:** Holmes-1 §3 and Moriarty S2, converged.

**Concrete edits:**
- Split the cancel predicate at `coding_jobs.py#290`: a user Stop (`run['id'] in self.cancels`) versus server close (`self.closed`).
- In `coding_workflow.py#77-79` and `#369`, raise a distinct stop on close. Its outcome is `interrupted`, with the message "Reader stopped before this job finished; it was not restarted." That matches `docs/web.md#1394-1396`.

**Tests:** extend the shutdown test (`tests/test_coding_failures.py#462-482`) to assert the outcome, and adopt test_m2.

**Proposed title:** *Coding jobs: a Reader shutdown ends a running job `interrupted`, not `cancelled` ("Stopped by you")*

### Issue 4: A pull request that also closes other issues still reaches `pr_opened`
**Type:** code fix. **Effort:** S–M. **Source:** Moriarty S3 (test_m3 fails), and the title of commit 4f8a7b3 ("close exactly the job's issue").

**The failure.** The agent's `pr_body` goes in unfiltered (`coding_publish.py#204-205`). A `Fixes #1` inside it means merging the verified PR silently closes issue #1. That is serious for a user who merges on trust. It is cheap to fix.

**Concrete edits:**
- Before composing the PR body, neutralise GitHub closing keywords (`close[sd]?|fix(e[sd])?|resolve[sd]?` followed by `#N` or `owner/repo#N`) in the agent's text.
- Extend `closes()` (`coding_publish.py#25-27`) to reject any body whose closing references are not exactly `{#N}`. The same check applies in the recovery read-back (`coding_jobs.py#397-413`).

**Tests:** adopt test_m3, plus a cross-repository reference case.

**Proposed title:** *Coding jobs: a PR Reader opens must close exactly the job's issue*

### Issue 5: Recovery leaves running a process group whose leader has exited
**Type:** code fix. **Effort:** M. **Source:** Moriarty S6 (test_m6 fails). The hostname drift is his conjecture, and Holmes-1 confirms only the leader-match path.

**The failure.** After a server crash, a left-over test run or build keeps writing in the worktree and using resources. This breaks the doc's "a process group the previous server left running is stopped" (`docs/web.md#1394-1395`). Since the leader-matching guard was written to prevent kills after PID reuse, this is a real safety-against-resources strike, not a cosmetic one.

**Concrete edits:**
- Change the guard at `coding_jobs.py#353-356`. When the leader is gone, enumerate the group (`ps -g <pgid> -o pid=,lstart=`). Kill it (`voice_runner.py#260-264`) only if every member started at or after the recorded leader start.
- Stop relying on `socket.gethostname()` equality (the conjecture: macOS changes the hostname with the network). Record a boot ID or machine ID instead.

**Tests:** adopt test_m6. Add the negative PID-reuse test that Holmes-3 found missing (§V.4).

**Proposed title:** *Coding jobs: recovery must stop a left-over process group even after its leader exited*

### Issue 6: `finish()` can raise, and a sealed archive can disagree with its run record
**Type:** code fix. **Effort:** M. **Source:** Holmes-1 §2 and Moriarty S5 (test_m5 fails). They found different faces of the same function.

**The failure.**
- A `ValueError` from `Store._write` (`coding_store.py#57-58,#63-64`) escapes `finish()` (`coding_jobs.py#308`, final save at `#328-331`). It kills the queue worker while the server still holds ownership, and the run shows "running" for ever.
- Separately, the archive is sealed (`#321-326`) before the record is saved. A crash in between makes recovery stamp the run `interrupted` (`#362-365`), while the archive says `already_fixed` (`llm_logs.py#161-162`).

**Concrete edits:**
- Make `finish()` actually total: catch `Exception` on the final save, keep the record for retry, and truncate oversized fields with a `truncated` mark.
- Have the `work()` loop (`#258-279`) survive a failure of a single job.
- In `recover()`, when the archive is already sealed, adopt the sealed `meta.json` status instead of overwriting it.

**Tests:** adopt test_m5, plus an oversized-record test.

**Proposed title:** *Coding jobs: finish() never raises, and a recovered run keeps the outcome its sealed archive records*

### Issue 7: Stop semantics are honest about in-flight effects
**Type:** code fix plus doc fix. **Effort:** M. **Source:** Holmes-1 §3 and Moriarty S4 (test_m4 fails). Moriarty's "Stop versus an in-flight `gh` create" is a related conjecture.

**The failure.**
- Stop can still end in `pr_opened` after answering `stopped: true` (`coding_publish.py#209-212`, `coding_jobs.py#254`).
- A push in progress is not killed (`coding_workflow.py#99`, `coding_publish.py#170-171`).
- `issue_pending` outlives a Stop that lands just before the issue is created (`coding_publish.py#85-87`). Commit 3648d34 fixed this for push and PR, but not for issues.

**Concrete edits:**
- `stop()` answers `stopping`. The final outcome reports any effect that completed.
- Clear `issue_pending` in `track()` on cancel, as `unsent()` already does (`#47-54`).
- Rewrite `docs/web.md#1393`: "Stop kills the agent's process group. A push or GitHub create already in flight completes and is recorded, and a pull request can still open."

**Tests:** adopt test_m4, plus a blocking fake `create_pull_request` with Stop arriving during it.

**Proposed title:** *Coding jobs: Stop reports in-flight effects truthfully and leaves no pending intent*

## Documentation that a user needs before pressing the button

### Issue 8: Say plainly what a coding job does to your repository, your GitHub account and your model provider
**Type:** doc fix (one bounded decision included). **Effort:** M. **Source:** Watson #1–11, #13, #14, #25. Converged with Holmes-1 §6/§8, Holmes-3 §II.1/§II.6 and Moriarty S7.

This is the documentation item with the highest yield. Every fact is already true in the code; the documentation hides it, softens it or overstates it.

**Edits:**

1. **README, "To get" table** (`README.md#210-217`). Add a row: *Coding jobs* | `codex` or `claude`, plus `gh auth login` with push access | register the repository in Reader Admin › Repositories. Add a link from `README.md#121-129` to `docs/web.md#article-prompts-and-coding-jobs`.
2. **README privacy section** (`README.md#228-247`). Add a bullet saying a coding job:
   - sends the prompt and repository content to the agent's provider;
   - creates issues, branches and PRs under your `gh` identity;
   - runs with your environment;
   - archives permanently and commits the archive to the vault's Git (`coding_jobs.py#334-342`).
3. **New "Before you run a coding job" subsection** in `docs/web.md`, placed before "The workflow" (`#1356`). It covers prerequisites, cost and risk, and moves the Executor-boundary paragraph (`#1399-1403`) up next to the reassurances it qualifies. It also replaces the "user's checkout … untouched" sentence at `#1371-1372` with: "Reader's own Git operations never touch your checkout; the agent is given write access to its shared `.git`."
4. **Exact argv** (`docs/web.md#1373-1374`):
   - Codex: `-c approval_policy="never"`, with `--add-dir` only under `workspace-write`;
   - Claude Code: `--verbose` and `--add-dir <git common dir> [lock store]` (`coding_agents.py#45-56`, `coding_workflow.py#243`).
5. **Modes** (`docs/web.md#1407-1408`). Say what each mode grants. Say that the default is `workspace-write` / `acceptEdits` (`repositories.py#130`). Say that the Register form cannot choose a full-access mode (`web/src/jobs/admin.tsx#152-170`).
   - **Decision for the maintainer:** keep full access as hand-edit only and document that, or remove it. I recommend keeping it, documented, with the card's agent menu showing the mode (it already does, `prompt-card.tsx#114`).
6. **Article text** (`docs/web.md#1380`). Replace with: "Reader never sends the article file, a vault path or the archive. Issue and PR titles and bodies are drafts written from the prompt; without one, the block's title is used."
7. **Push wording** (`CHANGELOG.md#5`). Replace "pushes normally" with "pushes create-only (an empty `--force-with-lease`, so an existing branch is never overwritten)". Align `docs/capabilities.md#363` to "never overwrites or force-updates a branch".
8. **"From this Mac"** (`docs/web.md#1411`). Explain that registration is accepted only from a request made on this computer (the server checks `via == 'local'`, `coding_api.py#125`), not over Tailscale or the front.
9. **"Repository's own guarded check"** (`README.md#126`). Change to "the verification command you registered".
10. **Authoring guidance** (`docs/web.md#1326-1344`). Add a short paragraph on writing a self-contained prompt, noting that Reader prepends a brief telling the agent to follow the repository's AGENTS.md (`coding_agents.py#60-82`).

**Dependency.** None is needed: it describes today's behaviour. Issues 3 and 7 will each amend one sentence.

**Proposed title:** *Docs: what a coding job does to your repository, GitHub account and model provider, and how to set one up*

## Smaller code and UI repairs

### Issue 9: Finish the "Behind the scenes" rename in shipped UI text
**Type:** code fix. **Effort:** S. **Source:** Watson #18 and Holmes-3 §III, converged.

**Edits.** Change these strings:
- `src/reader_mcp/web_ui/index.html#67` (the footer's accessible name and tooltip, which wrongly say it opens settings);
- `web/src/search-page.tsx#108,#136`;
- `src/reader_mcp/web_ui/art.mjs#152`;
- `src/reader_mcp/web_ui/app.mjs#298,#1659`.

Also sweep the comments in `web/src/styles.css#279,#681`, `web/src/server-card.tsx#1`, `web/src/companions.tsx#2,#34`, `web/src/local-model.tsx#1` and `web/src/reader-controls.tsx#338`.

**Test:** a grep-style assertion in `tests/web_admin.cjs` that no visible text contains "Behind the scenes".

**Proposed title:** *Reader Admin: remove the remaining user-visible "Behind the scenes" labels*

### Issue 10: The sidebar cannot get back from a job or log detail page to its list
**Type:** code fix. **Effort:** S. **Source:** Holmes-2 #7, his worst drift.

**Edit.** In `web/src/admin/admin-shell.tsx#28`, treat a sidebar entry as "active" only when the route has no parameters. Otherwise navigate (`context.go(section.id)`). When it is truly active, scroll to 0, then focus, to honour `docs/web.md#1082-1083`.

**Test:** `tests/web_admin.cjs` opens `#admin/jobs/<id>`, clicks Coding jobs, and expects the list.

**Proposed title:** *Reader Admin: choosing the open section returns to its list and its top*

### Issue 11: The repository identity check must use Git's effective push URL
**Type:** code fix. **Effort:** S. **Source:** Holmes-1 §6. This rests on Git's documented behaviour; it is not tested.

**Edit.** In `repositories.py#142-151`, read `git remote get-url --push <remote>` and `git remote get-url <remote>`, which apply `insteadOf` and `pushInsteadOf`, instead of the raw config values.

**Test:** a fixture with a `pushInsteadOf` rewrite to another repository must block.

**Proposed title:** *Coding jobs: the repository identity check uses the effective (rewritten) push URL*

### Issue 12: Recovery must not block server start
**Type:** code fix. **Effort:** M. **Source:** Holmes-1 §5.

**Edits:**
- Run `recover()` per run under try/except, so a broken record ends `needs_reconciliation` with the reason. The failure points are `KeyError` at `coding_jobs.py#359,#388`, `OSError` at `#384`, and a non-dict reply at `github.py#124`.
- Run recovery off the startup path (`web.py#228`), so a GitHub call of up to 60 s (`github.py#15`) cannot delay the server.
- Note in the record when a branch was pushed before the crash (`coding_jobs.py#426-429`).
- Give recovered runs the full `meta.json` (`coding_jobs.py#381`, `llm_logs.py#156-174`).

**Proposed title:** *Coding jobs: a broken or slow recovery never prevents Reader from starting*

### Issue 13: Show `needs_reconciliation` and failed jobs as needing attention, and keep job views current
**Type:** code fix. **Effort:** M. **Source:** Holmes-2's undocumented behaviours.

**Edits:**
- The Overview's Attention tile (`web/src/admin/overview.tsx#42-55`) counts `needs_reconciliation` and failed jobs. This is the run that most needs a human.
- The artifact preview stops refetching on every event and stops resetting the 1 MiB choice (`web/src/jobs/job-detail.tsx#80,#91`): key on `run.id` and the finish only.
- The Jobs list polls while any row is active (`web/src/jobs/admin.tsx#25-35`).
- The actions cache refreshes when the tab regains focus (`web/src/jobs/store.ts#105-114`).

**Proposed title:** *Reader Admin: runs that need reconciliation appear under Attention, and job views stay current*

### Issue 14: The validation lock stays host-wide when worker names become per-checkout
**Type:** decision plus code fix. **Effort:** S–M. **Source:** Watson #26 and Holmes-1 §8, converged.

**The problem.** The new per-checkout lock (`scripts/check_container.py`, `RUNTIME / 'validation.lock'`) lets several worktrees run heavy 2-CPU / 4-GiB validation workers at once. That is contrary to the workstation's serialise-heavy-work discipline.

**Edits:**
- **Decision:** keep per-checkout names, but take a host-wide lock as well. That means git-locks with an agreed key, falling back to a lock file outside the checkout.
- Fix the CHANGELOG wording at `CHANGELOG.md#9`.
- Tighten the argument regex at `#59-60`, which admits pytest options despite its message.

**Proposed title:** *Bounded validation: per-checkout worker names, but one host-wide heavy-work lock*

### Issue 15: Bound the coding-job scratch space and the listing costs
**Type:** code fix. **Effort:** M. **Source:** Holmes-1 §7.

**Edits:**
- Count, or cap and remove, the per-run `TMPDIR` scratch folder (`coding_workflow.py#263`, `coding_jobs.py#135-138`). It is never deleted.
- Page `GET /api/jobs` and `actions()` from an index rather than reading up to 10,000 records per request (`coding_store.py#126`, `coding_api.py#39,#95`).
- Make the `llm_inventory.page()` cursor seek, not scan (`llm_inventory.py#59-88`). Alternatively, retract "bounded" from its docstring.

Splittable into two issues if wanted.

**Proposed title:** *Coding jobs: bounded scratch space, and job and log listings whose cost does not grow with history*

### Issue 16: Decide what "credentials never appear" and "host folders shown as `~`" mean, then make the code or the docs true
**Type:** decision plus code or doc fix. **Effort:** M. **Source:** Holmes-1 §6 and Holmes-3 §II.7 (converged). Moriarty conceded it as a documented exception.

**Choices:**
- (a) Extend `display.shown()` (`display.py#27-46`) with the registry roots as `<checkout>` and `<worktrees>`, and scrub common token patterns from agent and verification output.
- (b) Narrow the claims at `coding_api.py#3-4`, `docs/web.md#1410` and `#3819-3820`.

I recommend (a) for paths, because it is cheap. For credentials I recommend (b) plus a warning: scrubbing gives false comfort. The `meta.json` and `git.log` absolute paths in the committed archive (`coding_jobs.py#323`) belong here too.

**Proposed title:** *Coding jobs: make the host-folder and credential claims true, or narrow them*

## Documentation accuracy sweep and records

### Issue 17: Reader Admin and coding-job documentation matches the shipped code
**Type:** doc fix. **Effort:** S. **Source:** Watson #12, #15–17, #19, #24; Holmes-2 #14, #22, #24, #28, #42, #43; Holmes-3 §II.2–5, §II.8 and §III.

**Edits:**
- `docs/web.md#1059`: "formerly Behind the scenes".
- Route table (`#1065-1075`), the README inventory (`README.md#107-113`) and the RW-45 changelog list (`CHANGELOG.md#7`): add `#admin/jobs`, `#admin/logs`, `#admin/repositories`.
- `#1306`: the finished inbox run is read when the poll sees a new run ID, on the Inbox page.
- `#1107-1108`: add the 5 s `/api/jobs?state=active` poll.
- `#1351`: "reads only (actions, events and the stream)".
- `#1421-1423`: every JSON line is stored, and recognition happens in the browser.
- `#1093`: Search returns without its query.
- `#1112`: Check again stays enabled.
- `#2537-2538`: add `coding-job`, `quiz`, `quiz-review` and `prompt` to the kinds list (`llm_logs.py#27`).
- State once that the footer button keeps the name Backstage.
- `repositories.py#14`: change the docstring's example key to `host/docker/<project-worker>/`.
- `CHANGELOG.md#5`: split the 450-word entry into a user paragraph and a maintainer paragraph, and stop calling `/api/jobs` read-only.
- Document the run, event and registry limits (Holmes-3 §III).

**Proposed title:** *Docs: Reader Admin and coding-job reference matches the shipped behaviour*

### Issue 18: Bring the RW-44 validation record up to the merged head
**Type:** doc fix. **Effort:** S. **Source:** Watson #20–22 and Holmes-3 §IV, converged.

**The problem.** The record is pinned at `f604a55`, 66 commits before the head. Its counts are stale (937 tests, 147 contract cases, 71 suites), and its gates are written in pre-merge tense (`activity/rw-44-validation.md#7-11,#44`).

**Edit.** Do not rewrite history. Append a dated post-merge addendum that:
- names 06add3e;
- states the CI result and the Code Lawyer outcome with links;
- lists the post-`f604a55` review fixes by commit;
- names the branches in `#3`;
- re-runs or explicitly declines to re-run the counts.

**Proposed title:** *Validation record: post-merge addendum for RW-44/RW-45 at 06add3e*

## Test gaps

### Issue 19: Tests for the workflow's guard rails
**Type:** test gap. **Effort:** M. **Source:** Holmes-3 §V.1–4 and §V.10.

**Tests to add:**
- preflight blocks a branch that already exists (`coding_workflow.py#190-193`);
- an existing worktree folder is never reused (`#217-218`);
- the agent timeout, the 4 GiB group memory limit and the mid-run disk reserve (`#371-381`);
- an adversarial no-shell verification argv.

The PID-reuse negative test belongs with Issue 5. Also make `test_viewing_listing_and_streaming_never_start_anything` (`tests/test_coding_jobs.py#213`) actually stream, and make the `-k` test (`tests/test_check_container.py#38`) assert that `-k` reaches pytest.

**Proposed title:** *Tests: coding-job guard rails (existing branch or folder, limits, no shell) fail when removed*

### Issue 20: HTTP-level and contract coverage for populated coding-job routes
**Type:** test gap. **Effort:** M. **Source:** Holmes-3 §V.7–9.

**Tests to add:**
- HTTP 409 from a server that does not own jobs;
- the `path`/`block` filters, the cursor and the 50-row page;
- contract goldens for a *populated* run, a registry entry and a log inventory page (`tests/contract/read.test.mjs`).

The host-folder test belongs with Issue 16, and the article-text test with Issue 8's sentence.

**Proposed title:** *Contract: pin populated coding-job, repository and LLM-log shapes*

### Issue 21: Authorise and run one real end-to-end sandbox job
**Type:** decision. **Effort:** M, needing the maintainer's authorisation. **Source:** Watson, Holmes-3, `activity/rw-44-validation.md#48` and `docs/capabilities.md#363`. Every one of us noted it.

**Decision.** Authorise one run of a real agent against a sandbox GitHub repository. Record the evidence in the validation addendum (Issue 18). It should come after Issues 1–4, so that it exercises the fixed failure paths.

**Proposed title:** *Decision: authorise one real Codex/Claude Code job against a sandbox GitHub repository*

## Coverage note

All 26 of my stumbles are placed:
- #1–11, #13, #14 and #25 in Issue 8;
- #12, #15–17, #19, #23 and #24 in Issue 17;
- #18 in Issue 9;
- #20–22 in Issue 18;
- #26 in Issue 14.

The other detectives' findings are placed as follows:
- **Holmes-1's 16 drifts.** Nine map to Issues 1, 3, 6, 7, 11, 12, 14, 15 and 16. The four doc drifts ("no article text", the Claude argv, "recognised" events and the check_container argument wording) land in Issues 8, 17 and 14. Two — "credentials never appear" and host folders shown raw — land in Issue 16. The admission drift is Issue 2.
- **Holmes-2.** His 7 drifts land in Issues 10 and 17; his undocumented behaviours in Issue 13.
- **Holmes-3.** His 9 drifts land in Issues 8, 9, 16, 17 and 18; his 10 test gaps in Issues 5, 19, 20, 16 and 8.
- **Moriarty.** S1 is Issue 2, S2 Issue 3, S3 Issue 4, S4 Issue 7, S5 Issue 6, S6 Issue 5 and S7 Issue 8.

No finding is owned twice. Dependencies: Issue 21 depends on Issues 1–4. Issue 8 is valid on its own and is amended later by Issues 3 and 7. Every other issue is independent.

```
VERDICT
witness: Dr. John H. Watson (second deposition: Repair Menu)
target: flyingrobots/reader PR #168, 06add3e^1..06add3e (base b462c23)
serious: issues 1 and 2 (wrong/duplicated GitHub effects; phantom run + false Stop ack); issue 4 (silent extra issue closure) and 5 (surviving process group) close behind
converged: S1≡H1§4; S2≡H1§3; S7≡H1§6≡H3§II.6≡W#9; push wording W#8≡H3§II.1; argv W#5≡H1§8; host folders H1§6≡H3§II.7 (Moriarty: documented exception); worker lock W#26≡H1§8; validation record W#20-22≡H3§IV; UI rename W#18≡H3§III
proposed_issues (in order):
  1  [code M-L] Coding jobs: an archive failure after a GitHub write must end needs_reconciliation, never failed
  2  [code S-M] Coding jobs: a failed run save at admission must leave no queued orphan, and Stop must not acknowledge it
  3  [code S]   Coding jobs: a Reader shutdown ends a running job interrupted, not cancelled ("Stopped by you")
  4  [code S-M] Coding jobs: a PR Reader opens must close exactly the job's issue
  5  [code M]   Coding jobs: recovery must stop a left-over process group even after its leader exited
  6  [code M]   Coding jobs: finish() never raises, and a recovered run keeps the outcome its sealed archive records
  7  [code+doc M] Coding jobs: Stop reports in-flight effects truthfully and leaves no pending intent
  8  [doc M, 1 decision] Docs: what a coding job does to your repository, GitHub account and model provider, and how to set one up
  9  [code S]   Reader Admin: remove the remaining user-visible "Behind the scenes" labels
  10 [code S]   Reader Admin: choosing the open section returns to its list and its top
  11 [code S]   Coding jobs: the repository identity check uses the effective (rewritten) push URL
  12 [code M]   Coding jobs: a broken or slow recovery never prevents Reader from starting
  13 [code M]   Reader Admin: runs that need reconciliation appear under Attention, and job views stay current
  14 [decision+code S-M] Bounded validation: per-checkout worker names, but one host-wide heavy-work lock
  15 [code M]   Coding jobs: bounded scratch space, and job and log listings whose cost does not grow with history
  16 [decision M] Coding jobs: make the host-folder and credential claims true, or narrow them
  17 [doc S]    Docs: Reader Admin and coding-job reference matches the shipped behaviour
  18 [doc S]    Validation record: post-merge addendum for RW-44/RW-45 at 06add3e
  19 [test M]   Tests: coding-job guard rails (existing branch or folder, limits, no shell) fail when removed
  20 [test M]   Contract: pin populated coding-job, repository and LLM-log shapes
  21 [decision M] Decision: authorise one real Codex/Claude Code job against a sandbox GitHub repository (after 1-4)
dependencies: 21 <- {1,2,3,4}; 8 later amended by 3 and 7; all others independent
regression_tests_ready: Moriarty test_m1..m6 -> issues 2,3,4,7,6,5
first_deposition_grade_stands: clarity B-
```
