"""Ports required by the MCP Apps lifecycle application."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from ..agent_host import OperationRunAttribution
from .contracts import WidgetEvent


class OperationAttributionReader(Protocol):
    """Read an operation's captured Run attribution for [McpAppsLifecycleProjector](projector.py:38).

    Only `get` is required; the Agent Host attribution registry satisfies this
    narrow structural view without exposing its `record` operation to MCP Apps.
    """

    async def get(
        self,
        session_key: str,
        operation_key: str,
    ) -> OperationRunAttribution | None: ...


class WidgetEventStore(Protocol):
    """Track pending operations and append/read composed widget outcomes.

    [InMemoryWidgetEventStore](store.py:12) structurally supplies operation tracking,
    `append`, Run reads, settlement waiting, and abort. Host presentation consumes
    its separate reader view rather than this lifecycle write surface.
    """

    async def start_operation(self, attribution: OperationRunAttribution) -> None: ...

    async def settle_operation(self, attribution: OperationRunAttribution) -> None: ...

    async def append(self, event: WidgetEvent) -> None: ...

    async def list_for_run(self, run_id: UUID) -> tuple[WidgetEvent, ...]: ...

    async def wait_until_settled(self, run_id: UUID) -> None: ...

    async def abort_run(self, run_id: UUID) -> None: ...
