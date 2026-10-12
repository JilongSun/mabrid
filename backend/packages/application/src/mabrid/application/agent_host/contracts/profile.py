"""Local runtime integration profile and implemented capabilities."""

from enum import StrEnum

from pydantic import Field

from .base import AgentHostModel


class AgentRuntimeInterface(StrEnum):
    """Identify the runtime API family rather than its vendor or transport."""

    OPENAI_CHAT_COMPLETIONS = "openai-chat-completions"


class AgentCapability(StrEnum):
    """Name locally implemented provider-neutral runtime behaviors."""

    TEXT_GENERATION = "text-generation"
    TOKEN_USAGE = "token-usage"


class AgentRuntimeProfile(AgentHostModel):
    """Immutable integration/interface selection and locally implemented capability set."""

    integration_kind: str = Field(min_length=1)
    interface: AgentRuntimeInterface
    capabilities: frozenset[AgentCapability] = Field(default_factory=frozenset)
