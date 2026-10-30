# Design sheet: Test yourself (quiz)

The dialog opens from an article. Source: `web/src/quiz.tsx`, built on shadcn's Questionnaire (`web/src/components/ui/questionnaire.tsx`, from `@shadcn/react`); state lives in the quiz controller.

## Focused activity

**Check what you took from the article, with the passages behind each answer.** Choose a voice and a difficulty, answer one question at a time (multiple choice is marked locally as you go; an optional short answer can be reviewed by the voice), and jump to the evidence. The result lists the questions to revisit.

## Composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Dialog`, `Select`, `Slider` (difficulty), `Textarea`, `Button`, `Badge`, `Progress`, `Skeleton`, `Collapsible`, `CodeBlock` |
| Organisms (shadcn) | `Questionnaire` with its items, choices, progress, error and navigation parts |
| Molecules | `Field` and `FieldDescription` (voice, difficulty hint), `Notice` (errors, earlier edition, unlocatable questions, and per-question feedback: Correct, or the saved answer with its reason), `LoadingState` (generating or reviewing) |

The running score, the result score and the choice marks keep the dialog's own `reader-quiz-*` styles from the Questionnaire rebuild.

## Test hooks

`[data-reader-quiz]`, `#quiz-voice`, `[data-quiz-feedback]`, `[data-quiz-task-details]`, and the Questionnaire's `data-slot` parts.
