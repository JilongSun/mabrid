"""Typed observations emitted by bridge core."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .protocol import (
    ReadResourceResult,
    ToolCallResult,
    ToolDescriptor,
    UpstreamIdentity,
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ObservationModel(BaseModel):
    """Immutable, extra-forbid base for core-owned observation values."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class BridgeFailureCode(StrEnum):
    """Stable categories for plan, routing, transport, and protocol failures."""

    INVALID_PLAN = "invalid_plan"
    UNKNOWN_TOOL = "unknown_tool"
    UNKNOWN_RESOURCE = "unknown_resource"
    BINDING_UNAVAILABLE = "binding_unavailable"
    UPSTREAM_TRANSPORT = "upstream_transport"
    UPSTREAM_PROTOCOL = "upstream_protocol"
    UNSUPPORTED_CAPABILITY = "unsupported_capability"
    PROTOCOL_ADAPTER = "protocol_adapter"


class BindingAvailabilityStatus(StrEnum):
    """Evidence-based availability of an individual upstream binding."""

    UNKNOWN = "unknown"
    AVAILABLE = "available"
    FAILED = "failed"


class BridgeFailure(ObservationModel):
    """Typed failure evidence with optional binding attribution and retryability."""

    code: BridgeFailureCode
    message: str
    retryable: bool = False
    binding_key: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ObservationBase(ObservationModel):
    """Attach a bridge Session key and observation time to a core event."""

    session_key: str
    observed_at: datetime = Field(default_factory=utc_now)


class BridgeSessionStarted(ObservationBase):
    """Report the downstream identity selected when a bridge Session starts."""

    kind: Literal["bridge.session.started"] = "bridge.session.started"
    identity: UpstreamIdentity


class BindingAvailabilityChanged(ObservationBase):
    """Report changed availability and identity or failure evidence for one binding."""

    kind: Literal["bridge.binding.availability_changed"] = "bridge.binding.availability_changed"
    binding_key: str
    status: BindingAvailabilityStatus
    identity: UpstreamIdentity | None = None
    failure: BridgeFailure | None = None


class ToolsPublished(ObservationBase):
    """Publish the tools visible through the current Session router."""

    kind: Literal["bridge.tools.published"] = "bridge.tools.published"
    tools: tuple[ToolDescriptor, ...]


class ToolCallStarted(ObservationBase):
    """Identify one tool operation before dispatch, including its public name and input."""

    kind: Literal["bridge.tool_call.started"] = "bridge.tool_call.started"
    operation_key: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolCallCompleted(ObservationBase):
    """Pair a tool operation key with its complete result or typed failure."""

    kind: Literal["bridge.tool_call.completed"] = "bridge.tool_call.completed"
    operation_key: str
    result: ToolCallResult | None = None
    failure: BridgeFailure | None = None


class ResourceRead(ObservationBase):
    """Preserve a complete resource result with optional tool-operation attribution."""

    kind: Literal["bridge.resource.read"] = "bridge.resource.read"
    operation_key: str | None = None
    binding_key: str | None = None
    requested_uri: str
    result: ReadResourceResult


class BridgeErrorRaised(ObservationBase):
    """Report a typed bridge failure outside a successful MCP result."""

    kind: Literal["bridge.error.raised"] = "bridge.error.raised"
    operation: str
    operation_key: str | None = None
    failure: BridgeFailure


BridgeObservation = Annotated[
    BridgeSessionStarted
    | BindingAvailabilityChanged
    | ToolsPublished
    | ToolCallStarted
    | ToolCallCompleted
    | ResourceRead
    | BridgeErrorRaised,
    Field(discriminator="kind"),
]
