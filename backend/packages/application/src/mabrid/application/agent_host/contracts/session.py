"""Agent Session bindings and runtime-owned history presentation contracts."""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import AwareDatetime, Field, JsonValue, NonNegativeInt

from .base import AgentHostModel
from .run import TokenUsage


class RuntimeSessionReference(AgentHostModel):
    """Pair an opaque remote Session ID with its stable runtime deployment binding."""

    runtime_binding_id: str = Field(min_length=1)
    remote_session_id: str = Field(min_length=1)


class AgentSessionRecord(AgentHostModel):
    """Persist Mabrid Session identity and metadata, not a duplicated conversation transcript."""

    session_id: UUID = Field(default_factory=uuid4)
    target_id: str = Field(min_length=1)
    runtime_session: RuntimeSessionReference
    title: str | None = None
    created_at: AwareDatetime


class CreateAgentSessionCommand(AgentHostModel):
    """Request a native remote Session with optional initial title metadata."""

    title: str | None = None


class AgentSessionRunStatus(AgentHostModel):
    """Expose the native Target lease's local Session/Run identity and active or unsettled state."""

    session_id: UUID
    run_id: UUID
    state: Literal["active", "unsettled"]


class StartSessionRunCommand(AgentHostModel):
    """Continue one bound Session with new input only, without replaying prior messages."""

    run_id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    input_text: str = Field(min_length=1, pattern=r"\S")


class HistoryPageQuery(AgentHostModel):
    """Bound runtime history reads with explicit page size, offset, and ordering."""

    limit: int = Field(default=100, ge=1, le=500)
    offset: NonNegativeInt = 0
    order: Literal["oldest", "latest"] = "latest"


class HistoryText(AgentHostModel):
    """Represent supported textual content in runtime-owned history."""

    kind: Literal["text"] = "text"
    text: str


class HistoryUnsupportedContent(AgentHostModel):
    """Identify unsupported historical content without exposing its opaque payload."""

    kind: Literal["unsupported"] = "unsupported"
    content_type: str = Field(min_length=1)


class HistoryToolCall(AgentHostModel):
    """Normalize a historical tool request and its parsed JSON arguments."""

    kind: Literal["tool_call"] = "tool_call"
    tool_call_id: str = Field(min_length=1)
    tool_name: str = Field(min_length=1)
    arguments: dict[str, JsonValue]


HistoryContent = Annotated[
    HistoryText | HistoryToolCall | HistoryUnsupportedContent,
    Field(discriminator="kind"),
]


class AgentHistoryMessage(AgentHostModel):
    """Present one runtime-owned message with supported content and optional tool correlation."""

    message_id: str = Field(min_length=1)
    role: Literal["system", "developer", "user", "assistant", "tool", "unsupported"]
    content: tuple[HistoryContent, ...]
    tool_call_id: str | None = None
    tool_name: str | None = None
    created_at: AwareDatetime | None = None


class AgentHistoryPage(AgentHostModel):
    """Attach a runtime history page to the stable local Agent Session identity."""

    session_id: UUID
    messages: tuple[AgentHistoryMessage, ...]
    query: HistoryPageQuery
    has_more: bool | None = None


class RuntimeAgentSession(AgentHostModel):
    """Return remote Session identity/title from the native catalog port."""

    remote_session_id: str = Field(min_length=1)
    title: str | None = None


class RuntimeHistoryPage(AgentHostModel):
    """Return history and its effective remote Session reference for verified adoption."""

    remote_session_id: str = Field(min_length=1)
    messages: tuple[AgentHistoryMessage, ...]
    query: HistoryPageQuery
    has_more: bool | None = None


class RuntimeRunHandle(AgentHostModel):
    """Bind an opaque remote Run ID to the deployment allowed to control it."""

    runtime_binding_id: str = Field(min_length=1)
    remote_run_id: str = Field(min_length=1)


class UnsettledSessionRun(AgentHostModel):
    """Persist Target ownership even when submission leaves the remote Run ID unknown."""

    target_id: str = Field(min_length=1)
    session_id: UUID
    run_id: UUID
    runtime_binding_id: str = Field(min_length=1)
    remote_run_id: str | None = None

    @property
    def handle(self) -> RuntimeRunHandle | None:
        if self.remote_run_id is None:
            return None
        return RuntimeRunHandle(
            runtime_binding_id=self.runtime_binding_id, remote_run_id=self.remote_run_id
        )


class RuntimeSessionRunStarted(AgentHostModel):
    """Provide the remote execution handle for durable local Run tracking."""

    kind: Literal["session_adapter.started"] = "session_adapter.started"
    handle: RuntimeRunHandle


class RuntimeSessionTextDelta(AgentHostModel):
    """Emit a native execution text fragment without provider-specific SSE fields."""

    kind: Literal["session_adapter.text.delta"] = "session_adapter.text.delta"
    delta: str


class RuntimeSessionRunCompleted(AgentHostModel):
    """Report native completion and effective Session reference after verified remote exit."""

    kind: Literal["session_adapter.completed"] = "session_adapter.completed"
    remote_session_id: str = Field(min_length=1)
    output_text: str
    usage: TokenUsage = Field(default_factory=TokenUsage)


class RuntimeSessionRunCancelled(AgentHostModel):
    """Represent the native cancellation outcome after execution settlement."""

    kind: Literal["session_adapter.cancelled"] = "session_adapter.cancelled"


RuntimeSessionRunEvent = Annotated[
    RuntimeSessionRunStarted
    | RuntimeSessionTextDelta
    | RuntimeSessionRunCompleted
    | RuntimeSessionRunCancelled,
    Field(discriminator="kind"),
]


class RuntimeStopReceipt(AgentHostModel):
    """Acknowledge a stop request without asserting that remote execution has exited."""

    handle: RuntimeRunHandle
    accepted: bool


class RuntimeRunState(AgentHostModel):
    """Normalize remote execution status, retaining unknown state when evidence is absent."""

    handle: RuntimeRunHandle
    state: Literal["queued", "running", "stopping", "completed", "failed", "cancelled", "unknown"]

    @property
    def is_terminal(self) -> bool:
        return self.state in {"completed", "failed", "cancelled"}
