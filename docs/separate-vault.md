# Separate code and private vault

Reader’s Python backend and installed integrations currently require macOS or Linux (POSIX locks, signals, and resource limits). Windows and mobile backend operation are not supported. A Windows executable-path substitution alone is insufficient.

Reader software and private reading material live in independent Git repositories. The code repository starts with fresh history. The vault retains its library history and must only have private remotes. A gitignore rule does not remove tracked content or historical commits.

## Install

From the code checkout, run:

```sh
uv sync --locked
python3 scripts/install.py --vault /path/to/private-vault
npm --prefix plugins/reader ci
npm --prefix plugins/reader run build
npm --prefix plugins/reader run install:vault -- /path/to/private-vault
```

The vault must already contain `library/` and `inbox/`; plugin installation also requires `.obsidian/`. For a new vault, create those directories and use `templates/vault-AGENTS.md` as operating guidance. Installing does not import or move documents. Add `--replace-existing` to migrate this same vault's existing Reader MCP registration and installed skills; unrelated registrations are refused. Restart the MCP client and reload Reader in Obsidian afterward.

The installer records the vault in ignored `.reader/config.json` in the code checkout. Skill helpers resolve `READER_ROOT` first, then this file. The MCP registration has an explicit `--root` argument. The plugin installer preserves other plugin settings and records `backendRoot` pointing to the code checkout; the plugin uses that environment while all document and runtime state stays in the open vault. Blank `backendRoot` retains legacy colocated compatibility. Moving code requires rerunning both installers; moving the vault requires reinstalling the MCP binding and reopening the moved vault in Obsidian.

Run `python3 scripts/reader_paths.py` to inspect the binding and `python3 skills/reader/scripts/reader.py search "example" --mode keyword` to exercise it. Upkeep and reflective-reading helpers use the same binding. Run `python3 scripts/install_wide_md.py` from the code checkout to install the pinned formatter into the configured vault's private tooling directory. Existing formatter receipts and search indexes stay in the vault.

## Privacy and recovery

Keep library, catalog, inbox, annotations, engagement, `.obsidian`, runtime caches, private activity, and local configuration out of the code repository. Its ignore rules exclude the standard vault directories. Review every staged path and scan the complete fresh history before making the code repository public. Do not push the old vault history to the code remote.

The vault path can remain unchanged during migration, preserving Obsidian identity and document links. Retain old source/environment copies until the new runtime is verified; these local compatibility copies are not the code development location. Do not delete uncommitted work. To recover, reinstall the prior plugin build and restore the prior Reader MCP/skill destinations from the migration record. Source documents and their receipts are independent of the plugin build.

## Bounded validation

Run `python3 scripts/check_container.py formatter`, then `python3 scripts/check_container.py python` and `python3 scripts/check_container.py node`. The runner requires locally available `rust:1.96.0`, `python:3.12-bookworm`, and `node:24.18.0` images. It copies software into isolated workers without mounting the vault or Git checkout. Root filesystems are read-only; kernel-capped temporary filesystems allow 2 GiB for build/dependency data and 1 GiB for test temporary data. Each worker has two CPUs, 4 GiB memory, bounded logs, and a 15-minute timeout. The shared validation lock serializes workers. Owned containers are removed after completion or failure; toolchain images are reused.

Host and Docker VM storage must have 50 GiB free. Production resource checks retain that reserve on ordinary filesystems; verified Linux tmpfs filesystems of at most 4 GiB instead reserve one quarter of their capacity, bounded between 16 and 256 MiB. This recognizes actual kernel quotas without accepting an environment flag as enforcement. The pinned Linux formatter is kept in ignored code-local test tooling and is separate from the native formatter installed in the private vault.
