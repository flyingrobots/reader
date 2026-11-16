# Keep coding fixture probes free of side effects

[Issue #266](https://github.com/flyingrobots/reader/issues/266) covers the broad-change fake agent's unconditional work after its delegated capability probe exits. Work starts from main `6f5b116`. The accepted issue body has SHA-256 `4330a5880cedb492e8d2ec7b6d638ae4dc607833142912a22da426c7e84ff786`.

The outcome is a probe that preserves its invoking repository. Keep the real synthetic task's 800-file change and existing log-inventory assertion. Production coding behavior and test-jail interruption belong to separate work; #267 tracks the latter.

The regression will invoke the exact fake-agent wrapper in a disposable repository and compare files, index and HEAD before and after its version/help probes. Capture RED before changing the wrapper, then GREEN after it exits from probes before performing task work. Restore the bad post-probe behavior as calibration. Run the existing broad-change test and bounded repeated probe cases, followed by required CI and review.

Use the repository's bounded container runner for the affected test module. It excludes the source Git checkout and private vault from the worker. Retain unique failure evidence and verify owned worker cleanup; no resource-limit or hook changes are in scope.

This agent-written plan has not received human editorial review.
