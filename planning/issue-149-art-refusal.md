# Recover the magazine art button after refusal

[Issue #149](https://github.com/flyingrobots/reader/issues/149) requires the magazine art button to become usable again when its commission is refused. The accepted body has SHA-256 `280586eb7e9a2a08432e0deb96227c5dabda26cd7e0d6c4231a35219ab112982`. This is one bug fix across the action result, button state and browser regression; art ownership and generation policy remain outside scope.

1. Observe a browser regression RED against the existing synthetic magazine/art fixture: a refused commission must report its reason and restore the same button's label and enabled state without reloading.
2. Return an explicit queued outcome from the action and clear pending UI state when no job was queued. Preserve successful pending state and prevent duplicate requests while one is running.
3. Verify 400, 409 and 429 refusal recovery, a subsequent successful retry, and existing article controls. Calibrate the new assertions and repeat them with controlled ordering where the runner supports it.
4. Rebuild the generated controls through the repository's established procedure, run the appropriate frontend/browser checks, and replace this completed plan with the verification record. Keep the PR draft until acceptance, test plan and exact-head CI pass.

Tests use synthetic documents and deterministic refusal/response boundaries without arbitrary sleeps. This plan is agent-written and has not received human editorial review.
