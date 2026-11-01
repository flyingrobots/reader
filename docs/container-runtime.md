# Managed container runtime primitives

`ContainerRuntime` in `reader_mcp.container_runtime` prepares a restricted local Docker container through the Dev Container CLI’s `set-up` command. It is selected by the default Coding Jobs adapter. Admin handles configuration approval and the terminal setup command handles tools and independent sign-in. Automatic managed-image preparation and real-daemon complete-job verification remain incomplete. Legacy registrations are retained as read-only recovery data and cannot execute through the default runner.

## Storage and ownership

A repository name deterministically identifies one worker name, persistent workspace volume and shared `host/docker/<worker>/` git-locks key. Labels bind the volume and worker to both the repository and the owning vault’s fingerprint. A foreign volume or existing worker is refused instead of being adopted or erased. The local volume must use Docker’s local driver without additional mount options.

The helper records preparation intent before creating a workspace, then records the immutable container identity before starting it. Its caller must persist those records durably. Normal teardown stops the whole container, confirms it stopped and removes the disposable container object. It never removes the workspace volume. User-created source, edits and container credentials are intended to live under `/work`; temporary system and runtime files use the explicitly bounded tmpfs mounts. Restart reconciliation uses the saved lease and per-run container labels, stops only a proven-owned worker and preserves this volume. It never restarts an agent. The operator recovery UI remains incomplete.

## Image and configuration boundary

The caller supplies a validated image configuration and a full approved local image identity. The configured image must resolve to that identity. Images that declare additional volumes are refused. Setup currently requires the managed `/etc` restoration entrypoint used by the development image, since the CLI patches system environment files while the image root remains read-only. Missing images and incompatible entrypoints are errors; the helper does not pull, build or replace them automatically.

The helper supplies a per-run workspace path under `/work/jobs/`, root inside the container and `userEnvProbe: none`. Configuration commands are skipped during `set-up`. The job adapter clones the pinned repository, executes lifecycle commands after cloning, resolves and checks tools/sign-in inside the container, runs the agent and verifies its commits. The explicit terminal setup command can install tools and initiate independent container sign-in; the browser does not run those commands automatically. No host repository, credentials, Docker socket or SSH-agent socket is mounted.

## Supervision and accounting

The configured worker has a read-only image root, 2 CPUs, 4 GiB memory with equal swap limit, 256 PIDs, all capabilities dropped, no-new-privileges, private IPC and bridge networking. Writable system mounts are `/tmp` at 256 MiB, `/etc` at 16 MiB and shared memory at 64 MiB. Docker logs use the local driver with one uncompressed 4 MiB file. Inspection checks the actual mounts and host configuration; an isolated system-Python probe also checks actual tmpfs capacities.

Workspace usage is monitored at a 3 GiB threshold. This is not a Docker volume quota. The measurement counts the greater of logical size and allocated blocks, deduplicates hard links, refuses traversal errors and includes open unlinked regular files on the workspace filesystem. It also inspects retained file mappings after descriptors close; when the kernel will not expose an otherwise unaccounted mapping’s full size, measurement fails and the worker is stopped rather than reporting an undercount. Host and Docker backing filesystems must each retain 50 GiB free. An independent monitor checks resources and lease identity while the control plane runs. Monitoring errors, cancellation, lease loss and deadlines request a stop of the whole container.

Host CLI metadata, cache and temporary files have an aggregate 8 MiB monitored threshold. CLI temporary/cache paths are placed under the owned control directory. Active client process groups are tracked; writable descriptors are inspected through procfs on Linux or NUL-delimited `lsof` records on macOS so deleting a still-open file does not hide its usage. Writable regular files outside the owned directory are a guard failure. Failure to inspect descriptors is not treated as zero usage.

Control-plane stdout and stderr share a 4 MiB capture limit per command. Agent/verification commands stream into the existing 64 MiB run archive budget without retaining their full output in memory. The transport applies deadlines and cancellation while reading chunks, including after both pipes close. It reaps the client process group on every exit path, escalating from TERM to KILL even after a leader has exited. A Docker client’s death does not prove its container children stopped; the runtime separately stops and inspects the container. A PID-1 deadline provides an additional finite bound if its host supervisor disappears. A failed stop keeps the lease for reconciliation/expiry rather than reporting clean shutdown.

