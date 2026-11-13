# Local Container Workflow

From the repository root:

```sh
just setup
just build
```

Edit `mabrid.yaml` and `runtime/mabrid.runtime.yaml`, then run:

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

Setup copies [mabrid.yaml.example](../../mabrid.yaml.example) to `mabrid.yaml` and
[mabrid.runtime.yaml.example](../../mabrid.runtime.yaml.example) to
`runtime/mabrid.runtime.yaml` under the selected configuration directory. Template contents are
unchanged. Existing files are kept, not parsed, rewritten, or merged by the launcher.

Setup also creates a commented `.env` beside the static file if missing. It is optional
process/container environment, not a Host credential source or a second product configuration file.
Setup never overwrites it. Configuration and secret values are not build inputs.

```text
<config-dir>/
  mabrid.yaml
  runtime/
    mabrid.runtime.yaml
  .env
```

The direct entry points are:

```sh
sh scripts/manage.sh setup
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/manage.ps1 setup
```

### Existing Deployments

The application still supports an adjacent runtime file when `runtimeConfigFile` is omitted, but
the supplied Compose layout mounts only `runtime/`. Setup detects an existing adjacent runtime
file without a destination and stops before creating another configuration. It never imports,
copies, deletes, or resets operator state.

To adopt the layout, explicitly move the desired runtime file into `runtime/`, add
`runtimeConfigFile: runtime/mabrid.runtime.yaml` to the static file, and arrange the directory
permissions below. Keep the static file's location, `storage.sqlitePath`, and named data volume
unchanged. Then recreate the container. Resolve any two pre-existing runtime files explicitly;
there is no source precedence or automatic fallback.

### Permissions

The image keeps UID/GID `10001:10001`; it does not start as root or change data-volume ownership.
For new Unix directories, setup creates `runtime/` with mode `2770` and its runtime file with mode
`0660`. The launcher adds the directory's numeric group to the container as a supplementary group
through `MABRID_CONFIG_GID`. Group write permits atomic replacement; setgid keeps replacement files
in the operator-controlled group. Existing permissions are never automatically changed.

An existing Unix runtime directory therefore needs group read/write/search access and setgid, and
the runtime file needs group read/write access. Protect the directory from untrusted group members.
Windows deployments use operator-managed ACLs and Docker Desktop bind-mount behavior; their actual
non-root read/write behavior requires container acceptance. Do not mount the checkout root writable
or make the runtime directory world-writable to work around permissions.

## Runtime Files

The image does not contain local YAML or secrets. Compose mounts the selected `mabrid.yaml`
read-only at `/var/lib/mabrid/mabrid.yaml`. The application reads its settings from YAML;
the launcher does not override listener settings or parse product configuration.

Compose separately mounts the host `runtime/` directory writable at `/var/lib/mabrid/runtime`.
The static template selects `runtimeConfigFile: runtime/mabrid.runtime.yaml`. The server resolves
that path relative to the static file, so API saves and explicit component application use the
same mounted file. Directory mounting preserves host-side atomic edits and permits API temporary
files and replacement; a writable single-file mount is insufficient.

Absolute runtime paths are supported by the application, but custom placement requires matching
deployment mounts. There is no runtime-path search or fallback. Gateway topology and Host settings
are rejected in the static file. A missing runtime file is unconfigured; an invalid Gateway file
may use existing ledger heads, while an invalid Host is unavailable without Host last-known-good
restoration. Neither case authorizes database deletion.

The existing named volume `mabrid-data` is mounted at `/var/lib/mabrid`. Relative SQLite paths
resolve from the mounted YAML's directory, so the root example's `./backend/var/mabrid.db`
remains inside this volume without rewriting the configuration. Absolute paths must likewise
point to writable persistent storage. Stop and image rebuilds do not delete the volume.

An optional adjacent `.env` supplies process/container environment. Setup creates a commented
template when the file is absent; Compose reads it using the raw env-file format, and it is never
included in image layers. Use `NAME=value` lines without shell interpolation. Docker administrators
can inspect container environment values. Host credentials are read only from runtime YAML.

