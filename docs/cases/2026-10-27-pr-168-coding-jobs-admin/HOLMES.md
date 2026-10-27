# HOLMES: the verification pass (three scoped sub-detectives)

The target exceeded 3,000 lines, so HOLMES was split into three disjoint sections under one charter. Each testimony follows verbatim.

---

## Sub-detective 1: the server

# HOLMES testimony, SERVER section (reader @ 06add3e, base b462c23)

Watson, the server keeps most of its promises. The publication path itself is careful work: the push is create-only, the remote is read back, pull requests are listed before one is created, and an uncertain create is reconciled, never repeated. The faults are at the edges. Three paths finish a run with a wrong or missing record:

- A failed archive write after a GitHub side effect.
- A `ValueError` that escapes a function documented as "Never raises".
- A failed save at admission.

Stop is also less absolute than the docs imply. I read every file in my section in full; I ran nothing.

## 1. The worst discovery: an archive failure after publication is recorded as `failed`

The docstring at `src/reader_mcp/coding_publish.py#3@06add3e` says "Publication is reconciled, never assumed". The docs at `docs/web.md#1419-1420@06add3e` say a full budget or failed archive write "fails the run before any publication".

- **Pull requests.** `open_pull_request` calls `create_pull_request` at `src/reader_mcp/coding_publish.py#212@06add3e`, then emits a step event at `#226`. That emit goes through `Capture.write`, which raises `CaptureFailed` once the budget is full or a write fails (`src/reader_mcp/coding_store.py#165-176@06add3e`). `execute` turns that into `failed` (`src/reader_mcp/coding_jobs.py#294-295@06add3e`). The pull request is open on GitHub, but `run['pr']` stays `None` and `pr_pending` stays set inside a *finished* record. Recovery skips finished runs (`coding_jobs.py#349-350`), so nothing ever reconciles it.
- **Pushes.** `git()` writes `git.log` after the push subprocess has run (`src/reader_mcp/coding_workflow.py#99-106@06add3e`). A failure there leaves the branch pushed, with `push = {sent: True, verified: False}`, and the outcome `failed` rather than `needs_reconciliation`.
- **Issues.** The same applies after `create_issue` (`coding_publish.py#90`, then `#110-111`): the issue is created, `issue_pending` is left set, and the outcome is `failed`. A rerun inherits the predecessor's issue only from `predecessor['issue']` (`coding_jobs.py#193-194`), which was never set. **The rerun therefore creates a second issue.**

## 2. `finish()` "Never raises" is not true

`src/reader_mcp/coding_jobs.py#308@06add3e` promises "Never raises". Its final save catches only `OSError` (`#328-331`). `Store._write` raises `ValueError` for a record over `MAX_RECORD` (`coding_store.py#63-64`), and `folder()` raises `ValueError` for a symlinked folder (`#57-58`).

If `finish` raises inside `execute`'s `finally` (`coding_jobs.py#304-305`), the exception leaves `work()`. That function has no `except`, and it releases ownership only when `closed` is set (`#258-279`). The queue worker dies while the server still holds `supervisor.lock`. The run stays "running" in every view: it is not shown as an orphan, because `owner()` is true (`coding_api.py#25`). Stop only adds the run to `cancels`.

How likely is an oversized record? That part is conjecture. The agent controls commit subjects, file names and evidence. The `CHANGED_BYTES` count is taken before JSON escaping (`coding_workflow.py#297-302`), and control characters expand sixfold under `json.dumps`. A deliberately hostile agent could approach 1 MiB.

## 3. Stop and shutdown

- **Stop can still end in `pr_opened`.** The last cancel check before creating a pull request is `unsent('pr_pending')` (`coding_publish.py#209`). If Stop lands during the in-flight `create_pull_request` (`#212`) or its read-back, the job returns `pr_opened` (`#45`), although `stop()` already answered `stopped: true` (`coding_jobs.py#254`). The docs at `docs/web.md#1393@06add3e` mention only pushes and issues as effects that stay.
- **Stop does not kill an in-flight push.** `git push` runs through a plain `subprocess.run` with a 300-second timeout (`coding_workflow.py#99`, `coding_publish.py#170-171`), not in a supervised process group. The push completes; then `phase('pull_request')` stops the job before any pull request (`coding_publish.py#180`, `coding_workflow.py#72`).
- **A graceful restart is reported as a user Stop.** The cancel predicate includes `self.closed` (`coding_jobs.py#290`), so a server that closes while a job runs records `cancelled` with the message "Stopped by you…" (`coding_workflow.py#79`, `#369`). The docs (`docs/web.md#1394-1396`) say a restart ends unfinished runs `interrupted`.

## 4. Admission: a phantom queued run

`store.save(run)` at `coding_jobs.py#223@06add3e` sits outside the try block that protects `remember()` (`#224-235`). If that save raises `OSError`, `Store.save` keeps the record in memory before re-raising (`coding_store.py#84-88`). The worker's `retry()` later writes it to disk (`#97-104`), but the run was never added to the queue.

The result is a run that shows `queued` with an active Stop button and never runs. A Stop on it finishes nothing, because the run is not in the queue (`coding_jobs.py#250-253`). It stays that way until a restart recovers it. The comment at `#226-228` ("no record is left to wait unqueued") covers only the receipt failure.

## 5. Recovery

These claims hold:

- The previous process group is killed only on a match of host and `lstart` start time (`coding_jobs.py#353-356`).
- Pending issues are looked up by marker (`#414-422`); pending pull requests by branch, head and base, then read back with `ours` and `closes` (`#397-413`).
- Anything unsettled ends `needs_reconciliation`, and no agent is ever relaunched.

What the docs do not mention:

