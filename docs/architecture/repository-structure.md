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
complete. Repository hosting and local checkout paths are independent: neither the checkout
directory name nor the remote URL determines Python imports or runtime Session bindings. See
[ADR 0009](decisions/0009-mabrid-product-identity.md) for the migration boundaries.

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

Review navigation starts at the implementation, not at a reverse implementation index. Every
contract-facing concrete method/property links directly to its declaring Protocol member, for
example `[BridgeObserver.observe](relative/observer.py:18)`. Class links remain useful context,
but do not replace this method-level entry point. Private observers, factory methods, shared
base-class implementations, and multiple reader/writer views follow the same rule. An inherited
Protocol member links to the Protocol that actually declares it.

Check the actual typed consumer and composition before calling a relationship an implementation.
For example, the Host observer implements `BridgeObserver`; Host presentation streams consume
event-source Protocols but yield different envelopes. A transport base supplies shared client
methods but needs a subclass's connection setup to satisfy the complete upstream client port.

Class docstrings use source references such as `[PortName](../ports.py:42)`: labels name the class
or function, targets are paths relative to the documenting source file, and the suffix is the
declaration's 1-based line number. Keep these references current when declarations move.

Install the workspace-recommended **Comment Linker** (`antunesdq.comment-linker`) extension to
Ctrl+Click a label in Python source and open the target at its declaration. In a remote/WSL window,
make sure the extension is enabled for that window's Python files. This uses an extension-provided
document link, not Pylance symbol resolution; F12 on docstring text is not part of this contract.
The extension's published provider has been checked against these docstrings for link ranges,
relative file resolution, and line fragments. That check does not exercise editor mouse clicks.

The `:42` suffix is provider-specific, not a standard Markdown file fragment. Keep ordinary
Markdown documents' file links in standard Markdown form, and do not rely on Pylance hover to open
the docstring references. The application and its tests do not require the editor extension.

Use the links in this Markdown document as file-navigation entry points, or use Go to Definition on
existing code identifiers and type annotations when the extension is unavailable. Select a named
class/function in the destination file's outline. Neither route changes inheritance or guarantees
automatic Go to Implementation
results for structural typing. Do not add imports or base classes solely to enable navigation.

For a concrete example, start at
[SqliteAgentSessionRepository](../../backend/apps/server/src/mabrid/server/persistence/agent_host.py),
follow its
[AgentSessionRepository](../../backend/packages/application/src/mabrid/application/agent_host/application/ports.py)
contract and consumer, then inspect
[compose_agent_host](../../backend/apps/server/src/mabrid/server/composition/agent_host.py)
for actual injection. Observer factories, store reader views, and async bound-method callbacks use
the same documented approach without adding base classes or documentation-only imports.

For the Gateway history-reader boundary, use these Markdown links:

- Implementation: [SqlAlchemySessionHistoryReader](../../backend/apps/server/src/mabrid/server/persistence/sessions/history_reader.py).
- Contract: [SessionHistoryReader](../../backend/packages/application/src/mabrid/application/gateway/sessions/ports.py).
- Injection and typed management view: [compose_gateway](../../backend/apps/server/src/mabrid/server/composition/gateway.py).

The composition module already imports the Protocol for a real field annotation, so that identifier
is a Python navigation target; the same name inside the implementation's docstring is only text.

[Architecture tests](../../backend/tests/test_architecture.py) require class docstrings, check the
audited implementation-to-Protocol method references, and verify qualified declarations and their
recorded lines. The implementation inventory is a documentation regression guard, not proof of
type compatibility or a production adapter registry. Descriptive Pydantic schema
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

## Frontend Scaffold

The [frontend](../../frontend/) is a standalone React and TypeScript application built with Vite.
Tailwind CSS v4 uses its Vite plugin. [shadcn configuration](../../frontend/components.json) selects
Radix-based components, a neutral palette, and CSS-variable theming. The initial page is only a
scaffold, not a connected Gateway or Agent Host workflow.

Use Node.js 22.12 or newer and the pnpm version declared in
[package.json](../../frontend/package.json). From `frontend/`:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
pnpm preview
```

`build` includes the TypeScript check. The Vite template's Oxlint configuration checks React and
TypeScript code; lint warnings fail the command. Add shadcn components as needed with
`pnpm exec shadcn add <component>`. The `@/` alias resolves to `src/` in both TypeScript and Vite.
The initial theme is light and does not follow the operating system's dark-mode preference.

The existing root `make install` / `just install` and `make dev` / `just dev` entry points continue
to manage both backend and frontend processes. Frontend-only development needs no backend process
until a workflow uses the frozen HTTP contracts.
