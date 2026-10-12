"""First-party Host HTTP contracts excluding deployment and routing identifiers."""

from typing import Literal, Annotated
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    NonNegativeInt,
    PositiveInt,
    JsonValue,
)
from mabrid.application.agent_host import TokenUsage, AgentSessionRunStatus


class HostHttpModel(BaseModel):
    """Immutable, extra-forbid base for explicit first-party Host HTTP payloads."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class CreateHostSessionRequest(HostHttpModel):
    """Create a native conversation with optional title metadata."""

    title: str | None = None


class HostSessionResponse(HostHttpModel):
    """Public local Session metadata without opaque remote deployment or Session IDs.

    A missing native `target_run` does not establish compatibility Target idleness.
    """

    session_id: UUID
    target_id: str = Field(min_length=1)
    title: str | None = None
    created_at: AwareDatetime
    binding_state: Literal["unknown", "available", "missing", "runtime_changed", "unavailable"]
    target_run: AgentSessionRunStatus | None = None


class HostSessionPageResponse(HostHttpModel):
    """Paginate local Agent Session metadata without loading remote transcripts."""

    sessions: tuple[HostSessionResponse, ...]
    limit: int = Field(ge=1, le=200)
    offset: NonNegativeInt
    has_more: bool


class StartHostSessionRunRequest(HostHttpModel):
    """Submit only new input to a bound Session, never replayed conversation history."""

    input_text: str = Field(min_length=1, pattern=r"\S")


class HostErrorResponse(HostHttpModel):
    """Expose an allowlisted Host failure code/message and optional local correlation IDs."""

    code: Literal[
        "invalid_request",
        "run_not_found",
        "internal_error",
        "session_not_found",
        "remote_session_not_found",
        "runtime_binding_changed",
        "runtime_unavailable",
        "runtime_contract_error",
        "target_busy",
        "unsupported_operation",
        "run_state_unknown",
    ]
    message: str
    session_id: UUID | None = None
    run_id: UUID | None = None


class HostStopResponse(HostHttpModel):
    """Acknowledge Session-bound cancellation while leaving execution settlement unconfirmed."""

    session_id: UUID
    run_id: UUID
    accepted: bool
    settlement: Literal["unconfirmed"] = "unconfirmed"


class HostReconcileResponse(HostHttpModel):
    """Report whether explicit Session-bound reconciliation settled durable Run ownership."""

    session_id: UUID
    run_id: UUID
    settled: bool


class HostToolResult(HostHttpModel):
    """Preserve public MCP tool content, structured output, error state, and metadata."""

    content: tuple[dict[str, JsonValue], ...] = ()
    structured_content: dict[str, JsonValue] | None = None
    is_error: bool = False
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class HostResourceContent(HostHttpModel):
    """Present a complete MCP Apps resource content item without deployment identifiers."""

    uri: str
    mime_type: str | None = None
    text: str | None = None
    blob: str | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class HostWidget(HostHttpModel):
    """Public widget payload linked to a tool invocation and its fresh resource contents."""

    widget_id: UUID
    tool_invocation_id: UUID
    tool_name: str
    tool_result: HostToolResult
    application_resource_uri: str
    resource_contents: tuple[HostResourceContent, ...]
    resource_metadata: dict[str, JsonValue]


class HostRunStartedPayload(HostHttpModel):
    """SSE payload identifying the Target after Run admission."""

    kind: Literal["run.started"] = "run.started"
    target_id: str


class HostTextDeltaPayload(HostHttpModel):
    """SSE payload appending one assistant text fragment."""

    kind: Literal["assistant.text.delta"] = "assistant.text.delta"
    delta: str


class HostTextCompletedPayload(HostHttpModel):
    """SSE payload publishing the assembled assistant text."""

    kind: Literal["assistant.text.completed"] = "assistant.text.completed"
    text: str


class HostRunCompletedPayload(HostHttpModel):
    """SSE terminal payload with output and usage after required execution settlement."""

    kind: Literal["run.completed"] = "run.completed"
    output_text: str
    usage: TokenUsage


class HostRunCancelledPayload(HostHttpModel):
    """SSE terminal payload for settled cancellation, not stop-request acceptance."""

    kind: Literal["run.cancelled"] = "run.cancelled"


class HostRunFailedPayload(HostHttpModel):
    """SSE terminal payload containing a safe public Host error."""

    kind: Literal["run.failed"] = "run.failed"
    error: HostErrorResponse


class HostToolStartedPayload(HostHttpModel):
    """SSE payload with a stable tool-invocation ID, public tool name, and arguments."""

    kind: Literal["tool.started"] = "tool.started"
    tool_invocation_id: UUID
    tool_name: str
    arguments: dict[str, JsonValue]


class HostToolCompletedPayload(HostHttpModel):
    """SSE payload pairing a successful MCP result with its tool invocation."""

    kind: Literal["tool.completed"] = "tool.completed"
    tool_invocation_id: UUID
    tool_name: str
    result: HostToolResult


class HostToolFailedPayload(HostHttpModel):
    """SSE payload pairing sanitized failure evidence and any result with its invocation."""

    kind: Literal["tool.failed"] = "tool.failed"
    tool_invocation_id: UUID
    tool_name: str
    error_code: str
    error_message: str
    result: HostToolResult | None = None


class HostWidgetCreatedPayload(HostHttpModel):
    """SSE payload exposing an attributed widget ready for presentation."""

    kind: Literal["widget.created"] = "widget.created"
    widget: HostWidget


class HostWidgetFailedPayload(HostHttpModel):
    """SSE payload preserving tool output when the associated UI resource is unavailable."""

    kind: Literal["widget.failed"] = "widget.failed"
    tool_invocation_id: UUID
    tool_name: str
    tool_result: HostToolResult
    application_resource_uri: str
    error_message: str


HostStreamPayload = Annotated[
    HostRunStartedPayload
    | HostTextDeltaPayload
    | HostTextCompletedPayload
    | HostRunCompletedPayload
    | HostRunCancelledPayload
    | HostRunFailedPayload
    | HostToolStartedPayload
    | HostToolCompletedPayload
    | HostToolFailedPayload
    | HostWidgetCreatedPayload
    | HostWidgetFailedPayload,
    Field(discriminator="kind"),
]


class HostStreamEvent(HostHttpModel):
    """Sequence a discriminated SSE payload with local event, Session, and Run identities."""

    event_id: UUID
    session_id: UUID
    run_id: UUID
    sequence: PositiveInt
    created_at: AwareDatetime
    event: HostStreamPayload
