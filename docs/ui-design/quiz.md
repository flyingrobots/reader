# Design sheet: Test yourself (quiz)

The dialog opens from an article (`:quiz`, or the article's quiz action). Source: `web/src/quiz.tsx`; state lives in the quiz controller.

## Focused activity

**Check what you took from the article, with the passages behind each answer.** Choose a voice to generate questions, answer them one at a time (multiple choice is graded locally; an optional short answer can be reviewed by the voice), and jump to the evidence in the text. The result lists the questions to revisit.

## Composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Dialog`, `Select`, `RadioGroup`, `Textarea`, `Button`, `Skeleton`, `Collapsible`, `CodeBlock` |
| Molecules | `Field`/`FieldSet`/`FieldLegend` (the question and its options), `Notice` (no voice, an earlier edition, unlocatable questions, errors, and per-question feedback: correct, or the saved answer), `LoadingState` (generating or reviewing) |
| Organisms | the score block, and task details in a `Collapsible` `CodeBlock` |

## Test hooks

`[data-reader-quiz]`, `#quiz-voice`, `#quiz-option-<n>`, `#quiz-short`, `[data-quiz-progress]`, `[data-quiz-feedback]`, `[data-quiz-score]`, `[data-quiz-task-details]`.
