---
description: "Stable project-wide product and engineering constraints. Architecture state and ownership live in ADRs and architecture documentation."
applyTo: "**"
---
# Project Standards

## Scope

This project has two core pillars: an MCP Apps Gateway and an adapter-driven Agent Host with
first-party MCP Apps UI support. A deployment may disable the Agent Host, but both capabilities
belong to the product.

- Preserve transparent MCP and MCP Apps behavior for downstream agent runtimes and models.
- Treat aggregate gateway behavior, management contracts, Agent Host runtime contracts, and MCP
	Apps lifecycle as release-critical.
- Do not expand v0.1 scope into speculative channels or post-v0.1 deployment shells.

## Architecture

- Follow the accepted dependency direction: server may depend on gateway service and bridge core;
	gateway service may depend on bridge core; lower packages never import the server.
- Keep protocol bridging, application use cases, and deployment infrastructure in their documented
	ownership boundaries.
- Keep agent-specific behavior out of reusable bridge core modules.
- Treat accepted ADRs and `docs/architecture/` as authoritative for current ownership and migration
	status. Do not duplicate implementation snapshots in instruction files.

## Delivery and Decision Workflow

- Maintain `explore/frontend-experience` as a long-lived exploration workstream for Mabrid's
	interaction model and user experience. Exploration does not authorize product contract changes
	or bulk integration of experimental code.
- Deliver a feature's backend and supporting frontend behavior together in its feature workstream.
	Keep unrelated frontend experience exploration out of functional delivery changes.
- Keep the long-lived `feat/managed-config-and-recovery` workstream centered on replacing
	handwritten product YAML with managed configuration, plus basic CI and tag-triggered releases.
	Include topology, runtime, recovery, and historically deferred work only where required for
	those outcomes or separately approved; historical Pending entries are not blanket authorization.
- Keep integrations small and coherent even when a workstream is long-lived. Merging into `main`
	does not itself require a release. Isolate unrelated fixes and return release hotfixes to `main`.
- Before the next product implementation batch, reconcile its related ADRs as one change set.
	Keep decision lifecycle, delivery status, and verification evidence separate; identify conflicts,
	dependencies, explicit amendments, and owner approvals in one review entry.
- Preserve ADR identities and historical rationale. Do not infer precedence from ADR number or
	implementation progress, and do not treat coupled decisions as independent feature tickets.
- Follow [Decision Governance](../../docs/architecture/decision-governance.md) and start from the
	active review entry in the [decision log](../../docs/architecture/decision-log.md).

## Conventions

- Use precise MCP terminology such as `bridge`, `host`, `adapter`, `session`, and `resource`.
- Prefer typed, contract-first boundaries and small explicit implementations.
- Document production classes as well as modules: explain responsibility, ownership, and important
	invariants so reviewers can follow the architecture without reconstructing every call site.
- Make structural Protocol and callable relationships explicit from the implementation back to
	its contract. Link implementation classes and contract-facing methods to verified declarations;
	do not require Protocol-to-implementation indexes. Establish relationships from signatures,
	typed consumers, and composition, not matching names. Do not change inheritance for navigation.
- Preserve cross-platform behavior and avoid OS-specific path or shell assumptions.
- Do not expose management, persistence, routing, or debugging concepts in model-visible MCP
	descriptions unless the protocol contract requires them.

## Testing

- Scale tests with behavior risk. Preserve protocol characterization coverage during architecture
	migration.
- Use controlled fixtures for bridge and protocol tests rather than live agents or MCP servers.
