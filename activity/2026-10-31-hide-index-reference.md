# Hideable Indexes reference — 2026-10-31

Added an explicit Show/Hide documentation control with expanded/control semantics. Hiding the reference gives the dashboard full width; the browser remembers visibility. The mounted reference preserves its position, and contextual info icons reopen it before scrolling/focusing the requested section. Jump frames are cancelled on replacement or unmount.

Validation: frontend typecheck/build and focused Indexes browser checks cover toggle visibility, expanded state, full-width dashboard, info-button reopening, existing reference navigation and mobile/data/action behavior.
