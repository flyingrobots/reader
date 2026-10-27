# Testimony of Professor James Moriarty: *In re* Reader PR #168 (RW-44 / RW-45)

Four rounds of review and fifty-two fix commits. They patched every hole they were shown, and they were shown only the holes in front of them. The holes I found are at the edges: when a write fails, when Reader shuts down, when the server dies at the wrong moment. Six probes, six failures. Every one ran in the bounded worker on synthetic fixtures.

**Reproduction.** The probes are in the untracked file `tests/test_moriarty_probe.py`. I ran them once, under git-locks key `host/docker/reader-python-checks-case-wt/`:
`python3 scripts/check_container.py python tests/test_moriarty_probe.py` gave `6 failed in 13.63s`. The worker was removed afterwards, `git status` shows only the probe file, and no tracked file changed.

---

## Strikes landed

### S1. A run record that cannot be saved at admission leaves an orphan, and Stop lies about it (P2)
- **Code.** `src/reader_mcp/coding_jobs.py#223@06add3e`: `self.store.save(run)` sits outside the rollback `try`, which covers only the receipt (`coding_jobs.py#224-235@06add3e`).
  - When the save raises `OSError`, `Store.save` keeps the record in `unsaved` (`src/reader_mcp/coding_store.py#87@06add3e`).
  - The queue worker's `retry()` then writes it to disk as `queued` (`coding_store.py#97-104@06add3e`, `coding_jobs.py#263@06add3e`).
  - No receipt was saved, so the browser's retry with the same UUID admits a second run.
  - `stop()` adds the orphan to `cancels`, finds it neither in the queue nor active, and still answers `stopped: True` (`coding_jobs.py#250-254@06add3e`).
  - The live capture and log are never closed until a restart.
- **What it breaks.** The doc's promise that "The same request UUID with the same input returns the same run" (`docs/web.md#1362@06add3e`). Commit 696cf4a fixed only the receipt half.
- **Evidence (test_m1):** `AssertionError: one request UUID owns 2 run records; orphan status='queued' not queued=True; Stop answered stopped=True but the record stays 'queued'`

### S2. Quitting Reader is recorded as "Stopped by you" (P3)
- **Code.** The cancel predicate is `run['id'] in self.cancels or self.closed` (`coding_jobs.py#290@06add3e`). Every cancel raises the same message, "Stopped by you" (`src/reader_mcp/coding_workflow.py#77-79@06add3e`).
- **What it breaks.**
  - A graceful shutdown seals the archive as `cancelled` and blames the user.
  - The docs say interruption by the server ends `interrupted` (`docs/web.md#1394-1396@06add3e`).
  - The existing shutdown test (`tests/test_coding_failures.py#462-482@06add3e`) never checks the outcome.
- **Evidence (test_m2):** `AssertionError: ('cancelled', 'Stopped by you. Completed effects (a pushed branch, a created issue) stay recorded.')`

### S3. "Close exactly the job's issue" is not checked; a PR that also closes another issue reaches `pr_opened` (P3)
- **Code.**
  - `closes()` (`src/reader_mcp/coding_publish.py#25-27@06add3e`) checks only that Reader's `Closes #N` line and the marker are present.
  - The agent's `pr_body` goes into the body unfiltered (`coding_publish.py#204-205@06add3e`).
  - Commit 4f8a7b3 is titled "require the pull request to close exactly the job's issue".
- **Evidence (test_m3).** The agent's PR body carried an extra `Fixes #1`. Result: `AssertionError: ('pr_opened', ['1', '277'])`. Merging that verified PR silently closes issue #1.

### S4. Incomplete fix: a Stop just before issue creation leaves `issue_pending` set (P5)
- **Code.** Commit 3648d34 added `unsent()` to clear the push and PR intents (`coding_publish.py#47-54@06add3e`). `track()` still raises at `coding_publish.py#87@06add3e` without clearing `issue_pending`, which was saved at line 85.
- **Evidence (test_m4).** The run ends `cancelled` with no `create_issue` call, yet the finished record keeps `{'marker': 'reader-run:e07e518a-…'}`.
- **Impact.** Record hygiene only. Finished runs are not reconciled again, and `view()` does not expose the field.

### S5. Recovery relabels a run whose archive is already sealed (P4)
- **Code.**
  - `finish()` seals the archive (`coding_jobs.py#321-326@06add3e`) before saving the record (`#328-331`).
  - If that save fails and the process dies before a retry, `recover()` stamps the run `interrupted`, "Reader stopped before this job finished" (`#362-365`).
  - `seal()` then does nothing and keeps the real status (`src/reader_mcp/llm_logs.py#161-162@06add3e`).
- **Result.** The run record and the archive name different outcomes for the same run.
- **Evidence (test_m5):** `AssertionError: ('interrupted', 'Reader stopped before this job finished; it was not restarted.', 'already_fixed')`
- **Note.** It needs a disk failure plus a crash. That is the moment evidence matters most.

