# Plain dispatcher field errors

[Issue #164](https://github.com/flyingrobots/reader/issues/164) exposed Python method names and argument-binding diagnostics in HTTP 400 responses. [PR #264](https://github.com/flyingrobots/reader/pull/264) validates public field sets before annotation, chat and quiz-result methods are called. Missing and extra fields now produce plain, deterministic messages without echoing arbitrary request keys.

Work began at main `b7d29fd` with plan commit `9480efb` on 2026-11-16. The accepted issue body has SHA-256 `87b317357a4f3d81d89130d07c11228cbc32e40a07817a59a441cf96d0edc089`. This record replaces the completed task plan.

## Failure and decision

The dispatchers expanded JSON objects into method keyword arguments. Python therefore checked missing or unexpected arguments before the method could validate them; the web boundary returned the exception text to the caller. For example, a quiz `result` request without result fields named `Quizzes.result()` and its required positional arguments.

The repair declares required and optional public fields alongside each dispatch choice. A shared field check reports sorted, trusted names before calling the method. Non-string selectors are rejected before dictionary membership checks. Existing quiz generate/review field checks remain in place, and the result action gains the missing required-field check. Chat and quiz participant identity remains a separate argument; request fields cannot overwrite it within the dispatcher.

This is a field-set contract, not a global sanitization rule for every error string. The issue's `()` and `positional argument` exclusion is checked for missing/extra fields and malformed selectors. Document, ownership and value errors keep their existing messages, including legitimate user content. Catching all `TypeError` exceptions or stripping parentheses globally would conceal unrelated defects or alter that content.

## RED and GREEN evidence

Before production changes, the nine malformed-request HTTP families produced **seven failures and two passing controls**. Annotation selectors and existing quiz extra-field rejection already passed. After the repair, all nine passed: **84 requests** cover 32 missing required fields, 34 extra-field requests in both key orders, and 18 missing/unknown/non-string selectors.

Each rejection checks status 400, exactly one string `error` property, plain guidance, and unchanged hashes and names of every durable fixture file. The comparison excludes `.reader/` runtime files and `.git/` repository internals; it includes annotation, engagement, conversation, quiz and source files. Reversed JSON key order must produce the same guidance. Unknown fields and selectors deliberately contain `()` to detect accidental echoing.

Two successful HTTP protocols bring the new suite to **11 passing tests**. They exercise all annotation operations with optional fields and defaults, preserved source bytes, and chat creation with the server participant, explicit author, reuse, settings and hush. Two Python cases verify successful quiz results with and without optional reviews, complete scores, preserved source bytes and refusal of a dispatcher-level participant override before receipts are written.

The existing annotation, engagement, quiz and chat Python suites passed **83 tests**, with **one existing skip** because the optional `READER_AGY_SAMPLE` fixture was not configured. The full HTTP/CLI contract suite passed **166 tests**, with no skips.

## Calibrated checks

Seventeen temporary source mutations were detected by assertion failures. The original source bytes were restored and their SHA-256 hashes checked before the final passing runs.

| Deliberate faults | Detected by |
| --- | --- |
| Bypass field checks; remove selector type guards | Six missing/extra families; three selector families |
| Remove useful field names; make guidance depend on key order | Three missing-field families; three extra-field families |
| Write a durable file before rejection | Durable file snapshot assertion |
| Change HTTP status; add a response property; make the error an array | Status, exact shape and string assertions |
| Reject optional fields | Successful annotation/chat protocols and the optional quiz case |
| Replace chat participant; discard author; disable reuse | Successful chat protocol |
| Rewrite annotation source bytes | Successful annotation protocol |
| Replace quiz participant; change returned score; rewrite quiz source | Both successful quiz cases |

Ten further HTTP runs passed in parallel pairs with Node's test-order randomization: seeds `16401` through `16409` and externally generated seed `841791408`. These were **110 test executions**. The two quiz cases also passed ten times in parallel pairs, alternating their explicit parameter order, for **20 executions**; those Python repetitions were not randomly shuffled.

## Reproduction and boundary

```sh
python3 scripts/test_jail.py --timeout 120 -- node --test tests/contract/dispatch-fields.test.mjs
python3 scripts/test_jail.py --timeout 120 -- .venv/bin/python -m pytest -q tests/test_annotations.py tests/test_engagement.py tests/test_quizzes.py tests/test_chats.py
python3 scripts/test_jail.py --timeout 240 -- node --test --test-timeout=120000 tests/contract/
```

Local checks used Node v26.13.1 and Python 3.14.7 inside the macOS test sandbox, with synthetic vaults only. No live app, private vault or deployment was involved. The existing CI separately runs the guarded container checks; exact-head CI and review remain live PR gates. System documentation now describes the field-error boundary in the web, annotation and quiz contracts, and the completed #164 item is removed from the port plan.

This verification record is agent-written and has not received human editorial review.