- **Recovery errors can stop the server from starting.** `WebLibrary.__init__` calls `jobs.start()` (`src/reader_mcp/web.py#228@06add3e`), which runs `recover()`. A `KeyError` (`coding_jobs.py#359` and `#388` read `run['source']` and `run['git']` unguarded), a `store.save` `OSError` (`#384`), or a non-dict GitHub reply (`github.py#124` calls `.get` on whatever came back) propagates and stops the server starting.
- **Recovery calls GitHub synchronously at server start**, up to 60 seconds per call (`github.py#15`).
- **A branch pushed and verified before the crash, with no pull request yet, ends `interrupted` with no note** that the branch is pushed (`coding_jobs.py#426-429`).
- **Recovered runs get a thinner `meta.json`.** They are sealed by `llm_logs.seal` (`coding_jobs.py#381`), which adds only `status`, `files` and `note` (`llm_logs.py#156-174`). The head SHA, worktree, issue, PR and tools are missing, contrary to `docs/web.md#1417-1419`.

## 6. Redaction and boundaries

- **"Credentials never appear"** (`coding_api.py#3-4`). Artifacts and events pass only through `shown()` (`coding_api.py#70`, `#74`, `#88`), which rewrites the vault and home paths and nothing else (`display.py#27-46`). No secret scrubbing is applied to agent or verification output. The `SECRET_FLAG` redaction at `llm_logs.py#32` covers argv only.
- **"Host folders appear as `<vault>/…` or `~/…`"** (`coding_api.py#3`; `repositories.py#242`; `docs/web.md#1410`). This is true only for paths under the vault or home. `display.py#5-6` deliberately leaves other paths as they are, so a `worktree_root` or checkout outside home is shown raw in views and agent events. For GitHub text, `private()` does rewrite the worktree and checkout (`coding_workflow.py#81-86`).
- **"No article text … goes to GitHub"** (`docs/web.md#1380`). When the agent supplies no title, the issue and PR titles fall back to the article block's title (`coding_publish.py#81`, `#203`). Nothing prevents an agent's summary from quoting the prompt.
- **Remote identity check.** `inspect` reads raw `remote.<name>.url` and `pushurl` (`repositories.py#142-151`), but the push goes by remote name (`coding_publish.py#170`). Git's `url.<base>.pushInsteadOf` / `insteadOf` rewrites are not considered, so the effective push target can differ from what was checked. This rests on Git's documented behaviour, not on a test.
- **Archive contents.** `meta.json` and `git.log` keep absolute host paths (`coding_jobs.py#323`, `git` includes `worktree` and `common_dir`), and that archive is committed to the vault's Git (`#336-342`).

## 7. Bounds and growth

- **"All output a run produces counts against 64 MiB"** (`docs/web.md#1419`). Only `Capture` writes are counted. The agent's `TMPDIR` is the in-vault scratch folder `.reader/coding-jobs/tmp/<run>` (`coding_workflow.py#263`, `coding_jobs.py#135-138`), which also holds `stdin.txt` and `last-message.md`. It is not budgeted and never removed: nothing in the coding modules deletes `tmp/`.
- **The `runs/` and `requests/` folders are never pruned.** `GET /api/jobs` and `actions()` read up to `MAX_RUNS` = 10000 records per request (`coding_store.py#126`; `coding_api.py#39`, `#95`) before paging 50.
- **The LLM log inventory is not bounded per page.** Its docstring promises a "bounded, read-only inventory", but `page()` lists every day folder and reads every run's `meta.json` before the cursor (`llm_inventory.py#59-88`), so the cost per page grows with the archive.

## 8. Lesser points

- `docs/web.md#1374` gives the Claude Code argv without `--verbose` and without `--add-dir <common dir>`; the code passes both (`coding_agents.py#53-55`).
- "Recognized CLI events" (`docs/web.md#1422`): in fact every JSON-object line is emitted (`coding_workflow.py#249-261`).
- `check_container.py` says "Test arguments may name tests/ paths or node IDs only", but its regex also admits pytest options such as `--basetemp=…` or `-p` (`scripts/check_container.py#59-60`).
- `scripts/check_container.py#26-31` now names the worker per checkout. Its lock is the per-checkout `.reader/review/validation.lock` (`#62-63`), so separate worktrees can now run heavy validations at the same time. That is a resource-discipline concern, not a drift from a stated claim.

## Verdict table

