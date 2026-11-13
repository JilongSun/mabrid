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
- Review state: **Draft for the CI, version preparation, and release design below**, with the
	owner-approved release choices recorded separately. Earlier configuration batches retain their
	approvals and delivery evidence. The owner accepted
	[ADR 0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md)
	and the dated amendments below, including component-scoped application, the existing Hermes
	interface boundary, and the explicit deferral of Host management access hardening.
- Delivery: the first Gateway configuration skeleton, runtime-only cleanup, and the Agent Host
	runtime-file location are implemented, together with the Gateway runtime-file editor assessed
	on 2026-11-10 and the bounded idle-only Host application and Hermes Settings batch assessed
	on 2026-11-11. Runtime placement, literal Host credential rotation, and container-layout
	integration have controlled evidence on 2026-11-12. The configuration-owned Host credential
	simplification has controlled evidence on 2026-11-13, separately from live acceptance.
- Further work: live deployment acceptance, README delivery review, CI/version handling, and
	unrelated Agent Host capabilities remain separately scoped; this batch does not authorize them.

#### CI, Version Preparation, And Tag-Triggered Releases (2026-11-13)

Review state: **Draft**, with the following owner-approved choices. These choices do not approve
the remaining detailed design or authorize workflow implementation or repository-setting changes.

- Before a release, the owner selects the target version once. Automation prepares a version PR
	containing the required version metadata and lockfile updates. CI and review precede its merge;
	merging it prepares the source but does not publish a release. Ordinary development merges do
	not require version PRs or automatically increment the version.
- After that PR is merged, the owner creates and pushes the matching version tag on the selected
	prepared commit. The tag is the publication decision: successful release checks publish a public
	GitHub Release directly, without a separate draft-approval step.
- The tagged source must already contain the prepared version. Do not repair version mismatches
	by rewriting source after tagging or moving an existing release tag. The source archive and
	reported product version must be consistent with the tag.
- Use one product version across backend workspace packages, frontend metadata, and API/MCP Apps
	Host reports. Internal packages do not select independent versions or gain package-registry
	publication as part of this design.
- Use package/version/build tooling to prepare and propagate versions automatically. Remove
	manually maintained runtime version literals rather than replacing them by hand for every release.
	The specific tooling and metadata/build integration remain implementation-design details.
- Merge into `main` through PRs with required CI checks and Merge commits, preserving the ancestry
	of long-lived workstreams. The maintainer decides when to merge; automatic merge and a merge queue
	are outside the initial design. Disallow force pushes and deletion of `main`; do not require
	approval from an additional maintainer for the initial workflow.
- Automatic container builds and image publication are deferred, not prerequisites for this batch.

Required CI checks and runners, version-tool integration, tag/prerelease formats, release
artifacts/notes, automation permissions and event chaining, and failure/rerun behavior remain
subject to the focused design review. Approval of the merge policy does not authorize applying
repository settings yet; bot-created tags and package-registry publication remain out of scope.

Delivery: **Pending**. No CI, version-preparation, or release workflow has been implemented.

#### Configuration-Owned Host Credential (2026-11-13)

The owner approved removal of the dual-source Host credential model and authorized implementation.
This explicitly amends the 2026-11-12 environment-or-value choice in ADR 0018, with a reciprocal
notice in ADR 0014. Runtime-file placement, component application, and deployment layout are retained.

- `agentHost.runtime.apiKey` is the only Host credential field. Remove `apiKeyEnv`, environment
	lookup, default variable names, source selection, and source/variable management metadata.
	Reject obsolete fields rather than retaining aliases, fallback, or automatic migration.
- Keep `.env` as startup process/container environment, not Host configuration. It does not
	override or supply a missing Host key; do not add configuration interpolation. Environment
	changes remain restart/recreate applied, while file-owned keys retain idle-only Host application.
- Management reads expose only whether the key is configured. Writes preserve or replace the key;
	ordinary edits never round-trip its value. Settings has one password input, cleared after saving.
	Missing credentials on an enabled Host fail explicitly. Protect plaintext runtime files/backups.
- Preserve secret-safe errors, file concurrency/atomicity, separate save/apply, both-client
	replacement, Session identity/binding, durable unsettled ownership, trusted-only access, and no
	business replay. No watcher, provider framework, general authentication, or deployment restart API.