## Verification boundary

The focused tests run in the project’s bounded Docker validation worker. Process tests execute actual Linux processes, including a surviving child and open unlinked temporary files. Host descriptor parsing for macOS is exercised with synthetic machine-readable records; this is not a macOS execution test. Runtime ownership, foreign mounts, low capacity, incorrect tmpfs capacity and volume preservation are tested against a fake Docker control plane. They do not prove a real daemon, CLI lifecycle, authentication, source clone or complete coding job flow. The adapter’s synthetic transport tests execute real Git, fake agent and verification programs in the bounded Docker test worker and preserve a separate dirty checkout. They do not establish real daemon/CLI integration. Real Docker setup, teardown, persistence and a public source clone have been exercised separately from these synthetic tests. Those operations do not establish a complete real-daemon Coding Job, authenticated provider task, push or PR flow; that broader integration remains required before release.

## Explicit terminal setup

After approving a container registration, the local `reader container` command can prepare tools and independent authentication in that repository’s managed volume. It uses the same image, worker key, resource guard and teardown as a job. It does not clone source or run repository lifecycle commands. Examples below assume `READER_ROOT` selects the private vault and replace `owner/name` with the registered repository:

```sh
reader --root "$READER_ROOT" container exec owner/name -- node --version
reader --root "$READER_ROOT" container exec owner/name -- npm install --global --prefix /work/tools @openai/codex@0.166.0
reader --root "$READER_ROOT" container exec owner/name -- codex login --device-auth
reader --root "$READER_ROOT" container check owner/name
```

Every token after `--` is a literal container argv token; Reader does not interpolate a host shell or import host environment secrets. A shell can be requested explicitly as a container executable when the operator needs one. Commands use `/work` as their working directory. Install tools under `/work/tools`, whose `bin` is already on the container PATH; install project dependencies in the job workspace through its approved lifecycle commands. Root-image package managers cannot write to the read-only system directories. Git authentication must likewise be established inside the container. Host `gh` access for issue/PR operations is separate from container Git credentials.

For private repositories and pushes, install the official GitHub CLI into `/work/tools/bin`, then authenticate and configure Git’s credential helper inside this container home:

```sh
reader --root "$READER_ROOT" container exec owner/name -- gh auth login --hostname github.com --web --git-protocol https
reader --root "$READER_ROOT" container exec owner/name -- gh auth setup-git --hostname github.com
```

These commands use a separate container login. Without a system credential store, GitHub CLI may persist its token in plain text under the retained container home; protect the volume accordingly. Do not paste tokens into configuration, article prompts or command arguments. A host `gh auth login` does not authenticate container Git.

`exec` streams bounded stdout/stderr to the terminal and returns the command’s exit code in its final JSON. The CLI exits nonzero for a failed command. Device-authentication output is for the local terminal; complete the provider’s browser approval yourself. Reader does not copy host sessions, take over the browser approval or promise that an agent is signed in merely because its executable exists. The setup lifetime defaults to 600 seconds and can be set between 60 and 3600 with `--seconds` before the action; cleanup retains 30 seconds beyond the command limit. Commands stop and remove their worker on return, keeping the workspace volume.

`check` actually opens the managed worker, probes each enabled agent’s version and authentication status, checks that container Git can read the registered base at the approved revision, measures resources, then closes it. Its `ready` result is limited to those checks; it does not prove push permission or project verification. Job preflight and publication still repeat their own checks. Check output contains booleans and identities, not authentication responses. It is not cached as an Admin “Ready” badge.

Creation intent and worker/lease identity are recorded in the repository’s host-control `setup.json` with atomic replacement and fsync. One nonblocking setup-file lock serializes setup/recovery commands; the concrete workstation worker lease also excludes jobs. A prior setup without confirmed shutdown must be reconciled explicitly:

```sh
reader --root "$READER_ROOT" container recover owner/name
```

Recovery uses the recorded identity and the fenced recovery protocol above. It never erases the volume or starts another coding agent. A foreign worker, replaced lease or uncertain stop remains an error. The setup command cannot prepare a missing image: the packaged managed image recipe must first be prepared under the workstation’s build-resource rules and its full local identity approved in Admin.
