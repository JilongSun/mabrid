# Local Container Workflow

From the repository root:

```sh
just setup
just build
```

Edit `mabrid.yaml`, then run:

```sh
just run
just stop
```

Linux/Unix users may replace `just` with `make`. The justfile selects native
[Unix shell](../../scripts/manage.sh) or [Windows PowerShell](../../scripts/manage.ps1).
Container commands require Docker with Compose 2.30+ and a Linux-container context, not host
Python, uv, Node, or pnpm. Setup does not require Docker. Development commands retain their
separate tooling requirements.

## Setup

Setup copies [mabrid.yaml.example](../../mabrid.yaml.example) to `mabrid.yaml` in the repository
root, removing only the `.example` suffix. Contents are unchanged. An existing target is kept.

Setup also creates `.env` beside that configuration file when it does not exist yet. The new file
contains only commented guidance and no active values, so an Agent Host deployment still fails fast
until the referenced environment variable is supplied. An existing `.env` is never modified or
overwritten. There is no separate container configuration template or configuration transformation.

The direct entry points are:

```sh
sh scripts/manage.sh setup
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/manage.ps1 setup
```

## Runtime Files

The image does not contain local YAML or secrets. Compose mounts the selected `mabrid.yaml`
read-only at `/var/lib/mabrid/mabrid.yaml`. The application reads its settings from YAML;
the launcher does not override listener settings or parse product configuration.

The existing named volume `mabrid-data` is mounted at `/var/lib/mabrid`. Relative SQLite paths
resolve from the mounted YAML's directory, so the root example's `./backend/var/mabrid.db`
remains inside this volume without rewriting the configuration. Absolute paths must likewise
point to writable persistent storage. Stop and image rebuilds do not delete the volume.

An optional adjacent `.env` supplies runtime secrets referenced by YAML. Setup creates a commented
template when the file is absent; Compose reads it using the raw env-file format, and it is never
included in image layers. Use `NAME=value` lines without shell interpolation. Docker administrators
can inspect container environment values.

The default mapping is host loopback port 8765 to container port 8765. If YAML changes the
container listener port, the Compose mapping must match; no helper discovers or overrides it.
Container `localhost` is not the host. Use a reachable host/container address for upstreams and
an agent-reachable `bridge.advertisedBaseUrl` when Agent Host is enabled.

## Storage and Injection Channels

External state reaches the container through three distinct channels. Only one of them becomes a
file inside the container.

| Content | Host location | Inside the container | Channel |
| --- | --- | --- | --- |
| `mabrid.yaml` | `<config-dir>/mabrid.yaml` | `/var/lib/mabrid/mabrid.yaml`, read-only file | Bind mount of one host file |
| `.env` | `<config-dir>/.env` | No file; values become process environment variables | Compose `env_file` injection |
| SQLite database | Docker volume `<name>-data` | The directory `/var/lib/mabrid` | Named volume |
| Logs | Not stored | Not stored; standard error | Docker log driver (`docker logs`) |

Consequences:

- The YAML is a real file the application opens through `--config`. It is mounted read-only and is
  never copied into the image or the data volume.
- `.env` is not mounted. Compose reads it on the host and injects every active `NAME=value` line as
  an environment variable. `docker exec ... ls /var/lib/mabrid` shows no `.env` file.
- The named volume is the only writable persistent location, because the container root filesystem
  is read-only and `/tmp` is a `tmpfs`.
- Because the YAML is mounted inside the volume's mount point, a relative `storage.sqlitePath`
  resolves against `/var/lib/mabrid` and therefore stays inside the volume.

## Configuration and Secret Ownership

YAML owns structured configuration; `.env` owns secret values. The split is deliberate rather than
a leftover of the original development workflow.

| Content | Owner | Reason |
| --- | --- | --- |
| Listener settings, upstream URLs, endpoint topology, timeouts, Agent Host enablement, and the *names* of secret variables (`apiKeyEnv`) | `mabrid.yaml` | Typed models reject unknown fields and invalid values at startup; the file can be reviewed and committed |
| Secret *values* such as `API_SERVER_KEY` | `.env` | Kept out of images, the data volume, and Git; injected only at container creation |
| Product and runtime state | Named volume | Written by the application and required across restarts |
| Diagnostics | Standard error | Owned by the container runtime |

YAML never stores a secret value; it stores the environment variable name to read:

```yaml
agentHost:
  runtime:
    apiKeyEnv: API_SERVER_KEY
```

Do not treat `.env` as a second configuration file. The application reads environment variables
only for the secrets named by `apiKeyEnv` and for `MABRID_FRONTEND_DIST`, which the image sets. An
unrelated variable added to `.env` has no effect on the server. Environment injection also lacks
structure, type validation, nesting, and review history, and changing it requires container
recreation rather than a restart.

One exception deserves attention: when the configuration directory is the repository root, Compose
also auto-loads that `.env` for `${...}` interpolation in `compose.yaml`. Variables such as
`MABRID_PORT` therefore influence Compose itself, not only the application. Keep deployment choices
in YAML and leave Compose interpolation variables to the launcher.

Secret inheritance is bounded. The MCP SDK spawns stdio upstream servers with a small allow-list of
inherited variables (`PATH`, `HOME`, and similar) plus the upstream's explicitly configured `env`,
so injected secrets are not forwarded to third-party MCP subprocesses.

## Changing Configuration at Runtime

The two configuration inputs are applied at different times.

| Changed file | Effect on the running container | Required action |
| --- | --- | --- |
| `mabrid.yaml` | The host change is visible inside the container immediately, but the process already loaded its configuration at startup | Restart the container process: `just stop` then `just run` |
| `.env` | No effect. Environment variables are fixed when the container is created | Recreate the container; a plain restart reuses the existing environment |

`just stop` followed by `just run` starts the existing container again. Compose does not reliably
detect changes to `env_file` contents, so an environment change requires explicit recreation:

```sh
just recreate
```

`make recreate` provides the same behavior where `just` is unavailable. Recreation performs a
verified graceful stop first, then replaces the container from the existing image. It never builds,
pulls, or deletes the data volume.

Neither input triggers a hot reload, and YAML topology changes still never overwrite a populated
database.

## Build, Run, and Stop

Build requires setup and builds `mabrid:local`. Run requires a built image and never builds or
pulls implicitly. It starts the container without a separate configuration preflight or image
health-check script. A running container is not proof of application readiness; inspect
`docker logs mabrid` and the existing `/ready` endpoint separately.

Stop sends SIGTERM, verifies shutdown, and preserves the stopped container and data volume.
Use stop before applying new runtime settings. Existing resource-ownership checks still reject
unrelated containers/volumes with the same names; this workflow does not adopt or delete them.

Recreate applies settings that Compose fixes when a container is created, such as `.env` values. It
stops a running container with the same verified shutdown check, then replaces the container from
the existing image. The data volume is preserved, and no build or pull occurs.

Existing topology behavior is unchanged: YAML seeds an empty database, but later YAML topology
edits do not overwrite populated topology. No command resets the database or adds hot reload.

Make retains `IMAGE`, `CONTAINER_NAME`, `PORT`, and `CONFIG_DIR`; just retains `image`, `name`,
`port`, and `config_dir`. These select Docker resources, the host port, and the source directory,
not application settings. The default source directory is the repository root.

## Verification Boundary

Controlled tests run the native Unix and PowerShell scripts with Docker doubles and check the
root example against current configuration models. Real image builds, Docker launches, shutdown,
and persistence still require deployment acceptance. No actual Docker acceptance is claimed.