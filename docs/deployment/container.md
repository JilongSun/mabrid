# Local Container Workflow

Run the following commands from the repository root, in order:

```sh
just setup
just build
```

Edit `deploy/local/mabrid.yaml` and `deploy/local/.env`, then run:

```sh
just run
just stop
```

Linux users may replace `just` with `make`. Windows uses PowerShell; Linux/WSL uses `sh`.
The justfile selects the platform shell and the appropriate pnpm command for development installs.
The deployment entry points are native [Unix shell](../../scripts/manage.sh) and
[Windows PowerShell](../../scripts/manage.ps1) scripts. Container build/run/stop require Docker
with Compose 2.30 or later and a Linux-container context, not host Python, uv, Node, or pnpm.
Setup needs only the platform shell and standard filesystem utilities. Docker Desktop may provide
Docker/Compose through Windows or WSL integration; a second daemon inside WSL is not required.
Development install/dev commands retain their separate Python/uv and frontend tooling requirements.

## Command Contracts

| Command | Prerequisites and behavior |
| --- | --- |
| `setup` | Copies the committed container YAML and environment examples into `deploy/local/`. Existing files are kept byte-for-byte; a missing companion file is created. Docker is not required. |
| `build` | Requires both local files from setup and usable Docker/Compose. Builds `mabrid:local`, without embedding local configuration or secrets or requiring host language tools. Editing settings after building is supported. |
| `run` | Requires setup, an existing local image, no running deployment with the same identity, and successful configuration preflight. Starts the image and waits for its health check before reporting its URL. It does not build or pull implicitly. |
| `stop` | Checks ownership, sends SIGTERM with a bounded grace period, and verifies application shutdown. Keeps the stopped container and named data volume. Repeating stop is harmless. |

`run` checks configuration using the built image's actual Pydantic models in a disposable container
without network access or the data volume. It resolves required environment-secret references,
requires SQLite storage inside `/var/lib/mabrid`, and rejects unchanged `.invalid` example URLs.
It does not migrate, seed, contact a runtime, call an MCP tool, or test remote availability.
Preflight errors are redacted rather than dumping configuration or environment values.

If an owned stopped container exists, Compose starts or recreates it only after successful preflight
and volume ownership checks. An already running container is never silently replaced: stop it explicitly
before applying new runtime settings or images. Unrelated containers or volumes with the same
names are rejected, not adopted, stopped, or deleted. A failed/timed-out start remains available
for diagnosis; inspect it with `docker logs mabrid`, then use stop as appropriate.

## Configuration and Environment

The templates are [mabrid.yaml.example](../../deploy/container/mabrid.yaml.example) and
[.env.example](../../deploy/container/.env.example). The setup directory is Git-ignored and excluded
from the Docker build context. The root development configuration and `.env` are not copied,
rewritten, or implicitly used by these deployment commands.

The example intentionally disables Agent Host and contains a nonfunctional MCP address. Replace
that address before run. Enable Agent Host only after supplying its Target/endpoint assignment,
advertised origin, runtime connection/native-session binding, and the key named by `runtime.apiKeyEnv`.

At run time, YAML is mounted read-only at `/etc/mabrid/mabrid.yaml`. Docker reads the companion
`.env` through the service's raw `env_file` and injects it into the container environment; `.env`
itself is not mounted. Compose's own interpolation uses the committed, secret-free example and
launcher-supplied deployment variables, not the root development `.env`. Use raw env-file syntax:
one `NAME=value` per line, no `export`, shell interpolation,
or quotes intended only for shell parsing. Secrets belong here, not in image build arguments.
On Unix, new `.env` files have mode 0600; Windows file privacy follows directory/file ACLs.
Docker administrators can inspect container environment values: this is runtime configuration,
not a secret-vault guarantee. Changing `.env` requires stop/run to recreate the environment.

Configuration stays outside the image because one artifact should run in different environments,
secret rotation should not require rebuilding, and private values must not become image layers.
Setup initializes local files; it does not make YAML the permanent product-configuration authority.
The accepted managed-configuration direction remains in
[ADR 0014](../architecture/decisions/0014-read-only-v0-1-management-plane.md).

For v0.1, topology is seeded only into an empty database. The initial setup/edit/run sequence
applies those settings; later YAML topology edits do not overwrite populated managed state.
Neither setup, build, run, nor stop deletes the database to force such changes. This workflow does
not add writable topology management, hot reload, a reset command, or runtime deployment rebinding.

## Storage and Networking

The default deployment uses container `mabrid` and named volume `mabrid-data`. The volume survives
stop, container recreation, setup, and rebuilds. Back it up before release/database upgrades. Do
not run two application processes against the same SQLite volume. Existing volumes with no workflow
Compose project and configuration-directory labels are deliberately not adopted; migrate them explicitly rather
than deleting data to bypass the ownership check.

The application listens at container port 8765, published only on host loopback by default.
Open `http://localhost:8765` after run succeeds. The v0.1 management surface is a trusted self-hosted
preview, not a hardened public multi-tenant service. `bridge.advertisedBaseUrl` must be an origin
reachable by the external agent; it is independent of listener binding and host port forwarding.

Container `localhost` is not the host. With Docker Desktop, use `host.docker.internal` for reachable
host-side MCP/Hermes services, or container DNS names on an explicitly configured Docker network.
The default launcher uses Docker's default network and does not guess host networking settings.
The Python runtime image does not include Node or arbitrary stdio MCP server executables.

## Overrides

Use the same overrides for every step of one deployment:

```sh
just --set image mabrid:preview --set name mabrid-preview --set port 8876 setup
just --set image mabrid:preview --set name mabrid-preview --set port 8876 build
just --set image mabrid:preview --set name mabrid-preview --set port 8876 run
just --set image mabrid:preview --set name mabrid-preview --set port 8876 stop
```

Make supports `IMAGE`, `CONTAINER_NAME`, `PORT`, and `CONFIG_DIR`; just supports `image`, `name`,
`port`, and `config_dir`. A separate deployment should also use a separate configuration directory.
The direct Unix entry point is:

```sh
sh scripts/manage.sh setup
```

The direct Windows entry point is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/manage.ps1 setup
```

Replace setup with build/run/stop. Unix options are `--config-dir`, `--image`, `--name`, `--port`,
and `--timeout`; PowerShell parameters are `-ConfigDir`, `-Image`, `-Name`, `-Port`, and `-Timeout`.
Project/container names use lowercase letters, digits, underscores and hyphens. Paths with spaces
remain one argument on either platform;
commas in Docker bind-mount paths are rejected explicitly. Ownership is scoped to the configuration
directory, so moving that directory or switching between Windows/WSL paths needs an explicit
deployment migration, not accidental adoption.

## Verification Boundary

Controlled tests execute the native Unix and PowerShell scripts using Docker doubles for
prerequisites, non-destructive setup, ordering, ownership, redaction, health-wait failure, and
graceful stopping. The Unix test PATH excludes Python and uv. Where PowerShell is unavailable,
its execution tests are explicitly skipped rather than reported as passed. Image-only configuration
preflight also runs against real application models in an isolated development-test subprocess;
this is not a host deployment dependency. Compose owns the actual build/up/health/stop lifecycle.
Actual Linux-image builds, Windows/WSL Docker launches, clean-volume migrations, shutdown and
restart persistence, plus real MCP/Agent Host/Apps integration still require deployment acceptance.
Local readiness does not certify external runtime availability or successful tool execution.