Required verification: file keys remain independent of process/dotenv values; missing/obsolete/invalid
keys are rejected safely; preserve/replace and key-only application retain their guards and identity;
the UI has no source selector, clears passwords after save, and never reads a key back; templates,
native setup comments, deployment documentation, and the generated contract match the single field.
Actual Docker, service restart, and real Agent/MCP operations remain outside controlled verification.

Delivery assessment on 2026-11-13: **Implemented for the approved single-field Host credential scope,
with controlled verification**.

- The file model, loader, and management editor have no environment credential branch. Process and
	dotenv precedence remains available for startup environment, but cannot override a file key or
	satisfy an enabled Host with no key. Obsolete fields and environment-write operations are rejected.
	Reads return only configured state; ordinary writes and Gateway edits preserve the stored key.
- `uv run --directory backend --all-packages pytest -q --tb=short`: 467 passed, 1 skipped. The skip
	reserves Windows directory ACL verification for actual deployment. Rotation tests retain both-client
	replacement, Session identity/binding, idle and durable unsettled guards, and failed-prepare safety.
	Native Unix/PowerShell setup tests use Docker doubles, not real Docker operations.
- Pyright, Ruff, full formatting, editor diagnostics, and offline contract drift checks passed.
	All 31 frontend contract tests passed with configured-only reads and preserve/replace writes.
	Updated setup comments, templates, and deployment documentation match the single-field contract.
- Frontend typecheck, lint, all 191 tests, and production build passed. Controlled Chromium checks
	at 1280x900 and 390x844 verified one password input without source/name controls, cleared values
	after save, preservation without round-trip, missing-key request blocking, separate save/apply,
	capability refresh, conflict/reload, and unknown application without retry. Screenshots/control
	bounds showed no overflow or overlap. All business requests used intercepted synthetic responses.
- Actual image builds, Docker/Windows ACL behavior, service restarts, and remote credential acceptance
	remain unverified. Trusted-only management and plaintext file/backup protection remain required;
	the existing frontend bundle-size warning remains outside this batch.

#### Runtime Placement, Host Credentials, And Container Integration (2026-11-12)

The owner approved the discussed combination and authorized implementation. Hermes credentials are
Host runtime inputs and must support rotation without container recreation; environment injection
remains an optional source, not the only update mechanism. This amends ADR 0018's adjacent-only
placement and Host environment-reference-only rules, with the reciprocal notice in ADR 0014.

- Add static `runtimeConfigFile`, relative to the static directory when not absolute. Keep the
	adjacent default, existing database and stdio path bases, and restart ownership. Do not search,
	move files automatically, reset storage, or silently fall back to another source.
- Use a dedicated writable `runtime/` directory in new container templates, retain a read-only
	static file and environment-only injection, and preserve the current named data volume and
	relative database location. Do not mount the repository root writable. Define non-root directory
	access explicitly; native deployment commands must not require Python or uv.
- Add mutually exclusive environment-reference and literal Host credentials. Management reads
	expose only source/configured metadata; writes preserve or explicitly replace/select credentials.
	Save and apply stay separate. Credential-only changes must bypass no-op suppression without
	publishing secret-derived component digests, and replace both clients under the idle guard.
- Retain identity, binding, durable Run protection, trusted-only access, safe errors, and no replay.
	Successful local replacement is not remote authentication evidence. Do not add independent key
	files, watchers, secret frameworks, access control, CI, version automation, or release publication.
- Update the deployment guide, templates, and configuration contracts for the completed layout
	and behavior. Preserve existing operator files and services; README delivery review remains
	separately requested rather than an implicit part of implementation.

Required verification: relative/absolute/default placement and static restart reporting; unchanged
database/stdio bases; mutually exclusive sources and invalid values; read/write/error redaction;
preserve/replace and failed atomic writes; credential-only pending/application and client replacement;
busy/unsettled rejection, retained Session identity, preparation failure, and no business retries;
frontend source switching and unknown outcomes; native Unix/PowerShell setup preservation, permissions,
Compose mount structure, contract/type/lint/build checks, and controlled browser flows. Actual Docker
and real Agent/MCP acceptance remain separate; no such operations are authorized in this workspace.

Delivery assessment on 2026-11-12: **Implemented for the approved configuration, credential,
and container-layout scope, with controlled verification**.

- Startup resolves the selected runtime path once. Relative/absolute placement and the adjacent
	default are tested; a static path edit reports restart required without switching the file.
	Database and stdio relative-path bases remain unchanged, and the editor uses the same path.
