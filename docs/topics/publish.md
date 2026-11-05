# Publish

## Overview

Publish uploads documents into your private vault and files them, showing each step. Publishing here means filing. Nothing on this page makes a document public.

## Choose files

Drop files on the page or choose them. The first file is the main document, and the rest are its attachments. An upload has at most 64 files, 32 MB per file and 64 MB in total. The page suggests a title from the first file's name.

## Who can read it

Each upload picks a level, and the page shows what it means before you send it.

- **No cloud models** is the default. Only a local model reads the document. The document and its logged excerpts are still committed and pushed with your vault.
- **Normal** lets Codex, Claude Code, agy or a local model read excerpts, in that order.
- **This machine only** is not available yet. Choosing it through the API stores nothing.

## Progress

After the upload, a filing run starts for that upload alone, so anything else waiting in the inbox stays there. The page lists each model it tries and why it moved on. It ends in one of two ways:

- **Filed** means the document was validated and committed.
- **Not filed** means it stays safely in the inbox with its receipt, and the page says why. For example, a No cloud models upload waits if no local model can answer, and another run, an unfinished failed run or a voice chat can keep this one from starting. Retry from the [Inbox](#admin/inbox) page, which files everything waiting.

## Access

The page is available to a browser on this machine and to approved Tailscale logins, the same as every other Reader Admin action. Other machines and agents can deliver over SSH.
