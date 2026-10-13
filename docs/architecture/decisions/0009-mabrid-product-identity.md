# ADR 0009: Mabrid Product Identity

- Status: Accepted; code migration timing amended by ADR 0013; implementation notes reviewed 2026-10-13
- Date: 2026-08-21
- Supersedes: the Cembrid brand decision in ADR 0007

ADR 0013 completed the coordinated Python and deployment-code identity migration during the
backend semantic refactor. ADR 0016 has now completed backend frontend-contract readiness. The
repository-hosting identity is independent of local checkout paths and does not require another
Python namespace migration. The original timing below is historical; the current implementation
status and migration boundaries are recorded below. The product identity and deployment-shell
decisions are unchanged.

## Context

ADR 0007 selected Cembrid as a future product identity and separately fixed two deployment shells:
the v0.1 Web/OCI service and a post-v0.1 Tauri desktop application. The Cembrid name has not been
adopted across repository, package, executable, configuration, or protocol interfaces.

The product owner no longer considers Cembrid a suitable long-term name and prefers Mabrid. The
architecture migration is complete, while first-release product contracts and behavior are still
being built. Renaming implementation surfaces now would create churn without advancing those
release gates.

## Decision

The timing statements in this original decision were amended by ADR 0013; they are not
instructions to repeat the completed code migration.

The future product brand is **Mabrid**.

This ADR supersedes only the Cembrid identity selected by ADR 0007. ADR 0007's deployment-shell
decision remains accepted: Web/OCI is the v0.1 release shell, and Tauri is the post-v0.1 personal
desktop shell.

The current repository name, Python packages, JavaScript packages, executable names, HTTP paths,
configuration keys, database identifiers, and protocol-facing identities are not renamed as part
of the current v0.1 feature work. A later coordinated migration will adopt Mabrid after backend and
frontend contracts have stabilized. Until then, existing technical names remain working names and
must not be changed piecemeal.

Package, registry, executable, and domain availability must be checked before the coordinated
migration. This decision does not claim ownership or availability on PyPI, npm, crates.io, GitHub,
or the public DNS namespace.

## Consequences

- New architecture decisions refer to Mabrid when a future product name is required.
- Existing source and external interfaces avoid a mixed Cembrid/Mabrid partial rename.
- The rename remains separate from the v0.1 Gateway, Agent Host, UI, and OCI release gates.
- Deployment architecture from ADR 0007 is unchanged.

## Implementation Status

Reviewed 2026-10-13:

- **Internal identity complete:** Python namespaces, distributions and descriptions, executable,
  Web title, configuration/database defaults, and backend development commands use Mabrid.
  Identity regression checks do not depend on the checkout directory's name.
- **Frontend contract complete:** ADR 0016 establishes the frozen first-party backend baseline;
  it does not mark the frontend or v0.1 distribution complete.
- **Hosting identity is separate:** repository names, remote URLs, and About metadata are hosting
  concerns. Hosting migration preserves Git history and does not change code or runtime bindings;
  its external completion is not certified by backend tests.
- **Checkout-path independence:** a local directory name is not the product identity, package
  namespace, executable, or runtime deployment binding. Moving a checkout is not required to adopt
  Mabrid's repository-hosting identity.
- **Legacy frontend untouched:** adopt Mabrid frontend identity when the owner explicitly starts
  the rewrite, not through a rename-only pass over disposable frontend code.

## Product Positioning and About

Mabrid is an **MCP Apps gateway and agent host**, not only a protocol bridge. Its current backend
combines MCP management and inspection with native Agent Sessions, runtime-owned history, composed
Run presentation, and MCP Apps widget payloads. The reusable bridge remains a protocol component,
not the whole product. These two product pillars remain useful independently when Agent Host is
disabled for a deployment.

Recommended GitHub About description:

> An extensible MCP Apps gateway and agent host for MCP management, native sessions, and interactive apps.

"Extensible" describes the adapter-driven, typed composition boundaries and room for future
integrations. It does not advertise a released plugin SDK, dynamic plugin loader, marketplace,
finished frontend, or implemented Host follow-up actions. Future expansion requires separate
project decisions and is not implemented as part of identity migration.

This text is a positioning recommendation, not evidence of published plugin support or a new
v0.1 feature commitment.

## Migration Boundaries

- Completed Python code identity does not require another namespace rewrite when hosting changes.
- Repository hosting and checkout movement are independent operations. Preserve Git history,
  update applicable repository references, and verify remote URLs after a hosting rename.
- Preserve configuration, secrets, SQLite state, and stable runtime deployment bindings. A
  repository rename is not a database reset or a change of external agent deployment.
- Frontend identity follows its rewrite against the frozen first-party contract. Live integration
  and OCI/static-serving release gates remain separate from branding or hosting migration.

See [Frontend Readiness and Migration Handoff](../frontend-readiness.md) for verification commands,
review priorities, and remaining release gates. Remote hosting, local directory movement, code
identity, and runtime deployment identity are distinct changes and must not be conflated.