### S6. Recovery leaves running a process group whose leader already exited (P2)
- **Code.**
  - The kill runs only if the group leader's `ps lstart` matches (`coding_jobs.py#353-355@06add3e`).
  - `kill_group` would kill the whole group regardless (`src/reader_mcp/voice_runner.py#260-264@06add3e`).
  - Nothing ties the supervised agent's life to its parent (the `SHIM`, `voice_runner.py#50@06add3e`).
- **Scenario.** The server crashes and the agent CLI dies, for example from SIGPIPE. Its test run or build lives on in the job's process group, which recovery does not kill. It keeps writing in the worktree and using resources.
- **What it breaks.** The doc's "a process group the previous server left running is stopped" (`docs/web.md#1394-1395@06add3e`).
- **Evidence (test_m6):** `AssertionError: process 521 of the left group 519 still runs after recovery`

### S7. Doc overclaim: "No article text … goes to GitHub" (P4, code-cited, no test)
- **Claim.** `docs/web.md#1380@06add3e`.
- **Code.**
  - If the agent omits `issue_title` or `pr_title`, the block's own title (article text) becomes the GitHub title (`coding_publish.py#81@06add3e`, `#203@06add3e`).
  - The brief asks the agent to write the issue body as a "task summary" of the author's prompt (`src/reader_mcp/coding_agents.py#78-80@06add3e`).
- **Verdict.** Article text reaches GitHub by design. The sentence should say "no article file, vault path or archive".

---

## Attacks attempted and failed (these parts hold)
- **Create-only push.** The empty lease and pushing the verified SHA hold. The push is refused when the branch already exists (`coding_publish.py#159-176@06add3e`).
- **`pr_opened` only after read-back.** I found no path to `pr_opened` that skips `matching()` plus `closes()`, live (`#227-233`) or in recovery (`coding_jobs.py#390-409`). S3 is a weakness in what `closes()` checks, not a bypass.
- **Nothing published after Stop (push and PR).** Cancellation is checked after each intent is saved (`coding_publish.py#162-166`, `#206-209`).
  - Residue, labelled CONJECTURE: a Stop acknowledged while `gh` is starting a create cannot recall that create.
  - Proposed experiment: a fake `create_issue` that blocks before recording, with `stop()` called during the block.
- **Folder hiding.** `display.prefixes` covers the realpath forms of the vault and home folders, and registry paths are resolved (`src/reader_mcp/repositories.py#67`). I found no leak inside home. A checkout outside home (`/Volumes/…`) is shown in the browser by its documented exception (`docs/web.md#3826-3827`). Not a strike.
- **Bounded pages and records.** Each event is capped at 256 KiB, below the 512 KiB page limit. Records over 1 MiB are refused before writing (`coding_store.py#29-30`, `#63-64`). I could not overflow either.
- **Branch and ID injection.** The ID pattern `[a-z0-9-]{1,64}` (`src/reader_mcp/prompt_blocks.py#41`) rules out bad ref names.
- **Admin never saves a reading position / "Backstage" naming.** Admin routes are excluded from `libraryReturn` and from the remembered return target (`src/reader_mcp/web_ui/admin-routes.mjs`, `app.mjs`). "Backstage" survives only as a documented label that opens Reader Admin (`docs/web.md#90`).
  - I did not run the browser suites, so this is a code-read surrender, not certification.
- **Hostname drift (CONJECTURE).** Recovery requires `process.host == socket.gethostname()` (`coding_jobs.py#353`). On macOS the hostname changes with the network, which would skip the kill.
  - Proposed experiment: change `host` in a left-running record and restart.

---

```
VERDICT
target:        flyingrobots/reader PR #168, first-parent b462c23..06add3e (case-wt @ 06add3e)
strikes:       7 landed (6 by failing test, 1 by code citation)
  S1 P2  orphan queued run + duplicate admission + false Stop ack — coding_jobs.py#223@06add3e — test_m1 FAIL
  S6 P2  recovery skips a left group whose leader exited — coding_jobs.py#353@06add3e — test_m6 FAIL
  S2 P3  shutdown recorded as "Stopped by you"/cancelled — coding_jobs.py#290@06add3e — test_m2 FAIL
  S3 P3  PR closing extra issues reaches pr_opened — coding_publish.py#25@06add3e — test_m3 FAIL
  S5 P4  recovery relabels a sealed outcome as interrupted — coding_jobs.py#321@06add3e — test_m5 FAIL
  S7 P4  doc: "No article text goes to GitHub" — docs/web.md#1380@06add3e — code citation
  S4 P5  issue_pending survives a pre-create Stop (3648d34 incomplete) — coding_publish.py#87@06add3e — test_m4 FAIL
failed attacks: create-only push; pr_opened read-back gate; push/PR Stop gates; folder hiding in home/vault;
                bounded events/pages/records; branch-name injection; Admin position (code-read only)
conjectures:   Stop vs in-flight gh create; hostname drift skipping recovery kill
scratch:       tests/test_moriarty_probe.py (untracked; tracked files unchanged; worker removed)
resilience:    B-  (publication core holds; recovery, admission-failure and shutdown edges do not)
```
