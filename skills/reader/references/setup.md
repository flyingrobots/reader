# Reader setup and remote delivery

Reached from the Reader skill when this machine has no configured vault, `~/.config/reader/remote.json` exists, or the helper reports a setup or SSH failure. "Code checkout" means the Reader repository containing the Reader skill's real path (the parent of `skills/`), not the installed symlink's directory.

## Separate private vault

Code and library have separate roots. Helpers resolve the vault from `READER_ROOT`, otherwise the ignored code-checkout `.reader/config.json`. With the Reader service installed, helpers run its live checkout (main), not this checkout's branch; `READER_CODE` overrides. See the code checkout's `docs/separate-vault.md`; run `python3 scripts/reader_paths.py` from the code checkout to locate the vault. Read library documents, AGENTS.md, activity, and inbox only from that configured vault. Use code-checkout helpers; do not infer a vault from the current project. If no vault is configured, report the missing setup instead of creating one in the code repository.

## Deliver from another machine

Remote delivery is optional; never set it up unasked. If this machine has no Reader vault, the helper can deliver to the user's vault on another computer over SSH. When `~/.config/reader/remote.json` exists, the Reader skill's helper commands (`ingest`, `status`, and with the `library` key scope also `search`, `read`, `annotate`) run on that computer automatically. Use the helper, not MCP; local paths in the request are read on this machine and their bytes are sent. The returned `document_path` is on the vault computer, so report it as a path there.

If delivery is requested and neither a local vault nor `remote.json` exists, or the helper reports an SSH failure, offer remote setup. It needs the vault computer's SSH address and, once, the user's login there, so ask the user to run it in their own terminal (in Claude Code, `! python3 /path/to/this/skill/scripts/reader.py remote-setup user@vault-host`):

```sh
python3 /path/to/this/skill/scripts/reader.py remote-setup user@vault-host
```

With `"url"` in `remote.json`, the helper delivers over HTTPS with a delivery token instead (`remote-token-setup`, also run by the user in their own terminal), and only `ingest` and `status` work. The optional `privacy` request field is `no-cloud` (its default) or `normal`.

It reuses an existing working setup, otherwise creates a dedicated Reader key and authorizes it on the vault computer for delivery only. Do not create or change SSH keys, `authorized_keys` or SSH configuration yourself. Suggest `--scope library` only when the user wants search and reading from this machine too. Details are in the code checkout's `docs/delivery.md`.
