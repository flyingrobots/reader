# Companion attachment rendering — 2026-11-01

Delivery already preserves explicitly supplied companion files and their relative
paths when a whole bundle is filed. The web reader treated HTML as source text
and attempted UTF-8 decoding of binary attachments. The repair adds an isolated
interactive HTML preview, a path-based resource route and byte-preserving
downloads. Original documents and delivery receipts remain unchanged. No asset
relocation, new dependency, source-link rewriting or live service change is part
of this patch.

The preview permits inline and sibling classic scripts, styles and images while
denying parent access, browser storage, forms, popups and API fetches. JavaScript
modules and fetch-based data loading remain unsupported. Raw HTML stays inert.

## Verification

- Before the repair, all five new Python attachment cases failed: HTML had no
  preview, binary files failed or returned unusable text, and the attachment route
  was absent.
- After the repair, 97 tests passed across `test_web_attachments.py`,
  `test_web.py`, `test_delivery.py`, `test_links.py` and `test_api_paths.py`.
  The delivery case files a synthetic bundle and verifies `filed` and
  `integrity: intact`, including unchanged receipt bytes.
- `web_attachments.cjs` passed: filed and inbox navigation, sibling scripts/CSS/SVG,
  HTML fragments and sibling pages, code/JSON views, exact-byte downloads, mobile
  width and opaque-origin isolation in both embedded and direct HTML views.
- `web_source.cjs` passed, retaining source links, raw bytes, keyboard access and
  mobile behavior.
- Ten repository path-hygiene tests passed. JavaScript syntax checks and
  `git diff --check` passed.
- `web_links.cjs` passed its link navigation, previews and layout checks, then
  failed the existing Admin-card assertion at line 121: it expects `Links20`, but
  the current card reads `Link graphCurrentRefresh`. The identical failure was
  reproduced with the unchanged `origin/main` backend, assets and fixture at
  `bb544f59`. The unrelated assertion is left unchanged.

Run the Python cases with the configured test environment. Browser suites use
the standard `READER_PYTHON`, `READER_PLAYWRIGHT` and `READER_CHROME` overrides.
Only synthetic fixtures enter repository tests. Test data and logs remained below
15 MiB, plus less than 1 MiB of local screenshots; no build caches were created.
