# Reader devcontainer experiment

This is a candidate, not Reader's supported development setup or Coding Jobs backend. It is deliberately outside `.devcontainer/` so editors and jobs do not automatically select a configuration before durable work recovery is implemented. The current Coding Jobs runner still uses registered local checkouts; this experiment does not migrate it.

The candidate uses Reader's GitHub CI Node image, `node:24.18.0`, and clones the public repository **inside** capped Docker tmpfs. The host workspace contains only configuration. Python is the image's Debian Python, not the CI Python 3.12 image; the candidate does not establish full Python or browser-test parity. It mounts neither host source nor credentials nor a Docker socket, and starts no coding agent.

## Reproduce the bounded trial

With the image already present and the Dev Container CLI installed, acquire the shared workstation key and run:

```sh
GIT_LOCKS_STORE=/Users/Shared/git-locks/workstation.git git locks with \
  --job "reader-development-$(uuidgen)" --holder reader-development \
  --ttl 420 --wait 5 --note 'Bounded Reader devcontainer experiment' \
  host/docker/reader-development/ -- python3 planning/devcontainers/trial.py
```

The trial requires 50 GiB free on host and Docker backing filesystem, caps workspace tmpfs at 1536 MiB and temporary tmpfs at 512 MiB, provides a 16 MiB `/etc` tmpfs and uses a read-only root, 2 CPUs, 4 GiB RAM, 256 PIDs, 64 MiB shared memory, 4 MiB Docker logs, 16 MiB host CLI output/data and a five-minute deadline. It refuses unknown pre-existing workers or changed startup hooks. It prints its launch contract before starting. Cleanup stops the owned container and CLI process group, removing the ephemeral workspace. There are no development edits to preserve in this setup-only trial. It must not be used for real development until workspace recovery is implemented.

## Compatibility boundary

The installed Dev Container CLI patches `/etc/environment` during setup. A small configuration-only image layer preserves the base image’s public `/etc`, and its entrypoint restores it into a 16 MiB tmpfs. This permits that setup step while retaining a read-only image root. The entrypoint preserves Docker’s hosts, hostname and resolver files. No CLI internals or marker files are patched. The local Docker engine accepts `--storage-opt size=...`, but the enforcement probe allowed a 96 MiB allocation under a requested 64 MiB quota. Acceptance of an option is not enforcement. Do not rely on that option as a guard on this engine.

The resulting setup trial prepares a GitHub clone and reports tool versions. It is not a coding-agent or publication test. The bounded tmpfs workspace is deliberately removed after the setup-only trial; real development requires a durable, bounded recovery contract before adoption.

## Container-only Coding Jobs acceptance

One coherent implementation must:

- Inspect GitHub at a pinned base SHA for `.devcontainer.json`, `.devcontainer/devcontainer.json` and named configurations. Distinguish missing files from authentication/API/truncated-inventory failures; ask the operator before inferring a missing configuration. Bind consent to the repository/revision and let the operator decline.
- Clone only inside the managed environment; execute agent, Git inspection and verification there, with no host fallback or required host checkout. Honor supported devcontainer builds/features/hooks or reject unsupported configuration explicitly.
- Provide enforceable aggregate resource bounds, resource locking, deadlines and cancellation that terminates container children as well as the client process.
- Preserve unique work across success, cancellation, server restart and failure; an ephemeral tmpfs trial alone does not meet that contract.
- Establish agent authentication inside the environment deliberately; do not silently copy host credentials or expose the Docker socket.
- Preserve existing source/prompt pinning, archive, Git hook, verification, create-only push and remote reconciliation contracts. Do not publish, merge or delete recovery work as part of migration.
- Replace host-checkout registration with GitHub discovery, configuration selection/consent and honest runtime readiness. Update Admin references in the same change and exercise the complete job flow with synthetic repository fixtures.
