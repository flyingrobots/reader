# Reader code

This repository contains reusable Reader software only. Keep documents, catalogs, inbox payloads, annotations, participant receipts, local configuration, and historical library activity in the separately configured private vault. Never copy the vault Git history into this repository.

Read docs/separate-vault.md before changing installation. Preserve source bytes and private vault configuration. Test with synthetic fixtures. Do not publish machine-local paths or private document excerpts in code, issues, reviews, or evidence.

Use Code Lawyer when requested. Run its validation in bounded Docker workers. Commit only owned changes; never push or merge without user authorization. Use /speak for project-named start and end summaries, respecting holds. Apply installed Upkeep in observer mode against its configured private vault; do not treat this code checkout as a vault or an intake assignment. Software development and report delivery do not authorize claiming, filing or delegating inbox ingestion. An explicit separate Reader librarian/intake assignment is required for librarian mode.

At the end of every turn, run `python3 scripts/stray_work.py` and tell the user about any unlanded commit you made, including commits on a local `main`, so finished work is pushed or deliberately set aside rather than stranded (docs/stray-work.md). The report only lists; it never authorizes pushing, merging or deleting.
