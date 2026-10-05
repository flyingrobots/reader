# Reader code

This repository contains reusable Reader software only. Keep documents, catalogs, inbox payloads, annotations, participant receipts, local configuration, and historical library activity in the separately configured private vault. Never copy the vault Git history into this repository.

Read docs/separate-vault.md before changing installation. Preserve source bytes and private vault configuration. Test with synthetic fixtures. Do not publish machine-local paths or private document excerpts in code, issues, reviews, or evidence.

Use Code Lawyer when requested. Run its validation in bounded Docker workers. Commit only owned changes; never push or merge without user authorization. Use /speak for project-named start and end summaries, respecting holds. Apply installed Upkeep against its configured private vault; do not treat this code checkout as a vault.
