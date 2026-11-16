# Voices and agent command lines

## Overview

Voices reports the coding/chat agent CLIs used by Reader and the registered voices that depend on them. This page is different from AI-TTS reading voices, which are chosen in Service & tools and the Speak popup. A voice name is an identity; finding a CLI does not authorize impersonating another voice.

## Agent command lines

The page discovers supported executables such as Codex, Claude Code and Agy and shows paths, discovery status and related voices. Found means Reader located a command; it is not proof of valid authentication, compatible permission settings or successful execution for every repository. Not found is a dependency state rather than an empty list of voices.

## Setup

Reader links to each CLI’s own setup instructions. It does not silently install an agent or sign in on your behalf. Follow the selected tool’s installation/authentication flow and check again through the appropriate status surface. Never copy credentials into article prompts or a repository’s public configuration.

## GPU coordination

The GPU notice describes local-model coordination, not the identity of a chat voice or the audio engine. An unavailable coordination mechanism must be understood before starting shared accelerator work. Advisory coordination only works among cooperating clients and does not create a hardware quota.

## Identity and permissions

Each configured voice keeps its own authorship, namespace and read/discussion state. Sharing a CLI does not merge those identities or establish agreement among them. Agent filesystem/approval modes belong to the invoking workflow’s policy. A local CLI’s presence does not prove an isolated dev container contains or can authenticate that CLI.

## Troubleshooting

If a voice cannot run, distinguish executable discovery, authentication, requested model availability, repository permission mode and runtime location. Use the exact source/run identity when stopping unexpected activity. Do not stop shared Reader or AI-TTS infrastructure merely because one voice’s stream is stale.

Implementation: CLI discovery in voices/companion helpers and `web/src/admin/pages/voices.tsx`. This page is informational; it has no agent install or login button.
