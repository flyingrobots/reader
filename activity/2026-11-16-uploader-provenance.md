# Uploader provenance boundary verification

The fix for [Reader #255](https://github.com/flyingrobots/reader/issues/255) refuses caller-supplied `provenance.uploaded_by` through MCP and CLI before publishing a receipt. Authenticated web uploads retain the server-established identity and its retry fingerprint. This is a bug fix, verified on 2026-11-16 in [PR #260](https://github.com/flyingrobots/reader/pull/260).

## Decision and scope

`Submission.provenance` describes caller input. It no longer has an uploader field. The upload handler passes its authenticated identity separately to `Store.ingest`, where the private receipt model preserves the existing uploader validation and serialization. Existing receipts remain unchanged.

Caller-supplied `privacy` remains supported: local agents may choose `no-cloud` to restrict filing to local models. The delivery contract now states this explicitly. No authentication, filing, source content or historical receipt is rewritten by this change.

The accepted issue body had SHA-256 `a304c970e991e7851b7ff292d17b12907c98c47940b7f0359dc856867cc93e8f`. The initial plan commit was `a8f3344b4c8a95e8982bc4300aa23e11120803d3`; implementation is `316b6f2`. The completed plan is replaced by this verification record.

## RED and GREEN

The six medium contract tests exercise actual MCP stdio and CLI processes against synthetic vaults. Their specified oracle is issue #255: a caller-selected uploader must be refused without publishing a receipt. The boundary sweep covers a named uploader, an empty string and null at each entry point.

```sh
python3 scripts/test_jail.py --timeout 90 -- node --test --test-name-pattern='caller-chosen uploader' tests/contract/mcp.test.mjs tests/contract/cli.test.mjs
```

On `a8f3344` before the production fix, all six tests failed. MCP returned `{refused: false, receipt: true}` instead of `{refused: true, receipt: false}`; CLI returned status 0 with a receipt instead of status 1 without one. After the fix, all six passed. Ten further runs, using `--test-concurrency=2`, each passed all six cases without skips. Node does not provide test-order randomization here; the two test files ran concurrently.

The input-schema comparison was also observed failing after the production change and before re-recording. The reviewed golden diff removes only the `uploaded_by` property from `mcp-tool-reader_ingest.json`.

## Related validation

```sh
python3 scripts/test_jail.py --timeout 120 -- .venv/bin/python -m pytest -q tests/test_uploads.py tests/test_delivery.py tests/test_delivery_tokens.py
python3 scripts/test_jail.py --timeout 240 -- npm run test:contract
```

The Python selection passed 83 tests, including authenticated uploader identity, upload retry ownership, public upload restrictions and delivery preservation. The complete contract suite passed 155 tests with no skips. The contract run includes the separately verified inbox-shape repair from #208, copied as `a11742e`; it adds the already-shipped `editorial`, `pending_work` and `retained` fields to that unrelated golden.

These runs used Python 3.14.7, Node v26.13.1, the macOS test sandbox, synthetic files and process boundaries. They did not read or change a private vault, deploy Reader, or exercise an external MCP host. CI and review status remain live gates on the PR. This record is agent-written and has not received human editorial review.
