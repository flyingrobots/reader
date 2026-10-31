# File Explorer deployment candidate — 2026-10-31

The original explorer change, `5a3ff98`, was based on an older local main. This candidate applies that change on top of the running Reader version `4e87a15ba9063be2b87574ef0a7ce0203a6893b3`, preserving the newer shadcn shell dialogs, article art, gallery, versions and focus fixes. Integration removes the retired modal picker wiring, keeps the explorer outside modal detection, and lets the shell's explorer retain keyboard focus and status while split panes are open.

Verified on this combined candidate:

- Frontend typecheck and production asset build passed.
- `tests/web_documents.cjs`, with `PYTHONPATH` selecting this worktree's source, passed: full-library paging, filters, sorting, article loading, read state, keyboard and Escape, continuous/two-page/mobile geometry, and Search contents navigation.
- `tests/web_breadcrumbs.cjs` and `tests/web_focus.cjs` passed against this worktree's source.
- Changed JavaScript syntax and `git diff --check` passed.

Deployment uses the existing service and live worktree, with the supported source setting `local/file-explorer`, followed by `reader_service.py update --now`. Its smoke gate runs the Python web suite and synthetic endpoint checks before checkout and restart, and retains rollback behavior. The local branch is intentionally retained for the service to follow; this operation does not publish to origin or alter the private vault's contents. The original local-main commit also remains unpublished.

The operator must verify the exact health commit, served asset hashes and actual explorer behavior after activation. Deployment output and verification receipts are retained locally under `.reader/explorer-deployment/`; this candidate record does not claim activation before those checks run.

Resource measurements: host free space 584 GiB; candidate frontend dependencies 280 MiB; focused browser screenshots 652 KiB. Dependencies use the existing npm package cache, with a local install to keep bundle source paths canonical. No Docker worker, image, volume or background validation campaign was created.
