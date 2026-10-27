# Architecture Decision Log

## Reading And Review

Use [Decision Governance](decision-governance.md) for lifecycle transitions, owner approval,
scoped delivery assessments, and review of coupled decisions. Start with the active change-set
entry below; follow only its relevant ADR sections and amendments. The index remains a historical
decision inventory, not a list of independent implementation tickets.

This log separates accepted product and architecture decisions from their current implementation
state. ADRs remain historical records; implementation notes may advance without rewriting the
original context or decision.

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
current release facts and workstream scope are recorded separately below. This governance change
does not re-audit every implementation or promote historical verification to live acceptance.

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
	product implementation batch are not yet approved.
- Delivery: not implemented by this governance change; reuse the existing v0.1 foundations.
- Next eligible work: prepare the focused configuration/CI design review below, not feature code.

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
| Configuration authority and write scope | [0002](decisions/0002-sqlite-persistence-and-configuration-authority.md), [0014](decisions/0014-read-only-v0-1-management-plane.md#post-v01-product-configuration-ownership) | Classify product/deployment/secret settings together; define write protection, first-run setup, migration precedence, and non-destructive existing-database updates |
| Revision writes and runtime application | [0008](decisions/0008-restart-applied-managed-topology.md), [0014](decisions/0014-read-only-v0-1-management-plane.md#saved-configuration-and-runtime-application) | Specify transactions, concurrency, dependent endpoint revisions, saved/running reads, and restart reporting as one consistent contract; do not claim hot reload |
| Runtime configuration and durable ownership | [0011](decisions/0011-single-agent-target-and-endpoint-assignment.md), [0012](decisions/0012-agent-runtime-profiles-and-integration-composition.md), [0016](decisions/0016-session-oriented-host-and-frontend-contract-readiness.md) | Reconcile Target assignment, integration/interface selection, deployment identity, active/unknown Runs, and old Session bindings before changing configuration ownership |
| Fault handling required by configuration delivery | [0003](decisions/0003-mcp-apps-gateway-and-optional-agent-host.md), [0005](decisions/0005-upstream-transport-task-ownership.md), [0013](decisions/0013-backend-semantic-boundaries-and-mabrid-code-identity.md) | Preserve degradation and worker ownership; identify the actually necessary timeout/recovery slice, if any, rather than approving a general recovery system |
| CI, versions, and release artifacts | [0004](decisions/0004-first-release-scope-and-distribution.md), existing OCI/native workflow, owner-approved workstream goal | Select source-version ownership, lockfile/build behavior, tag mapping, and CI permissions together; managed YAML removal does not require build-time secrets or user configuration |

ADR 0014 narrowed v0.1 delivery, not the permanent configuration goal. Its destructive reset
workaround is not a future managed update mechanism; ADR 0013's pre-v0.1 reset permission does
not authorize deletion of released user data. The classified settings and new API/secret contracts
still need design. This is a dependency and clarification map, not a newly selected schema.

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
- Open: detailed configuration, security, migration, version, and minimum recovery designs.
- Existing evidence: accepted ADR requirements and dated implementation records; this entry is
	not evidence that writable configuration or release automation has been implemented.
- Required for the first product batch: an owner-approved bounded delta, reconciled decision
	notices where needed, and focused verification for that slice. Expected later checks include
	temporary populated-database migrations, atomic/conflicting writes, saved-versus-running
	behavior, unknown-Run ownership, frozen-contract compatibility, and isolated CI/build inputs.

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

## Future Configuration Milestone

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