The default mapping is host loopback port 8765 to container port 8765. If YAML changes the
container listener port, the Compose mapping must match; no helper discovers or overrides it.
Container `localhost` is not the host. Use a reachable host/container address for upstreams and
an agent-reachable `bridge.advertisedBaseUrl` when Agent Host is enabled.

## Storage and Injection Channels

External state reaches the container through explicit file, environment, and persistence channels.

| Content | Host location | Inside the container | Channel |
| --- | --- | --- | --- |
| `mabrid.yaml` | `<config-dir>/mabrid.yaml` | `/var/lib/mabrid/mabrid.yaml`, read-only file | Bind mount of one host file |
| Runtime configuration | `<config-dir>/runtime/mabrid.runtime.yaml` | `/var/lib/mabrid/runtime/mabrid.runtime.yaml`, writable file | Bind mount of the runtime directory |
| `.env` | `<config-dir>/.env` | No file; values become process environment variables | Compose `env_file` injection |
| SQLite database | Docker volume `<name>-data` | The directory `/var/lib/mabrid` | Named volume |
| Logs | Not stored | Not stored; standard error | Docker log driver (`docker logs`) |

Consequences:

- The YAML is a real file the application opens through `--config`. It is mounted read-only and is
  never copied into the image or the data volume.
- `.env` is not mounted. Compose reads it on the host and injects every active `NAME=value` line as
  an environment variable. `docker exec ... ls /var/lib/mabrid` shows no `.env` file.
- Only the data volume and runtime directory are writable persistent mounts; the root filesystem
  stays read-only and `/tmp` is a `tmpfs`.
- Because the YAML is mounted inside the volume's mount point, a relative `storage.sqlitePath`
  resolves against `/var/lib/mabrid` and therefore stays inside the volume.

## Configuration and Secret Ownership

The static file owns process settings. The runtime file owns desired Gateway and Host settings,
including the Host key. Environment injection does not supply or override product configuration.

| Content | Owner | Reason |
| --- | --- | --- |
| Listener settings, advertised origin, storage, and runtime-file placement | `mabrid.yaml` | Restart-applied process settings |
| Upstreams, endpoints, Host connection settings, and `apiKey` | `runtime/mabrid.runtime.yaml` | Saved desired settings; explicit component application |
| Optional process/container environment | `.env` | Host-side input; injected only at container creation, never a Host key source |
| Product and runtime state | Named volume | Written by the application and required across restarts |
| Diagnostics | Standard error | Owned by the container runtime |

The Host key has one configuration field:

```yaml
agentHost:
  runtime:
    apiKey: replace-with-your-Hermes-key
```

Host Settings offers one password input and writes a replacement without reading the current value
back. Ordinary saves preserve the existing key; an empty replacement is invalid. The runtime file
contains plaintext: protect its directory, backups, and access, and never commit real configuration
or credentials. Management reads expose configured state only, never the key.

An enabled Host requires a valid file key even if an old environment variable still exists.
`apiKeyEnv` is rejected; explicitly replace it with `apiKey` before adopting this contract. The
application and launcher do not migrate credentials, search for values, or fall back to `.env`.

Do not treat `.env` as a second configuration file. An injected variable has an effect only when
the process, a library, or an explicitly configured subprocess consumes it. The image sets
`MABRID_FRONTEND_DIST` for frontend assets; future environment-owned settings require an explicit
contract. There is no YAML environment interpolation or implicit override. Changing injected values
requires container recreation; restarting a directly launched process reloads its adjacent `.env`.

Upstream `headers` and `env` may contain literal values. Treat runtime YAML, upstream URLs, and the
SQLite revision ledger as sensitive if they contain credentials. Host literal keys are not added
to a Host configuration history table. Management writes remain unauthenticated and must only be
accessible to trusted clients; this is not a hardened public administration surface.

