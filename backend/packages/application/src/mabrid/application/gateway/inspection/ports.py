"""Durable event and snapshot ports required by Gateway inspection projection."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from .events import (
    ErrorRaisedEvent,
    ResourceReadEvent,
    SessionEvent,
    SessionStartedEvent,
    ToolCallCompletedEvent,
    ToolCallStartedEvent,
    ToolDiscoveredEvent,
    UpstreamAvailabilityChangedEvent,
)
from .models import (
    BridgeSessionSnapshot,
    ResourceReadRecord,
    ToolCallResult,
    ToolDescriptor,
    UpstreamAvailability,
    UpstreamInitialization,
)
from .queries import SessionEventPage, SessionEventPageRequest


class BridgeSessionStore(Protocol):
    """Event/snapshot write and read surface for one bridge Session.

    [SessionInspectionProjector](projector.py:39) writes observation projections;
    server persistence supplies event appends, snapshots, and waiting structurally.
    HTTP inspection uses the narrower [SessionInspectionReader](ports.py:94).
    """

    async def start(
        self,
        upstream: UpstreamInitialization | None = None,
    ) -> SessionStartedEvent: ...

    async def register_tools(self, tools: list[ToolDescriptor]) -> list[ToolDiscoveredEvent]: ...

    async def start_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, object] | None = None,
        *,
        call_id: str | None = None,
    ) -> ToolCallStartedEvent: ...

    async def complete_tool_call(
        self,
        call_id: str,
        result: ToolCallResult,
        *,
        failed: bool = False,
    ) -> ToolCallCompletedEvent: ...

    async def record_resource_read(self, read: ResourceReadRecord) -> ResourceReadEvent: ...

    async def set_upstream_availability(
        self,
        availability: list[UpstreamAvailability],
    ) -> list[UpstreamAvailabilityChangedEvent]: ...

    async def record_error(
        self,
        message: str,
        details: dict[str, object] | None = None,
    ) -> ErrorRaisedEvent: ...

    async def snapshot(self) -> BridgeSessionSnapshot: ...

    async def events(self, after_index: int = 0) -> list[SessionEvent]: ...

    async def wait_for_events(self, after_index: int = 0) -> list[SessionEvent]: ...


class BridgeSessionStoreFactory(Protocol):
    """Create, resolve, and remove Session-scoped [BridgeSessionStore](ports.py:29) views.

    The coordinator consumes `create`/`get`/`remove` structurally; the server SQL
    factory owns persistence and process-local notification resources.
    """

    async def create(self, session_id: UUID) -> BridgeSessionStore: ...

    async def get(self, session_id: UUID) -> BridgeSessionStore | None: ...

    async def remove(self, session_id: UUID) -> None: ...


class SessionInspectionReader(Protocol):
    """Paginated management reads through `get_snapshot` and `list_events`.

    The server SQL reader supplies this shape structurally, without widening the
    runtime store or its lifecycle factory with HTTP query responsibilities.
    """

    async def get_snapshot(self, session_id: UUID) -> BridgeSessionSnapshot | None: ...

    async def list_events(self, request: SessionEventPageRequest) -> SessionEventPage | None: ...
