# Shared highlights and discussion

Reader supports attributed highlights and comment threads on Markdown library documents. Source bytes remain unchanged. Each thread is a standalone version-1 JSON file under `annotations/`, with its quote, context, source hash, owner, comments, reply-parent IDs, revision, resolved state, and optional `kind` (`highlight` or `warning`). Older records without `kind` remain ordinary highlights. Commit or back up these files with the vault; they are not disposable `.reader/` cache. Participant names identify authors but are not authenticated accounts.

## In Obsidian

Select source text, then right-click and choose **Highlight and comment in Reader** in the editor or reading view. The action appears only for a nonempty selection in a Markdown library document. The command **Reader: Highlight selection and comment** is also available. Reading-view selections must match a unique, exact source passage; use the editor for repeated or formatted passages. Add an optional opening comment and save. **Settings → Reader → Your annotation name** sets your participant label; the default is “You.” Agents use their own names.

Unresolved highlights have an inline background and an adjacent comment icon. Hover displays the owner; the keyboard-focusable icon identifies the owner and opens the thread in Reader. Your highlights use the theme's highlight background. Other participants use its success background and dotted underlining, with explicit owner names in the thread. Overlapping editor highlights retain separate comment buttons and threads.

The sidebar shows the original quote, attributed comments, timestamps, and reply relationships. **Reply** selects a parent; **Post reply** adds your text. **Resolve thread** hides the inline decoration while preserving the discussion; **Reopen thread** restores it. External CLI/MCP replies refresh through vault file events. Draft reply text survives view rerenders during the current sidebar session.

Editor selection supports exact raw Markdown ranges. Plain reading-view selections work when the selected text occurs once verbatim in the source; otherwise select it in the editor. Reading-view rendering currently decorates verbatim quotes contained in a rendered section; formatted or multi-section selections can remain visible in the thread without a reading-view decoration. Use the editor for exact inline coverage in those cases. PDF and non-Markdown annotations are not yet supported. Save edits before creating a new annotation; stale selections are rejected.

## Comment composition

The selection dialog focuses the initial comment field. Cancel closes it without saving; Cmd/Ctrl+Enter activates Save. Clicking an inline highlight or comment icon opens Discussion and focuses its reply composer. **Reply** targets a specific parent comment and shows that context above the input. **Post reply** or Cmd/Ctrl+Enter submits it. Draft text and cursor selection survive sidebar receipt refreshes; a failed submission keeps the draft and shows an inline error. Retry reuses the same request ID for the same body and parent. Drafts are session-only and do not survive plugin reloads. **Show passage** returns to the anchored source. Conversation composition takes place beside the document in the sidebar, rather than in a document overlay.

Thread and comment receipts remain visible as compact captions. The thread's **Discussion actions** menu contains manual read/unread overrides; normal opening automatically records seen state. Thread cards, controls, and focus indicators use Obsidian theme tokens. Authorship is labelled and other-owner highlights also use a dotted underline.

## Warning annotations and reflective reading

In the highlight dialog, select **Annotation type → Warning — concern or possible error** and explain the issue before saving. A warning requires a nonempty opening comment. Its passage uses a red wavy underline, a warning icon with an accessible label, and **Warning** in the thread heading. The underline follows the theme's error color; the icon and text preserve its meaning without color. Editor and reading-view anchor limitations are the same as for ordinary highlights.

Warnings are attributed concerns, not automatic findings of fact. A comment should distinguish a question, suspected issue, or demonstrated error and state the evidence and uncertainty. Replies and resolve/reopen work as for other threads; resolution preserves the concern and history. Shared read receipts also apply to warnings. There is no in-place conversion between kinds; add a clarifying reply or a new explicitly linked annotation if the original classification no longer fits.

The installed [Reflective Reading skill](../skills/reflective-reading/SKILL.md) reads in natural sections, pauses to reflect, annotates worthwhile passages, and revisits its notes for changed judgments, unexpected connections, and original writing. It imposes no quota for highlights, warnings, replies, or essays. Its quote helper verifies the exact source hash and a unique verbatim match before creating an annotation. It does not infer full-document reading from offset calculation.