- Host file credentials select an environment name or a literal value. Separate management models
	expose only source/configured metadata and accept explicit preserve/replace/source operations.
	Credential-only changes use a process-keyed opaque Host fingerprint, rebuild both clients under
	the idle guard, retain Session identity/binding, and respect all durable unsettled claims.
- New setup templates and Compose mount only the runtime directory writable, preserve the static
	file/data-volume locations, and use supplementary directory-group access for the existing non-root
	identity. Setup retains existing files/permissions and rejects implicit adjacent-file migration.
	Native scripts do not require host Python and never reset storage. The deployment guide is updated;
	README changes remain outside this implementation assessment.
- `uv run --directory backend --all-packages pytest -q --tb=short`: 466 passed, 1 skipped. The skip
	explicitly reserves Windows directory ACL verification for actual deployment. Native Unix and
	Windows PowerShell workflows use Docker doubles; no real Docker command was executed.
- Pyright, Ruff, full formatting, editor diagnostics, and the offline frontend contract check passed.
	The approved preview snapshot includes the separated credential-read/write models. Safe HTTP
	validation/conflict/storage/preparation failures do not expose credentials or replace the Host.
- Frontend typecheck, lint, all 191 tests, and production build passed. Settings source selection,
	required replacement, cleared password input, ordinary preserve writes, save/apply separation,
	busy/conflict behavior, and unknown outcomes without retry are covered. The existing bundle-size
	warning remains outside this batch.
- Controlled Chromium checks at 1280x900 and 390x844 verified those Settings flows, native capability
	refresh, control bounds, and screenshots without overflow or overlap. All business requests used
	intercepted synthetic responses; no real Agent/MCP request or remote authentication was attempted.
- Existing operator configuration, secrets, databases, and services were not changed. Actual image
	builds, container filesystem/ACL behavior, recreate persistence, and remote credential acceptance
	remain unverified. Trusted-only management access and explicit deferral of hardening remain in force.

#### Agent Host Reconfiguration Policy (2026-11-11)

The owner approved a bounded simplification of Host reconfiguration instead of treating Gateway
revision snapshots and last-known-good startup as mandatory Host mechanisms. This amends ADR 0018's
Host snapshot, client-retirement, and configuration-ledger requirements; Gateway revisions, pinned
bridge Sessions, and Gateway last-known-good startup are unchanged.

- A Host's logical identity includes its declared `targetId` and runtime `integration`. Changing
	either selects a new logical Host; existing Sessions must not silently acquire that identity.
	The current Hermes implementation remains the supported template; this does not add integrations.
- The native `bindingId` separately identifies a remote deployment. Changing it does not migrate
	old Sessions or unresolved Runs. A URL change may update the same Host's connection when the
	operator explicitly declares that the deployment is unchanged; neither equal nor different URLs
	prove deployment identity. Machine-verifiable deployment identity is not part of this approval.
- Apply Host changes only when there are no in-flight Host operations and no active or unsettled
	Run. Serialize admission and reconfiguration so a new operation cannot start between the idle
	check and replacement. Do not retain multiple executable Host generations or permanently pin
	Agent Sessions to configuration revisions. Running operations keep a stable client until done.
- Keep process-wide single-Target Run ownership, durable unresolved-Run claims, Session deployment
	bindings, and tool/App attribution intact. Client replacement must not reset those safety facts.
- Do not add a Host configuration revision ledger or Host last-known-good startup restoration.
	Invalid Host startup configuration leaves the Host unavailable with an explicit error. A failed
	runtime application leaves the current Host in place and the desired change unapplied; that is
	not permission to restore historical Host configuration at startup.
- Preserve secret redaction, startup environment-secret behavior, and external process-restart
	ownership. No real Agent/MCP operations, database reset, or automatic business-operation retry
	is authorized by this policy.

The focused contract review below resolves interface transitions, component application, management
writes/access, and minimal status within this scope. The whole-file save hash remains a concurrency
token, not proof that every component has applied its content.

Delivery assessment on 2026-11-11: **Implemented within the bounded application and settings
batch below**. The following entry records its controlled verification; policy acceptance and
implementation evidence do not establish live acceptance.

#### Agent Host Application And Settings Contract (2026-11-11)

The owner selected all three reviewed choices: apply Gateway and Host separately, retain the current
Hermes compatibility interface with optional native Sessions, and explicitly extend the trusted-only
management access model to bounded Host reads, writes, and application. These selections completed
the contract review; the separate delivery assessment below records implementation evidence.

