# Design sheet: Write about this (writing prompt)

The dialog opens from an article. Source: `web/src/writing-prompt.tsx`.

## Focused activity

**Get one good question about the article, then start writing your answer.** A voice asks a question tied to a verified passage. *Show me in the text* finds it, and *Write a response* opens Scratch with the question attached.

## Composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Dialog`, `Select`, `Button`, `Skeleton` |
| Molecules | `Field` (voice), the question as a `figure` (author caption and the question as a serif blockquote), `Notice` (no voice, errors, a failed commit), `LoadingState` (waiting for a voice) |

## Test hooks

`[data-reader-writing-prompt]`, `#writing-prompt-voice`, `[data-writing-question]`.
