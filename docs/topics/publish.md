# Publish

## Overview

Publish uploads documents into your private vault and files them, showing each step. Publishing here means filing. Nothing on this page makes a document public.

## Choose files

Drop files on the page or choose them. The first file is the main document, and the rest are its attachments. An upload has at most 64 files, 32 MB per file and 64 MB in total. The page suggests a title from the first file's name.

## Who can read it

Each upload picks a level, and the page shows what it means before you send it.

- **No cloud models** is the default. Only a local model reads the document. The document and its logged excerpts are still committed and pushed with your vault.
- **Normal** lets Codex, Claude Code, agy or a local model read excerpts, in that order.
- **This machine only** encrypts the document with a passphrase only you know. It never joins your vault or leaves this machine, and no model, voice or search can find it through Reader. It works only in a browser on the computer that holds your library, at its local address such as `http://127.0.0.1:8766/#admin/publish`. A Tailscale address, even on that computer, shows a note instead of this option.

## Progress

After the upload, a filing run starts for that upload alone, so anything else waiting in the inbox stays there. The page lists each model it tries and why it moved on. It ends in one of two ways:

- **Filed** means the document was validated and committed.
- **Not filed** means it stays safely in the inbox with its receipt, and the page says why. For example, a No cloud models upload waits if no local model can answer, and another run, an unfinished failed run or a voice chat can keep this one from starting. Retry from the [Inbox](#admin/inbox) page, which files everything waiting.

## On this machine only

The first use installs a small pinned tool and asks you to choose a passphrase. **There is no recovery:** if you lose it, these files are gone, and nothing backs them up.

Once unlocked, you can open, download or delete these documents here. They stay unlocked in this browser until you press **Lock**, Reader restarts, or 15 minutes pass without use. Deleting removes a document from encrypted storage, but it doesn't securely erase the disk.

While it's unlocked, you can also encrypt a delivery that's waiting in the inbox instead of filing it. The inbox copy is removed once the encrypted copy has been checked.

This protects Reader's copy. The original file you uploaded stays wherever it was, and agents running as you can still read that copy, so remove it if it matters.

## Delivery tokens

A token lets another machine or agent send documents to your inbox over HTTPS. It can't read your library or start filing, so what it sends waits until you file it. Each token gets 200 uploads and 512 MB a day. Create one here, copy it right away because it's shown only once, and revoke it when it's no longer needed.

## Access

The page is available to a browser on this machine and to approved Tailscale logins, the same as every other Reader Admin action. Other machines and agents can deliver over SSH or with a delivery token.
