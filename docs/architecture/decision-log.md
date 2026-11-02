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
- Review state: **Draft**; the workstream's goals are approved, but the detailed design and next
	product implementation batch are not yet approved. The configuration design under review is
	[ADR 0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md)
	(Proposed).
- Delivery: not implemented by this governance change; reuse the existing v0.1 foundations.
- Next eligible work: owner review of ADR 0018 and the proposed first batch below, not feature code.
	CI and release design follow after the configuration skeleton is substantially delivered.

#### Approved Outcome And Boundaries

The core outcomes are managed product configuration instead of handwritten YAML, plus basic CI
and version-tag-triggered releases with automatic source-version handling. Topology mutation,
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
| Configuration authority and write scope | [0002](decisions/0002-sqlite-persistence-and-configuration-authority.md), [0014](decisions/0014-read-only-v0-1-management-plane.md#post-v01-product-configuration-ownership) | Classify product/deployment/secret settings together; define write protection, first-run setup, migration precedence, and non-destructive existing-database updates. ADR 0018 proposes amending SQLite authority to file authority with a database revision ledger |
| Revision writes and runtime application | [0008](decisions/0008-restart-applied-managed-topology.md), [0014](decisions/0014-read-only-v0-1-management-plane.md#saved-configuration-and-runtime-application) | Specify transactions, concurrency, dependent endpoint revisions, saved/running reads, and restart reporting as one consistent contract. ADR 0018 proposes amending restart-applied topology to generation-applied dynamic configuration; restart-applied remains authoritative until accepted |
| Runtime configuration and durable ownership | [0011](decisions/0011-single-agent-target-and-endpoint-assignment.md), [0012](decisions/0012-agent-runtime-profiles-and-integration-composition.md), [0016](decisions/0016-session-oriented-host-and-frontend-contract-readiness.md) | Reconcile Target assignment, integration/interface selection, deployment identity, active/unknown Runs, and old Session bindings before changing configuration ownership |
| Fault handling required by configuration delivery | [0003](decisions/0003-mcp-apps-gateway-and-optional-agent-host.md), [0005](decisions/0005-upstream-transport-task-ownership.md), [0013](decisions/0013-backend-semantic-boundaries-and-mabrid-code-identity.md) | Preserve degradation and worker ownership; identify the actually necessary timeout/recovery slice, if any, rather than approving a general recovery system |
| CI, versions, and release artifacts | [0004](decisions/0004-first-release-scope-and-distribution.md), existing OCI/native workflow, owner-approved workstream goal | Select source-version ownership, lockfile/build behavior, tag mapping, and CI permissions together; managed YAML removal does not require build-time secrets or user configuration |

ADR 0014 narrowed v0.1 delivery, not the permanent configuration goal. Its destructive reset
workaround is not a future managed update mechanism; ADR 0013's pre-v0.1 reset permission does
not authorize deletion of released user data. The classified settings and new API/secret contracts
still need design. This is a dependency and clarification map, not a newly selected schema.

#### Proposed Configuration Direction

On 2026-11-02 the owner proposed keeping declarative configuration files as the single source of
truth and applying topology and Agent Host runtime changes without a restart. The owner selected
these direction choices for the draft; they are inputs to ADR 0018, not its acceptance:

| Choice | Selected direction |
| --- | --- |
| Database role | Applied-configuration revision ledger and last-known-good startup source |
| File layout | Read-only static `mabrid.yaml` plus a writable dynamic runtime file in a mounted directory |
| Object identity | Configuration keys normalized to slugs; a rename disables the old identity and creates a new one |
| Removed or disabled endpoint | Existing bridge Sessions continue until they close naturally |
| Secret value changes | Restart-applied for now |
| Apply trigger | Explicit management apply and startup; file watching deferred |

Proposed amendments, all pending acceptance:

- ADR 0002 configuration boundary: files, not SQLite, are the configuration authority; reconciliation
	replaces `seed-if-empty`.
- ADR 0008 configuration ownership, publication, latch, and deferred live refresh: dynamic
	configuration is applied as an atomic immutable generation for new work, while revision pinning,
	dependent endpoint revisions, and no active-session migration remain.
- ADR 0014 post-v0.1 ownership, first-run setup, and saved/running application: the frontend edits
	the runtime file through validated APIs; an absent runtime file is a valid unconfigured state.

Open design items before the affected batch:

- Runtime file name, location, schema, and how the static file locates it.
- Ledger representation of applied Agent Host settings for last-known-good startup.
- Placement of the current global upstream HTTP timeout, now a static bridge setting.
- Runtime address changes under an unchanged deployment binding (local issue LOCAL-002).
- Write-access protection and secret-reference set/preserve/replace/clear semantics (batch 3).
- Comment and formatting preservation when the API rewrites the runtime file.

Proposed delivery order, each batch requiring its own approval:

1. **Configuration skeleton**: split static and dynamic configuration models and allow an empty
	 topology; replace `seed-if-empty` with ledger reconciliation; introduce the immutable active
	 snapshot with generation numbers and atomic published-endpoint replacement; add explicit Gateway
	 topology apply and management reads of active generation and file state.
2. **Agent Host generation application**: snapshot capture by Session and Run operations, deferred
	 client release, unsettled-Run guards, ledger persistence, and the deployment-identity decision.
3. **Management writes and frontend settings**: write protection, validated atomic file writes with
	 hash-based conflicts, secret-reference semantics, and settings pages.
4. **First-run setup** and optional coalesced file watching.

#### Owner Questions For The Next Review

1. Which product settings move to managed storage first, how does an unconfigured installation
	 remain manageable, and how is existing YAML imported without overwriting managed state?
2. What write-access trust boundary and secret set/preserve/replace/clear contract apply? Which
	 runtime address/deployment-binding changes can be accepted while execution is active or unknown?
3. What is the minimum complete topology/Host configuration transaction and restart contract,
	 including dependent revisions, conflict responses, and preserved Session ownership?
4. Which source-version strategy feeds backend, frontend, and OCI builds, and what is the first
	 credential-free CI slice? Generated build files and committed version changes are different choices.
5. Is any broader automatic recovery/backoff work necessary now, or should it remain separately
	 scoped? SDK v2/Session redesign and full model unification remain outside this workstream.

Present these as coupled choices with concrete alternatives and an explicit recommended batch.
If a choice changes an accepted clause, identify the exact amendment and its surviving constraints
before seeking approval. Do not create a replacement ADR or mark this review Approved just because
its overall workstream has owner support.

#### Dispositions And Verification

- 2026-10-26, owner: approved the two long-lived workstream boundaries and functional frontend/backend
	co-delivery; narrowed this workstream to managed configuration and CI/tag publishing.
- 2026-10-26, owner: explicitly selected direct adoption of lightweight ADR governance before
	further product implementation.
- 2026-11-02, owner: proposed file-authoritative configuration with generation-applied dynamic
	settings and selected the draft direction choices above. ADR 0018 records the proposal as
	Proposed; this is not acceptance of ADR 0018 or approval of an implementation batch.
- Open: owner acceptance of ADR 0018 and batch 1, the open design items above, and the security,
	version, and minimum recovery designs.
- Existing evidence: accepted ADR requirements and dated implementation records; this entry is
	not evidence that writable configuration or release automation has been implemented.
- Required for the first product batch: an owner-approved bounded delta, reconciled decision
	notices where needed, and focused verification for that slice. Expected later checks include
	temporary populated-database migrations, atomic/conflicting writes, saved-versus-running
	behavior, unknown-Run ownership, frozen-contract compatibility, and isolated CI/build inputs.

## Archived ADRs

No ADR is newly archived by this change. Partial amendments, completed implementation, and older
dates do not establish full supersession. Future archive entries must identify the ADR, its final
decision status, archive date, reason, and accepted replacement where applicable. Archiving changes
default reading scope; it does not replace an approval or remove surviving requirements.

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
| [0002](decisions/0002-sqlite-persistence-and-configuration-authority.md) | Accepted; amended by 0008, 0013, and 0014 | Partial | SQLite, reset migrations, revisions, events, bootstrap, and management read adapters exist; v0.1 topology is frozen after seed |
| [0003](decisions/0003-mcp-apps-gateway-and-optional-agent-host.md) | Accepted; amended by 0008, 0010, 0011, 0012, 0014, 0015, and 0016 | Partial | Gateway, read-only management, native sessions, Host HTTP/SSE, frozen contracts, and the first-party frontend are implemented; deployment acceptance and review follow-up remain open |
| [0004](decisions/0004-first-release-scope-and-distribution.md) | Accepted; amended by 0007, 0008, 0012, 0014, and 0016 | Partial | First-party UI, same-origin serving, OCI packaging, and native container commands are implemented; image build evidence does not complete deployment or release acceptance; product Host actions are deferred |
| [0005](decisions/0005-upstream-transport-task-ownership.md) | Accepted | Implemented | Upstream SDK contexts run and close in persistent owner tasks |
| [0006](decisions/0006-core-service-and-server-packages.md) | Accepted | Implemented | Protocol core, application services, and the deployable server are separate dependency-ordered workspace packages |
| [0007](decisions/0007-cembrid-identity-and-deployment-shells.md) | Accepted; brand superseded by 0009 | Partial | The Web/OCI service shell is implemented; Tauri desktop remains deferred and its Cembrid identity is superseded |
| [0008](decisions/0008-restart-applied-managed-topology.md) | Accepted; v0.1 scope amended by 0014 | Pending | Retain restart-applied topology mutation as the basis for a post-v0.1 writable management milestone |
| [0009](decisions/0009-mabrid-product-identity.md) | Accepted; timing amended by 0013 | Partial | Backend and first-party frontend use Mabrid code identity; hosting and checkout paths are independent, and external hosting metadata requires separate verification |
| [0010](decisions/0010-application-contexts-and-capability-composition.md) | Accepted; amended by 0011, 0012, 0013, 0014, 0015, and 0016 | Partial | v0.1 contexts, typed assembly, native bindings, widget presentation, effective capabilities, frozen contracts, and the first-party UI exist; full deployed workflow acceptance remains open; product Host actions are deferred |
| [0011](decisions/0011-single-agent-target-and-endpoint-assignment.md) | Accepted; amended by 0012, 0014, 0015, and 0016 | Partial | Single Target, endpoint ownership, Run coordination, durable Sessions, restart ownership, and frozen controls complete the backend prerequisite; deployed endpoint/agent validation remains release work |
| [0012](decisions/0012-agent-runtime-profiles-and-integration-composition.md) | Accepted; amended by 0015 and 0016; future configuration ownership clarified by 0014 | Partial | Runtime profiles, discovery, capabilities, and frozen contracts exist; external deployment certification remains release work; frontend-managed runtime configuration is deferred |
| [0013](decisions/0013-backend-semantic-boundaries-and-mabrid-code-identity.md) | Accepted | Implemented | Backend contexts are modularized, MCP transport is core-owned, provisional contracts are removed, and Mabrid code identity is adopted |
| [0014](decisions/0014-read-only-v0-1-management-plane.md) | Accepted; future configuration ownership clarified 2026-10-10 | Implemented (v0.1 read-only scope) | Read-only management is complete; frontend-managed topology and Agent Host/runtime settings, first-run setup, non-destructive database updates, and YAML transition remain post-v0.1 requirements |
| [0015](decisions/0015-agent-host-runs-and-mcp-apps-endpoint-composition.md) | Accepted; amended by 0016 | Partial | Run attribution, fresh resources, timely delivery, frozen contracts, and first-party widget rendering are implemented; review follow-up and full deployed workflow acceptance remain open; product Host actions are deferred |
| [0016](decisions/0016-session-oriented-host-and-frontend-contract-readiness.md) | Accepted | Implemented | All eight backend batches and six frontend prerequisites are complete with frozen contracts and controlled evidence; the subsequent first-party frontend functional baseline is implemented, while deployment and release acceptance remain separate |
| [0017](decisions/0017-protocol-aware-sessions-and-context-owned-model-reuse.md) | Accepted | Pending | Future SDK v2 compatibility must reassess Gateway Session semantics; consolidate model ownership and reuse equivalent definitions without requiring one universal model or expanding v0.1 scope |
| [0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md) | Proposed; would amend 0002, 0008, and 0014 | Not implemented | Configuration files as the single source of truth, SQLite as the applied revision ledger, and generation-applied dynamic topology and Agent Host settings |

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
proposes replacing the SQLite authority and restart-applied baseline described here; until it is
accepted, this section remains authoritative.

ADR 0014 records the accepted post-v0.1 direction, not a delivered write-management feature:
first-party frontend workflows edit both Gateway topology and Mabrid's Agent Host/Target/runtime
settings through backend management APIs backed by authoritative storage. YAML product configuration
is transitional; process/deployment configuration and server-owned secret resolution remain
separate. Agent Host configuration is currently loaded from YAML at startup, not persisted merely
because Agent Sessions are persisted.

The later milestone must cover first-run setup, non-destructive edits of populated databases,
explicit migration from existing YAML/seeded state, credential references, and saved-versus-running
configuration semantics. `seed-if-empty` must not block management writes, but startup must continue
to avoid implicit YAML overwrites. Stable Session/deployment bindings, historical revision
references, and unsettled Run ownership must survive migration. This does not authorize hot reload,
remote agent administration, a multi-target registry, or implementation before a separate owner
request, and it does not reopen the completed v0.1 read-only contract baseline.
