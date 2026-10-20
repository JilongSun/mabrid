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
There is no separate container configuration template, generated environment file, or configuration
transformation. An existing `.env` is left untouched.

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

An optional adjacent `.env` supplies runtime secrets referenced by YAML. It is read using Compose's
raw env-file format, not copied by setup or included in image layers. Use `NAME=value` lines
without shell interpolation. Docker administrators can inspect container environment values.

The default mapping is host loopback port 8765 to container port 8765. If YAML changes the
container listener port, the Compose mapping must match; no helper discovers or overrides it.
Container `localhost` is not the host. Use a reachable host/container address for upstreams and
an agent-reachable `bridge.advertisedBaseUrl` when Agent Host is enabled.

## Build, Run, and Stop

Build requires setup and builds `mabrid:local`. Run requires a built image and never builds or
pulls implicitly. It starts the container without a separate configuration preflight or image
health-check script. A running container is not proof of application readiness; inspect
`docker logs mabrid` and the existing `/ready` endpoint separately.

Stop sends SIGTERM, verifies shutdown, and preserves the stopped container and data volume.
Use stop before applying new runtime settings. Existing resource-ownership checks still reject
unrelated containers/volumes with the same names; this workflow does not adopt or delete them.

Existing topology behavior is unchanged: YAML seeds an empty database, but later YAML topology
edits do not overwrite populated topology. No command resets the database or adds hot reload.

Make retains `IMAGE`, `CONTAINER_NAME`, `PORT`, and `CONFIG_DIR`; just retains `image`, `name`,
`port`, and `config_dir`. These select Docker resources, the host port, and the source directory,
not application settings. The default source directory is the repository root.

## Verification Boundary

Controlled tests run the native Unix and PowerShell scripts with Docker doubles and check the
root example against current configuration models. Real image builds, Docker launches, shutdown,
and persistence still require deployment acceptance. No actual Docker acceptance is claimed.