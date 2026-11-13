# ADR 0018: File-Authoritative Configuration and Generation-Applied Runtime Configuration

- Status: Accepted
- Date: 2026-11-02
- Amended: 2026-11-03; runtime-only developer-preview configuration
- Amended: 2026-11-10; bounded Gateway file editing, literal header operations, and deferred access hardening
- Amended: 2026-11-11; Host identity, idle-only replacement, component-scoped application/settings, and no Host last-known-good restoration
- Amended: 2026-11-12; explicit runtime-file placement, write-only Host credentials, and container deployment integration
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
| Secret values | Host credentials and upstream connection values | Host credentials explicitly select environment references or write-only literal runtime values; management reads never return values |

The static file remains `mabrid.yaml`. It is read-only to the management API. The dynamic settings
move to `mabrid.runtime.yaml`. The initial adjacent-file default remains available; the 2026-11-12
amendment below permits explicit placement without changing other relative-path bases.
A missing or empty runtime file is a valid unconfigured
installation: the process starts, publishes no endpoints, keeps Agent Host disabled, and reports
Gateway readiness as not ready. Gateway topology is accepted only from the runtime file;
`upstreams` and `endpoints` in the static file are errors. There is no single-file import or fallback.
The developer preview does not promise old-format or old-database upgrade compatibility.
Agent Host settings are accepted only from the runtime file; `agentHost` in the static file is an
error. Until the separate Host application batch, they remain restart-applied: an apply whose
`agentHost` section differs from the one the process started with, including a disabled section, is
rejected as a whole and reported as restart required, never partially applied. This describes the
current delivery, not a requirement for the idle-only Host policy accepted on 2026-11-11 below.
Invalid Host configuration at startup leaves the Host unavailable and reports the error; a Host
configuration recovery ledger is not required by the amended policy.

Rotation of startup environment values, including variables not present at startup, requires a restart.
A literal Host credential can instead be changed through the runtime file under the 2026-11-12
amendment below. Management reads and errors never return secret values.
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

These configuration-ledger and last-known-good requirements apply to Gateway topology. The
2026-11-11 amendment removes the proposed Host configuration-revision and startup-restoration
requirements. Agent Session identity, deployment bindings, and unresolved Run ownership remain
durable independently of configuration history. Any later Host application record is diagnostic
state, not an alternative configuration authority or an automatic recovery source.

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

The Gateway serves one immutable active topology snapshot with a monotonically increasing,
process-local generation number. It contains the published endpoint index and executable plans.
The 2026-11-11 amendment does not require the Host to share this revision model or Agent Sessions
to pin a configuration generation. The original shared Gateway/Host snapshot requirement is
replaced by the Host and component-scoped application contracts below. There is no cross-component
atomic apply in the bounded Host batch.

The delivered Gateway application pipeline is serialized and atomic:

1. Read the runtime file and record its content hash.
2. Parse and validate it, including cross-object checks such as binding cardinality, namespace
   uniqueness, and Agent Host endpoint assignment to an endpoint enabled in the same candidate.
3. Resolve secret references and detect static-file changes, which only set restart required.
4. Build the candidate Gateway snapshot, including executable plans.
5. Reconcile the ledger in one short database transaction.
6. Replace the active snapshot reference and publish a generation-change event.
7. Release the previous snapshot after its last captured user finishes.

Any failure before step 6 leaves the active generation unchanged and reports the failure with the
file hash. Partial application is not allowed. A database commit followed by a failure to replace
the in-memory reference is not an expected path; if it occurs, the ledger heads are reloaded.

In-flight Gateway work is not interrupted:

- A bridge Session captures its endpoint plan at creation and keeps it until it closes naturally.
  Existing Sessions are not migrated, closed, or notified with `list_changed` because of a new
  generation. New Sessions use the active generation; removed or disabled endpoints are not found
  for new Sessions.

### Host identity and idle-only reconfiguration

On 2026-11-11 the owner accepted a simpler Host policy rather than Gateway-style revision-pinned
Sessions, multiple live client generations, or a Host last-known-good configuration ledger:

- Logical Host identity includes `targetId` and runtime `integration`. Changing either selects a
  new logical Host; old Agent Sessions must not silently acquire that identity. `targetId` is the
  local product identity, not proof of a remote Agent's identity. This does not add integrations
  beyond the currently supported Hermes template or permit multiple active Targets.
- Native `bindingId` identifies the remote deployment separately from logical Host identity.
  Changing it does not reassign existing Sessions or unresolved Runs. A connection URL may change
  without selecting a new Host when the operator explicitly declares the same deployment binding;
  a URL by itself does not prove deployment identity. Automatic deployment verification remains
  outside this amendment. The supported Hermes compatibility interface remains unchanged; native
  Session support is additive and follows the capability transition rules below.
