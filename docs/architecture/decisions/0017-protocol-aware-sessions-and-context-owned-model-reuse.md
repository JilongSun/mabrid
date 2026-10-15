# ADR 0017: Protocol-Aware Sessions and Context-Owned Model Reuse

- Status: Accepted
- Date: 2026-10-15
- Related: ADR 0001, ADR 0013, and ADR 0016

## Context

The current Gateway uses MCP SDK 1.x and combines protocol transport lifecycles with application
session records and inspection projections. These contracts depend on the supported protocol and
SDK behavior; they are not a permanent requirement that every MCP invocation has a session.

The MCP `2026-07-28` revision removes the initialization handshake and protocol-level sessions.
Python SDK v2 supports that revision while retaining compatibility with older clients. SDK 1.x
already supports stateless HTTP, but that transport option is not equivalent to the new protocol's
sessionless semantics. See the official
[Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
and [Python SDK v2 changes](https://py.sdk.modelcontextprotocol.io/whats-new/#no-handshake-no-session).

Application records, public HTTP schemas, and persistence rows also sometimes repeat definitions.
Some repetition represents a real boundary; some is mechanical duplication. Moving an adapter or
HTTP route closer to its owning feature would not, by itself, make those representations identical.

## Decision

### Require Session review for SDK v2 compatibility

Reassessing Gateway Session semantics is a required part of future MCP SDK v2 and new-protocol
compatibility work, not an optional cleanup after a dependency upgrade. The review must distinguish:

- protocol sessions and SDK transport contexts required by a supported protocol profile;
- application-owned Gateway lifecycle or diagnostic grouping, where it has an independent purpose;
- durable Agent Sessions and runtime-owned conversation references defined by
  [ADR 0016](0016-session-oriented-host-and-frontend-contract-readiness.md); and
- operation, Run, and widget identities used for attribution independently of protocol sessions.

Do not fabricate a long-lived MCP session solely to fit sessionless requests into the existing
Gateway model. Determine which records should remain sessions, which should become request- or
operation-scoped, and how inspection groups related activity. Sessionless MCP does not eliminate
Agent conversation continuity, operation attribution, or resource ownership during execution.

The compatibility design must address downstream and upstream protocol profiles, broker and SDK
context lifetimes, endpoint revision capture, inspection history and public contract migration,
notifications, cancellation, and cleanup. Retain correct legacy-client behavior and do not assume
that transport disconnection has identical meaning across protocol revisions. Preserve stable
Agent deployment bindings and unresolved Run ownership throughout any migration.

Protocol mechanics remain owned by bridge core; application lifecycle and inspection semantics
remain owned by their application contexts. This review does not select a replacement Session
model or authorize shared upstream connections.

### Unify model ownership and reuse equivalent definitions

Organize models and their boundary-specific representations around the owning bounded context.
Reuse definitions when their meaning, fields, validation, visibility, and lifecycle requirements
are genuinely identical. This includes suitable value objects, enums, common fields, and pure data
contracts; it does not require a separate copy merely because data crosses a package boundary.

Do not require one class to serve every application, HTTP, and persistence use. Keep separate
representations when they express meaningful differences, including internal correlation versus
public identity, secret visibility, create/update/read requirements, or ORM tracking and storage
constraints. Conversions with real policy or shape differences remain explicit and tested.

Feature ownership and representation are separate choices. If a future decision relocates HTTP or
persistence adapters into feature-owned modules, apply this reuse policy there without assuming
that route ownership merges public contracts with internal records or ORM rows.

The dependency direction and adapter boundaries in
[ADR 0013](0013-backend-semantic-boundaries-and-mabrid-code-identity.md) remain in force. SQLModel
may be evaluated separately as a persistence and schema tool, but is not selected by this decision.
Neither SQLModel adoption nor importing ORM dependencies into application contracts follows from
the model-reuse principle.

### Keep delivery scope separate

These are accepted follow-up directions, not additions to the v0.1 release gates or changes to its
frozen public contracts. During v0.1 release planning, turn the Session compatibility review and
model ownership/reuse audit into separately scoped backlog tasks for later milestones. The choice
of a todo list or GitHub issues, prioritization, and implementation scheduling remain backlog
decisions rather than evidence of delivered behavior.

## Alternatives

- Preserve every current Session abstraction unchanged: rejected because its assumptions depend
  on the protocol profile and SDK lifecycle.
- Use one universal ORM/application/API model: rejected because it hides real visibility,
  validation, lifecycle, and storage differences.
- Require a distinct model at every layer: rejected where the contracts are genuinely equivalent
  and duplication has no independent purpose.

## Consequences

- SDK v2 compatibility must include lifecycle and contract review, not just import changes.
- Sessionless protocol support can coexist with useful application state without inventing
  protocol sessions or conflating Gateway and Agent Session identities.
- Model consolidation follows semantic ownership and verified equivalence rather than class count.
- Future work requires focused compatibility, projection, and migration evidence before delivery.

## Implementation Status

Pending as of 2026-10-15. The backend remains on `mcp>=1.28,<2`; existing Session lifecycles,
dependency boundaries, persistence models, and frozen HTTP contracts are unchanged. This ADR
records the accepted review and reuse direction, not a completed SDK migration, route relocation,
Session redesign, ORM replacement, or published issue backlog.