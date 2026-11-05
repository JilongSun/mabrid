# Architecture Decision Log

## Reading And Review

Use [Decision Governance](decision-governance.md) for lifecycle transitions, owner approval,
scoped delivery assessments, and review of coupled decisions. Start with the active change-set
entry below; follow only its relevant ADR sections and amendments. Current publication facts and
active reviews are the default context. Read the historical reference area and archived ADRs only
when a task needs them; unrelated accepted decisions remain binding but are not loaded by default.

This log separates accepted product and architecture decisions from their current implementation
state. ADRs remain historical records; implementation notes may advance without rewriting the
original context or decision. The single ADR inventory is retained under Historical References;
its dated delivery assessments are not a list of independent implementation tickets. See
[context selection and archiving](decision-governance.md#context-selection-and-archiving).

## Current Publication And Governance Position

As of 2026-10-26, the owner has confirmed that v0.1 is formally released. This is an owner-reported
publication fact, not a fresh independent audit of release artifacts or all deployment scenarios.
On 2026-11-03 the owner clarified that the product remains a developer preview: publication does
not imply stable interfaces or a supported upgrade path for prior preview databases.
Continued real-world validation and known defect follow-up do not reopen release preparation.
The dated implementation and deployment evidence below remains historical and is not silently
promoted to completed live acceptance.

The owner approved the two long-lived workstream boundaries in
[Decision Governance](decision-governance.md#workstream-and-integration-boundaries) and explicitly
authorized adoption of the lightweight governance process before the next product implementation
batch. No product design, Git branch, workflow, tag, or release artifact is created by that approval.

## Active Change-Set Reviews

### Managed Configuration And Release Foundations

- Review identifier: `managed-config-foundations`.
- Workstream: `feat/managed-config-and-recovery`.
- Review state: **Approved for the Agent Host runtime-file location batch**. The owner accepted
	[ADR 0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md)
	and authorized the bounded batches below; later batches and unresolved details require review.
- Delivery: the first Gateway configuration skeleton, runtime-only cleanup, and the Agent Host
	runtime-file location are implemented; verification is recorded below. Agent Host generation
	application and runtime-file editing are not included.
- Next eligible work: the frontend configuration entry and runtime-file editing design.
	Agent Host live application, deployment integration, and the other remaining batches require
	their own scope review.

#### Agent Host Runtime-File Location (2026-11-04)

The owner kept the Agent Host product position, fields, and behavior unchanged and approved only
moving its settings into the runtime file:

- `agentHost` is accepted only in `mabrid.runtime.yaml` and validated with the Gateway topology as
	one candidate. The static file rejects it; there is no fallback or import.
- Host settings stay restart-applied. An apply whose `agentHost` section differs from the one the
	process started with, including changes to a disabled Host, is rejected as a whole with
	`configuration_restart_required` and status reports restart required.
- An invalid runtime file at startup, including a missing Host API-key variable or advertised base
	URL, starts with the Host disabled and reports the runtime-file error. Host last-known-good
	persistence remains part of the later Host application batch.
- Deployment identity, single-runtime address derivation, cross-Session behavior, and remote
	capability expression are deferred to later discussion, not this workstream.

Verification on 2026-11-04:

- `uv run --all-packages pytest -q --tb=short`: 416 tests passed, including static rejection of
	`agentHost`, runtime-file Host resolution and errors, a whole-section Host signature, and
	rejection of changed enabled or disabled Host settings without changing the publication or
	generation.
- `uv run pyright`, `uv run ruff check`, and `uv run ruff format --check`: passed. The frontend
	contract check reports no drift.
- `pnpm test src/features/gateway`: 62 tests passed, including the restart-required message.
	`pnpm typecheck` and `pnpm lint` passed.
- No live Agent/MCP operations or container acceptance were performed. Deployment documentation
	and Compose artifacts still describe the earlier layout until a delivery review.

#### Runtime-Only Preview Cleanup (2026-11-03)

The owner approved a breaking simplification rather than an old-format migration:

- `mabrid.runtime.yaml` is the only file source for Gateway topology. Static-file topology keys
	are rejected, not ignored or imported. Missing runtime configuration means unconfigured.
- Remove legacy selection, adoption markers, seed-only persistence, and old-database compatibility
	tests. Keep immutable revisions, Session/Run references, atomic publication, and last-known-good
	recovery as current behavior, not as backward compatibility.
- Setup creates the static and runtime examples independently and never overwrites existing files.
- The preview configuration-state schema may change in place; no upgrade from the earlier
	adoption-marker schema is supported. Startup must not automatically reset an existing database.
- Agent Host stayed in the static configuration in this batch; it moved on 2026-11-04 (above).
	Compose integration is deferred; the existing deployment artifacts do not establish support for
	this runtime-only layout. Container acceptance is outside this batch.
- ADR 0018 replaces all of ADR 0008, including its surviving revision, Session, management-routing,
	and restart-ownership constraints. ADR 0008 is archived at its existing path. ADRs 0002 and 0014
	remain accepted for persistence and management contracts; their preview upgrade requirements are
	amended, not grounds for wholesale archival.

Verification on 2026-11-03:

- `uv run --all-packages pytest -q --tb=short`: 412 tests passed, including strict file separation,
	missing/invalid runtime files, startup/application, revision and Session/Run preservation,
	current-schema creation without the adoption marker, and POSIX/PowerShell setup idempotence.
	Launcher tests use a fake Docker command and temporary directories, not a container engine.
- `uv run pyright` and `uv run ruff check`: passed. Changed Python files are Ruff-formatted;
	Pylance reports no diagnostics in the loader or configuration coordinator.
- `pnpm test src/features/gateway/configuration-controls.test.tsx src/features/gateway/endpoints-view.test.tsx`:
	35 tests passed. `pnpm typecheck` and `pnpm lint` passed. The generated frontend contract removes
	the legacy source value; no old API shape is retained.
- No live Agent/MCP operations or container acceptance were performed. Delivery artifacts remain
	outside this cleanup; the earlier Compose documentation does not describe the runtime-only layout.

#### Approved Outcome And Boundaries

The core outcomes are first-party managed product configuration backed by authoritative YAML files,
plus basic CI and version-tag-triggered releases with automatic source-version handling. Topology mutation,
Agent Host/runtime configuration improvements, recovery, and historical deferrals are supporting
work only where necessary for those outcomes or where the owner separately approves inclusion.
They are not four equal mandatory workstreams or permission to complete every Pending ADR.

Keep `explore/frontend-experience` as the separate long-lived experience exploration workstream.
Deliver the functional management frontend with its backend feature. Do not combine unrelated
navigation, visual, or interaction-model experiments with configuration delivery. Basic CI may
land as an independently verified slice without making it a separate product objective.

#### Coupled Decision Map

| Concern | Existing authority to preserve | Required reconciliation before the affected batch |
| --- | --- | --- |
| Configuration authority and write scope | [0002](decisions/0002-sqlite-persistence-and-configuration-authority.md), [0014](decisions/0014-read-only-v0-1-management-plane.md#post-v01-product-configuration-ownership), [0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md) | YAML is the desired-state authority and SQLite retains applied revisions; first-run setup, general write protection, and secret handling remain to be designed without destructive database updates |
| Revision writes and runtime application | [0014](decisions/0014-read-only-v0-1-management-plane.md#saved-configuration-and-runtime-application), [0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md) | Apply dynamic configuration through immutable generations while preserving dependent endpoint revisions and active Session ownership; process settings remain restart-applied |
| Runtime configuration and durable ownership | [0011](decisions/0011-single-agent-target-and-endpoint-assignment.md), [0012](decisions/0012-agent-runtime-profiles-and-integration-composition.md), [0016](decisions/0016-session-oriented-host-and-frontend-contract-readiness.md) | Reconcile Target assignment, integration/interface selection, deployment identity, active/unknown Runs, and old Session bindings before changing configuration ownership |
| Fault handling required by configuration delivery | [0003](decisions/0003-mcp-apps-gateway-and-optional-agent-host.md), [0005](decisions/0005-upstream-transport-task-ownership.md), [0013](decisions/0013-backend-semantic-boundaries-and-mabrid-code-identity.md) | Preserve degradation and worker ownership; identify the actually necessary timeout/recovery slice, if any, rather than approving a general recovery system |
| CI, versions, and release artifacts | [0004](decisions/0004-first-release-scope-and-distribution.md), existing OCI/native workflow, owner-approved workstream goal | Select source-version ownership, lockfile/build behavior, tag mapping, and CI permissions together; managed YAML removal does not require build-time secrets or user configuration |

ADR 0014 narrowed v0.1 delivery, not the permanent configuration goal. The preview cleanup removes
upgrade compatibility, not the requirement to retain history during normal configuration changes.
Automatic database reset remains unsupported. The new API/secret contracts still need design.

#### Accepted Configuration Direction

On 2026-11-02 the owner accepted declarative configuration files as the single source of truth
and generation-applied topology and Agent Host runtime configuration:

| Choice | Selected direction |
| --- | --- |
| Database role | Applied-configuration revision ledger and last-known-good startup source |
| File layout | Read-only static `mabrid.yaml` plus a writable dynamic runtime file in a mounted directory |
| Object identity | Configuration keys normalized to slugs; a rename disables the old identity and creates a new one |
| Removed or disabled endpoint | Existing bridge Sessions continue until they close naturally |
| Secret value changes | Restart-applied for now |
| Apply trigger | Explicit management apply and startup; file watching deferred |

Accepted amendments and replacement:

- ADR 0002 configuration boundary: files, not SQLite, are the configuration authority; reconciliation
	replaces `seed-if-empty`.
- ADR 0008 is fully superseded by ADR 0018: dynamic configuration is applied as an atomic immutable
	generation for new work. Revision pinning, dependent endpoint revisions, Session isolation,
	management boundaries, and external restart ownership remain explicit in the replacement.
- ADR 0014 post-v0.1 ownership, first-run setup, and saved/running application: the frontend edits
	the runtime file through validated APIs; an absent runtime file is a valid unconfigured state.

Remaining design items for their affected batches:

- Ledger representation of applied Agent Host settings for last-known-good startup.
- Any later optimization of the existing global upstream HTTP timeout; retain its current behavior
	in the first batch.
- Runtime address changes under an unchanged deployment binding (local issue LOCAL-002).
- Management and MCP Gateway access boundaries, and secret-reference set/preserve/replace/clear
	semantics. The owner deferred authentication for the development-stage apply-only operation;
	this does not approve unprotected general file-writing management or untrusted deployment.
- Comment and formatting preservation when the API rewrites the runtime file.

Delivery order:

1. **Approved Gateway configuration skeleton**: split static and dynamic configuration models and allow an empty
	 topology; replace `seed-if-empty` with ledger reconciliation; introduce the immutable active
	 snapshot with generation numbers and atomic published-endpoint replacement; add explicit Gateway
	 topology apply, management reads of active generation and file state, and their supporting frontend
	 states. Preserve existing Agent Host startup behavior until its separate batch.
2. **Agent Host generation application**: snapshot capture by Session and Run operations, deferred
	 client release, unsettled-Run guards, ledger persistence, and the deployment-identity decision.
3. **Management writes and frontend settings**: write protection, validated atomic file writes with
	 hash-based conflicts, secret-reference semantics, and settings pages.
4. **First-run setup** and optional coalesced file watching.

Later batches require their own approval.

#### Questions For Subsequent Reviews

1. What write-access trust boundary and secret set/preserve/replace/clear contract apply? Which
	 runtime address/deployment-binding changes can be accepted while execution is active or unknown?
2. What is the complete Host configuration transaction and application contract,
	 including dependent revisions, conflict responses, and preserved Session ownership?
3. Which source-version strategy feeds backend, frontend, and OCI builds, and what is the first
	 credential-free CI slice? Generated build files and committed version changes are different choices.
4. Is any broader automatic recovery/backoff work necessary now, or should it remain separately
	 scoped? SDK v2/Session redesign and full model unification remain outside this workstream.

Present later choices as coupled decisions with concrete alternatives and a bounded batch. If a
choice changes an accepted clause, identify the exact amendment and surviving constraints before
seeking approval.

#### Dispositions And Verification

- 2026-10-26, owner: approved the two long-lived workstream boundaries and functional frontend/backend
	co-delivery; narrowed this workstream to managed configuration and CI/tag publishing.
- 2026-10-26, owner: explicitly selected direct adoption of lightweight ADR governance before
	further product implementation.
- 2026-11-02, owner: accepted ADR 0018 and approved the first Gateway configuration batch.
	The initial runtime file is `mabrid.runtime.yaml` beside `mabrid.yaml`; retain the existing
	global HTTP timeout behavior and defer its optimization.
- 2026-11-02, owner: deferred authentication for the development-stage apply-only operation and
	requested separate review together with the MCP Gateway boundary. This does not authorize
	general file-writing management or establish security for untrusted deployment.
- Owner clarification: the developer-preview Gateway status contract may change in place rather
	than preserving an obsolete frozen topology mode. Runtime-file hot application in the standard
	Compose deployment is deferred; the first batch must document that limitation.
- 2026-11-02, implementation evidence: controlled backend tests cover populated-database migration,
	revision and Session preservation, application conflicts, cancellation and ledger recovery,
	last-known-good startup, and isolation of old and new Gateway Sessions. An adopted runtime-file
	marker also prevents invalid legacy topology from being selected after the runtime file is removed.
	Backend tests, Pyright, and Ruff passed.
- 2026-11-02, frontend evidence: Vitest, type checking, linting, and a production build passed.
	An isolated browser smoke check used only a mock API to exercise application, conflicts, invalid
	files, unknown outcomes, and recovery messaging; it did not exercise a live Gateway.
- Not verified: real Agent or MCP operations, or Docker/container acceptance. The standard Compose
	deployment does not mount the runtime file. The apply-only management operation has no
	authentication and is not approved for untrusted networks.
- Open: the later Agent Host, management write, security, version, and minimum recovery designs.
- These checks do not establish that API-driven file writes, Agent Host hot application, or release
	automation have been implemented. Their relevant ownership, write-conflict, and verification
	requirements remain for their separately approved batches.

## Archived ADRs

- **2026-11-03 — ADR 0008, Superseded by ADR 0018.** The owner authorized removal of obsolete
	preview compatibility. ADR 0018 replaces database-authoritative, seed-only, restart-applied
	topology and explicitly retains the revision, Session, management, and restart-ownership
	requirements. The original path and historical rationale remain available for reference.

## Historical References

This area is for targeted lookup, not default project context. Its inventory includes decisions
that still govern current behavior; a historical delivery assessment is not an archive designation.

<details>
<summary>ADR inventory and historical delivery evidence (read on demand)</summary>

Read amended decisions together with their amendment notices. Sections labeled Historical
Implementation Snapshot describe their stated date, not current behavior or release obligations.
ADR 0016 is the current authority for session-oriented first-party readiness and Host action scope.
ADR 0017 records follow-up Session compatibility review and model reuse requirements without
changing the v0.1 baseline or its release gates.

Implementation states:

- **Implemented**: the decision is represented in executable code and has focused validation.
- **Partial**: a usable slice exists, but one or more stated behaviors or release checks are absent.
- **Pending**: no executable implementation exists yet.

These are scoped delivery assessments, not decision lifecycle states. Proposed belongs to the
decision lifecycle. The ADR index below retains the historical assessment through 2026-10-22;
current release facts and workstream scope are recorded above. This governance change does not
re-audit every implementation or promote historical verification to live acceptance.

| ADR | Decision status | Implementation state | Summary |
| --- | --- | --- | --- |
| [0001](decisions/0001-managed-endpoints-and-session-ownership.md) | Accepted; amended by 0003, 0008, 0013, and 0014 | Partial | Managed topology, core-owned endpoint dispatch, isolated sessions, and v0.1 read-only management are implemented; writable management is deferred |
| [0002](decisions/0002-sqlite-persistence-and-configuration-authority.md) | Accepted; amended by 0008, 0013, 0014, and 0018 | Partial | SQLite, migrations, revisions, events, and management read adapters exist; v0.1 topology was frozen after seed |
| [0003](decisions/0003-mcp-apps-gateway-and-optional-agent-host.md) | Accepted; amended by 0008, 0010, 0011, 0012, 0014, 0015, and 0016 | Partial | Gateway, read-only management, native sessions, Host HTTP/SSE, frozen contracts, and the first-party frontend are implemented; deployment acceptance and review follow-up remain open |
| [0004](decisions/0004-first-release-scope-and-distribution.md) | Accepted; amended by 0007, 0008, 0012, 0014, and 0016 | Partial | First-party UI, same-origin serving, OCI packaging, and native container commands are implemented; image build evidence does not complete deployment or release acceptance; product Host actions are deferred |
| [0005](decisions/0005-upstream-transport-task-ownership.md) | Accepted | Implemented | Upstream SDK contexts run and close in persistent owner tasks |
| [0006](decisions/0006-core-service-and-server-packages.md) | Accepted | Implemented | Protocol core, application services, and the deployable server are separate dependency-ordered workspace packages |
| [0007](decisions/0007-cembrid-identity-and-deployment-shells.md) | Accepted; brand superseded by 0009 | Partial | The Web/OCI service shell is implemented; Tauri desktop remains deferred and its Cembrid identity is superseded |
| [0008](decisions/0008-restart-applied-managed-topology.md) | Superseded by 0018; archived 2026-11-03 | Historical | Restart-applied managed topology; surviving constraints are now explicit in ADR 0018 |
| [0009](decisions/0009-mabrid-product-identity.md) | Accepted; timing amended by 0013 | Partial | Backend and first-party frontend use Mabrid code identity; hosting and checkout paths are independent, and external hosting metadata requires separate verification |
| [0010](decisions/0010-application-contexts-and-capability-composition.md) | Accepted; amended by 0011, 0012, 0013, 0014, 0015, and 0016 | Partial | v0.1 contexts, typed assembly, native bindings, widget presentation, effective capabilities, frozen contracts, and the first-party UI exist; full deployed workflow acceptance remains open; product Host actions are deferred |
| [0011](decisions/0011-single-agent-target-and-endpoint-assignment.md) | Accepted; amended by 0012, 0014, 0015, and 0016 | Partial | Single Target, endpoint ownership, Run coordination, durable Sessions, restart ownership, and frozen controls complete the backend prerequisite; deployed endpoint/agent validation remains release work |
| [0012](decisions/0012-agent-runtime-profiles-and-integration-composition.md) | Accepted; amended by 0015 and 0016; future configuration ownership clarified by 0014 | Partial | Runtime profiles, discovery, capabilities, and frozen contracts exist; external deployment certification remains release work; frontend-managed runtime configuration is deferred |
| [0013](decisions/0013-backend-semantic-boundaries-and-mabrid-code-identity.md) | Accepted | Implemented | Backend contexts are modularized, MCP transport is core-owned, provisional contracts are removed, and Mabrid code identity is adopted |
| [0014](decisions/0014-read-only-v0-1-management-plane.md) | Accepted; post-v0.1 direction amended by 0018 | Implemented (v0.1 read-only scope) | Read-only management is complete; frontend-managed configuration and non-destructive transition remain post-v0.1 requirements |
| [0015](decisions/0015-agent-host-runs-and-mcp-apps-endpoint-composition.md) | Accepted; amended by 0016 | Partial | Run attribution, fresh resources, timely delivery, frozen contracts, and first-party widget rendering are implemented; review follow-up and full deployed workflow acceptance remain open; product Host actions are deferred |
| [0016](decisions/0016-session-oriented-host-and-frontend-contract-readiness.md) | Accepted | Implemented | All eight backend batches and six frontend prerequisites are complete with frozen contracts and controlled evidence; the subsequent first-party frontend functional baseline is implemented, while deployment and release acceptance remain separate |
| [0017](decisions/0017-protocol-aware-sessions-and-context-owned-model-reuse.md) | Accepted | Pending | Future SDK v2 compatibility must reassess Gateway Session semantics; consolidate model ownership and reuse equivalent definitions without requiring one universal model or expanding v0.1 scope |
| [0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md) | Accepted; amends 0002, 0008, and 0014 | Pending | Configuration files as the single source of truth, SQLite as the applied revision ledger, and generation-applied dynamic topology and Agent Host settings |

## Historical v0.1 Position (2026-10-22)

The aggregate gateway data plane and the ADR 0014 read-only backend management plane are complete
vertical slices. ADR 0015 establishes the composed text-Run and widget baseline. ADR 0016 defines
the completed backend contract milestone used by the subsequent first-party frontend implementation.
The following position reflects implementation progress through 2026-10-22, not completed release
acceptance.

All eight ADR 0016 backend batches are complete: decision reconciliation, source-verified contracts,
[native session use cases with durable bindings](host-session-contract.md), and typed production
assembly with explicit observer and settlement policy, timely tool/widget presentation, and
first-party HTTP/SSE with safe DTOs and Session-bound cancellation/reconciliation, and conservative
capability/availability reporting, and final OpenAPI/SSE/history schema and example freeze.
Bootstrap can select native ports and
restores unresolved ownership before all invocation, validated with controlled HTTP and real
SQLite. Native and compatibility presentation deliver attributed tool activity and optional
widgets during provider pauses, with reader cleanup and unknown-state lease retention. Host routes
are wired to production, enforce admission before SSE headers, expose recovery metadata, and keep
unknown execution owned after disconnect or sending failure. User cancel acknowledgement alone
does not release ownership. `/api/v1/capabilities` now separates local implementation, deployment
selection, remote support, and current discovery availability, using bounded read-only probes of
native and compatibility interfaces independently. Missing evidence stays unknown; Host outages
do not affect Gateway readiness. Frozen snapshots, exact public examples, production schema checks,
and controlled lifecycle tests establish all six backend frontend prerequisites. The backend's
planned v0.1 functional baseline is substantially complete, not a completed product release.

The first-party frontend functional baseline is implemented against the reviewed backend contracts:
Session creation, history and continuation, Run controls and uncertainty handling, tool activity,
page-local widgets, read-only Gateway inspection, and connection/capability status. The server can
serve compiled frontend assets and the sandbox on the same origin. Focused frontend, backend, and
static-serving checks establish implementation evidence, not complete live deployment acceptance.
Review findings remain follow-up work; functional baseline completion is not a claim that no defects
remain.

Hosting migration does not require another namespace rewrite or expand release scope. See
[Frontend Readiness and Migration Handoff](frontend-readiness.md) for artifacts, evidence,
verification commands, review priorities, and release gates. Checkout paths do not determine
product identity or runtime deployment bindings. Branding changes, exploratory proposals, and
controlled backend tests do not establish live deployment or distribution readiness.

The [OCI image](../../Dockerfile), [Compose deployment](../../compose.yaml), and
[native container workflow](../deployment/container.md) are implemented. Configuration and secrets
remain external to the image, while SQLite state uses persistent storage. Image build success has
been reported on Windows Docker Desktop; this is build evidence, not acceptance of image startup,
migrations, persistence, or shutdown. Full deployed validation of runtime integration, MCP
transports, continuation, stop/disconnect settlement, resources, and widgets remains open and is
being accumulated through actual use.

Writable topology management is outside v0.1 under ADR 0014; product Host actions are outside v0.1
under ADR 0016. Desktop and broader future ideas do not expand this milestone. Deployment acceptance,
review follow-up, and release preparation remain distinct from the implemented functional baseline.

</details>

## Future Configuration Milestone

[ADR 0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md)
amends the prior SQLite-authoritative and restart-applied direction. Configuration files become
the desired-state authority; SQLite retains applied revisions and Session history. Dynamic
configuration is intended to apply by generation, while static process settings require restart.

The milestone must cover first-run setup, non-destructive evolution of populated databases,
transition from existing single-file and seeded installations, credential references, and clear
desired-versus-running status. Stable Session/deployment bindings, historical revision references,
and unsettled Run ownership must survive. Agent Host live application and general file-writing
management remain separate batches, and the completed v0.1 release remains historical.
