# Link preview recovery plan

Issue [#136](https://github.com/flyingrobots/reader/issues/136) requires a link preview to recover from a transient request failure on the next hover or K without reloading the page.

The accepted issue body has SHA-256 `5932fd4f58a5fa32cd5b247cff48e52392d3d0ecaf655cd997a7b546ef95819b`. This is one bug fix. It changes the existing preview cache policy and its regression coverage, with no UI redesign or server API change.

1. Reproduce a first-request 429 followed by a healthy preview through the browser's synthetic fixture. Observe RED before changing production code.
2. Evict transient failures using the API's explicit status boundary, while preserving successful and genuine 404 entries. Preserve ownership when an older request settles after a replacement.
3. Verify retry behavior, successful/missing caching and stale-display isolation, then run the complete affected browser suite and relevant checks inside the existing resource guards.
4. Replace this active plan with the observed validation record. Keep the PR in draft until acceptance and test-plan checks pass and exact-head CI is green.

Network failure and resolve-phase coverage will follow the actual API boundary. Tests must synchronize on observable conditions, with no arbitrary sleeps. Existing gates remain in force. This plan is agent-written and awaits human editorial review.