| # | Claim | Verdict | Citation |
|---|---|---|---|
| 1 | One owner per vault via `.reader/coding-jobs/supervisor.lock` | CONFIRMED | coding_jobs.py#81; voice_runner.py#383 |
| 2 | Non-owners answer 409 to submit and Stop | CONFIRMED | coding_jobs.py#160-161, #242-243; web.py#1686 |
| 3 | Original and submitted prompts archived before any work | CONFIRMED | coding_jobs.py#216-221 |
| 4 | Same request UUID: same run; different input: 409 | CONFIRMED | coding_jobs.py#165-169 |
| 5 | Viewing, listing and streaming never start anything; GETs never write | CONFIRMED | coding_api.py#4; web.py#1620-1638 |
| 6 | A restart never relaunches; process stopped on start-time match | CONFIRMED | coding_jobs.py#346-356 |
| 7 | Recovery ends `interrupted` / `pr_opened` / `needs_reconciliation` | CONFIRMED (but can stop server start) | coding_jobs.py#386-429; web.py#228 |
| 8 | A graceful restart ends `interrupted` | DRIFT (ends `cancelled`, "Stopped by you") | coding_jobs.py#290; coding_workflow.py#79 |
| 9 | `finish()` never raises | DRIFT | coding_jobs.py#308, #328-331; coding_store.py#63-64 |
| 10 | No record left unqueued after an admission failure | DRIFT (save path) | coding_jobs.py#223-228; coding_store.py#84-88 |
| 11 | Create-only push with an empty lease; nothing force-pushed or overwritten | CONFIRMED | coding_publish.py#163-176 |
| 12 | `pr_opened` only after remote SHA and PR read back (repo, base, branch, head, issue) | CONFIRMED | coding_publish.py#18-27, #227-233 |
| 13 | Uncertain creates reconciled, never repeated | CONFIRMED | github.py#74-102; coding_publish.py#91-97, #213-222 |
| 14 | Budget or write failure fails the run before any publication | DRIFT | coding_publish.py#212, #226; coding_workflow.py#106 |
| 15 | Stop kills the process group; only pushes and issues survive | DRIFT (PR can open; push not killed) | coding_publish.py#209-212; coding_jobs.py#254 |
| 16 | Nothing resets, merges or deletes worktrees or branches | CONFIRMED | coding_workflow.py (no such calls) |
| 17 | Preflight refusals end `blocked`; branch exists nowhere | CONFIRMED | coding_workflow.py#154-194 |
| 18 | Remote and push URL must be `github.com/owner/name` | CONFIRMED (insteadOf rewrites unchecked) | repositories.py#135-155 |
| 19 | Verify: nonzero exit, moved head or dirty tree publishes nothing | CONFIRMED | coding_publish.py#146-153; coding_workflow.py#285-286 |
| 20 | "No article text … to GitHub" | DRIFT (title fallback) | coding_publish.py#81, #203 |
| 21 | Credentials never appear | DRIFT (no output scrubbing) | coding_api.py#3-4, #88; display.py#27 |
| 22 | Host folders shown as `<vault>` / `~` | DRIFT (other paths shown raw) | display.py#5-6; repositories.py#242 |
| 23 | All run output counts against 64 MiB | DRIFT (`TMPDIR` scratch excluded) | coding_workflow.py#263; coding_jobs.py#135 |
| 24 | `meta.json` pins head, issue, PR, tools (for every run) | DRIFT for recovered runs | coding_jobs.py#381; llm_logs.py#156-174 |
| 25 | `MAX_EVENT` 256 KiB with truncation; pages at most 512 KiB | CONFIRMED | coding_store.py#186-189; coding_api.py#63-68 |
| 26 | Sequence numbers contiguous and in order | CONFIRMED | coding_store.py#182-191 |
| 27 | Artifact reads 1 KiB to 1 MiB | CONFIRMED | coding_api.py#86 |
| 28 | Prompt-block parse rules (column 0, flat JSON, limits) | CONFIRMED | prompt_blocks.py#63-123, #232-242 |
| 29 | Unowned unfinished run shown as interrupted | CONFIRMED (not for a dead worker on the owner) | coding_api.py#25-28 |
| 30 | LLM log inventory bounded | DRIFT (linear per page) | llm_inventory.py#59-88 |
| 31 | Claude Code argv as documented | DRIFT (minor) | coding_agents.py#53-55 |
| 32 | Only recognized CLI events are emitted | DRIFT (minor) | coding_workflow.py#249-261 |
| 33 | `check_container` test args: paths or node IDs only | DRIFT (minor) | scripts/check_container.py#59-60 |
| 34 | `extract_controls` takes plain files and folders only | CONFIRMED | scripts/check_container.py#34-43 |
| 35 | Executor boundary is cooperative, not enforced | CONFIRMED (honestly framed) | coding_agents.py#8-10 |
| 36 | Tests use a fake GitHub | UNVERIFIABLE (outside my section) | github.py#4 |

```
VERDICT
section: SERVER (src/reader_mcp/*.py, scripts/check_container.py) @ 06add3e
claims_checked: 36
confirmed: 19   drift: 16   planned: 0   unverifiable: 1
worst_drift: a CaptureFailed after create_pull_request, create_issue or push
  finishes the run as `failed` with pr_pending / issue_pending / push-unverified
  in a finished record that recovery never revisits. A PR or issue exists while
  the run says `failed`, and a rerun can create a duplicate issue.
  (coding_publish.py#212,#226@06add3e; coding_jobs.py#294-295,#349-350@06add3e)
runner_up: finish() "Never raises" is false: a ValueError from Store._write
  kills the queue worker while ownership is held
  (coding_jobs.py#308,#328-331; coding_store.py#63-64@06add3e)
fidelity_grade: C+
```

The core publication guarantees are sound and honestly stated. The failure-path guarantees are overstated in several places, and the redaction claims are broader than the code.

```text
═══ ⋆★⋆ Progress Report ⋆★⋆ ═══

Baker Street audit: reader PR #168 (SERVER section)
██████████ 100% (1/1 slices)

- [x] HOLMES server-section testimony

⎇ main +0/-0
🚫 none
```

---

## Sub-detective 2: the web UI

# Testimony of HOLMES, sub-detective 2: the Web UI section

Watson, this section mostly keeps its word. The routing, the honest unavailable states, the nonce-guarded prompt cards and the rule that nothing runs merely by viewing a page are all done carefully. I found one real navigation fault and a handful of smaller drifts, and I give each with its evidence.

Scope: reader @ 06add3e (base b462c23). I read `web/src/jobs/*`, `web/src/admin/*`, `web/src/activity/*`, the `reader-controls.tsx` diff, and the diffs of `app.mjs`, `admin-routes.mjs`, `prompt-blocks.mjs`, `reading.mjs` and `split.mjs`. `static-demo.js` and `web_ui/style.css` have **no changes** in `b462c23..06add3e`; I consulted them only for context.

## Claims examined

**Admin routing and shell**

