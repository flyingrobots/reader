# Validate dispatcher fields before method calls

[Issue #164](https://github.com/flyingrobots/reader/issues/164) requires plain HTTP 400 field errors for annotation, chat and quiz dispatchers instead of Python method/argument diagnostics. The accepted body has SHA-256 `87b317357a4f3d81d89130d07c11228cbc32e40a07817a59a441cf96d0edc089`.

1. Add real HTTP contract regressions for missing required fields and extra fields across all six annotation operations, eight chat actions and quiz results. Include malformed selectors, useful deterministic guidance and unchanged durable files; observe the relevant cases RED before the repair.
2. Validate explicit required/allowed field sets before calling domain methods. Preserve optional defaults, accepted payloads, existing quiz generate/review behavior and separately supplied chat/quiz participant identity. Do not echo arbitrary selector/extra-field input, mask TypeError globally, or sanitize unrelated user content.
3. Verify valid requests with the existing focused annotation, engagement, chat and quiz suites and full contract suite. Calibrate new assertions, repeat with supported shuffling and parallel workers, and retain evidence of failures.
4. Replace this plan with the completed activity record and update maintained documentation where the error contract changes. Keep the PR draft until acceptance, test plan and exact-head CI pass; merge follows clean review.

Scope is the three named dispatcher boundaries. This plan is agent-written and has not received human editorial review.
