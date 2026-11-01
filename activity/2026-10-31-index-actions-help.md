# Actionable index states and contextual help — 2026-10-31

Rebuildable stale/partial/missing states now invoke the primary rebuild through a status button in the health table and inspector. Search also has an immediately visible Rebuild search action above the charts. Busy and unavailable states remain protected. Current/error/capacity-limit states do not imply that rebuilding is a repair.

Added reusable shadcn help popovers supporting hover, focus and tap for update policy, index purposes, measurements and Admin Overview tiles. The policy explains that checks do not update data, rebuilds have no recurring schedule, and filing procedures require explicit refreshes. No backend scheduler or watcher was added.

Validation: typecheck/build and the focused Indexes browser checks passed, including actual fake-daemon maintenance POST from the status button, policy hover help and busy-button admission. Existing D3/keyboard/mobile/error checks remain green.
