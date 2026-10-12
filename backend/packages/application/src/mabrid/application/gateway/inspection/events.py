"""Durable session inspection events emitted by application stores."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, TypeAlias
from uuid import uuid4

from pydantic import BaseModel, Field

from .models import (
    ResourceReadRecord,
    ToolCallRecord,
    ToolDescriptor,
    UpstreamAvailability,
    UpstreamInitialization,
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def next_event_id() -> str:
    return str(uuid4())


class BaseSessionEvent(BaseModel):
    """Identify and timestamp a durable inspection event, separate from core observations."""

    event_id: str = Field(default_factory=next_event_id)
    session_id: str
    created_at: datetime = Field(default_factory=utc_now)


class SessionStartedEvent(BaseSessionEvent):
    """Record Session initialization and any available downstream identity evidence."""

    kind: Literal["session.started"] = "session.started"
    upstream: UpstreamInitialization | None = None


class ToolDiscoveredEvent(BaseSessionEvent):
    """Record one published tool in the Session's diagnostic event history."""

    kind: Literal["tool.discovered"] = "tool.discovered"
    tool: ToolDescriptor


class ToolCallStartedEvent(BaseSessionEvent):
    """Record a tool invocation's input and initial diagnostic state."""

    kind: Literal["tool.call.started"] = "tool.call.started"
    call: ToolCallRecord


class ToolCallCompletedEvent(BaseSessionEvent):
    """Record a paired invocation's terminal result or failed diagnostic state."""

    kind: Literal["tool.call.completed"] = "tool.call.completed"
    call: ToolCallRecord


class ResourceReadEvent(BaseSessionEvent):
    """Record complete resource content and optional tool-operation correlation."""

    kind: Literal["resource.read"] = "resource.read"
    read: ResourceReadRecord


class ErrorRaisedEvent(BaseSessionEvent):
    """Retain diagnostic error text and details for trusted management inspection."""

    kind: Literal["error.raised"] = "error.raised"
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class UpstreamAvailabilityChangedEvent(BaseSessionEvent):
    """Record a binding revision's updated initialization or failure evidence."""

    kind: Literal["upstream.availability.changed"] = "upstream.availability.changed"
    availability: UpstreamAvailability


SessionEvent: TypeAlias = (
    SessionStartedEvent
    | ToolDiscoveredEvent
    | ToolCallStartedEvent
    | ToolCallCompletedEvent
    | ResourceReadEvent
    | UpstreamAvailabilityChangedEvent
    | ErrorRaisedEvent
)
