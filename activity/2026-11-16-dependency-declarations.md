# Declare Reader's runtime dependencies

[Issue #160](https://github.com/flyingrobots/reader/issues/160) asks for Reader's direct NumPy use to be declared and for FontTools to be removed only if unused. This plan starts from main `b7d29fd`. The accepted issue body has SHA-256 `e8619b275f798ad53f4611b0029e3415a55748d6836bfb88c034868b9575a2b0`.

## Outcome and scope

Declare NumPy with a range compatible with the existing FastEmbed requirement and locked versions. Keep supported Python versions and resolved package versions unchanged. Correct the dependency inventory's stale descriptions.

FontTools remains necessary: installed pypdf 6.21.4 imports `fontTools.cffLib.CFFFontSet` to decode embedded CFF Type1 fonts, and its package metadata exposes a `fonts` extra. Reader's own lack of a direct import is not evidence that this transitive feature is unused. Preserve the current PDF capability and document why the existing explicit dependency remains.

No production algorithm, live installation, model download, vault content or unrelated dependency upgrade is in scope. The safe intermediate state is the currently working environment; this change makes its requirements explicit.

## Verification plan

1. Capture the current inventory's undeclared NumPy row and package metadata as RED evidence.
2. Update the declaration and lock without changing resolved versions. Produce a fresh inventory and check the dependency rows and descriptions.
3. Sync an isolated environment from the lock, run existing affected Python tests and the full suite under the test jail, and retain any pre-existing failure evidence separately.
4. Build and retain wheel/source artifacts; verify their metadata and import the installed wheel outside the source checkout.
5. Push progress, complete CI and review, then mark ready and merge only when the applicable gates are clean.

This is a dependency/configuration and documentation change; it adds no new application test. The existing inventory and package artifact are the direct verification boundaries. This agent-written plan has not received human editorial review.
