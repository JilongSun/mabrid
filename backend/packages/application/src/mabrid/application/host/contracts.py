"""Presentation envelopes for the composed Agent Host and MCP Apps event stream."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, TypeAlias
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, PositiveInt

from ..agent_host import AgentRunEvent, ToolActivityEvent
from ..mcp_apps import WidgetEvent


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class HostEventModel(BaseModel):
    """Immutable, extra-forbid base for internal Host presentation envelopes."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class HostEventBase(HostEventModel):
    """Order composed presentation events within a local Run and optional Agent Session."""

    event_id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    sequence: PositiveInt
    created_at: datetime = Field(default_factory=utc_now)
    session_id: UUID | None = None


class HostAgentEvent(HostEventBase):
    """Wrap an agent-domain event in the common Host presentation sequence."""

    kind: Literal["host.agent"] = "host.agent"
    event: AgentRunEvent


class HostWidgetEvent(HostEventBase):
    """Wrap widget lifecycle with optional public tool-invocation correlation."""

    kind: Literal["host.widget"] = "host.widget"
    event: WidgetEvent
    tool_invocation_id: UUID | None = None


class HostToolEvent(HostEventBase):
    """Wrap attributed tool activity in the common Host presentation sequence."""

    kind: Literal["host.tool"] = "host.tool"
    event: ToolActivityEvent


HostEvent: TypeAlias = HostAgentEvent | HostWidgetEvent | HostToolEvent
