# Changelog

## Unreleased

- Separate reusable Reader code from the private vault and its Git history.
- Configure a vault explicitly for CLI/MCP skills and the Obsidian backend; migrate matching integrations without replacing unrelated ones.
- Keep documents, annotations, read receipts, search state, and native formatter tooling in the vault.
- Validate software in copy-isolated Docker workers with enforced temporary-storage limits, including the pinned real Markdown formatter.
