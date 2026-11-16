# Verify the Link graph refresh contract

[Issue #230](https://github.com/flyingrobots/reader/issues/230) requires the complete browser suite to reach and verify the current Link graph card, usable Refresh action, successful completion and exact synthetic fixture counts. The accepted issue body has SHA-256 `4f5407eb54d97e71c69254d32311eb2c875f9a21a153e8ef51b2cbf2796ec0ed`.

1. Recheck the current main implementation and existing test history. Run the complete suite against synthetic files within the existing resource guard.
2. Calibrate missing and disabled refresh controls, failed refresh, and incorrect result counts. If a negative control survives, observe it RED before repairing only that assertion boundary.
3. Preserve navigation, preview, fragment, layout and local-resource coverage. Restore temporary mutations exactly and run the complete suite again.
4. Replace this plan with a concise evidence record. If all existing checks already satisfy acceptance, make the PR verification-only; otherwise include the smallest demonstrated test repair. Keep the PR draft until acceptance and exact-head CI are green.

Production UI changes and unrelated browser repairs are outside scope. This plan is agent-written and has not received human editorial review.
