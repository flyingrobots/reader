# Keep coding fixture probes free of side effects

[Issue #266](https://github.com/flyingrobots/reader/issues/266) covers the broad-change fake agent's unconditional work after its delegated capability probe returns. Work started from main `6f5b116`. The accepted issue body has SHA-256 `4330a5880cedb492e8d2ec7b6d638ae4dc607833142912a22da426c7e84ff786`.

## Cause and change

The ordinary fake CLI returns normally after printing its version. The broad-change wrapper then continued into its 800-file task, staging and committing changes in whichever directory invoked the probe. The production capability lookup inherits its caller's directory. The regression invokes the exact wrapper in a disposable repository with pre-existing staged, unstaged and untracked work; it compares file bytes, index, HEAD and branch references before and after the probe.

The wrapper now initializes its exit status and exits immediately after its supported `--version` probe. The fixture supports no other capability-probe aliases. Its real task still creates all 800 expected paths with their expected bytes and satisfies the existing log-inventory check. Production coding behavior is unchanged. Test-jail interruption remains separate work in #267.

## Verification

The new probe test failed before the repair: the repository snapshot changed, including HEAD. It passed after the early exit. Four additional deliberate faults each failed the intended assertion: a wrong exit status, an extra version line, only 799 task files, and incorrect task-file bytes. Each fault was restored before the next run; the final source hash matched the pre-calibration source.

The probe and broad-task cases passed ten runs in seeded shuffled order (seed 266, 20 passing cases). The complete affected module passed in the repository's bounded Docker worker: **38 passed in 13.62 seconds**. The worker used 438,544 KiB under `/work` and 22,764 KiB under `/tmp`; its named container was absent after cleanup and its exclusive lock was released.

Focused command, once for each test or the pair:

```sh
.venv/bin/python scripts/test_jail.py --timeout 30 -- .venv/bin/python -m pytest -q \
  tests/test_coding_jobs.py::test_broad_change_agent_version_probe_preserves_invoking_repository \
  tests/test_coding_jobs.py::test_a_coding_job_with_hundreds_of_changed_files_stays_readable_in_the_log_inventory
```

Affected-module command, under the owned worker lock and resource admission check:

```sh
python3 scripts/check_container.py python tests/test_coding_jobs.py
```

Local evidence is retained outside the repository under the session's `reader266-*` artifacts: initial RED/GREEN logs, four calibration logs, ten repeat logs, a calibration manifest, the container log and its resource/cleanup receipt. A preliminary container attempt refused a stale measurement before starting the worker; a fresh measurement admitted the successful run. No private vault, live service or real coding provider participated. Focused local checks and the affected module do not establish a complete-suite pass; hosted CI is the merge gate.

The test fixture's operating contract did not change, so maintained system documentation needs no update. This agent-written activity record has not received human editorial review.
