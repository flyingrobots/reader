# Writing about an article

**Write about this**, **Space a** and `:write-about` ask a configured voice for an open question about the current Markdown or plain-text article. **Space w** retains its existing Scratch shortcut. Historical text, inbox previews, PDFs and the static demo are excluded from live generation.

Opening the dialog asks at once: the default voice's cached question for this edition appears, or one is generated, shown as a running line while the voice thinks. The question is a message from that voice, built from shadcn AI Elements patterns (Trace, Message, Prompt Input, Model Selector). The voice menu on the answer field switches voices and asks the newly chosen voice if it has no question yet; a failed generation is not retried automatically. **Show me in the text** highlights a verified passage. Type an opening in the answer field and press Enter (Shift+Enter for a new line) or **Write a response**: the existing Scratch editor opens with the question at the top of the editor pane (a shadcn Collapsible, open by default, so both panes keep the full height), and the opening starts the draft or is appended to the matching existing draft (within the 64 KiB Scratch limit). It retains Vim commands, live preview, responsive layouts and IndexedDB autosave. Reopening the same question resumes the matching participant's draft on that device. Drafts never enter question-generation requests.

When the question dialog finishes closing into Scratch, keyboard focus remains in the response editor. Other closes return focus to the reading page.

If browser storage is unavailable or full, the response still opens in memory and shows **Not saved on this device**. The current draft can be reopened through its question in the same page and explicitly saved to the vault. Save or copy it before reloading, closing the page or replacing the active buffer; this fallback is not durable autosave.

## Saving and replies

Only an explicit save writes the response to `library/notebook/`. The author comes from the vault's Git configuration, with participant attribution recorded separately. Prompted responses use the current versioned metadata profile and block YAML: title, creation date, revision, source article and exact digest, prompt ID, generating voice, question, quote and source evidence. A reply request also records its chat path.

**Save and ask for a reply** saves the response and opens a real chat on the source article. Its first message is the preserved question attributed to its voice; the second is the participant's saved answer with a mention of that voice. The response uses ordinary chat authority and supervision. Saving alone does not send the answer to a provider.

Editing in Scratch creates the next `.vN.md`, links `previous_version` and preserves earlier bytes. Prompt provenance remains tied to the edition that prompted the response. Free writing retains existing Scratch behavior. Commits cover only the saved file, with `Reader-Writing`, `Reader-Participant` and, for prompted responses, `Reader-Prompt-Voice` trailers. A commit failure remains distinct from successful publication. A failed reply handoff returns `reply_error` while preserving the writing.

## Generation and discovery

Generation is a `prompt` job on the existing voice queue. Input includes the article and at most 20 threads as fenced data, each with its quote and at most three recent comments with bounded excerpts. Existing timeout, capacity, process supervision, recovery, raw logging and commit coordination apply. There is no new spending cap or filesystem sandbox.

Plain-text articles omit discussion context because passage annotations currently support Markdown only.

Questions contain at most 400 characters, with quotes at most 600. Reader recomputes Unicode offsets and rejects ambiguous locations. An invalid quote removes the passage link while preserving the question. Exact location does not establish semantic correctness.

Immutable questions live at `prompts/<article SHA-256>/<voice-name SHA-256>-<prompt UUID>.json`. The latest matching edition and voice is the cache. **Ask something else** creates a new file and preserves earlier questions. Two tabs can share pending generation. A source change during generation refuses publication under the wrong digest. Raw logs use `logs/llm/prompt/`.

Lookups filter edition, voice and question ID from the stored paths before decoding candidate payloads. Unrelated payload corruption outside those filters does not disable the requested lookup; matching records still require valid identity and schema.

Reading-log links show the current participant's responses. Margin pins appear where response evidence can be located in the current article. The homepage's **Your writing** lists up to ten recent notebook pieces directly, including those not yet indexed. Collection and browse indexes remain librarian maintenance. Participant labels are local attribution, not authenticated identity.

## API, limits and recovery

Writes require the existing same-origin Reader token and JSON content type.

Prompt, notebook and reading-log GETs share the existing expensive-request pool. Public runtime metadata uses host-path redaction; canonical question archives retain their original values. Prompt inventory discovery ignores hidden OS/editor metadata without removing it.

| Route | Behavior |
| --- | --- |
| `GET /api/prompt?path=&participant=&voice=&task=` | Cached question or `prompt: null`, voice selection and participant-owned task state |
| `POST /api/prompt` | `action: generate`, `path`, optional `voice`, UUID `request_id`, optional boolean `regenerate` |
| `GET /api/writing?participant=&responds_to=` | Participant-owned pieces, optionally restricted to an article |
| `POST /api/writing` | Existing `save` fields plus optional `prompt_id` and boolean `ask_reply`; `revise` requires `base` |

Prompt files are limited to 16 KiB and 5,000 records. Source text has the shared 4 MiB limit. Notebook bodies retain the 64 KiB limit; listing refuses more than 5,000 files. A requested reply must fit the chat message limit after adding the voice mention.

Notebook discovery skips individual unreadable, malformed, oversized or symlinked pieces without changing them. An unsafe notebook root or excessive total inventory still refuses discovery.

Save request UUIDs bind a content/participant fingerprint. `.reader/writing-requests/` retains at most 5,000 records of at most 128 KiB each. A plan is recorded atomically before publication. An interrupted retry verifies any existing destination's digest and resumes the same save. Completed identical requests return their earlier result across restarts; changed input with the same ID is refused. Preserve the journal during recovery. Cooperating locks and atomic files do not provide a multi-file transaction or a physical power-loss guarantee.

## Verification

Run `tests/test_prompts.py`, existing `tests/test_writing.py`, web typechecking and production builds in bounded copy-isolated Docker workers. `tests/web_writing_prompt.cjs` uses fake voices and the synthetic `tests/quiz_fixture.py` to verify generation, evidence links, Scratch reload, saves, reading-log/home discovery, pins, preserved revisions, reply chat and a 390-pixel viewport. Fake output verifies plumbing, not the quality of real questions.

`tests/web_prompt_storage.cjs` verifies blocked IndexedDB and quota failures, current-buffer recovery within the same page, and explicit vault saves with prompt provenance.
