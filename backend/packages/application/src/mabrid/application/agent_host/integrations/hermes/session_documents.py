"""Hermes native session, history, and Run control wire documents."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, NonNegativeInt, PositiveInt


class HermesSessionWireModel(BaseModel):
    """Base for native Hermes wire documents isolated from Agent Host contracts."""

    model_config = ConfigDict(extra="allow", frozen=True)


class HermesSession(HermesSessionWireModel):
    """Read the native remote Session identity and optional title/start metadata."""

    id: str = Field(min_length=1)
    title: str | None = None
    started_at: float | None = None


class HermesSessionDocument(HermesSessionWireModel):
    """Validate the native Session-resource response envelope."""

    object: Literal["hermes.session"]
    session: HermesSession


class HermesToolFunction(HermesSessionWireModel):
    """Preserve a historical function name and JSON-encoded argument string."""

    name: str = Field(min_length=1)
    arguments: str


class HermesToolCall(HermesSessionWireModel):
    """Validate native history's function-call identifier and function document."""

    id: str = Field(min_length=1)
    type: Literal["function"]
    function: HermesToolFunction


class HermesHistoryMessage(HermesSessionWireModel):
    """Read vendor history content before normalizing supported message representations."""

    id: int | str
    role: str
    content: JsonValue
    tool_calls: tuple[HermesToolCall, ...] | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    timestamp: float | None = None


class HermesHistoryPagination(HermesSessionWireModel):
    """Validate returned pagination evidence against the requested native history page."""

    limit: int = Field(ge=0, le=500)
    offset: NonNegativeInt
    order: Literal["oldest", "latest"]
    returned: NonNegativeInt


class HermesHistoryDocument(HermesSessionWireModel):
    """Read native message history and its effective remote Session reference."""

    object: Literal["list"]
    session_id: str = Field(min_length=1)
    data: tuple[HermesHistoryMessage, ...]
    pagination: HermesHistoryPagination


class HermesSessionChatRequest(BaseModel):
    """Send only the new user message to the native Session continuation endpoint."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    message: str = Field(min_length=1, pattern=r"\S")


class HermesSessionCreateRequest(BaseModel):
    """Send optional title metadata when creating a remote Session."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    title: str | None = None


class HermesRunStatusDocument(HermesSessionWireModel):
    """Parse explicit native Run status evidence used to verify execution settlement."""

    run_id: str = Field(min_length=1)
    status: Literal["queued", "running", "stopping", "completed", "failed", "cancelled"]
    session_id: str | None = None


class HermesStopDocument(HermesSessionWireModel):
    """Parse Hermes's stopping receipt, which is not proof of completed cancellation."""

    run_id: str = Field(min_length=1)
    status: Literal["stopping"]


class HermesSessionStreamUsage(HermesSessionWireModel):
    """Read native stream input/output usage without OpenAI wire-model coercion."""

    input_tokens: NonNegativeInt = 0
    output_tokens: NonNegativeInt = 0


class HermesSessionStreamPayload(HermesSessionWireModel):
    """Validate native SSE identity, sequence, text, and usage before event translation."""

    run_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    seq: PositiveInt
    delta: str | None = None
    content: str | None = None
    usage: HermesSessionStreamUsage = Field(default_factory=HermesSessionStreamUsage)
