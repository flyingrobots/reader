# Reader documentation

This corpus describes how Reader works: its architecture, contracts, capabilities, limitations, and operating procedures.

- [Design and conventions](design.md) — structure, metadata, navigation, and implementation decisions.
- [Unwrapped reading copies](reading-copies.md) — wide-md setup, intake formatting, preservation, and recovery.
- [Operations](operations.md) — deposit, intake, verification, and recovery procedures.
- [Delivery integration](delivery.md) — MCP tools, skill, CLI, installation, receipt contract, and recovery.
- [Shared read receipts and Upkeep](engagement.md): participant state, unread discussion, turn-boundary intake, and recovery.
- [Shared highlights and discussion](annotations.md) — source anchors, replies, persistence, and CLI/MCP tools.
- [Codex inbox runner](inbox-runner.md) — explicit Obsidian launch, deterministic controls, librarian judgment, and recovery.
- [Obsidian Reader sidebar](obsidian-plugin.md) — relationships, dates, filtering, library search, read-aloud, installation, and recovery.
- [Library search](search.md) — CLI/MCP search, source reading, indexing, local model setup, and recovery.
- [Versioned document metadata](metadata.md) — frontmatter schema, Obsidian placeholders, SQL mirror, migration, and validation.
- [Capabilities and boundaries](capabilities.md) — supported behavior and operational limits.
- [Librarian instructions](../AGENTS.md) — the standing agent mandate.

Future work belongs in the [roadmap](../planning/roadmap.md). Intake, reading, maintenance, and validation history belong in `activity/` in the private vault. Keep those records outside `docs/`.

Open `library/index.md` in your private vault to read cataloged material.

Code and content are separate repositories. Start with [separate-vault setup](separate-vault.md); `$READER_ROOT` in command examples means the private vault path.
