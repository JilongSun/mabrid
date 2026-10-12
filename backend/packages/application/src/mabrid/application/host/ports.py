"""Source ports used by Host presentation composition."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Protocol
from uuid import UUID

from ..agent_host import (
    AgentRunEvent,
    StartRunCommand,
    ToolActivityEvent,
    StartSessionRunCommand,
    RuntimeSessionRunEvent,
)
from ..mcp_apps import WidgetEvent


class AgentRunEventSource(Protocol):
    """Compatibility Run source consumed by [HostEventStream](service.py).

    [AgentHostService](../agent_host/application/service.py) structurally supplies
    `run_events`; the presentation merger does not depend on its runtime adapter.
    """

    def run_events(self, command: StartRunCommand) -> AsyncGenerator[AgentRunEvent, None]: ...


class SessionRunEventSource(Protocol):
    """Native Session source consumed by [HostSessionEventStream](service.py).

    [AgentSessionService](../agent_host/application/sessions.py) structurally
    supplies `target_id` and `run_session`; Session admission remains application-owned.
    """

    target_id: str

    def run_session(
        self, command: StartSessionRunCommand
    ) -> AsyncGenerator[RuntimeSessionRunEvent, None]: ...


class WidgetEventReader(Protocol):
    """Read/wait widget outcomes for Host presentation without lifecycle writes.

    [InMemoryWidgetEventStore](../mcp_apps/store.py) supplies `list_for_run`,
    `wait_for_events`, and `wait_until_settled` structurally.
    """

    async def list_for_run(self, run_id: UUID) -> tuple[WidgetEvent, ...]: ...

    async def wait_for_events(self, run_id: UUID, after: int) -> tuple[WidgetEvent, ...]: ...

    async def wait_until_settled(self, run_id: UUID) -> None: ...


class ToolActivityReader(Protocol):
    """Read/wait attributed tool events and resolve their public invocation IDs.

    [InMemoryToolActivityStore](../agent_host/application/activity.py) supplies
    `list_for_run`, `wait_for_events`, and `invocation_id` structurally to the merger.
    """

    async def list_for_run(self, run_id: UUID) -> tuple[ToolActivityEvent, ...]: ...

    async def wait_for_events(self, run_id: UUID, after: int) -> tuple[ToolActivityEvent, ...]: ...

    async def invocation_id(self, session_key: str, operation_key: str) -> UUID | None: ...