- Reconfiguration requires no in-flight Host operation and no active or unsettled Run. Operation
  admission and replacement share a serialization boundary: an idle check followed by an unguarded
  replacement is insufficient. Running operations use a stable client until completion; later
  operations may use updated connection settings without permanently pinning their Agent Session
  to the old configuration. There is no requirement to keep multiple executable Host generations.
- Process-wide single-Target execution ownership, durable Run claims, and tool/App attribution
  survive client replacement. Recomposition must not reset them or infer remote termination from
  an absent local request. Gateway changes with an unchanged Host are not blocked merely by Host
  activity. A file changing both components requires their separate apply operations; applying one
  component does not publish or mark the other component applied.
- Invalid Host startup configuration makes the Host unavailable with an explicit error. Do not
  restore an earlier Host configuration from SQLite. A failed runtime application leaves the
  current Host in place and reports the desired change as unapplied. Preserving that running
  instance is distinct from restoring historical configuration after restart.

Gateway revisions and last-known-good startup are unchanged. Static process settings and startup
environment-secret rotation remain restart-applied. A whole-file save hash alone cannot establish
that both components applied the same content.

### Component-scoped application and capability transitions

The owner selected separate Gateway and Host application on 2026-11-11. Each apply validates and
publishes only its own component; no endpoint or Settings action implicitly applies the other.
Gateway topology retains its atomic revision/publication pipeline. Host replacement is atomic
within its idle-only lifecycle boundary. Neither component promises a transaction spanning both.

Cross-component dependency validation belongs to server composition, not Gateway core. Host apply
checks its assignment against the currently published Gateway endpoints. Gateway apply checks the
running Host assignment rather than a pending Host configuration. A pending or busy Host does not
unconditionally block Gateway application. Endpoint migration therefore requires publishing the
new endpoint while retaining the old, applying the Host assignment, then removing the old endpoint;
the owner accepted this staged workflow instead of cross-component atomic application.

Hermes `interface` stays `openai-chat-completions`. The optional native Session configuration adds
capabilities rather than selecting a different compatibility interface. Under the same idle guard,
native Session support can be enabled or disabled without deleting persisted Session records.
Disabled native support does not perform remote Session operations or provide offline runtime
history. Re-enabling the same logical Host and deployment binding permits existing Session access;
different identities or bindings do not adopt those Sessions. No new integration/interface is
implemented by this contract.

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
environment remain file-managed. Host editing and live application were outside the 2026-11-10
Gateway batch; the separate 2026-11-11 contract now permits bounded Host editing and application.

The Host writer exposes existing Hermes settings and environment-variable reference names, never
resolved credentials. It writes only the Host section while preserving Gateway configuration and
comments. Both section writers share serialization and the complete file's expected-hash check;
saving does not switch either runtime and need not wait for Host idleness. Static process settings
are never written by these APIs.

The owner explicitly extended the trusted-deployment access-hardening deferral to Host management
reads, writes, and application on 2026-11-11. This amends ADR 0014's earlier pre-write gate for that
bounded surface; it does not authorize untrusted access or broader remote runtime administration.
Changing runtime addresses or credential-reference names can change where credentials are sent.
No authentication or origin-security boundary is established by CORS or this deferral.

Deployments that allow frontend editing mount a writable configuration directory rather than a
single runtime file. The static file may remain read-only.

### Management reads

Management reads distinguish the active generation, including its number, applied file hash, and
time, from the current file state, including its hash, validity, latest error, and whether it
differs from the active generation. Restart required is reported for static configuration changes
and, until Host generation application is delivered, changes to the complete Agent Host section.
This replaces the topology `restart_required` latch proposed by ADR 0008.

After component-scoped application is implemented, applied/desired and pending/error status belong
to each component. Changes or comments in one section do not imply that the other needs application.
The complete file hash remains an optimistic concurrency token and must not imply global application
success. Host application status may remain in process; startup resolves the file rather than
restoring status as configuration. This creates no durable Host configuration history/recovery
table and does not weaken persistent Session/Run ownership.

### Runtime-file placement and Host credential rotation (2026-11-12)

The owner approved a bounded deployment and credential amendment after confirming that the Hermes
API key is part of Host runtime configuration and must support idle-only hot replacement.

- Static `runtimeConfigFile` optionally selects an absolute runtime-file path or a path relative to
  the static file's directory. When omitted, the adjacent `mabrid.runtime.yaml` remains the default.
  There is no search, fallback, automatic file move, or import. Database and stdio relative paths
  retain their existing static-directory base. Changing placement requires process restart.
