# Writing-prompt validation

The RW-16 change reuses Scratch, the voice queue and notebook versioning rather than adding a separate editor. It uses Space a because Space w already belongs to Scratch. Source reading, prompt generation and saving remain separate actions; a provider receives the draft answer only after an explicit reply request.

## Checks on 2026-10-26

The focused prompt, notebook and shared quiz-queue suite passed 33 tests in copy-isolated Docker. Coverage includes immutable question alternatives, per-voice/edition caching, invalid quote handling, fenced discussion, valid response metadata, preserved revisions, scoped commits, saved request replay across restart, interrupted-publication recovery and chat handoff. A new legacy-notebook discovery check initially failed because strict metadata interpretation hid older Scratch files; discovery now reads preserved source fields without rewriting those files, and the regression passed.

TypeScript checking and the production web build passed. The browser test passed source highlighting, Scratch draft reload, explicit save, reading-log/home links, a margin pin, a preserved second version, reply chat and phone-width layout. The material and voice outputs were synthetic. No real prompt-quality claim follows from these fixtures.

The checks used the existing bounded Reader Node worker: read-only root, no host mounts, 3 GiB and 512 MiB tmpfs filesystems, four CPUs, 6 GiB memory and a 600-second watchdog. The first passing browser flow used about 670 MiB in `/work`; the latest focused backend run used about 191 MiB. Host and Docker backing storage remained above 500 GiB free.

## Remaining gates

These checks precede final integration of the quiz PR and current main. Complete-suite and integrated browser validation, current-head CI and an independent Code Lawyer review remain required. This is a development checkpoint, not a merge announcement.

## Shared review corrections

The quiz branch's published review fixes were merged normally into this separate worktree. A matching prompt-store regression showed that OS/editor dotfiles disabled prompt discovery; ignoring hidden entries without altering their bytes made all 12 prompt tests pass (`prompt-dotfiles-red` / `prompt-dotfiles-green`, bounded Docker).

A public prompt-runtime regression reproduced a host path in the voice version. The existing display redaction now applies to the public runtime copy, while the immutable archive remains byte-identical. All 13 prompt tests passed (`prompt-runtime-red` / `prompt-runtime-green`).

The prompt and notebook GET routes now share expensive-request admission because each scans its bounded inventory. The route regression was RED before classification; the refusal and ordinary-read availability checks both passed afterward (`prompt-admission-red` / `prompt-admission-green`).
