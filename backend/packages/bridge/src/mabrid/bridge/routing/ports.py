"""Lifecycle and MCP method contract implemented by one session router."""

from typing import Protocol

from ..contracts import McpMethodRouter, UpstreamIdentity


class McpSessionRouter(McpMethodRouter, Protocol):
    """Extend [McpMethodRouter](../contracts/methods.py:15) with Session lifecycle.

    `identity`, `start`, and `close` complete the router contract used by the
    bridge engine. [PassthroughRouter](passthrough.py:26) and
    [AggregateRouter](aggregate.py:63) provide it structurally without inheritance.
    """

    @property
    def identity(self) -> UpstreamIdentity: ...

    async def start(self) -> None: ...

    async def close(self) -> None: ...
