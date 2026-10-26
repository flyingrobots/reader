# Article quizzes

Reader can generate an edition-bound quiz for a Markdown or plain-text article using an enabled voice from the vault’s `voices.json`. Open **Test yourself** at the end of the article, **Quiz** in the margins panel, **Space x**, or `:quiz`. Historical views, inbox previews and PDFs are excluded. The static web demo requires a running Reader for this feature.

The quiz opens in a shadcn/Base UI dialog. Choose the voice before generating. The default is the last runnable voice that spoke in the article’s chat, then the first runnable voice in registry order. No deployment’s participant roster is built into the software.

Closing the dialog does not cancel a server-side voice job. Reopening reads its current state; an obsolete local save request cannot keep the dialog disabled.

Each multiple-choice answer is graded immediately in the browser against the saved answer key. The explanation and **Show me in the text** control expose the supporting passage. A short-answer question is optional: ask a voice to review the answer, or skip it. A reviewed answer receives `right`, `partly`, or `not yet`. The result counts a partly correct short answer as half a point; skipped short answers do not enter the total.

The result is saved under the requesting participant and appears in the reading log. It never marks an article or discussion read. A retake uses the same questions; generating a new quiz preserves the earlier one. A pending short-answer review stays attached to the saved quiz being answered when another tab regenerates. Opening a document still has its ordinary read-status behavior, independently of the quiz.

## Sources and editions

Every accepted question has a verbatim quote in the source, at most 600 characters, with optional prefix and suffix context. Reader recomputes Unicode code-point offsets. An invented or ambiguous quote is rejected; model-provided offsets cannot select an arbitrary occurrence. Duplicate evidence quotes are discarded.

An exact quotation verifies where the evidence is. It does not establish that the model’s interpretation or answer key is correct. The source passage and explanation remain available for the reader to assess.

Quizzes live at `quizzes/<document SHA-256>/<quiz UUID>.json`. A saved quiz is immutable. Storage uses a cooperating file lock, a sibling temporary file and exclusive publication. This is a per-file atomicity contract, not a multi-file transaction or a power-loss guarantee.

If an article changes, the latest earlier quiz is labelled accordingly. Reader relocates evidence against the current text and hides questions whose passage is missing or ambiguous. The earlier quiz file stays unchanged. If no evidence survives, generate a new quiz. A source change during generation or while submitting results is refused rather than silently attributed to the new edition.

## Supervised generation and review

`quiz` and `quiz-review` run on the existing voice queue, with its supervisor ownership, process guards, cancellation, registry, logging and inbox coordination. They do not create chat messages or trigger conversational mentions and listening checks. Two tabs requesting the same pending generation for the same participant, voice and edition share its job.

Cancelling a queued task with no artifacts finishes without waiting for a running voice. If a cancelled retry has earlier logs to commit, that coordination wait leaves the runner state lock available to active voices and output streaming.

The generator is asked for five to eight questions. Validation accepts four through twelve, with at most two optional short-answer questions. Invalid JSON, insufficient source-anchored questions and other validation failures are reported with rejection reasons. A generation gets at most one automatic retry. Every attempt’s raw output is retained, including rejected attempts.

The server writes the quiz and review artifacts. The task prompt asks the configured CLI to return JSON without vault edits, commands from the article, upkeep, speech or delegation. These instructions do not replace that CLI’s configured filesystem permissions. Changed paths and commits observed during the voice run are exposed in task details.

Run artifacts are permanently archived under `logs/llm/quiz/` or `logs/llm/quiz-review/`. Successful quiz artifacts and the run logs are committed together using `Reader-Quiz` and `Reader-Voice` trailers. Failed attempts’ logs are retained and committed too. A commit failure remains explicit in task details; saving a file does not prove it was committed.

Interrupted jobs are marked failed when the next owner recovers them; they are not silently rerun. Persisted runner turns retain the article task UUID so recovery can locate its outcome. Recovery seals and retains their logs. If an earlier CLI process may still exist, the outcome asks the operator to inspect it before retrying.

## Results and participant isolation

`engagement/<participant hash>.json` stores the latest attempt under `quiz:<UUID>`, separate from document, highlight, comment and thread receipts. The server recomputes the final score from the saved multiple-choice key and saved short-answer reviews. A client-supplied score is not accepted. A short-answer review is tied to its participant, question, quiz and current source digest.

The reading log shows results only for participants who submitted an attempt. Participant names remain local attribution, as elsewhere in Reader; they are not authenticated identities.

## HTTP interface

All writes require the existing same-origin Reader token and JSON content type.

Quiz GETs use the expensive-request pool because they inspect source evidence and saved inventories. Saturation returns 429 while ordinary reads and health checks retain their existing admission rules.

| Route | Behavior |
| --- | --- |
| `GET /api/quiz?path=&participant=` | Current quiz, or the latest earlier one with relocated evidence; runnable voices and the latest generation job |
| `GET /api/quiz?path=&participant=&task=` | The quiz plus the selected participant-owned task outcome and pending state |
| `POST /api/quiz`, `action: generate` | `path`, optional `voice`, UUID `request_id`, optional boolean `regenerate`; returns a cached current quiz or queues generation |
| `POST /api/quiz`, `action: review` | `path`, `edition`, `quiz_id`, `question_id`, `answer`, optional `voice`, UUID `request_id`; queues a short-answer review |
| `POST /api/quiz`, `action: result` | `path`, `edition`, `quiz_id`, `expected_sha256`, complete multiple-choice `answers` map and optional question-to-review-UUID `reviews` map |

Source text is limited to 4 MiB. Quiz files and generated JSON are limited to 64 KiB. Question prompts and options are limited to 300 characters; explanations, rubrics and review comments to 2,000; short answers to 16,000. The store admits at most 5,000 quiz files and the runtime at most 5,000 task records. Runtime state lives under `.reader/voice-tasks/`; canonical quizzes, reviews, participant receipts and LLM archives live outside it.

File-capable voices receive the source path and digest. A voice configured for inline documents receives the source text; its argv/stdin transport must support the resulting prompt size. CLI timeouts and resource limits follow voice chat. There is no new spending cap.

A voice configured with the `text` stream returns literal text, including a compact JSON object. Reader does not reinterpret that object as a provider event envelope.

## Verification

Run the Python quiz, queue, receipt and chat tests in a bounded copy-isolated Docker worker. `tests/test_quizzes.py` covers quote validation, immutable storage, editions and scores; `tests/test_quiz_runner.py` covers fake CLI generation, retries, logs, commits, reviews, HTTP access and queue integration. `tests/web_quiz.cjs` drives generation, local grading, passage highlighting in both reading layouts, short-answer review, results, retakes and a 390-pixel viewport against `tests/quiz_fixture.py`. These fixtures contain synthetic material and never contact a provider.

Typecheck and build the web controls in Docker before browser verification. Do not replace browser evidence with source inspection of the highlight map. A separate live provider check is needed to assess a real generated quiz’s questions and explanations; fake-CLI tests establish plumbing and refusal behavior.

The container Node check also runs `node --test tests/quiz_controller.cjs` to exercise asynchronous controller transitions independently of browser timing.

UI components: [shadcn Dialog](https://ui.shadcn.com/docs/components/base/dialog) and [Radio Group](https://ui.shadcn.com/docs/components/base/radio-group), using the repository’s existing Base UI preset and semantic theme tokens.