- Application is component-scoped. Gateway apply changes Gateway topology only; Host apply changes
	the Host only. A pending or busy Host is not an unconditional Gateway apply blocker. This batch
	provides no cross-component atomic apply or implicit application of the other component.
- Validate dependencies against the other component's running state. An enabled Host must use an
	endpoint published by the current Gateway; Gateway changes must respect the running Host's
	endpoint assignment rather than substituting a pending assignment. Endpoint migration is staged:
	publish the new endpoint while retaining the old one, apply the Host assignment, then remove the
	old endpoint. The owner accepted this workflow instead of a joint publication transaction.
- Hermes `interface` remains `openai-chat-completions`. Native Sessions are an additive capability,
	not an alternative interface. They can be enabled or disabled under the same idle-only guard as
	other Host changes. Disabling them retains local records but disables remote Session operations;
	re-enabling the same logical Host and deployment binding permits access to its existing Sessions.
	This adds neither offline history nor another integration/interface implementation.
- Host management reads expose editable settings and environment-variable names, never resolved
	credentials. A typed Host write replaces only the Host section, preserving Gateway settings and
	YAML comments. Both editors serialize writes and compare the same whole-file hash; saving is not
	application and does not require the Host to be idle. Static settings remain outside the writer.
- Host management access hardening is explicitly deferred, as for the Gateway editor. Runtime
	addresses and credential-reference names affect where credentials may be sent; this surface must
	not be exposed to untrusted clients. CORS and missing origin headers are not authentication.
- Gateway and Host report applied versus desired state independently. A change to one section or
	only its comments must not falsely mark the other component unapplied. Keep current Host
	application status in process; do not introduce a durable Host configuration history/recovery
	table. Session identity and unsettled-Run ownership remain durable and distinct from this status.

Bounded implementation batch:

1. Make Host routes, capabilities, and Gateway observation consumers resolve the active Host through
   a stable lifecycle boundary rather than permanently capturing startup clients. Count operations
   through stream completion, and serialize admission, idle checking, replacement, and cleanup.
2. Enforce logical Target/integration identity and deployment-bound Session/Run access. A replacement
   Target must not bypass unsettled ownership by looking up only its new identity. Preserve existing
   records; no automatic deletion, reassignment, or remote-operation replay.
3. Add component-scoped application/status and a typed Host-only runtime-file editor using the
   existing comment-preserving, hash-checked atomic file writer. Prepare and validate before
   publication; application failure must not be reported as success or switch the other component.
4. Deliver Hermes Settings with separate save and Host apply actions, truthful capability/status
   changes, conflict and busy states, and no automatic retry after unknown outcomes. Gateway UI
   remains responsible only for Gateway application.

Required controlled verification: startup-disabled Host enablement; native Session off/on with
records retained; URL updates within an explicitly unchanged deployment; Target/integration/binding
isolation; in-flight reads/probes/streams and active/unsettled Run guards; admission-versus-apply
races; Gateway-only apply while Host changes are pending; staged endpoint migration; independent
pending/error states; stale hashes across both editors; comments, redaction, failed preparation and
replacement; frontend flows and the updated preview contract. No real Agent/MCP calls, container
acceptance, database reset, new integrations, joint apply, or Host last-known-good restoration.

Delivery assessment on 2026-11-11: **Implemented for the approved Host application and settings
scope**.

- The server owns a stable Host lifecycle boundary. HTTP reads, probes, streams, and observation
	callbacks retain operation leases; admission, idle checking, preparation, publication, and client
	retirement serialize. Gateway observers retain per-Host projection state and seed tool metadata
	after replacement without replaying business operations. Gateway core remains Host-independent.
- Session persistence includes logical integration identity. The additive Hermes migration retains
	existing records, IDs, and deployment bindings. Runtime replacement checks all durable unsettled
	claims, not only the requested Target; startup cannot bypass another identity's claim.
- Gateway and Host parse, apply, and report component state independently. Component fingerprints
	identify applied/desired settings; the complete-file hash remains the shared save/apply concurrency
	token. Runtime Host preparation failure keeps the current Host; invalid startup Host configuration
	leaves it unavailable. No Host configuration ledger or last-known-good restoration was added.
- Host-only management reads/writes and Hermes Settings preserve Gateway settings, comments, and
	secret-reference names. Save and Apply Host remain separate. The UI retains drafts on conflicts,
	refreshes capabilities after application, and requires explicit reload after unknown outcomes.
