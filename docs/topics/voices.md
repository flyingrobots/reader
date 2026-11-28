# Voices and agent command lines

## Overview

Voices reports the coding/chat agent CLIs used by Reader and the registered voices that depend on them. This page is different from AI-TTS reading voices, which are chosen in Service & tools and the Speak popup. A voice name is an identity; finding a CLI does not authorize impersonating another voice.

## Configure a local LLM

Open **Admin → Voices → Local LLM**. Choose the provider, enter the model and select **Save provider**.
The server card shows availability and, for LM Studio, offers server start and model load controls.
In **Filing models**, enable **Local model** to include it in fallback, choose what happens when it is not ready,
then select **Save filing models**. Editing a custom executable requires opening Reader through localhost on
the server machine; a Tailscale browser cannot edit that command.

Send a short message in **LLM Sanity Check**. The output panel shows startup diagnostics and model output.
These controls share their saved state with **Models**; there is no second provider configuration.
The bulk-work queue and task settings remain on Models. See [Models](models.md) for limits and recovery.

## Agent command lines

The page discovers supported executables such as Codex, Claude Code and Agy and shows paths, discovery status and related voices. Found means Reader located a command; it is not proof of valid authentication, compatible permission settings or successful execution for every repository. Not found is a dependency state rather than an empty list of voices.

## Setup

Reader links to each CLI’s own setup instructions. It does not silently install an agent or sign in on your behalf. Follow the selected tool’s installation/authentication flow and check again through the appropriate status surface. Never copy credentials into article prompts or a repository’s public configuration.

## GPU coordination

The GPU notice describes local-model coordination, not the identity of a chat voice or the audio engine. An unavailable coordination mechanism must be understood before starting shared accelerator work. Advisory coordination only works among cooperating clients and does not create a hardware quota.

## Identity and permissions

Each configured voice keeps its own authorship, namespace and read/discussion state. Sharing a CLI does not merge those identities or establish agreement among them. Agent filesystem/approval modes belong to the invoking workflow’s policy. A local CLI’s presence does not prove an isolated dev container contains or can authenticate that CLI.

## LLM voice

The selected provider does not automatically become a named article-chat voice. To expose it as `@llm`, add a
voice to the private vault's `voices.json` using Reader's installed Python executable as `cli`:

```json
{
  "name": "LLM",
  "mention": ["llm"],
  "cli": "/path/to/reader/python",
  "argv": ["-m", "reader_mcp.llm_check", "--root", "{vault}"],
  "stream": "text",
  "version_argv": null,
  "inline_document": true,
  "timeout_seconds": 900
}
```

That interpreter must import the installed Reader package (or inherit the service's `PYTHONPATH`). The command
reads a prompt from stdin, uses the provider and model saved in Models, starts a local server through the saved
startup settings, and prints the answer. Diagnostics go to stderr and appear in the article chat's raw output.
It has no model tools and does not impersonate another registered voice. The full article prompt and history must
fit the Sanity Check's 24,000-character input bound; longer prompts fail explicitly. Article chat retains its usual
transcript and raw archive, unlike the ephemeral Admin panel. A configured remote provider receives this prompt.

## Troubleshooting

If a voice cannot run, distinguish executable discovery, authentication, requested model availability, repository permission mode and runtime location. Use the exact source/run identity when stopping unexpected activity. Do not stop shared Reader or AI-TTS infrastructure merely because one voice’s stream is stale.

Implementation: CLI discovery in voices/companion helpers and `web/src/admin/pages/voices.tsx`; shared model controls in `web/src/admin/panels.tsx`. CLI discovery has no agent install or login button.
