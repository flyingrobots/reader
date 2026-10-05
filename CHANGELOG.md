# Changelog

## Unreleased

- Keep guarded reindexing running when SQLite removes a transient journal during disk accounting; other measurement errors still stop the worker.

- Upgrade FastEmbed to the compatible 0.8 line and require Pillow 12.3 or newer to exclude the affected image-decoding releases.

- Pass an explicit external backend command to inbox jobs so fresh private vaults need no colocated environment.

- Preserve existing plugin preferences when a settings write is interrupted by publishing settings atomically.

- License Reader software under Apache-2.0; vault content retains its existing rights.

- Separate reusable Reader code from the private vault and its Git history.
- Configure a vault explicitly for CLI/MCP skills and the Obsidian backend; migrate matching integrations without replacing unrelated ones.
- Keep documents, annotations, read receipts, search state, and native formatter tooling in the vault.
- Validate software in copy-isolated Docker workers with enforced temporary-storage limits, including the pinned real Markdown formatter.
