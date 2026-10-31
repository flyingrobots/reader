# Artwork and commissions

## Overview

Artwork lists commissioned article art and its producer/runtime outcomes. Opening it does not commission new art. A commission is a generated result with provenance, not a source-document replacement or proof that a model understood an article correctly.

## Commissions

Rows distinguish queued, waiting, making, ready, failed, timed out and cancelled states. Available facts include producer/model, elapsed time, estimated/reported cost, archive path and bounded error. Compare the exact job ID and source/version before interpreting an old result as the current article’s art.

## Producers

The producer line reports supported art-producing integrations and availability. Producer selection/defaults belong to Settings and article controls. Finding an executable is distinct from having provider access or successful scene validation. A missing producer should be shown explicitly, not replaced by an unrequested external service.

## Generation and validation

The producer prepares an art brief and scene; Reader validates supported scene data and renders it. Captured prose, a completed agent process and a valid rendered result are different checkpoints. Invalid or oversized output must fail visibly. Existing art is retained until a replacement satisfies the publication contract.

## Open

Open navigates to the commissioned article/result through its supported reading view. It does not start another generation. Different versions and source hashes are retained as provenance rather than silently overwriting an unrelated holding.

## Cancel

Cancel requests termination of an owned active commission. It does not undo already committed versions or erase archived producer output. Another server’s ownership makes the page read-only. A stale browser cannot safely claim ownership of an unrelated producer process.

## Costs and privacy

Displayed duration and cost are measurements supplied by the integration and may be absent. Unknown is not zero. Providers can receive prompts/source context according to their configuration. An art preview does not authorize remote publication or acquisition of unrelated source material.

## Storage and recovery

Run archives retain prompts/events/output separately from disposable renderer/runtime files. Art versions and their source identity belong to the article-art workflow. On failure inspect the exact bounded error and retained scene/brief before retrying. Preserve unique evidence and existing art; do not prune shared volumes or reinstall all renderers to hide a failed commission.

Implementation: art workflow/runtime, scene validation and `web/src/art-studio.tsx`, with article-side generation controls and Settings kept separate.
