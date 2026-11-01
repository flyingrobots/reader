# Deterministic intake: automatic partitioning checkpoint

This checkpoint advances the earlier draft; it is not a landed or deployed
release. The supervisor now invokes the deterministic worker. The script owns
filing, preservation checks, journal recovery and commits; a read-only model
returns structured editorial decisions.

The user should not split deliveries or select a split size. The worker divides
the frozen queue into sequential batches without dividing original bundles.
Oversized editorial inventories are partitioned automatically and their bounded
observations reduced to one decision. Completed model responses are cached by
context hash for retry. These boundaries are internal implementation details.

Synthetic checks exercise a 2,000-entry editorial inventory and a 102-bundle
queue, preserving all inventory entries and bundle members. They also verify
that classification retries reuse completed responses. Portable-link JavaScript
checks passed all five cases, including matching hashed API identities without
disclosing host paths through that API.

The previous full guarded Python run reported 1,062 passed, two skipped and
three failures: a browser fixture still performing agent-owned filing, a stale
compiled controls bundle and a deployment-specific default author. The fixture
and author have since changed. The latest focused host run passed 122 tests and
failed the API-path integration check because the synthetic inbox run produced
no completion report. Inspection found an unrelated coverage-file change in
fixture setup; moving the initial fixture commit after setup did not make that
integration check pass (three tests passed, one failed on retry). The remaining
failure needs diagnosis. This checkpoint still needs the full guarded chain on
a stable candidate; it does not claim a green full suite.

Remaining acceptance work includes rebuilding controls and the Obsidian plugin,
updating browser expectations for the structured intake report, browser proof of
portable links and assets, and testing empty-inbox recovery in the Obsidian UI.
Review partitioning of unusually large shared provenance/context as well as file
inventories. The model's excerpt coverage remains bounded and explicit; automatic
partitioning does not establish full reading of every source.

Library-wide repair application, installed skill activation, service deployment,
and landing remain unfinished. Original documents and receipt bundles must
remain unchanged during that work. The proposal's earlier inbox delivery is
separate from its filing.
