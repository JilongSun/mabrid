"""Renderer-neutral MCP Apps widget lifecycle contracts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, TypeAlias
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class McpAppsModel(BaseModel):
    """Immutable, extra-forbid base for composed MCP Apps lifecycle values."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class WidgetToolResult(McpAppsModel):
    """Preserve the tool output used to initialize an interactive MCP App."""

    content: tuple[dict[str, Any], ...] = ()
    structured_content: dict[str, Any] | None = None
    is_error: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ApplicationResourceContent(McpAppsModel):
    """Preserve one fresh MCP Apps resource content item and its metadata."""

    uri: str
    mime_type: str | None = None
    text: str | None = None
    blob: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class WidgetInstance(McpAppsModel):
    """Combine attributed tool output and complete fresh resource payloads for one widget."""

    widget_id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    target_id: str = Field(min_length=1)
    session_key: str = Field(min_length=1)
    operation_key: str = Field(min_length=1)
    tool_name: str = Field(min_length=1)
    tool_result: WidgetToolResult
    application_resource_uri: str = Field(min_length=1)
    resource_contents: tuple[ApplicationResourceContent, ...] = Field(min_length=1)
    resource_metadata: dict[str, Any] = Field(default_factory=dict)


class WidgetCreated(McpAppsModel):
    """Report a composed widget ready for first-party presentation."""

    kind: Literal["widget.created"] = "widget.created"
    event_id: UUID = Field(default_factory=uuid4)
    occurred_at: datetime = Field(default_factory=utc_now)
    widget: WidgetInstance


class WidgetFailed(McpAppsModel):
    """Report an attributed UI-resource failure while preserving the tool result."""

    kind: Literal["widget.failed"] = "widget.failed"
    event_id: UUID = Field(default_factory=uuid4)
    occurred_at: datetime = Field(default_factory=utc_now)
    run_id: UUID
    target_id: str = Field(min_length=1)
    session_key: str = Field(min_length=1)
    operation_key: str = Field(min_length=1)
    tool_name: str = Field(min_length=1)
    tool_result: WidgetToolResult
    application_resource_uri: str = Field(min_length=1)
    error_message: str = Field(min_length=1)


WidgetEvent: TypeAlias = WidgetCreated | WidgetFailed
