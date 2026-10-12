"""Shared validation policy for provider-neutral Agent Host contracts."""

from pydantic import BaseModel, ConfigDict


class AgentHostModel(BaseModel):
    """Immutable, extra-forbid base for provider-neutral Agent Host contracts."""

    model_config = ConfigDict(extra="forbid", frozen=True)
