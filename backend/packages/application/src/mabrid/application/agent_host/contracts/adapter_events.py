"""Events emitted through the outbound Agent Runtime port."""

from typing import Annotated, Literal, TypeAlias

from pydantic import Field

from .base import AgentHostModel
from .run import AgentFinishReason, TokenUsage


class AgentAdapterTextDelta(AgentHostModel):
    """Provider-neutral text fragment emitted by the compatibility runtime adapter."""

    kind: Literal["adapter.text.delta"] = "adapter.text.delta"
    delta: str


class AgentAdapterCompleted(AgentHostModel):
    """Compatibility adapter completion evidence with normalized finish reason and usage."""

    kind: Literal["adapter.completed"] = "adapter.completed"
    finish_reason: AgentFinishReason = "stop"
    usage: TokenUsage = Field(default_factory=TokenUsage)


AgentAdapterEvent: TypeAlias = Annotated[
    AgentAdapterTextDelta | AgentAdapterCompleted,
    Field(discriminator="kind"),
]
