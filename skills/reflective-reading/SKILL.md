---
name: reflective-reading
description: Read Reader documents in thoughtful sections, pause to reflect, leave source-anchored highlights or warnings with comments, and revisit notes for connections, changed judgments, and original writing. Use for sustained reading, study, critique, or librarian reading sessions, not a quick fact lookup.
---

# Reflective Reading

Resolve Reader from this installed skill's real path (the parent of `skills/`). Follow its `AGENTS.md`, `docs/operations.md`, and `docs/annotations.md`. The user authorizes local annotations, discussion, and librarian-authored writing during reading. Source text remains unchanged. The companion Reader skill supplies retrieval and exact source reading; Upkeep handles turn-boundary intake and pending discussion. Do not recursively start upkeep workers from this skill.

## Begin with a question, leave room for surprise

Identify the exact work and edition, why you are reading it, and what you currently expect or believe. Skim its structure, existing reading record, and relevant discussion. Resume from a recorded stopping point when appropriate. Note prior judgments you might revise; do not treat an earlier reaction as a verdict to defend.

Read a bounded section at a time: a natural argument, several paragraphs, a subsection, or a handful of pages. Adapt the pace to the material. Pause more often around dense reasoning, unfamiliar notation, emotionally significant scenes, or a surprising claim. Do not turn each pause into a formulaic user-facing report.

At each pause, consider:

- What did this section claim, show, or make me imagine? What support or counterexample did it supply?
- What is interesting, inspiring, beautiful, useful, or unexpectedly connected to something else?
- What troubles me? Is it a demonstrated error, a missing assumption, an unresolved question, or merely unfamiliar terminology?
- Has this changed an earlier expectation? What would help me decide?

Keep concise reading notes with exact locations and your current reasoning. Preserve uncertainties. Continue reading before assuming a later section cannot answer a question. Section notes may be scratch material; a durable reading record must describe actual coverage and remaining gaps. A fetched but truncated response is not a completed read.

## Annotate when there is something to say

Use `reader_threads(path)` first to avoid duplicate comments or to continue a relevant existing thread. Do not manufacture an annotation quota. A passage worth returning to deserves a **highlight with a comment** that explains why, asks a useful question, or sketches a possible connection. Attribute it to your stable identity, normally **Reader librarian**.

Use `reader_highlight(path,start,end,owner,comment,expected_sha256,request_id)` for interesting or inspiring passages. Use **`reader_warning`** with the same arguments and a required comment for a concern, suspected error, unsupported claim, or consequential ambiguity. Warnings render as red wavy underlines with a warning icon and label, and have ordinary discussion/reply/read-receipt behavior.

A warning is a reader's attributed concern, not a declaration that the author is wrong. Explain the precise issue, the evidence or counterexample, your confidence, and what would resolve it. Distinguish **question**, **suspected issue**, and **demonstrated error** in the comment. Do not use warnings just for disagreement or as a substitute for understanding the source. Verify external factual claims when necessary; source criticism and independently checked evidence are separate.

Anchor the smallest passage that still contains the necessary context. Offsets are Unicode code points in full raw Markdown, including frontmatter; end is exclusive. Use the exact source hash, and a UUID reused on retries. If the file changes, reread the relevant context before retrying. Do not calculate raw offsets from rendered Markdown or PDF excerpts.

For an exact quote that appears only once, the installed helper avoids offset mistakes:

```sh
python3 <this-skill>/scripts/annotate_quote.py library/path.md \
  --quote-file <exact-quote.txt> --comment-file <your-comment.txt> \
  --kind highlight --expected-sha256 <source-hash> --request-id <uuid>
```

Use `--kind warning` for a warning. The default owner is `Reader librarian`; `--owner` selects your own stable identity. It checks the hash and unique verbatim quote, then calls Reader's annotation CLI. It refuses ambiguous passages instead of guessing. Preparing a source anchor does not itself establish that the agent read the document.

Inline annotations currently support Markdown only. For PDFs or other formats, use an existing labelled Markdown reading edition when suitable and identify that edition. Otherwise preserve page-linked observations in a reading note; do not promise a red underline on an unsupported format or silently alter the original. Formatted/multi-section passages may require editor view for exact inline display.

## Return to the notes after reading

Review the annotations, comments, unresolved questions, and reading notes together. Look for patterns that were not apparent section by section. Follow promising connections with Reader search and read their source context; matching terminology alone does not establish equivalence or interoperability.

Ask whether an old idea deserves a fresh look, whether two pieces suggest a new possibility, or whether the reading changes a previously held judgment. Keep a speculative combination visibly speculative and describe a useful next question or test. A source's proposal is not authorization to implement it.

When a judgment changes, add a dated follow-up to the earlier thread or writing, linking the new evidence. Preserve the earlier position so the reader can see what changed. Resolve a warning only when the discussion supports that disposition, with an explanation; keep the thread and original concern. Do not silently rewrite the source or history.

An essay, reaction, guide, thought experiment, story, or connection note is welcome when there is a real idea worth developing. There is no required genre or output count. Distinguish source claims, your interpretation, and invention. Give original writing clear authorship and source links, put it in the appropriate library collection, and update catalogs/metadata/activity according to the librarian procedure. Do not produce an essay merely to prove the skill ran.

## Finish with honest coverage

Record what was actually read and what remains: edition, chapters/pages/sections, extracted text versus visual inspection, unresolved questions, and a practical next reading point. Tell the user what mattered, not every pause.

Use `reader_attention` and `reader_mark_seen` to acknowledge only the exact items inspected. A whole-document receipt requires full coverage of that exact file; a source excerpt, catalog wrapper, or reading edition does not establish reading of another file. A whole-thread receipt requires all its current comments, quote, and state. Reading and replying are separate; neither means agreement or approval. Preserve notes if work is interrupted and do not mark unread sections as read.

## Separate private vault

Code and library have separate roots. Helpers resolve the vault from `READER_ROOT`, otherwise the ignored code-checkout `.reader/config.json`. Run `python3 scripts/reader_paths.py` from the code checkout to locate it. Read library documents, AGENTS.md, activity, and inbox only from that configured vault. Use code-checkout helpers; do not infer a vault from the current project. If no vault is configured, report the missing setup instead of creating one in the code repository.