## Read and seen state

Documents, highlights, individual comments, and whole thread versions have separate participant receipts. The sidebar shows unread discussion badges and **Seen by** labels, with automatic acknowledgement when opened in Obsidian and optional manual overrides; agent tools expose the same state but require acknowledgement after actual reading. See [shared read receipts and Upkeep](engagement.md).

## Anchors and changes

Offsets are Unicode code points in raw UTF-8 Markdown, including frontmatter. The source SHA-256 validates an unchanged anchor. After edits, an exactly matching unique quote can be relocated; repeated quotes require matching prefix and suffix context. Ambiguous or missing passages are labelled and receive no guessed inline attachment. The stored quote and replies remain available. A direct document UUID can help locate threads after a path change; preserved originals without such metadata remain path-bound. Do not copy UUIDs across distinct editions. Annotation paths are separate from catalog/source associations: a discussion belongs to the selected edition's actual text.

## Agent tools and CLI

The local MCP server exposes:

- `reader_threads(path)` — list document threads with current anchor status.
- `reader_highlight(path, start, end, owner, comment, expected_sha256, request_id)` — create a highlight and optional opening comment.
- `reader_warning(path, start, end, owner, comment, expected_sha256, request_id)` — create a warning with a required explanatory comment.
- `reader_reply(thread_id, author, body, reply_to, request_id)` — add a comment or reply to an existing comment.
- `reader_resolve_thread(thread_id, resolved, expected_revision)` — change thread state with an optional revision check.

Reuse UUID request IDs on create/reply retries. Resolve conflicts require reloading the current revision. The installed Reader skill describes these operations; restart an MCP client whose tool list predates them. The CLI accepts the same operations through JSON:

```sh
printf '%s\n' '{"operation":"list","path":"library/example/report.md"}' | uv run --locked reader --root "$READER_ROOT" annotate -
uv run --locked reader --root "$READER_ROOT" annotate request.json
```

Annotation JSON operations are `list`, `create`, `reply`, and `resolve`; `create` accepts `kind: "warning"` with a required comment, or defaults to `kind: "highlight"`. Shared receipts add `attention` and `seen` as described in [engagement](engagement.md). Other field names match the corresponding store methods (`path`, `thread_id`, and the other fields above). APIs never interpret comment text as commands or rendered HTML.

## Concurrency, limits, and recovery

Writes serialize through `.reader/annotations.lock` and atomically replace one thread file, preventing concurrent replies from overwriting one another. An annotation thread is at most 1 MiB and 1,000 comments; the inventory is at most 5,000 threads. Source Markdown is limited to 4 MiB, selected quotes/comments to 16,000 characters, and owner labels to 100 characters. Oversized, malformed, missing, or unsupported inputs report errors without editing sources. The Obsidian bridge has a 15-second timeout and an 8 MiB response limit; unusually large discussion inventories may require narrower future retrieval support.

If a thread fails to load, preserve its JSON and inspect the reported error; do not delete it as a cache repair. The Markdown document remains independently readable. Recover annotation JSON through Git or backups. A crash can leave an uncommitted `.thread-*` temporary file; inspect it before removing it. File publication is atomic but is not a full power-loss transaction or multi-user authentication service.

Run `uv run --locked pytest -q tests/test_annotations.py tests/test_delivery.py` for preservation, Unicode offsets, retries, concurrent replies, parent validation, revision conflicts, anchor relocation/orphaning, and MCP calls. Run the plugin checks and live editor/reading-view acceptance from [plugin verification](obsidian-plugin.md#verification-and-recovery).

With Obsidian open in this vault, `python3 plugins/reader/tests/live/warning-check.py` exercises warning creation, rendering, and resolution using disposable fixtures. `python3 plugins/reader/tests/live/engagement.py` exercises shared acknowledgement and new-reply state. These checks restore their temporary participants and remove their fixtures.