- `uv run --directory backend --all-packages pytest -q --tb=short`: 445 tests passed. Coverage
	includes disabled startup enablement, native off/on with retained records, identity/binding
	isolation, URL changes, operation and durable ownership guards, admission races, independent
	Gateway application, staged endpoint migration, failed preparation, shared hashes, and comments.
- Pyright, Ruff, and formatting checks passed. The approved preview contract was regenerated and
	its offline drift check passed; all 31 contract tests passed again after documenting the Host
	configuration-unavailable 503 response and verifying its safe HTTP shape.
- `pnpm --dir frontend test`: 189 tests passed. Frontend typecheck, lint, and production build
	passed. The existing large-chunk warning remains; bundle optimization is outside this batch.
- Controlled Chromium checks at 1280x900 and 390x844 verified Host-only reference writes, separate
	save/apply, refreshed native capabilities, retained conflict drafts, explicit reload, and unknown
	outcomes without retry. Screenshots and control bounds showed no horizontal overflow or overlap.
	All business requests used synthetic intercepted responses, not a live Agent/MCP deployment.
- No real Agent/MCP operations, container acceptance, database reset, release, or CI changes were
	performed. Management access hardening remains explicitly deferred to trusted deployments only;
	this assessment does not establish hardened access or live deployment acceptance.

#### Gateway Runtime-File Editing (2026-11-10)

The owner approved structured Gateway configuration reads and whole-document writes with
file-hash concurrency, complete candidate validation, and atomic replacement. Saving changes the
desired file only; a separate apply uses the returned hash. The frontend also offers save-and-apply
without implying a transaction across file persistence and runtime publication.

- Preserve YAML comments and untouched nodes using `ruamel.yaml`; review example comments for
	consistency with the editor and setup. Do not expose raw YAML or secret values in management reads.
- HTTP upstream header values use explicit preserve/replace/remove semantics and remain literal
	values in the protected runtime file. Their replacements follow explicit Gateway apply for new
	Sessions; Agent Host credentials retain startup environment references and restart behavior.
- Existing stdio entries may only change enablement; their launch configuration stays file-managed.
	Endpoint-owned bindings remain editable. Do not create stdio commands through this editor.
- Agent Host configuration is read-only and preserved on writes, with unchanged restart behavior.
- Object keys cannot be renamed in place. Removing editable objects preserves applied history;
	immutable revisions and existing Session ownership are unchanged.
- Access-control changes are explicitly deferred from this batch. The editor retains the existing
	unauthenticated access model, is restricted operationally to trusted deployments, and is not safe
	to expose to untrusted clients. This amends the earlier pre-write access-design gates in ADRs
	0014 and 0018; it does not establish an authentication or browser-origin security boundary.
- No README, Docker/Compose integration, Host hot application, file watching, CI, or release work.

Required verification: controlled file/API tests for stale hashes, redaction and secret operations,
complete validation, stdio/Host preservation, comment retention, failed replacement, and first-run
creation; frontend tests for edits, save/apply separation, conflicts, and unknown outcomes.

Delivery assessment on 2026-11-10: **Implemented for the approved Gateway editor scope**.

- `uv run --all-packages pytest -q --tb=short`: 428 tests passed, including desired-file saves
	without ledger/publication mutation, explicit application, full topology validation, stale hashes,
	first-run creation, redacted errors, header operations, stdio/Host retention, replacement failure,
	and setup-example comments and Host templates surviving edits.
- `uv run ruff check`, `uv run pyright`, and the frontend contract `--check`: passed. Changed
	Python files are Ruff-formatted. The preview contract adds GET/PUT runtime-file routes and edit
	models; existing route and schema definitions are structurally unchanged.
- `pnpm test`: 181 frontend tests passed; typecheck, lint, and production build passed. The build
	reports a large-chunk warning; bundle optimization is outside this batch.
- Controlled Chromium checks at 1280x900 and 390x844 verified Settings navigation, retained drafts,
	write-only headers, stdio restrictions, save/apply hash ordering, conflict/reload, and unknown
	outcomes without retry. Screenshots and control bounds showed no horizontal overflow or overlap.
	All API traffic used synthetic intercepted responses, not a live deployment.
