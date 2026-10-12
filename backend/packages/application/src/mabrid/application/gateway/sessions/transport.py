"""Application adapter between the core MCP transport and Gateway session lifecycle.

The broker resolves published endpoint keys and turns application-owned bridge session runtimes
into opaque transport sessions. It is the only application component consumed by the raw MCP ASGI
dispatcher; transport parsing therefore never reaches topology or persistence ports directly.
"""

from __future__ import annotations

from mabrid.bridge import McpTransportSession

from .service import BridgeSessionRuntime, GatewaySessionCoordinator


class GatewayMcpSessionBroker:
    """Adapt Gateway lifecycle use cases to core's opaque ASGI broker shape.

    `open_session`, `resolve_session`, `bind_transport_session`, `close_session`,
    and `transport` structurally implement the generic MCP Session broker.
    [GatewaySessionCoordinator](service.py) owns the Session; the returned transport
    is its downstream server, not an application-owned HTTP implementation.
    Contract: [McpSessionBroker](../../../../../../bridge/src/mabrid/bridge/downstream/asgi.py).
    """

    def __init__(self, coordinator: GatewaySessionCoordinator) -> None:
        self._coordinator = coordinator

    async def open_session(self, endpoint_key: str) -> BridgeSessionRuntime | None:
        if self._coordinator.resolve_published_endpoint(endpoint_key) is None:
            return None
        return await self._coordinator.open_session(endpoint_key)

    async def resolve_session(
        self,
        endpoint_key: str,
        transport_session_id: str,
    ) -> BridgeSessionRuntime | None:
        return await self._coordinator.resolve_session(endpoint_key, transport_session_id)

    async def bind_transport_session(
        self,
        session: BridgeSessionRuntime,
        transport_session_id: str,
    ) -> None:
        await self._coordinator.bind_transport_session(session, transport_session_id)

    async def close_session(self, session: BridgeSessionRuntime) -> None:
        await self._coordinator.close_session(session)

    def transport(self, session: BridgeSessionRuntime) -> McpTransportSession:
        return session.bridge_session.transport
