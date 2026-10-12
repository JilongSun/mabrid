"""Agent Target identity and Gateway endpoint assignment contracts."""

from datetime import datetime

from pydantic import Field

from .base import AgentHostModel
from .profile import AgentRuntimeProfile


class AgentModel(AgentHostModel):
    """Present the single Agent Target through the compatibility model-list boundary."""

    model_id: str = Field(min_length=1)
    created_at: datetime | None = None
    owned_by: str = "unknown"


class AgentEndpointAssignment(AgentHostModel):
    """Declare the stable Gateway endpoint intended for an external runtime."""

    endpoint_slug: str = Field(pattern=r"^[a-z][a-z0-9-]*$")


class AgentTarget(AgentHostModel):
    """Combine product identity, selected runtime profile, and declared endpoint assignment."""

    target_id: str = Field(min_length=1)
    runtime_profile: AgentRuntimeProfile
    endpoint_assignment: AgentEndpointAssignment