1. **Sections are hash routes, and the registry is the single extension point.** CONFIRMED.
   - `web/src/admin/sections.tsx#66-84@06add3e`
   - `src/reader_mcp/web_ui/admin-routes.mjs#22-50@06add3e`
   - `sectionFor` rejects parameters a section does not accept: `sections.tsx#87-91@06add3e`.
2. **The header carries the trigger, a breadcrumb (*Reader Admin › Section*) and Back to Library.** CONFIRMED: `web/src/admin/admin-shell.tsx#41-53@06add3e`.
3. **Footer Backstage, `:backstage`, `:admin` and legacy `#backstage` open the Overview, and `#backstage` is shown as `#admin`.** CONFIRMED.
   - Footer: `src/reader_mcp/web_ui/reading.mjs#206@06add3e`
   - Commands: `app.mjs#1672@06add3e`
   - Legacy hash: `admin-routes.mjs#38@06add3e`
   - Address rewrite: `app.mjs#1702-1703@06add3e` and `app.mjs#1850-1852@06add3e`
4. **Space p, `:settings` and a bare `:set` open Settings, with no `scrollIntoView`.** CONFIRMED.
   - `app.mjs#1481@06add3e`, `app.mjs#1673@06add3e`, `app.mjs#1645@06add3e`, `app.mjs#1272@06add3e`
   - The old `scrollIntoView` was removed (`renderAdmin`, `app.mjs#1255-1264@06add3e`).
5. **Each route opens at its top with its heading focused (`preventScroll`).** CONFIRMED: `admin-shell.tsx#59-62@06add3e` and `admin-shell.tsx#36-39@06add3e`.
6. **Space p while already on Settings returns to its top.** CONFIRMED: `openAdmin` scrolls to 0 and focuses the heading when the path is unchanged (`app.mjs#1266-1270@06add3e`).
7. **"Choosing the open section again … returns to its top."** DRIFT (`docs/web.md#1082-1083@06add3e`).
   - The sidebar does `if(active)focusHeading();else context.go(section.id);` (`admin-shell.tsx#28@06add3e`).
   - `focusHeading` uses `preventScroll:true` (`admin-shell.tsx#38@06add3e`), so the page never scrolls back up.
   - It is worse on sub-routes. `active` compares only the section id, so on `#admin/jobs/<uuid>` or `#admin/logs/…` clicking **Coding jobs** or **LLM logs** in the sidebar does not navigate back to the list at all.
8. **A direct load never mounts the Overview first, and Back/Forward and reload keep the section.** CONFIRMED.
   - Boot navigates straight to the parsed path: `app.mjs#1850-1853@06add3e`.
   - `mountAdmin` receives that route: `web/src/reader-controls.tsx#363-366@06add3e`.
   - Moves within Admin re-render in place: `setAdminRoute`, `app.mjs#1260@06add3e`.
9. **An unknown section says so and links to the Overview.** CONFIRMED: `admin-shell.tsx#73-76@06add3e`. Unparseable segments land on `not-found` and are never echoed back (`admin-routes.mjs#24@06add3e`).
10. **The status line shows ADMIN mode.** CONFIRMED: `reading.mjs#50@06add3e`.

**Scrolling, reading position and Back to Library**

11. **Native scrolling, with no ScrollSmoother.** CONFIRMED: `app.mjs#172@06add3e`, and `renderAdmin` stops the smoother (`app.mjs#1258@06add3e`).
12. **Admin never saves a reading position.** CONFIRMED.
    - `navigate` calls `reading.leave()`, which saves the document being left, then `prepare()`, which sets `ready=false` (`app.mjs#479@06add3e`).
    - `save()` does nothing while `!ready` (`reading.mjs#149-150@06add3e`).
13. **Back to Library reopens the document at its saved bookmark.** CONFIRMED: `libraryReturn` strips `&at=` and `&h=` (`admin-routes.mjs#59-62@06add3e`), and `backToLibrary` pushes that address and follows it (`app.mjs#1281-1284@06add3e`).
14. **"The homepage, an issue, Search or a scratch pad reopen as they were."** DRIFT (`docs/web.md#1093@06add3e`). Search comes back as a bare `#search`, without its query (`admin-routes.mjs#63@06add3e`). The module's own comment admits "without passage or search terms" (`admin-routes.mjs#52@06add3e`).
15. **The return target survives a reload within the tab.** CONFIRMED: it is kept in `sessionStorage` (`app.mjs#1275-1279@06add3e`).
16. **A split layout is saved whole, its panes close, and Back restores it with the same focused pane.** CONFIRMED.
    - `split.detach` saves every pane: `split.mjs#301@06add3e`, called from `app.mjs#471-473@06add3e`.
    - The `#split=` hash encodes focus: `split.mjs#189-190@06add3e`.
17. **A pane's Space p or `:backstage` asks the window to open Admin, and a saved layout naming `#backstage` opens the homepage.** CONFIRMED: `app.mjs#469@06add3e`, `split.mjs#354@06add3e`, `app.mjs#1851@06add3e`, and `cleanRoute` drops `#backstage` (`split.mjs#115@06add3e`).

**Sidebar and keyboard**

18. **Collapsed, the sidebar leaves the Tab order; below 768 px it is a sheet named *Admin sections*, and choosing a section focuses the heading.** CONFIRMED.
    - `inert` when collapsed: `web/src/components/ui/sidebar.tsx#223@06add3e`
    - Breakpoint: `web/src/hooks/use-mobile.ts#3@06add3e`
    - Sheet title and focus handoff: `admin-shell.tsx#16-17,27,64@06add3e`
