---
name: you-got-mail
description: Process Reader inbox arrivals when the user says "you got mail", requests inbox filing, or assigns librarian intake. Starts the deterministic local workflow, watches its result, and reports exceptions. Sending a document to Reader does not invoke filing.
---

# Process Reader's inbox

Use this only for an explicit inbox-processing request or an authorized Reader
librarian intake assignment. Delivery couriers stop at their verified receipt.

Run the colocated helper from any project:

```sh
python3 /path/to/you-got-mail/scripts/process.py status
python3 /path/to/you-got-mail/scripts/process.py start
```

The helper resolves the installed code checkout and its configured private
vault. `start` launches the same supervised workflow as Reader's **You got
mail** and Obsidian's **Process inbox** buttons. It returns the run identity;
it does not wait for completion. Inspect `status` while the run is active,
allowing time between checks, and report the final result. Use `stop` only when
the user requests cancellation. Do not start another run while this one exists.

The script freezes the arrival inventory, invokes a read-only LLM for bounded
editorial decisions, validates those decisions, files preserved originals,
prepares reading copies and link repairs, verifies catalogs and receipt bytes,
and commits only its owned files with normal Git hooks. Do not reproduce those
steps manually, grant the model write access, or delegate parallel filing.
The script divides queues and oversized model context automatically. Never ask
the user to choose a split size or divide an original delivery bundle.

Existing Upkeep claims must finish before this runner can start. A failed or
stopped run retains its journal. Read its report, resolve the stated cause,
then explicitly retry `start`; the journal resumes the original batch even if
its sources have already left the inbox. Later arrivals belong to a later run.
An interrupted supervisor requires verifying its recorded processes before
clearing stale state; follow [runner recovery](../../docs/inbox-runner.md).
Never remove the pending journal merely to make a retry start.

Completion requires a verified result and, for filed material, a local commit.
Report filed destinations, deferred arrivals and reasons, unresolved links,
formatter refusals and the commit. An empty inbox or successful model exit is
not proof of filing. Mechanical filing does not claim independent reading or
clear another participant's curation backlog. No pushes or external publication
are part of intake.
