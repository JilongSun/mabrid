"""Events emitted by Agent Host run orchestration."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, TypeAlias
from uuid import UUID, uuid4

from pydantic import Field, PositiveInt

from .base import AgentHostModel
from .run import AgentRunResult


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AgentRunEventBase(AgentHostModel):
    """Sequence and timestamp an agent-domain event within a local Run."""

    event_id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    sequence: PositiveInt
    created_at: datetime = Field(default_factory=utc_now)


class AgentRunStarted(AgentRunEventBase):
    """Report admitted execution against the selected Target identity."""

    kind: Literal["run.started"] = "run.started"
    model: str


class AssistantTextDelta(AgentRunEventBase):
    """Append one assistant text fragment to the agent-domain stream."""

    kind: Literal["assistant.text.delta"] = "assistant.text.delta"
    delta: str


class AssistantTextCompleted(AgentRunEventBase):
    """Publish the assembled assistant text before the Run terminal event."""

    kind: Literal["assistant.text.completed"] = "assistant.text.completed"
    text: str


class AgentRunCompleted(AgentRunEventBase):
    """Publish the completed agent result after required local workflow settlement."""

    kind: Literal["run.completed"] = "run.completed"
    result: AgentRunResult


class AgentRunFailed(AgentRunEventBase):
    """Represent an application Run failure before HTTP-specific error projection."""

    kind: Literal["run.failed"] = "run.failed"
    error_message: str


class AgentRunCancelled(AgentRunEventBase):
    """Represent a settled cancellation outcome, not merely a stop request receipt."""

    kind: Literal["run.cancelled"] = "run.cancelled"


AgentRunEvent: TypeAlias = Annotated[
    AgentRunStarted
    | AssistantTextDelta
    | AssistantTextCompleted
    | AgentRunCompleted
    | AgentRunFailed
    | AgentRunCancelled,
    Field(discriminator="kind"),
]
