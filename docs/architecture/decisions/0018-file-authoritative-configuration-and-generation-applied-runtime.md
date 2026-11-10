# ADR 0018: File-Authoritative Configuration and Generation-Applied Runtime Configuration

- Status: Accepted
- Date: 2026-11-02
- Amended: 2026-11-03; runtime-only developer-preview configuration
- Amended: 2026-11-10; bounded Gateway file editing, literal header operations, and deferred access hardening
- Supersedes: ADR 0008, including its surviving constraints recorded below
- Amends: ADR 0002 ([Configuration boundary](0002-sqlite-persistence-and-configuration-authority.md#configuration-boundary)),
  ADR 0014 ([Post-v0.1 product-configuration ownership](0014-read-only-v0-1-management-plane.md#post-v01-product-configuration-ownership),
  [Existing-database evolution and first-run setup](0014-read-only-v0-1-management-plane.md#existing-database-evolution-and-first-run-setup),
  [Saved configuration and runtime application](0014-read-only-v0-1-management-plane.md#saved-configuration-and-runtime-application),
  [Read-only management scope](0014-read-only-v0-1-management-plane.md#read-only-management-scope)
  for post-v0.1 Gateway editing and its pre-write access/secret design gate)
- Related: ADR 0001, ADR 0003, ADR 0005, ADR 0011, ADR 0012, and ADR 0016
- Review entry: [`managed-config-foundations`](../decision-log.md#managed-configuration-and-release-foundations)

The owner accepted this direction and authorized the first Gateway configuration batch on
2026-11-02. Acceptance of the architecture does not authorize all subsequent implementation
batches or resolve their open security, migration, and Agent Host details.

## Context

Released v0.1 seeds topology from YAML into an empty SQLite database once and then freezes it.
Agent Host settings are resolved from YAML and environment variables at each startup and are not
persisted. ADR 0002, ADR 0008, and ADR 0014 accepted SQLite as the future authoritative product
configuration store, with restart-applied topology mutation as the baseline.

The owner now proposes a different direction for the managed-configuration workstream: keep
declarative configuration files as the single source of truth, provide first-party frontend
settings that edit those files through the backend, and apply topology and Agent Host runtime
changes without restarting the process. Process-level settings, such as listeners and future
extension loading, remain restart-applied.

Existing implementation evidence relevant to live application:

- Bridge Sessions capture one immutable `EndpointPlan` built from immutable endpoint and upstream
  revisions, and `bridge_sessions` reference the exact endpoint revision they used.
- Upstream runtimes and their SDK contexts are owned per bridge Session under ADR 0005, so a new
  topology does not require draining shared upstream connections.
- `PublishedTopology` is loaded once and rebuilt in place; it has no atomic replacement contract.
- `seed-if-empty` makes a populated database ignore later YAML topology changes.
- The Compose deployment bind-mounts a single `mabrid.yaml` file read-only. A single-file bind
  mount cannot be replaced atomically from inside the container, and host-side replace-on-save
  edits may not reach the container.

## Decision

### Two configuration classes in separate files

Configuration is split by how it is applied:

| Class | Settings | Application |
| --- | --- | --- |
| Static process configuration | Listener host and port, advertised base URL, storage path and migration policy, logging, diagnostic upstream selection, and future extension loading | Loaded at process start; a later change is reported as restart required and never partially applied |
| Dynamic runtime configuration | Upstreams and transport connection settings, endpoints and endpoint-owned bindings, Agent Host enablement, Target, endpoint assignment, runtime integration, interface, connection, and deployment binding settings, and future UI preferences | Applied by a validated configuration generation without restarting the process |
| Secret values | Host credentials and upstream connection values | Host credentials use startup environment-variable references; upstream headers and subprocess environment values may remain literal values in the runtime file, never returned by management reads |

The static file remains `mabrid.yaml`. It is read-only to the management API. The dynamic settings
move to `mabrid.runtime.yaml` in the same directory as the static file; no separate path setting is
required for the initial design. A missing or empty runtime file is a valid unconfigured
installation: the process starts, publishes no endpoints, keeps Agent Host disabled, and reports
Gateway readiness as not ready. Gateway topology is accepted only from the runtime file;
`upstreams` and `endpoints` in the static file are errors. There is no single-file import or fallback.
The developer preview does not promise old-format or old-database upgrade compatibility.
Agent Host settings are accepted only from the runtime file; `agentHost` in the static file is an
error. Until the separate Host application batch, they remain restart-applied: an apply whose
`agentHost` section differs from the one the process started with, including a disabled section, is
rejected as a whole and reported as restart required, never partially applied. Without a Host
ledger, an invalid runtime file at startup leaves the Host disabled and reports the error.

Rotation of startup environment values, including variables not present at startup, requires a restart.
A reloadable secret source is deferred. Management reads and errors never return secret values.
The existing global `bridge.httpxTimeoutSeconds` remains unchanged and restart-applied in the first
batch. The 2026-11-10 editing amendment explicitly retains literal upstream values; management
writes distinguish preserving, replacing, and removing values without returning their originals.
Literal upstream header changes follow explicit Gateway apply for new Sessions, rather than the
earlier blanket secret-rotation restart rule; existing Sessions retain their captured revisions.

### Files are the configuration authority

The configuration files are the single source of truth for desired configuration. The frontend is
an editing surface over typed management APIs that validate and write the runtime file. Operators
may also edit the files directly. Neither the frontend nor the database is a competing authority.

SQLite stops being the configuration authority and becomes the applied-configuration ledger:

- immutable upstream, endpoint, and binding revisions remain the durable identities referenced by
  Session history;
- head pointers record the last successfully applied configuration, not an independently edited
  state;
- the ledger is written only by the apply pipeline below, never by direct management edits; and
- the ledger is the last-known-good configuration. If the runtime file is invalid at startup, the
  process starts from the ledger heads and reports the configuration error rather than refusing to
  start. Without a ledger, it starts unconfigured.

Agent Host settings that the ledger must restore are recorded as applied revisions with secret
references, not secret values. Persisting Agent Sessions still does not persist Target
configuration by itself.

### Reconciliation replaces seed-if-empty

Startup and every later apply use the same reconciliation against the ledger:

1. Configuration keys are the stable object identities, normalized to slugs. Two keys that
   normalize to the same slug are a validation error.
2. An object whose effective definition is unchanged produces no new revision.
3. A changed object gets a new immutable revision and an advanced head. An upstream change also
   creates coherent new revisions for every current endpoint that binds it, as ADR 0008 requires.
4. An object removed from the file has its head disabled. History, revisions, and Session
   references are retained. Restoring the same key re-enables that identity with a new revision.
5. Renaming a key means disabling the old identity and creating a new one. Explicit rename
   identifiers are deferred.

Reconciliation reuses stable slugs and preserves historical references in the current schema.
Conflicting input is rejected rather than silently discarding existing state. Normal startup
applies runtime configuration instead of ignoring it, removing the populated-database freeze.
The preview may change its schema without an old-database upgrade path; the server must never
automatically delete or reset a database. Removing upgrade compatibility does not weaken revision,
Session, or unsettled-Run preservation during normal application.

### Generation-applied runtime configuration

The running process serves one immutable active configuration snapshot with a monotonically
increasing, process-local generation number. A snapshot contains the published endpoint index and
its executable plans, the effective Agent Host configuration, and future UI preferences.

Applying a configuration is serialized and atomic:

1. Read the runtime file and record its content hash.
2. Parse and validate it, including cross-object checks such as binding cardinality, namespace
   uniqueness, and Agent Host endpoint assignment to an endpoint enabled in the same candidate.
3. Resolve secret references and detect static-file changes, which only set restart required.
4. Build the complete candidate snapshot, including executable plans.
5. Reconcile the ledger in one short database transaction.
6. Replace the active snapshot reference and publish a generation-change event.
7. Release the previous snapshot after its last captured user finishes.

Any failure before step 6 leaves the active generation unchanged and reports the failure with the
file hash. Partial application is not allowed. A database commit followed by a failure to replace
the in-memory reference is not an expected path; if it occurs, the ledger heads are reloaded.

In-flight work is not interrupted:

- A bridge Session captures its endpoint plan at creation and keeps it until it closes naturally.
  Existing Sessions are not migrated, closed, or notified with `list_changed` because of a new
  generation. New Sessions use the active generation; removed or disabled endpoints are not found
  for new Sessions.
- Agent Host Session and Run operations capture the Agent Host snapshot when they start. New
  runtime clients serve only later operations; old clients close after their last captured
  operation finishes.
- A generation that changes the Target identity or the runtime deployment binding is rejected as a
  whole while that Target has an active or unknown Run. Such a change never reassigns existing Agent
  Sessions to another remote deployment or releases an unsettled Run lease. Changing a runtime
  address under an unchanged deployment binding requires the deployment-identity design tracked by
  the review entry before it can be accepted.

### Triggers and management writes

Application is triggered at startup and by an explicit management apply operation. File watching
is deferred and, if added later, must use the same pipeline with change coalescing.

Management writes validate the complete candidate before writing. They use optimistic concurrency
based on the runtime file's content hash, reject stale writes with a conflict, and replace the file
atomically within its directory. A file that fails validation is never written by the API.
The eventual first-party settings surface supports creating, inspecting, revising, enabling, and
disabling upstreams and endpoints, including their bindings, without destructive history deletion.
On 2026-11-10 the owner approved the Gateway editing batch with the existing unauthenticated access
model, explicitly deferring access-control changes. This amends the earlier pre-write access-design
gate; these operations are not safe to expose to untrusted clients. Access control still requires
joint review with the MCP Gateway and deployment topology. The runtime file contains sensitive
values and requires operator-managed access protection.

The editor uses typed whole-document Gateway writes and preserves the untouched Agent Host section
and YAML comments. HTTP header values are write-only with preserve/replace/remove operations.
Existing stdio entries only permit enablement changes; command, arguments, working directory, and
environment remain file-managed. Agent Host editing and live application are outside this batch.

Deployments that allow frontend editing mount a writable configuration directory rather than a
single runtime file. The static file may remain read-only.

### Management reads

Management reads distinguish the active generation, including its number, applied file hash, and
time, from the current file state, including its hash, validity, latest error, and whether it
differs from the active generation. Restart required is reported for static configuration changes
and, until Host generation application is delivered, changes to the complete Agent Host section.
This replaces the topology `restart_required` latch proposed by ADR 0008.

### Preserved constraints

- Immutable revisions, coherent dependent endpoint revisions, revision-pinned bridge Sessions,
  and non-destructive configuration reconciliation. Removal disables heads without deleting history.
- Management routes remain separate from MCP data-plane routes and redact sensitive connection
  values. Direct database mutation is unsupported; configuration writes go through the file contract.
- Users, service managers, and deployment shells own process restarts. The Gateway exposes no
  process-restart API. Future desktop sidecar supervision remains shell-owned under ADR 0007.
- One active Agent Target, endpoint assignment rules, and deployment-binding protections from
  ADR 0011, ADR 0012, and ADR 0016.
- Binding-level degradation from ADR 0003 and per-Session upstream task ownership from ADR 0005.
- Connection recovery is not business-operation retry; no generation change replays tool calls or
  Runs.
- No user configuration or secrets in OCI images.
- Management does not configure external runtime internals.

### Explicitly excluded

- Active-session topology migration or forced closure on configuration change.
- File watching in the first delivery, reloadable secrets, and a process-restart API.
- Durable draft/published workflows and rollback orchestration beyond keeping the previous
  generation active on failure.
- Shared or pooled upstream connections, multiple active Targets, and runtime registries.
- Explicit object identifiers for renames.

## Alternatives

- SQLite as configuration authority edited by management APIs, as accepted in ADR 0014: not
selected because files remain directly reviewable and editable as the single
  declarative source, while the database retains its ledger and history roles.
- Keep restart-applied topology: not selected because the existing revision pinning already
  provides the isolation needed for safe new-Session application.
- One file with static and dynamic sections: not selected because API writes would rewrite process
  settings and deployments could not separate read-only and writable mounts.
- Fail startup on an invalid runtime file: not selected because the ledger can provide a
  last-known-good configuration.
- Close Sessions on removed endpoints after a grace period: not selected; Sessions end naturally.

## Consequences

- Editing the runtime file followed by an apply, or a restart, takes effect on populated databases.
- The frontend and direct file edits share one validation and application path.
- `PublishedTopology` and Agent Host composition need replaceable immutable snapshots.
- Agent Host applied settings need ledger persistence for last-known-good startup.
- Compose deployment changes from a single read-only file mount to a configuration directory for
  writable installations.
- Startup environment-secret changes remain restart-applied; literal upstream header changes use
  explicit Gateway apply under the 2026-11-10 amendment.

## Implementation Status

The first Gateway configuration batch has controlled test and isolated browser evidence in the
decision log. Runtime-only cleanup was approved on 2026-11-03. On 2026-11-04 Agent Host settings
moved to the runtime file with unchanged fields and restart-applied behavior. Agent Host live
application and Host last-known-good persistence remain separate later batches. On 2026-11-10 the
bounded Gateway runtime-file editor was implemented with controlled file/API/frontend tests and
isolated browser evidence recorded in the decision log. Host editing, broader secret-reference
contracts, and access hardening remain deferred. Compose integration is deferred and is not
evidence of runtime-only deployment support.