19. **Reduced motion removes the sidebar's transitions.** CONFIRMED, but only through the old global rule `src/reader_mcp/web_ui/style.css#61@06add3e`. Nothing specific to the sidebar was added.
20. **Space on a focused Admin control activates it, and Reader's keys never act on typing.** CONFIRMED: `app.mjs#1592-1593@06add3e`. Native `select` and `input` elements are covered by the `typing` guard (`app.mjs#1351@06add3e`).

**Overview, Indexes and Inbox**

21. **The Overview is read-only: it starts no check, rebuild, model or inbox run.** CONFIRMED.
    - `overview.tsx#57-103@06add3e` contains only reads.
    - `checkIndexes` is called only from `IndexesPanel` (`web/src/admin/panels.tsx#35@06add3e`; `reader-controls.tsx#340-345@06add3e`).
22. **"The Overview summarizes what Reader already polls (`/api/maintenance` and `/api/inbox`)."** DRIFT (`docs/web.md#1107-1108@06add3e`). The Overview also runs its own poll of `/api/jobs?state=active` every 5 s. That poll does not check whether the tab is visible (`overview.tsx#16-27@06add3e`). The component comment says so; `web.md` does not.
23. **Unknown status is never shown as zero or healthy, and a failed later refresh is announced as stale.** CONFIRMED.
    - Tiles go loading → unavailable → ready: `overview.tsx#69,83,93@06add3e`.
    - "Nothing is running" is shown only when every read has answered: `overview.tsx#78@06add3e`.
    - Stale note: `overview.tsx#100@06add3e`.
    - Error fields: `reader-controls.tsx` (`maintenanceError`/`inboxError` set in `pollMaintenance`/`pollInbox`).
24. **"Indexes and the Inbox show the same unavailable state, with their actions disabled."** Mostly confirmed, with a small DRIFT (`docs/web.md#1112@06add3e`).
    - Rebuild buttons are `disabled={busy||unavailable}` (`web/src/backstage.tsx#129@06add3e`).
    - **Check again** is `disabled={busy}` only (`backstage.tsx#114@06add3e`), so it stays enabled when status is unavailable.
25. **In the static demo, Service & tools, Voices and Models (and Jobs, Logs and Repositories) say they need Reader.** CONFIRMED: `sections.tsx#68-82@06add3e` (`needsReader:true`) and `admin-shell.tsx#77@06add3e`.

**Prompt cards (RW-44)**

26. **The card shows the repository, issue, an editor, Copy, the agent, Run → PR, Stop and earlier runs.** CONFIRMED: `web/src/jobs/prompt-card.tsx#87-136@06add3e`, with Stop in `job-detail.tsx#39-45@06add3e`.
27. **Nothing runs on view.** CONFIRMED. The only POSTs are `submitJob`, called from the form's submit handler (`prompt-card.tsx#66-81@06add3e`; `store.ts#96-99@06add3e`), and `stopJob`.
28. **"The card only reads `GET /api/jobs/actions`."** DRIFT (`docs/web.md#1351@06add3e`). The card sets its latest earlier run as current (`prompt-card.tsx#52@06add3e`). `useJob` then reads `/api/jobs/events` and opens the `/api/jobs/stream` EventSource (`store.ts#46,59@06add3e`). These are still only reads, so the read-only promise holds.
29. **Request UUID idempotence: a retried click is the same request.** CONFIRMED: `prompt-card.tsx#69-76@06add3e`.
30. **Editing makes a run-local revision; Reset restores the text; Escape leaves the editor.** CONFIRMED: `prompt-card.tsx#53,97,104@06add3e`.
31. **The static demo, past editions and inbox previews stay readable and copyable but cannot run.** CONFIRMED: `app.mjs#667-672@06add3e` and `prompt-card.tsx#55,63@06add3e`.
32. **Cards mount only on wrappers carrying this render's nonce, and embeds, chat and scratch show the block as code.** CONFIRMED: `prompt-blocks.mjs#123-150@06add3e`, `app.mjs#681-682,695@06add3e`.
33. **Markers inside lists, quotes or an already-open wrapper, duplicates and bad metadata stay ordinary code.** CONFIRMED: `prompt-blocks.mjs#84-114@06add3e`.
34. **The trace opens by itself when a check fails.** CONFIRMED: `job-detail.tsx#50-52@06add3e`.
35. **Set up repository and Open in Reader Admin go to the admin routes.** CONFIRMED: `prompt-card.tsx#126,128@06add3e`.

**Coding-job sections in Admin**

36. **Coding jobs can be filtered by repository, state and article.** CONFIRMED, with a limitation: the repository and article choices come only from the latest 50 runs (`web/src/jobs/admin.tsx#45-46@06add3e`).
37. **The job detail shows facts, the trace, Stop, commits, links and bounded artifact previews with Copy and Download.** CONFIRMED: `job-detail.tsx#98-128@06add3e`.
38. **LLM logs are paged and never pruned; registration and removal happen in Repositories.** CONFIRMED: `admin.tsx#78-102@06add3e` and `admin.tsx#125-173@06add3e`. That the server accepts registration only from this Mac cannot be checked from the UI code: UNVERIFIABLE.
39. **A failed request shows as unavailable, never as an empty healthy list.** CONFIRMED: `admin.tsx#36-38,47,83,129@06add3e`.
40. **Stream cursor: frames at or below the cursor are ignored and a gap is filled from the archive.** CONFIRMED: `web/src/activity/reducer.ts` `applyFrames`, and `store.ts#42-73@06add3e`.
41. **The transcript is producer-neutral, with Claude Code stream-json, phases and GitHub rows.** CONFIRMED: `reducer.ts` (`claudeMapper`, `jobMapper`, the `steps` phases branch) and `transcript.tsx#20-27@06add3e`.

**Documentation slips**