- New deployment templates use a dedicated `runtime/` directory. Only that directory is mounted
  writable for atomic file replacement; the static file remains read-only, environment files remain
  host-side injection inputs, and the existing data volume and database path are preserved.
  Native Unix/PowerShell tooling remains independent of host Python and never resets storage.
- Host credentials explicitly select either an environment-variable reference or a literal runtime
  configuration value, never both. Environment injection remains supported; changing injected values
  requires container recreation. Switching to a literal value permits rotation without recreation.
  No independent secret-file provider, secret registry, or implicit fallback is introduced.
- Host credential reads expose only source, reference name, and configured state. Writes preserve
  existing values or explicitly replace/select a source; ordinary edits never round-trip the value.
  Empty replacement is invalid. File persistence contains plaintext and requires operator-managed
  permissions and backup protection. Safe errors, logs, status, and contract examples omit values.
- A credential-only change must make the desired Host pending and rebuild both compatibility and
  native clients under the existing idle guard. Public component fingerprints must not expose a
  reusable digest of a secret; an opaque process-keyed fingerprint includes effective credentials
  without publishing an ordinary secret digest or persisting a Host configuration history.
  Save remains separate from application. Failed local preparation keeps the current Host.
- Successful application confirms local client replacement, not remote authentication. A later
  authentication failure is reported without secret fallback or automatic business-operation retry.
  Rotation preserves Target/integration identity, deployment binding, Session IDs, and unsettled
  ownership. No real Agent/MCP operation is required to validate this batch.

This amends the earlier Host environment-reference-only rule and the initial adjacent-only placement
rule, not the trusted-deployment access boundary. Access hardening remains explicitly deferred.

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
- Durable draft/published workflows and rollback orchestration beyond keeping the current
  runtime active on application failure; Host last-known-good startup restoration.
- Shared or pooled upstream connections, multiple active Targets, and runtime registries.
- Explicit object identifiers for renames.
- Cross-component atomic apply, new integrations/interfaces, and offline Agent history in the
  bounded Host reconfiguration and Settings batch.

## Alternatives

- SQLite as configuration authority edited by management APIs, as accepted in ADR 0014: not
selected because files remain directly reviewable and editable as the single
  declarative source, while the database retains its ledger and history roles.
- Keep restart-applied topology: not selected because the existing revision pinning already
  provides the isolation needed for safe new-Session application.
- One file with static and dynamic sections: not selected because API writes would rewrite process
  settings and deployments could not separate read-only and writable mounts.
- Fail the entire process on an invalid runtime file: not selected because Gateway topology can
  use its last-known-good ledger. Host configuration has no historical recovery under the
  2026-11-11 amendment; it remains unavailable with a reported configuration error instead.
- Pin Agent Sessions to Host configuration revisions and retain multiple executable Host
  generations: not selected in the 2026-11-11 amendment. Idle-only replacement preserves stable
  clients for operations without introducing that lifecycle or a Host recovery ledger.
- Close Sessions on removed endpoints after a grace period: not selected; Sessions end naturally.

## Consequences

- Editing the runtime file followed by an apply, or a restart, takes effect on populated databases.
- The frontend and direct file edits share one validation and application path.
- Gateway publication retains immutable revision snapshots; Host composition needs safe idle-only
  replacement with admission control, not a matching configuration-revision model.
- Host Session/Run ownership persists without requiring a Host configuration recovery ledger.
- Compose deployment changes from a single read-only file mount to a configuration directory for
  writable installations.
- Startup environment-secret changes remain restart-applied; literal upstream header changes use
  explicit Gateway apply under the 2026-11-10 amendment.

## Implementation Status

The first Gateway configuration batch has controlled test and isolated browser evidence in the
decision log. Runtime-only cleanup was approved on 2026-11-03. On 2026-11-04 Agent Host settings
moved to the runtime file with unchanged fields and restart-applied behavior. On 2026-11-10 the
bounded Gateway runtime-file editor was implemented with controlled file/API/frontend tests and
isolated browser evidence recorded in the decision log. The 2026-11-11 idle-only Host application
and Settings batch is implemented with separately recorded controlled evidence. The 2026-11-12
placement, literal Host credential rotation, and deployment integration amendment is implemented
with controlled test/browser evidence recorded in the decision log. Host last-known-good restoration is excluded
rather than pending delivery. Broader secret providers and access hardening remain deferred.
Controlled verification is not evidence of live Agent/MCP or container acceptance.
