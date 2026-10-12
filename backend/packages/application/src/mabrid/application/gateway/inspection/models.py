"""Session inspection snapshots, resources, and tool activity models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SessionStatus(StrEnum):
    """Lifecycle vocabulary for an inspection snapshot, not the runtime Session owner."""

    STARTING = "starting"
    READY = "ready"
    DEGRADED = "degraded"
    ERROR = "error"
    CLOSED = "closed"


class UpstreamAvailabilityStatus(StrEnum):
    """Diagnostic availability evidence for one captured upstream binding."""

    UNKNOWN = "unknown"
    AVAILABLE = "available"
    FAILED = "failed"


class ToolCallStatus(StrEnum):
    """Diagnostic state of an observed tool invocation."""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class UpstreamInitialization(BaseModel):
    """Persist initialization identity and raw capability evidence for inspection."""

    server_name: str
    server_version: str | None = None
    protocol_version: str | None = None
    instructions: str | None = None
    supports_tools: bool = True
    supports_resources: bool = False
    raw_capabilities: dict[str, Any] = Field(default_factory=dict)


class ToolDescriptor(BaseModel):
    """Inspection projection of a published MCP tool, including schemas and metadata."""

    name: str
    title: str | None = None
    description: str | None = None
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] | None = None
    annotations: dict[str, Any] = Field(default_factory=dict)
    ui_resource_uri: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolCallResult(BaseModel):
    """Persist a complete MCP tool output for diagnostic reads."""

    content: list[dict[str, Any]] = Field(default_factory=list)
    structured_content: dict[str, Any] | None = None
    is_error: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolCallRecord(BaseModel):
    """Pair one observed invocation's input, timing, diagnostic state, and result."""

    call_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    status: ToolCallStatus
    result: ToolCallResult | None = None
    started_at: datetime = Field(default_factory=utc_now)
    completed_at: datetime | None = None


class ResourceContent(BaseModel):
    """Persist an individual resource content item without truncating text or binary data."""

    uri: str
    mime_type: str | None = None
    text: str | None = None
    blob: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ResourceReadRecord(BaseModel):
    """Retain complete resource-read contents and optional operation attribution."""

    operation_key: str | None = None
    requested_uri: str
    contents: list[ResourceContent]
    metadata: dict[str, Any] = Field(default_factory=dict)
    loaded_at: datetime = Field(default_factory=utc_now)


class ResourceDescriptor(BaseModel):
    """Represent MCP resource discovery fields in the inspection vocabulary."""

    name: str
    uri: str
    title: str | None = None
    description: str | None = None
    mime_type: str | None = None
    annotations: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    size: int | None = None


class UpstreamAvailability(BaseModel):
    """Attach availability and failure evidence to exact endpoint/upstream revisions."""

    binding_revision_id: str
    namespace: str | None = None
    upstream_revision_id: str
    upstream_server_id: str
    status: UpstreamAvailabilityStatus = UpstreamAvailabilityStatus.UNKNOWN
    identity: UpstreamInitialization | None = None
    failure_kind: str | None = None
    error_message: str | None = None
    updated_at: datetime = Field(default_factory=utc_now)


class BridgeSessionSnapshot(BaseModel):
    """Current diagnostic projection of discovery, tool calls, resources, and errors."""

    session_id: str
    status: SessionStatus = SessionStatus.STARTING
    upstream: UpstreamInitialization | None = None
    upstream_availability: list[UpstreamAvailability] = Field(default_factory=list)
    discovered_tools: list[ToolDescriptor] = Field(default_factory=list)
    active_tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    resource_reads: list[ResourceReadRecord] = Field(default_factory=list)
    last_error: str | None = None
    event_count: int = 0
    updated_at: datetime = Field(default_factory=utc_now)
