"""Read models for inspecting current managed topology without runtime secrets."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from mabrid.bridge import EndpointMode
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, PositiveFloat, PositiveInt


class ManagementReadModel(BaseModel):
    """Immutable, secret-safe application values for topology management reads."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class ConfiguredKey(ManagementReadModel):
    """Reveal a configured header/environment key without revealing its value."""

    name: str = Field(min_length=1)
    configured: Literal[True] = True


class ManagedStreamableHttpConnection(ManagementReadModel):
    """Expose streamable HTTP connection details with header values redacted."""

    transport: Literal["streamable-http"] = "streamable-http"
    url: AnyHttpUrl
    headers: tuple[ConfiguredKey, ...] = ()
    timeout_seconds: PositiveFloat = 30.0


class ManagedSseConnection(ManagementReadModel):
    """Expose legacy SSE connection details with header values redacted."""

    transport: Literal["sse"] = "sse"
    url: AnyHttpUrl
    headers: tuple[ConfiguredKey, ...] = ()


class ManagedStdioConnection(ManagementReadModel):
    """Expose subprocess connection details with environment values redacted."""

    transport: Literal["stdio"] = "stdio"
    command: str = Field(min_length=1)
    args: tuple[str, ...] = ()
    cwd: Path | None = None
    env: tuple[ConfiguredKey, ...] = ()


ManagedUpstreamConnection = Annotated[
    ManagedStreamableHttpConnection | ManagedSseConnection | ManagedStdioConnection,
    Field(discriminator="transport"),
]


class RevisionMetadata(ManagementReadModel):
    """Identify the immutable revision currently selected by a managed head."""

    revision_id: UUID
    revision_number: PositiveInt
    created_at: datetime


class ManagedUpstream(ManagementReadModel):
    """Read one upstream head and current revision without resolving secret values."""

    server_id: UUID
    slug: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    display_name: str = Field(min_length=1)
    connection: ManagedUpstreamConnection
    enabled: bool
    metadata: dict[str, object] = Field(default_factory=dict)
    current_revision: RevisionMetadata


class ManagedEndpointBinding(ManagementReadModel):
    """Expose a current endpoint binding and the exact upstream revision it captures."""

    binding_id: UUID
    binding_revision_id: UUID
    upstream_server_id: UUID
    upstream_revision_id: UUID
    namespace: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9-]*$")
    priority: int = 0
    enabled: bool = True


class ManagedEndpoint(ManagementReadModel):
    """Read an enabled or disabled endpoint head, current revision, and bindings."""

    endpoint_id: UUID
    slug: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    display_name: str = Field(min_length=1)
    mode: EndpointMode
    bindings: tuple[ManagedEndpointBinding, ...]
    enabled: bool
    metadata: dict[str, object] = Field(default_factory=dict)
    current_revision: RevisionMetadata


class TopologySnapshot(ManagementReadModel):
    """Represent internally consistent upstream/endpoint heads from one management read."""

    upstreams: tuple[ManagedUpstream, ...]
    endpoints: tuple[ManagedEndpoint, ...]
