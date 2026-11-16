# Link preview recovery verification

[PR #261](https://github.com/flyingrobots/reader/pull/261) fixes [#136](https://github.com/flyingrobots/reader/issues/136): after a transient resolve or preview failure, the next hover, focus or K can retry without reloading the page. The accepted issue body has SHA-256 `5932fd4f58a5fa32cd5b247cff48e52392d3d0ecaf655cd997a7b546ef95819b`; the initial plan commit was `1823588`, based on main `ab5c9b3`.

## Decision

The old cache retained every promise after its rejection became a missing-preview result. A 429 or dropped connection therefore looked like a permanent missing document for the rest of the page load. The API already preserves numeric HTTP status, so the fix keeps successful previews and actual 404 responses cached while removing other failed entries. No error-message matching is involved.

Removal checks that the cache still holds this request's promise. Without that check, an old request evicted by the 200-link bound could later fail and erase a replacement for the same link. The existing display token separately prevents old results from replacing the visible preview. The first error still appears with its reason; there is no automatic retry loop.

## RED and GREEN

The new browser suite uses the real synthetic Reader fixture and HTTP boundary for four transient cases: 429 and network failure, each at resolve and preview. Every case was observed failing on the unchanged production code at `1823588`: after the next K, the expected document title never appeared. Successful and genuine 404 cache retention passed. An initial harness draft incorrectly assumed Escape preserved link focus; its failures were excluded from the evidence after changing the reopening action to focus.

```sh
python3 scripts/test_jail.py --timeout 90 -- node tests/web_link_preview_retry.cjs
python3 scripts/test_jail.py --timeout 120 -- node tests/web_links.cjs
python3 scripts/test_jail.py --timeout 60 -- .venv/bin/python -m pytest -q tests/test_ui_debt.py tests/test_jail_guard.py
```

After the fix, all eight new tests passed. The complete existing links browser suite also passed, including previews, navigation, selection, phone layout, two-page placement, local-only assets and the Link graph refresh result of 20 links with one unresolved link. The UI debt and jail-guard selection passed seven tests.

The eighth new test calls the public `installLinks` interface in a browser page with a controlled API port. Its explicit schedule holds the first request, fills the bounded cache with external links, completes a replacement, then rejects the old request. This avoids timing races and private-cache inspection. Real HTTP error propagation is covered by the other seven cases.

Four temporary production mutations calibrated the assertions, and the source was restored byte-for-byte after each:

- Removing eviction ownership produced three requests instead of two.
- Evicting 404 entries made both resolve and preview cases issue two requests instead of one.
- Bypassing the cache made the success case issue two requests instead of one.
- Removing display ownership caused the old error to appear in the rendered history.

Ten further runs passed all eight tests, in parallel pairs with randomized ordering. Seeds were 13601–13609 and the externally generated seed 1937831092. For example:

```sh
python3 scripts/test_jail.py --timeout 90 -- node --test --test-randomize --test-random-seed=1937831092 tests/web_link_preview_retry.cjs
```

These checks used Node v26.13.1, Python 3.14.7, installed Chrome, synthetic files and the macOS test sandbox. They did not access a private vault or deploy Reader. Browser cases run through the local browser runner; the existing CI workflow separately checks Python, contracts, Node and the frontend build. Exact-head CI and review remain live PR gates. This record is agent-written and has not received human editorial review.
