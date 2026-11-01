# Managed container runtime primitives

`ContainerRuntime` in `reader_mcp.container_runtime` prepares a restricted local Docker container through the Dev Container CLI’s `set-up` command. It is a backend primitive and is not yet selected by Coding Jobs. Repository registration and the production job workflow still use the existing host runner. This page describes the implemented helper and its verification boundary; it does not establish an operational container job service.

## Storage and ownership

A repository name deterministically identifies one worker name, persistent workspace volume and shared `host/docker/<worker>/` git-locks key. Labels bind the volume and worker to both the repository and the owning vault’s fingerprint. A foreign volume or existing worker is refused instead of being adopted or erased. The local volume must use Docker’s local driver without additional mount options.

The helper records preparation intent before creating a workspace, then records the immutable container identity before starting it. Its caller must persist those records durably. Normal teardown stops the whole container, confirms it stopped and removes the disposable container object. It never removes the workspace volume. User-created source, edits and container credentials are intended to live under `/work`; temporary system and runtime files use the explicitly bounded tmpfs mounts. Automatic job restart/reconciliation and recovery UI are not implemented by this helper.

## Image and configuration boundary

The caller supplies a validated image configuration and a full approved local image identity. The configured image must resolve to that identity. Images that declare additional volumes are refused. Setup currently requires the managed `/etc` restoration entrypoint used by the development image, since the CLI patches system environment files while the image root remains read-only. Missing images and incompatible entrypoints are errors; the helper does not pull, build or replace them automatically.

The helper supplies a per-run workspace path under `/work/jobs/`, root inside the container and `userEnvProbe: none`. Configuration commands are skipped during `set-up`. Source cloning, lifecycle-command execution after cloning, coding-tool installation, independent container sign-in, agent execution and final verification are responsibilities of the job adapter, which is not connected yet. No host repository, credentials, Docker socket or SSH-agent socket is mounted.

## Supervision and accounting

The configured worker has a read-only image root, 2 CPUs, 4 GiB memory with equal swap limit, 256 PIDs, all capabilities dropped, no-new-privileges, private IPC and bridge networking. Writable system mounts are `/tmp` at 256 MiB, `/etc` at 16 MiB and shared memory at 64 MiB. Docker logs use the local driver with one uncompressed 4 MiB file. Inspection checks the actual mounts and host configuration; an isolated system-Python probe also checks actual tmpfs capacities.

Workspace usage is monitored at a 3 GiB threshold. This is not a Docker volume quota. The measurement counts the greater of logical size and allocated blocks, deduplicates hard links, refuses traversal errors and includes open unlinked regular files on the workspace filesystem. It also inspects retained file mappings after descriptors close; when the kernel will not expose an otherwise unaccounted mapping’s full size, measurement fails and the worker is stopped rather than reporting an undercount. Host and Docker backing filesystems must each retain 50 GiB free. An independent monitor checks resources and lease identity while the control plane runs. Monitoring errors, cancellation, lease loss and deadlines request a stop of the whole container.

Host CLI metadata, cache and temporary files have an aggregate 8 MiB monitored threshold. CLI temporary/cache paths are placed under the owned control directory. Active client process groups are tracked; writable descriptors are inspected through procfs on Linux or NUL-delimited `lsof` records on macOS so deleting a still-open file does not hide its usage. Writable regular files outside the owned directory are a guard failure. Failure to inspect descriptors is not treated as zero usage.

Control-plane stdout and stderr share a 4 MiB capture limit per command. The transport applies deadlines and cancellation while reading chunks, including after both pipes close. It reaps the client process group on every exit path, escalating from TERM to KILL even after a leader has exited. A Docker client’s death does not prove its container children stopped; the runtime separately stops and inspects the container. A PID-1 deadline provides an additional finite bound if its host supervisor disappears. A failed stop keeps the lease for reconciliation/expiry rather than reporting clean shutdown.

## Verification boundary

The focused tests run in the project’s bounded Docker validation worker. Process tests execute actual Linux processes, including a surviving child and open unlinked temporary files. Host descriptor parsing for macOS is exercised with synthetic machine-readable records; this is not a macOS execution test. Runtime ownership, foreign mounts, low capacity, incorrect tmpfs capacity and volume preservation are tested against a fake Docker control plane. They do not prove a real daemon, CLI lifecycle, authentication, source clone or complete coding job flow. Real Docker integration and the job adapter must be verified before enabling this runtime for production jobs.
