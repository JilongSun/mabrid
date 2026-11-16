"""Keep Host clients admitted until the complete ASGI response, including streams, finishes."""

from starlette.types import ASGIApp, Receive, Scope, Send

from mabrid.server.composition.host_runtime import AgentHostRuntime


class HostOperationMiddleware:
    """Lease the active Host for business/probe routes, excluding configuration commands."""

    def __init__(self, app: ASGIApp, runtime: AgentHostRuntime) -> None:
        self._app = app
        self._runtime = runtime

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        host_path = (
            path == "/api/v1/capabilities"
            or path == "/api/v1/agent-host/target"
            or path == "/api/v1/host"
            or path.startswith("/api/v1/host/")
            or path == "/v1"
            or path.startswith("/v1/")
        )
        if scope["type"] == "http" and host_path:
            async with self._runtime.operation():
                await self._app(scope, receive, send)
        else:
            await self._app(scope, receive, send)
