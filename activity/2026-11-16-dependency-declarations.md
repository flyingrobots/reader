# Declare Reader's runtime dependencies

[Issue #160](https://github.com/flyingrobots/reader/issues/160) asks for Reader's direct NumPy use to be declared and for FontTools to be removed only if unused. Work started from main `b7d29fd` in [PR #265](https://github.com/flyingrobots/reader/pull/265). The accepted issue body has SHA-256 `e8619b275f798ad53f4611b0029e3415a55748d6836bfb88c034868b9575a2b0`.

## Outcome and scope

Declare NumPy with a range compatible with the existing FastEmbed requirement and locked versions. Keep supported Python versions and resolved package versions unchanged. Correct the dependency inventory's stale descriptions.

FontTools remains necessary: installed pypdf 6.21.4 imports `fontTools.cffLib.CFFFontSet` to decode embedded CFF Type1 fonts, and its package metadata exposes a `fonts` extra. The current `scripts/generate_circle_mark.py` also imports FontTools directly, so the issue's original empty-import premise is stale. Preserve the current PDF capability and document why the existing explicit dependency remains.

No production algorithm, live installation, model download, vault content or unrelated dependency upgrade is in scope. The safe intermediate state is the currently working environment; this change makes its requirements explicit.

## Planned checks

1. Capture the current inventory's undeclared NumPy row and package metadata as RED evidence.
2. Update the declaration and lock without changing resolved versions. Produce a fresh inventory and check the dependency rows and descriptions.
3. Sync an isolated environment from the lock, run existing affected Python tests and the full suite under the test jail, and retain any pre-existing failure evidence separately.
4. Build and retain wheel/source artifacts; verify their metadata and import the installed wheel outside the source checkout.
5. Push progress, complete CI and review, then mark ready and merge only when the applicable gates are clean.

## Results and boundaries

The RED metadata check found no NumPy requirement and failed with `Reader directly imports NumPy but its install metadata does not declare it`. The unchanged inventory reported `numpy | no (transitive)`. After declaring `numpy>=1.21,<3`, the inventory reports `yes`; its NumPy and FontTools descriptions now match the inspected uses. Only the affected dependency rows were refreshed in the maintained surface inventory.

FastEmbed 0.9.1 already requires NumPy with Python-specific minimums. The explicit requirement preserves those constraints and adds a major-version ceiling. `uv lock` changed only Reader's NumPy dependency edges and metadata; all **63 resolved package name/version/source triples are unchanged**. The lock retains NumPy 2.4.6 for Python below 3.12 and 2.5.3 for Python 3.12 and later. Other allowed NumPy versions were not tested.

Using uv 0.13.8 and Python 3.14.7, a fresh noneditable `uv sync --locked --offline --no-editable` installed 59 packages. Existing search, search-page, index-scale, related-work and shape tests passed **71 tests** in Reader's test jail with those dependencies. The unchanged art suite passed **23 tests** separately. No live vault, model or service was used.

`uv build --offline` built the wheel from its source distribution. The retained wheel's metadata includes both NumPy and FontTools. After installing that exact wheel outside the source checkout, an isolated Python process imported all five direct NumPy users, imported the FontTools CFF decoder, and verified a NumPy dot product. This checks installed-package imports and metadata; the repository pytest harness deliberately pins source code to the checkout, so its 71 cases are not installed-wheel tests.

| Retained artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `reader_library-0.1.0.tar.gz` | 13051932 | `94535432a6af339591da52d4e04b2715208e1bfbfd7724f2e2f94ea1cb6d5455` |
| `reader_library-0.1.0-py3-none-any.whl` | 5487318 | `f0ca561511fd8703421daad3549a332bba1ce01e2c2dd688622f6151f8813f92` |

These are local verification artifacts, not a release. Their source predates this final activity-record update; application code and package metadata are the tested bytes.

## Failed validation attempts

The first offline lock attempt lacked registry metadata in the reused cache. An explicit online lock refresh succeeded without version changes; subsequent installation and builds were offline. An initial source build detected an accidentally included verification environment with an absolute interpreter symlink. That environment was moved outside the checkout before the successful retained build.

A full local pytest attempt under an additional CPU wrapper was invalid: Reader's fake CLI requested its own CPU limit above that wrapper's hard ceiling. A focused reproduction established that cause, while the same 23 art tests passed in the repository jail. Another full-suite attempt reached its 90-second jail deadline before completion. Neither is claimed as a full-suite pass; the complete repository CI remains required.

Interrupting the extra outer wrapper also exposed a process-custody gap: the separately grouped pytest process survived its parent. The exact owned group was stopped and its absence verified. During that run, a coding fixture's unconditional post-probe code staged 800 synthetic files in this isolated checkout. Their bytes and staged patch were preserved, their index entries removed, and the files moved to owned evidence storage; HEAD did not change. These independent defects are tracked in [#266](https://github.com/flyingrobots/reader/issues/266) and [#267](https://github.com/flyingrobots/reader/issues/267). No fixture additions are in this PR.

This is a dependency/configuration and documentation change; it adds no new application test. The existing inventory and package artifact are the direct verification boundaries. This agent-written record has not received human editorial review.