42. **"Reader Admin (formerly Reader Admin)."** DRIFT (a typo; it should read "formerly Behind the scenes"): `docs/web.md#1059@06add3e` against `admin-shell.tsx#1@06add3e`.
43. **The coding-job sections are missing from the route lists.** DRIFT by omission.
    - The routes table in `docs/web.md` and the RW-45 CHANGELOG list nine sections.
    - The code puts three more (Jobs, Logs, Repositories) directly after the Overview (`sections.tsx#68-75@06add3e`).
    - They are documented only later, at `docs/web.md#1437@06add3e`. The RW-44 CHANGELOG entry never mentions the Admin sections.

## Undocumented behaviour (reverse drift)

- **Artifact previews refetch on every event.** `useEffect(()=>{load(256*1024)…},[run.id,name,run.seq])` (`job-detail.tsx#80@06add3e`) refetches a 256 KiB artifact each time the sequence number advances during a live run. If you pressed **Show up to 1 MiB** (`job-detail.tsx#91@06add3e`), the next event quietly drops the preview back to 256 KiB.
- **Admin lists go stale.** The Jobs and Logs tables load once and never refresh (`admin.tsx#25-35@06add3e`), so an active job's state badge stays frozen until you press Refresh.
- **The browser's job-actions cache goes stale.** It is kept per article edition for the life of the tab and cleared only after a registry edit in that same tab (`store.ts#105-114@06add3e`). Installing an agent, a change of server ownership, or a run started in another tab does not show until reload.
- **Failures probably show twice (conjecture).** The `outcome` event maps to a fatal error item (`reducer.ts#299@06add3e`), and the transcript also appends its own error box for `failed/blocked/interrupted/needs_reconciliation` (`transcript.tsx#25,317@06add3e`). A user's **Stop** (`cancelled`) also renders as an error trace.
- **The Overview's Attention tile ignores coding-job failures and `needs_reconciliation`** (`overview.tsx#42-55@06add3e`). The run that most needs a human is missing from "Attention needed".
- **The job store never evicts entries** (`store.ts#24@06add3e`). This is minor and only grows with each job viewed.
- **Opening Indexes can start two `/api/maintenance` reads at once** (`reader-controls.tsx#340-345,366@06add3e`). The timer chain heals itself, so this is trivial.
- **To their credit:** the phone layout turns tables into stacked rows (`web/src/styles.css#766@06add3e`), the sheet is used below 768 px, and links carry screen-reader "opens a new tab" text throughout.

## VERDICT

| # | Claim | Verdict |
|---|---|---|
| 1–6, 8–13 | Routes, header, aliases, Space p, focus without scrolling, direct load, Overview never first, native scroll, no position saved, bookmark return | CONFIRMED |
| 7 | Re-choosing the open section returns to its top | **DRIFT** (and the sidebar fails to navigate from sub-routes) |
| 14 | Search reopens "as it was" | DRIFT (query dropped) |
| 15–21, 23, 25 | Session return, split restore, pane delegation, sidebar and sheet, reduced motion, Space activation, read-only Overview, honest unavailable states, static-demo pages | CONFIRMED |
| 22 | Overview only summarizes the existing polls | DRIFT (its own 5 s jobs poll) |
| 24 | Unavailable Indexes have their actions disabled | DRIFT (minor: Check again stays enabled) |
| 26–27, 29–35 | Prompt card contents, nothing runs on view, idempotent request UUID, blocked contexts, nonce guard, parser rejections, auto-opening trace | CONFIRMED |
| 28 | Card reads only `/api/jobs/actions` | DRIFT (also events and stream; still read-only) |
| 36–41 | Admin job, log and repository panels; cursor and gap fill; producer-neutral reducer | CONFIRMED (36 with a limitation) |
| 38 | Registration accepted from this Mac only | UNVERIFIABLE (server side) |
| 42 | "formerly Reader Admin" | DRIFT (typo) |
| 43 | Route table and CHANGELOG cover all sections | DRIFT (omission) |

- **Drift count:** 7 (claims 7, 14, 22, 24, 28, 42, 43), plus 7 undocumented behaviours.
- **Worst drift:** claim 7. `admin-shell.tsx#28@06add3e` treats "active" as the same section id. Choosing the open section never scrolls back up, despite `docs/web.md#1082-1083@06add3e`. On `#admin/jobs/<uuid>` and `#admin/logs/…`, the sidebar entry for the list does nothing but focus the heading, so you cannot get back to the list from the sidebar.
- **Worst undocumented behaviour:** the per-event artifact refetch, which also undoes the 1 MiB preview (`job-detail.tsx#80,91@06add3e`).
- **Fidelity grade: B+.** The core promises hold: nothing runs on view, Admin never saves a reading position, unknown status is never shown as healthy, and Back to Library restores the place. The drifts are small; only the sidebar fault breaks a promised behaviour.

---

## Sub-detective 3: docs, validation record and tests

Watson, my verdict: grade **B−**. docs/web.md kept pace with most of the 52 review fixes, but the CHANGELOG, the validation record and a few web.md passages did not. I read everything at 06add3e only; I ran no tests, no Docker and no generators, so "a test exists" means it would fail by reading, not by running.

## I. What the docs got right

docs/web.md caught several late changes correctly:

- **Create-only push.** web.md describes `--force-with-lease=refs/heads/<branch>:` and says the empty lease refuses a branch that already exists (`docs/web.md#1383-1385@06add3e`). The code matches (`src/reader_mcp/coding_publish.py#170@06add3e`). It pushes `<verified sha>`, not the branch ref (#167).
- **Verification command found on PATH.** web.md says a bare name is resolved on Reader's `PATH` (`docs/web.md#1366@06add3e`). The code uses `shutil.which(argv[0], path=self.env.get('PATH'))` (`src/reader_mcp/coding_workflow.py#142-150@06add3e`).
- **Byte-bounded pages.** web.md gives "at most 512 KiB a page" for both live and archive pages (`docs/web.md#1429@06add3e`). Live pages now respect `MAX_PAGE_BYTES` too (`src/reader_mcp/coding_api.py#62-68@06add3e`; `src/reader_mcp/coding_store.py#30@06add3e`).
- **Rerun predecessor.** web.md requires a finished run of the same article and block (`docs/web.md#1363@06add3e`). The code checks exactly that (`src/reader_mcp/coding_jobs.py#185-194@06add3e`).
- **Restart and orphan views.** Both match `src/reader_mcp/coding_jobs.py#346-429@06add3e` and `src/reader_mcp/coding_api.py#25-28@06add3e`.
- **Pull request read-back.** web.md lists repository, base, branch, head SHA and issue. The code checks all of those, plus the head repository, open and not merged (`src/reader_mcp/coding_publish.py#18-27@06add3e`).

## II. Where the docs drifted

1. **CHANGELOG says "pushes normally".** (`CHANGELOG.md#5@06add3e`). The push is now create-only with an empty lease (`src/reader_mcp/coding_publish.py#168-171@06add3e`). The text dates from 348769b and was never touched again: `git log -S"pushes normally"` finds only that commit. This is the worst drift, because it is the headline entry and misstates the one step that publishes.
2. **"Reader Admin (formerly Reader Admin)"** (`docs/web.md#1059@06add3e`). A find-and-replace in 436bb8f turned "Behind the scenes" into "Reader Admin" here too.
3. **"A finished run is read once when the Models page opens"** (`docs/web.md#1306@06add3e`). This sentence is about the inbox transcript, and the same rename produced it. In the code the inbox poll catches up a finished run whenever it sees a new run ID, whatever page is open (`web/src/reader-controls.tsx#283-284@06add3e`). The run panel lives on Inbox, not Models (`web/src/admin/sections.tsx` inbox entry).
4. **The Overview's sources.** web.md says it summarizes `/api/maintenance` and `/api/inbox` (`docs/web.md#1107-1108@06add3e`). Since bd7da65 it also polls `/api/jobs?state=active` every 5 s (`web/src/admin/overview.tsx#16-27,67@06add3e`; `web/src/jobs/store.ts#94@06add3e`). That fix shipped without a doc update.
5. **"Recognized" CLI events.** web.md says `events.jsonl` holds the agent's recognized CLI events and unrecognized output stays in the raw logs (`docs/web.md#1421-1423@06add3e`). The server stores every JSON-object line as an `agent` event (`src/reader_mcp/coding_workflow.py#249-261@06add3e`). Only lines that are not JSON stay raw; recognition happens later, in the browser.
6. **"No article text … goes to GitHub"** (`docs/web.md#1380@06add3e`). When the agent gives no title, the issue and pull request titles fall back to the article block's title (`src/reader_mcp/coding_publish.py#81,203@06add3e`). The bodies are the agent's drafts, written from the article's prompt, and are only path-redacted (`private()`, `src/reader_mcp/coding_workflow.py#81-86@06add3e`).
7. **"No `/api/*` answer names a host folder"** (`docs/web.md#3819-3820@06add3e`). This is the general rule, and the new routes break it in one case. The run view copies `git` whole, including `worktree` and `common_dir` (`src/reader_mcp/coding_api.py#29,35@06add3e`). The registry view returns `checkout` and `worktree_root` (`src/reader_mcp/repositories.py#253-258@06add3e`). `shown()` only rewrites the vault and `$HOME` prefixes (`src/reader_mcp/display.py#27-46@06add3e`). So a worktree folder outside `$HOME` is returned verbatim. I found this by reading, not by running it.
8. **Incomplete route table.** The table "Each section is its own hash route" leaves out `#admin/jobs`, `#admin/logs` and `#admin/repositories` (`docs/web.md#1063-1075@06add3e`); they appear only at #1437. The RW-44 CHANGELOG entry never mentions the three Admin sections.
9. **Stale validation record.** Details in §IV.

capabilities.md's "never … force-pushes" (`docs/capabilities.md#363@06add3e`) holds in substance: the force-with-lease flag is used only as a create-only guard.

## III. Behavior that ships but is documented nowhere

- **UI strings still say "Behind the scenes".** The footer button's accessible name and tooltip read "Open Behind the scenes: indexes and settings · Space p" (`src/reader_mcp/web_ui/index.html#67@06add3e`). But that button opens the Overview, and Space p opens Settings. The same old name survives in `web/src/search-page.tsx#108,136`, `src/reader_mcp/web_ui/art.mjs#152`, and in `app.mjs#298,1659` (the `:rebuild` help). This contradicts the CHANGELOG's "replaces" (`CHANGELOG.md#7@06add3e`).
- **Run-record limits and in-memory fallback.** Records cap at 1 MiB, writes that would exceed it are refused, and the newest 10,000 records are kept. Failed saves are kept in memory and retried (`src/reader_mcp/coding_store.py#26-27,52,61-112@06add3e`).
- **Event limits.** An event over 256 KiB is truncated and marked `truncated`; the live buffer holds 4,096 events and is released when the run is sealed (`src/reader_mcp/coding_store.py#28-29,186-188,220-225@06add3e`).
- **Registry limits.** At most 64 repositories and 256 KiB, a cross-server `flock` on `repositories.lock`, and the lock's `ttl_seconds`/`wait_seconds` (ttl must exceed the verify timeout) (`src/reader_mcp/repositories.py#34-35,124-128,213-219@06add3e`).
- **LLM log metadata limit.** The inventory reads `meta.json` only up to 1 MiB (`src/reader_mcp/llm_inventory.py#12,26@06add3e`).
- **Stream limits.** The job stream has a 1-hour deadline and accepts only an ASCII-digit cursor (`src/reader_mcp/web.py#1360,1382@06add3e`).
- **Branch names truncated.** The block ID in the branch name is cut to 40 characters (`src/reader_mcp/coding_jobs.py#196@06add3e`).

## IV. activity/rw-44-validation.md, now stale

| Claim (`activity/rw-44-validation.md`) | Verdict |
|---|---|
| "All checks ran at `f604a55`" (#7) | **DRIFT**: head 06add3e is 66 commits later (`git log f604a55..06add3e`), including four review rounds and a main merge. |
| "Python passed 937 tests" (#9) | **DRIFT**: `def test_` count rose from 663 to 713 after f604a55, plus parametrized cases. |
| "147 of 147" contract tests (#10) | **DRIFT**: main's merge added a test to `tests/contract/security.test.mjs` after f604a55, so it is at least 148 (assuming 147 was right). |
| "all 71 browser suites" (#11) | **DRIFT**: `tests/web_source.cjs` arrived later, so 72 by the same count. I assume `web_wait.cjs` is a helper; that is conjecture. |
| surface.md: no route without contract coverage (#10) | **CONFIRMED** at head (`docs/port/surface.md#924@06add3e`: 82 of 82), though it was regenerated four times after the record. |
| Render loop, lock-keys default, stream hang-ups (#17, #20, #21) | **CONFIRMED** (`web/src/jobs/store.ts#84-88`, `web/src/jobs/admin.tsx#127`, `src/reader_mcp/web.py#1398-1401`). |
| Determinism runs (18/18); CI and Code Lawyer gates | **UNVERIFIABLE** from the tree. |
| Omission | It records none of the roughly 50 review fixes made after f604a55. |

## V. Test gaps: guarantees no test would catch breaking

1. Preflight blocks a branch that already exists locally or remotely (`src/reader_mcp/coding_workflow.py#190-193`). No test; the only "already exists" test is at publish time (`tests/test_coding_failures.py#160`).
2. A worktree folder that already exists is never reused (`src/reader_mcp/coding_workflow.py#217-218`). No test.
3. Agent timeout, the 4 GiB process-group memory limit and the mid-run disk reserve (`src/reader_mcp/coding_workflow.py#371-381`). No tests.
4. Recovery's PID-reuse guard: a process whose start time does not match is not killed. Only the matching case is tested (`tests/test_coding_failures.py#275`).
5. Host folders outside `$HOME` in run and registry views (§II.7). `tests/test_coding_api.py#126-127` checks only the vault string; the registry test sets `HOME` to the fixture's folder.
6. No article text in issues or pull requests. Only host-folder redaction of titles is tested (`tests/test_coding_jobs.py#313`).
7. HTTP 409 for writes to a server that does not own jobs. It is tested only at library level (`tests/test_coding_api.py#159-161`).
8. Contract goldens for jobs, repositories and logs cover only empty or error shapes (`tests/contract/read.test.mjs`). No golden pins a populated run's shape; "82 of 82" means each route is requested, not that its shape is pinned.
9. `/api/jobs` filters `path` and `block`, the cursor, and the 50-row page. Only `repo` and `state=failed` are exercised (`tests/test_coding_api.py#83-84`).
10. "Verification runs without a shell" has no adversarial test.

**Tests that cannot fail:** I found none. Two are weaker than their names:
- `test_viewing_listing_and_streaming_never_start_anything` (`tests/test_coding_jobs.py#213`) never streams.
- `test_python_takes_a_k_expression` (`tests/test_check_container.py#38`) proves the arguments parse, but not that `-k` reaches pytest.

Otherwise the review-fix commits generally carry tests that fail without the fix, judging by their commit messages and code.

## VERDICT

| Area | Verdict |
|---|---|
| CHANGELOG RW-44 workflow, outcomes, idempotency, budget, routes | CONFIRMED, except "pushes normally" (DRIFT) |
| CHANGELOG RW-45 | CONFIRMED (shipped UI labels drift, §III) |
| CHANGELOG worker names | CONFIRMED (`scripts/check_container.py#25-30`) |
| docs/web.md, coding jobs | Mostly CONFIRMED; DRIFT on recognized events, article text to GitHub, host folders |
| docs/web.md, Reader Admin | Mostly CONFIRMED; DRIFT at #1059, #1107, #1306; route table incomplete |
| docs/separate-vault.md | CONFIRMED (`scripts/check_container.py#52-63,65,126-127,173-181`) |
| docs/capabilities.md | CONFIRMED (force-push wording holds in substance) |
| README.md | CONFIRMED (anchors resolve; one leftover "Install in Companions") |
| docs/port/surface.md | CONFIRMED by spot checks (82 rows, subprocess line numbers); query-parameter columns miss `after`/`limit`/`cursor` read through `self.number` |
| activity/rw-44-validation.md | DRIFT (stale numbers and SHA); defect claims CONFIRMED; gates UNVERIFIABLE |

- **Drift count:** 9 documentation drifts (§II.1–9), plus 1 reverse drift in shipped UI labels and 6 undocumented behaviors.
- **Worst drift:** `CHANGELOG.md#5@06add3e` "pushes normally", against the create-only empty-lease push at `src/reader_mcp/coding_publish.py#170@06add3e`. Close behind is the host-folder promise at `docs/web.md#3820@06add3e`, which the new run view breaks for worktrees outside `$HOME`.
- **Test gaps:** the 10 listed in §V.
- **Fidelity grade: B−.**
