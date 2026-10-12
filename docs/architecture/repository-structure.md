# Repository Structure

## Backend Workspace

The backend is a `uv` workspace with three internal distributions under one implicit Python
namespace:

```text
backend/
|-- pyproject.toml
|-- uv.lock
|-- packages/
|   |-- bridge/                       # mabrid-bridge
|   |   `-- src/mabrid/bridge/
|   |       |-- contracts/            # Protocol values, plans, failures, observations
|   |       |-- downstream/           # MCP SDK v1 server, mapping, ASGI, legacy SSE
|   |       |-- engine/               # Bridge and hosted-session lifecycle
|   |       |-- routing/              # Passthrough, aggregate, URI routing
|   |       `-- upstream/             # Owner task and transport-specific clients
|   `-- application/                  # mabrid-application
|       `-- src/mabrid/application/
|           |-- gateway/
|           |   |-- topology/         # Definitions, revisions, plan mapping, reader port
|           |   |-- sessions/         # Publication, live lifecycle, transport broker
|           |   `-- inspection/       # Events, snapshots, projection, store ports
|           `-- agent_host/           # Provider-neutral Agent Host and integrations
`-- apps/
    `-- server/                       # mabrid-server
        |-- migrations/               # Squashed pre-v0.1 SQLite baseline
        `-- src/mabrid/server/
            |-- api/                  # FastAPI composition and OpenAI compatibility
            |-- composition/          # Gateway and Agent Host assembly
            |-- config/               # YAML contracts and resolved runtime configuration
            |-- runtime/              # Uvicorn process runtime
            |-- logging/              # Stderr logging policy
            `-- persistence/
                |-- schema/           # Shared SQLAlchemy metadata and rows
                |-- topology/         # Seed, row mapping, immutable revision reader
                `-- sessions/         # Lifecycle repository, inspection store, recovery
```

The package directories are implementation locations. The stable code identities are
`mabrid.bridge`, `mabrid.application`, and `mabrid.server`. Repository-local identity migration is
complete. The owner will rename the remote repository separately; the local `mcpapps-bridge`
checkout directory is deliberately retained while the current editor session is active. Neither
the checkout directory name nor the remote URL determines Python imports or runtime Session
bindings. See [ADR 0009](decisions/0009-mabrid-product-identity.md) for the current sequence.

## Dependency Direction

```text
mabrid.server ----------------> mabrid.bridge
      `--> mabrid.application ---> mabrid.bridge
```

- Bridge never imports application or server code.
- Application never imports server, FastAPI, YAML, SQLAlchemy, or Alembic.
- Server is the composition root and may depend on both lower distributions.
- Detailed contracts are imported from their owning context facade. Distribution roots expose
  only high-level entry points.

## Reviewing Structural Contracts

Production modules document their package boundary; classes document their responsibility and
important ownership/lifecycle invariants. Protocols and concrete adapters additionally name their
structural relationship, matching methods or properties, and the actual consumer or composition
site. A matching method name alone does not prove conformance: parameter and return types matter.

Class docstrings use Markdown source links that Pylance preserves in hover documentation. Link
labels name the class or function; targets are portable paths relative to the documenting source
file. Follow a link to the owning file and select the named symbol in the editor outline. These
links do not change inheritance, create a nominal type hierarchy, or guarantee a language server's
automatic Go to Implementation results for structural typing.

For a concrete example, start at
[SqliteAgentSessionRepository](../../backend/apps/server/src/mabrid/server/persistence/agent_host.py),
follow its
[AgentSessionRepository](../../backend/packages/application/src/mabrid/application/agent_host/application/ports.py)
contract and consumer, then inspect
[compose_agent_host](../../backend/apps/server/src/mabrid/server/composition/agent_host.py)
for actual injection. Observer factories, store reader views, and async bound-method callbacks use
the same documented approach without adding base classes or documentation-only imports.

[Architecture tests](../../backend/tests/test_architecture.py) require class docstrings and verify
that source links resolve to files containing the named symbols. Descriptive Pydantic schema
changes are reflected in the frozen frontend contract without altering its fields or validation.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `mabrid.bridge.contracts` | Immutable bridge plans, protocol values, failures, observations, and ports |
| `mabrid.bridge.downstream` | MCP request handling, SDK v1 conversion, Streamable HTTP, and legacy SSE mechanics |
| `mabrid.bridge.engine` | Structured lifecycle of bridge sessions and downstream hosts |
| `mabrid.bridge.routing` | Passthrough and aggregate routing, exact URI maps, and degraded availability |
| `mabrid.bridge.upstream` | Stateful upstream owner tasks and stdio/SSE/Streamable HTTP clients |
| `mabrid.application.gateway.topology` | Managed topology contracts, immutable revisions, and core-plan conversion |
| `mabrid.application.gateway.sessions` | Process-lifetime publication, persisted session lifecycle, and live transport correlation |
| `mabrid.application.gateway.inspection` | Durable event/snapshot contracts and direct projection from core observations |
| `mabrid.application.agent_host` | Agent Target, provider-neutral run contracts, runtime ports, and isolated integrations |
| `mabrid.server.composition` | One-time injection of configuration, SQLite adapters, Gateway, and Agent Host |
| `mabrid.server.persistence` | SQLAlchemy rows, transactions, migration execution, and JSON projection storage |
| `mabrid.server.api` | FastAPI lifecycle, raw MCP mount, OpenAI compatibility, and liveness |

## Key Invariants

- Core owns all MCP path, method, header, SSE query, and SDK transport mechanics.
- The core ASGI adapter consumes the core-defined `McpSessionBroker` contract, implemented by the
  application broker; it never accesses topology repositories or persistence.
- `mcp-session-id` correlation is process-local because the corresponding SDK transport state
  cannot survive restart. SQLite stores application session history, not live transport state.
- Each bridge session captures one immutable endpoint revision and corresponding core plan.
- `resources/read` preserves every returned content item, item URI, metadata value, and result
  metadata.
- Core observations are projected directly into application inspection stores. There is no
  duplicate journal DTO layer.
- Streamable HTTP upstreams use only their explicit configured URL. Environment-specific address
  mapping belongs to deployment configuration.
- Normal deployments define endpoints explicitly. Diagnostic upstream selection is an explicit
  command-line override used by the owner-maintained debug workflow.
- SQLite topology is authoritative after first-run seeding. The pre-v0.1 migration history is one
  resettable Mabrid baseline containing only implemented fields and tables.
