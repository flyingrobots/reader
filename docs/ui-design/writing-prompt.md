# Design sheet: Write about this (writing prompt)

The dialog opens from an article. Source: `web/src/writing-prompt.tsx`, rebuilt as an AI Elements composer (InputGroup, Message and Trace).

## Focused activity

**Get one good question about the article, then start writing your answer.** Ask a voice at once, read its question with its passage evidence, and open Scratch with the question attached, where it appears as a collapsible above the editor (`web/src/scratch-question.tsx`).

## Composition

| Tier | Parts |
| --- | --- |
| Atoms (shadcn) | `Dialog`, `DropdownMenu` (voice), `InputGroup`, `Button`, `Skeleton` |
| Chat primitives (shadcn) | `Message` (the question) and `Trace` (its evidence) |
| Molecules | `Notice` (no voice, a failed commit) |

## Test hooks

`[data-reader-writing-prompt]` and the composer's `data-slot` parts.