- No real Agent/MCP operations or container acceptance were performed. Access hardening, Host
	editing/live application, and deployment integration remain outside this assessment.

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
| Configuration authority and write scope | [0002](decisions/0002-sqlite-persistence-and-configuration-authority.md), [0014](decisions/0014-read-only-v0-1-management-plane.md#post-v01-product-configuration-ownership), [0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md) | YAML remains authoritative; bounded Host-only writes and explicit access-hardening deferral are approved above without destructive database updates |
| Revision writes and runtime application | [0014](decisions/0014-read-only-v0-1-management-plane.md#saved-configuration-and-runtime-application), [0018](decisions/0018-file-authoritative-configuration-and-generation-applied-runtime.md) | Keep immutable Gateway generations; Host uses idle-only replacement without revision-pinned Agent Sessions or last-known-good recovery; apply components separately with staged endpoint migration |
| Runtime configuration and durable ownership | [0011](decisions/0011-single-agent-target-and-endpoint-assignment.md), [0012](decisions/0012-agent-runtime-profiles-and-integration-composition.md), [0016](decisions/0016-session-oriented-host-and-frontend-contract-readiness.md) | Preserve single-Target execution, durable unresolved ownership, and old Session bindings; distinguish Target/integration identity from deployment binding; Hermes native Sessions remain additive to the existing compatibility interface |
| Fault handling required by configuration delivery | [0003](decisions/0003-mcp-apps-gateway-and-optional-agent-host.md), [0005](decisions/0005-upstream-transport-task-ownership.md), [0013](decisions/0013-backend-semantic-boundaries-and-mabrid-code-identity.md) | Preserve degradation and worker ownership; identify the actually necessary timeout/recovery slice, if any, rather than approving a general recovery system |
| CI, versions, and release artifacts | [0004](decisions/0004-first-release-scope-and-distribution.md), existing OCI/native workflow, owner-approved workstream goal | Select source-version ownership, lockfile/build behavior, tag mapping, and CI permissions together; managed YAML removal does not require build-time secrets or user configuration |

ADR 0014 narrowed v0.1 delivery, not the permanent configuration goal. The preview cleanup removes
upgrade compatibility, not the requirement to retain history during normal configuration changes.
Automatic database reset remains unsupported. The accepted Host contract above does not imply its
implementation, joint application support, or broader secret-reference contracts.

#### Accepted Configuration Direction

On 2026-11-02 the owner accepted declarative configuration files as the single source of truth
and generation-applied topology and Agent Host runtime configuration:

| Choice | Selected direction |
| --- | --- |
| Database role | Gateway applied-revision ledger and last-known-good source; Host Session/Run ownership persists, without a Host configuration recovery ledger under the 2026-11-11 amendment |
| File layout | Read-only static `mabrid.yaml` plus a writable dynamic runtime file in a mounted directory |
| Object identity | Configuration keys normalized to slugs; a rename disables the old identity and creates a new one |
| Removed or disabled endpoint | Existing bridge Sessions continue until they close naturally |
| Secret value changes | Startup environment values remain restart-applied; the 2026-11-10 amendment applies literal upstream headers through explicit Gateway apply |
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

- Any later optimization of the existing global upstream HTTP timeout; retain its current behavior
	in the first batch.
- Runtime address changes under an unchanged deployment binding (local issue LOCAL-002).
- Management and MCP Gateway access boundaries, and secret-reference set/preserve/replace/clear
	semantics beyond literal upstream headers. The owner explicitly deferred access-control changes
	for the Gateway editor and bounded Host writer above; no untrusted deployment or broader Host
	administration is approved.

Delivery order:

1. **Approved Gateway configuration skeleton**: split static and dynamic configuration models and allow an empty
	 topology; replace `seed-if-empty` with ledger reconciliation; introduce the immutable active
	 snapshot with generation numbers and atomic published-endpoint replacement; add explicit Gateway
	 topology apply, management reads of active generation and file state, and their supporting frontend
	 states. Preserve existing Agent Host startup behavior until its separate batch.
2. **Agent Host idle-only reconfiguration**: the policy above replaces the earlier multi-generation
	 Host snapshot and last-known-good proposal. Implement the bounded application/settings contract
	 above, including admission and identity safety, without adding joint application.
3. **Management writes and frontend settings**: Gateway editing is delivered above with validated
	 atomic writes, hash-based conflicts, and write-only literal header operations. The bounded Host
	 editor and its access-hardening deferral are covered by the accepted contract above; broader
	 secret-reference contracts and future access hardening remain separately scoped.
4. **First-run setup** and optional coalesced file watching.

Later batches require their own approval.

#### Questions For Subsequent Reviews

1. What future access hardening and broader secret-reference contract apply beyond the approved
	 trusted-deployment Gateway editor? Which
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
