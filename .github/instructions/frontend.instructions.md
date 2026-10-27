---
description: "Stable React conventions for gateway management, Agent Host sessions, and MCP Apps rendering."
applyTo: ["frontend/**", "**/*.tsx", "**/*.ts"]
---
# Frontend Guidelines

## Tooling

- Use React with Vite and pnpm.
- Run `pnpm dev` for development, `pnpm build` for production builds, `pnpm test` for Vitest.
- Keep dependencies minimal; add new packages only when the built-in platform or existing stack cannot solve the problem cleanly.
- Prefer mature SDKs and established packages when they fit the requirement well. Avoid custom UI infrastructure when a stable package already solves the problem.

## Delivery Scope

- Maintain the current frontend in focused feature and fix batches, not as a disposable rewrite.
- Deliver supporting frontend behavior with its backend feature, including necessary loading,
	error, conflict, and unavailable states. Keep unrelated experience experiments in the dedicated
	exploration workstream defined by the project instructions.

## Structural Boundaries

The frontend serves both gateway management and the first-party Agent Host. Keep those bounded
contexts explicit without adopting a generic large-chat-application scaffold.

Organize code so these concerns stay separate:

- **Agent Host transcript** — user messages, model output, and streaming event display
- **Tool activity** — tool call lifecycle, timing, input/output summaries
- **MCP App rendering** — integration with `@mcp-ui/client`, sandboxed iframe, resource loading
- **Management** — upstreams, endpoints, bindings, publication revisions, and status
- **Session transport** — Session-bound POST-SSE admission, stream parsing, cancellation,
	reconciliation, history loading, and safe error handling; not WebSocket transport or SSE replay
- **UI action handling** — validated MCP Apps initialization/data exchange and supported host
	methods; explicitly reject unsupported product-level follow-up actions

## State Management

- Prefer local component state and React Context for shared session data.
- Do not introduce global state libraries (Redux, Zustand) unless a specific task proves React Context is insufficient.
- Keep session event stream and derived UI state in separate layers so the transcript does not need to understand MCP App rendering internals.
- Agent runtimes own transcript/history and context continuity. Use local Agent Session IDs for
	selection and send new input only; do not replay a locally assembled transcript to simulate a
	remote session. Session switching is not cancellation.
- Capabilities are separate from Run admission. Unknown support is not available support, an
	accepted stop is not verified termination, and a disconnected stream must not be automatically
	resubmitted. Keep busy/unsettled states visible and use the frozen recovery contracts.
- Keep page-local MCP App state separate from runtime-owned history. Do not refetch resources,
	replay tool calls, or resubmit Runs merely to reconstruct widgets after navigation or refresh.
	Durable widget restoration requires a separately approved contract.

## Component Rules

- A component that renders chat transcript should not also manage POST-SSE lifecycle.
- A component that wraps `@mcp-ui/client` AppRenderer should not also own tool-activity polling.
- Event handlers (`onMessage`, `onOpenLink`, `onUiAction`) must validate origins and payload shapes before acting.
- Avoid OS-specific path, shell, or URL assumptions in the frontend toolchain and development scripts when portable alternatives exist.

## Testing

- Use Vitest for unit and component tests.
- Use Playwright for integration tests that span the POST-SSE Run lifecycle and rendered MCP App
	widget, including disconnect, capability/error states, and sandbox boundaries.
- For sandbox or network-policy changes, verify the actual built renderer/proxy/guest boundary
	with controlled browser tests, including permitted behavior and denied self-navigation/egress.
	CSP string assertions, blocked fetches, or parent-DOM isolation alone do not prove network
	containment; do not send real data to external destinations during verification.
- Do not test framework behavior; test session flows, event rendering, and action dispatch.
