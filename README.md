# Mabrid

[English](README.md) | [简体中文](README.zh.md)

[![Version](https://img.shields.io/github/v/release/JilongSun/mabrid?label=Version&color=2F855A&logo=semver&logoColor=white)](https://github.com/JilongSun/mabrid/releases/latest)
[![CI](https://github.com/JilongSun/mabrid/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/JilongSun/mabrid/actions/workflows/ci.yml?query=branch%3Amain)
[![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](./backend/pyproject.toml)
[![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](./Dockerfile)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?logo=apache&logoColor=white)](./LICENSE)

Mabrid is a self-hosted MCP gateway for enterprises, individual developers, and
agent users. It also provides an optional, session-centered Agent Host designed
to work across agent runtimes.

The MCP gateway gives you one place to manage external MCP servers. The Agent
Host gives developers a ready-made chat interface to test their own AI agents
and LLM applications, without building a frontend just for testing.

Together, the gateway and Agent Host provide a foundation for additional
features, such as interactive MCP Apps.

> [!NOTE]
> Mabrid is a developer preview. Features are still being developed and refined.
> Mabrid's APIs are not yet stable and may change between releases.

## Why Mabrid

### MCP Gateway

Bring external MCP servers together behind shared endpoints, with namespaces
that keep tools from different servers distinct. Inspect server configuration,
connections, and bridge sessions in one place. The gateway keeps tool and resource
metadata in memory for session routing; tool results and resource contents are
not cached.

![Gateway topology showing one aggregate endpoint connected to two MCP servers](docs/images/gateway-topology.png)

### Session-centered Agent Host

Connect different agent runtimes through adapters and use sessions to organize
testing. View conversation history, streaming responses, tool inputs and results,
and execution status together, so you can follow what happened during a test.
The integration is non-invasive: your runtime keeps control of agent execution,
conversation history, and context.

![Agent Host session showing tool arguments, results, and execution time](docs/images/agent-host-session.png)

### Built to extend

The gateway and Agent Host provide a foundation for additional features.
Event broadcasting and the observer pattern let extensions consume activity
without putting feature-specific logic into the protocol bridge or agent runtime.
MCP Apps support is one example: it builds on tool activity to show interactive
interfaces alongside results.

![MCP App displaying user search results from mock data](docs/images/mcp-apps.png)

The current agent integration connects to a separately deployed Hermes runtime
over HTTP/SSE. Mabrid does not run Hermes inside its container.

## Quick Start

### Requirements

- **Local development:** Git, Python 3.12+, [uv](https://docs.astral.sh/uv/),
  Node.js 22.12+, and pnpm 11.9.0.
- **Docker deployment:** Git and Docker with Compose 2.30+ and Linux container support.

Commands below use Make by default, with [just](https://just.systems) alternatives
for cross-platform use.

### Get the code and configure

```sh
git clone https://github.com/JilongSun/mabrid.git
cd mabrid
make setup # or: just setup
```

Setup creates static `mabrid.yaml` and dynamic `runtime/mabrid.runtime.yaml`.
The static file selects that runtime path through `runtimeConfigFile`; MCP servers,
endpoints, and Agent Host connections belong in the runtime file. Replace the sample
addresses before use.

Gateway Settings and Host Settings edit their supported runtime fields. Saving writes
the file; use the corresponding **Apply Gateway** or **Apply Host** action to activate
changes. Existing Gateway Sessions retain their bindings. Host application requires
an idle Host with no active or unsettled Run. Stdio process definitions remain
file-managed. Listener, storage, and other static process settings require a restart.

Configure the Host key through Host Settings or `agentHost.runtime.apiKey` in the
runtime file. The UI never returns the key, but it is plaintext on disk: protect the
runtime directory and keep credentials out of version control. The optional `.env`
beside `mabrid.yaml` is only for startup process/container environment; it does not
supply or override the Host key.

### Run locally

```sh
make install # or: just install
make dev     # or: just dev
```

Open <http://localhost:5173> in your browser. The backend listens on port 8765.

To run only the backend or frontend, enter its directory and run
`make install` (or `just install`), then `make dev` (or `just dev`).

### Deploy with Docker

```sh
make build # or: just build
make run   # or: just run
```

Open <http://127.0.0.1:8765> in your browser.
Stop the container with `make stop` (or `just stop`). Data is kept in a Docker volume.

See the [container guide](docs/deployment/container.md) for more deployment options.

## Before you use it

Mabrid is intended for trusted, self-hosted use, not a public multi-user service.

- Keep it on a trusted network. Management APIs have no authentication, and
  session diagnostics may contain tool inputs and results.
- The web interface edits supported Gateway and Host settings, not arbitrary YAML
  or stdio process definitions. Management authentication remains deferred.
- Compose mounts `mabrid.yaml` read-only and the `runtime/` directory writable for
  managed edits. Runtime changes use the separate Apply actions; static settings
  and process/container environment changes still require restart or recreation.
- MCP Apps can display and exchange tool data. App-triggered follow-up messages
  and tool calls are not currently supported.
- Desktop packaging and multi-worker deployments are outside the current scope.

## License

[Apache License 2.0](LICENSE).
