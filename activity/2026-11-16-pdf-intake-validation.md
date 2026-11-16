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