One exception deserves attention: when the configuration directory is the repository root, Compose
also auto-loads that `.env` for `${...}` interpolation in `compose.yaml`. Variables such as
`MABRID_PORT` therefore influence Compose itself, not only the application. Keep deployment choices
in YAML and leave Compose interpolation variables to the launcher.

Secret inheritance is bounded. The MCP SDK spawns stdio upstream servers with a small allow-list of
inherited variables (`PATH`, `HOME`, and similar) plus the upstream's explicitly configured `env`,
so injected secrets are not forwarded to third-party MCP subprocesses.

## Changing Container Configuration

Saving and applying are separate. Gateway and Host apply independently against the running state
of their dependencies; neither implicitly applies the other component.

| Changed file | Effect on the running container | Required action |
| --- | --- | --- |
| `mabrid.yaml` | Static settings and runtime placement remain fixed; single-file mounts may retain replaced files | Recreate to remount and restart the process |
| Runtime Gateway section | Desired file changes without switching existing Sessions | Apply Gateway; new Sessions use the new publication |
| Runtime Host section, including literal key | Desired file changes without switching the running Host | Apply Host when no operation or active/unsettled Run owns its clients |
| `.env` | No effect. Environment variables are fixed when the container is created | Recreate the container; a plain restart reuses the existing environment |

`just stop` followed by `just run` starts the existing container again. Recreate after editing
`mabrid.yaml` or `.env` so a replaced file is remounted and environment values are refreshed:

```sh
just recreate
```

`make recreate` provides the same behavior where `just` is unavailable. Recreation performs a
verified graceful stop first, then replaces the container from the existing image. It never builds,
pulls, or deletes the data volume.

Literal Host key rotation updates both compatibility and native clients under the same idle guard.
It does not change Target/integration identity, deployment binding, or Session IDs. Failed local
preparation retains the running Host and leaves the desired file unapplied. Successful application
confirms local replacement, not remote authentication; later authentication failures are reported
without credential fallback or automatic Run/tool retry. An unresolved Run still blocks replacement.

For endpoint migration, publish the new Gateway endpoint while retaining the old one, apply the
Host assignment, then remove the old endpoint. Startup and application preserve historical
Gateway revisions, Session references, and durable unsettled ownership without resetting storage.

## Build, Run, and Stop

Build requires setup and builds `mabrid:local`. Run requires a built image and never builds or
pulls implicitly. It starts the container without a separate configuration preflight or image
health-check script. A running container is not proof of application readiness; inspect
`docker logs mabrid` and the existing `/ready` endpoint separately.

Stop sends SIGTERM, verifies shutdown, and preserves the stopped container and data volume.
Runtime changes use explicit component apply without a stop. Existing resource-ownership checks still reject
unrelated containers/volumes with the same names; this workflow does not adopt or delete them.

Recreate applies settings that Compose fixes when a container is created, such as `.env` values. It
stops a running container with the same verified shutdown check, then replaces the container from
the existing image. The data volume is preserved, and no build or pull occurs.

No command resets the database, deletes the data volume, or implicitly replays business operations.

Make retains `IMAGE`, `CONTAINER_NAME`, `PORT`, and `CONFIG_DIR`; just retains `image`, `name`,
`port`, and `config_dir`. These select Docker resources, the host port, and the source directory,
not application settings. The default source directory is the repository root.

## Verification Boundary

Controlled tests run the native Unix and PowerShell scripts with Docker doubles and check the
root examples, permissions, file-owned credentials, API writes, and application against controlled files
and runtime fixtures. Real image builds, Docker launches, Windows ACLs, shutdown, and persistence
still require deployment acceptance. No actual Docker acceptance is claimed.

For deployment acceptance, verify non-root API save and host-side atomic replacement on the mounted
runtime directory; separate Gateway/Host application; literal key rotation while idle; busy/unsettled
rejection; safe invalid-value and preparation failures; and persistence across recreate without
changing Session identity or deleting the named volume. Live authentication tests require separately
authorized runtime credentials and operations, not synthetic test evidence.