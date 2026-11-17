# PDF editorial context validation — 2026-11-16

This record covers [issue #236](https://github.com/flyingrobots/reader/issues/236).
The baseline is `9cbc7b6`. Source inspection confirmed that `model_context` skips
PDF files, leaving a PDF-only arrival without a reading excerpt. The existing
search helper extracts every page and returns no PDF metadata; it is not an
intake excerpt operation.

The scoped repair will use the existing `pypdf` dependency to supply bounded,
source-labelled text, title and author metadata. It will preserve original bytes
and expose extraction limits and failures. It will not run live intake, invoke
a model, add OCR, or change filing authority.

Validation will use synthetic text, image-only, encrypted and malformed PDFs;
public context and classification boundaries; per-file and aggregate UTF-8 byte
limits; source hashes; and separately calibrated process/resource refusals.
The task remains unfinished until these checks and published-head CI pass.

The initial four executable PDF cases failed because `reading` was empty. The
first implementation passed 58 affected cases in the bounded Linux worker. An
expanded run passed 78 cases: the intake module plus PDF payload/source identity,
page/batch limits and direct-child supervision controls. Each worker was removed
and its exclusive host lock released. Assertion calibration then passed in the bounded worker: each injected fault
(excluded PDFs, stale snapshots, extra pages or files, ignored deadline, UTF-8,
metadata, output, memory, reaping and input-size limits) failed its named test.
The calibration module was temporary and is not retained. Together with the
intake suite, 80 cases passed. Current-head CI remains outstanding.

The implementation chooses a separate single parser child over the existing
search extractor, whose eager whole-document operation would not establish
bounded intake work. The child hashes the same admitted bytes it parses. Text,
title and author share the payload budget; metadata is evidence rather than
verified authorship. Eight attempts and a shared 20-second deadline also bound
empty or malformed batches. The macOS memory limit is sampled, while Linux adds
a hard address-space limit; neither is claimed to be a parser security sandbox.
