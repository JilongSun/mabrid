"""Project-owned MCP protocol models exposed by bridge core."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProtocolModel(BaseModel):
    """Immutable project-owned MCP value base, independent of SDK wire classes."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class UpstreamIdentity(ProtocolModel):
    """Initialization identity and supported method families reported by an upstream."""

    server_name: str
    server_version: str | None = None
    protocol_version: str | None = None
    instructions: str | None = None
    supports_tools: bool = False
    supports_resources: bool = False
    raw_capabilities: dict[str, Any] = Field(default_factory=dict)


class ToolDescriptor(ProtocolModel):
    """Preserve MCP tool schemas, annotations, metadata, and any MCP Apps resource URI."""

    name: str
    title: str | None = None
    description: str | None = None
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] | None = None
    annotations: dict[str, Any] = Field(default_factory=dict)
    ui_resource_uri: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolCallResult(ProtocolModel):
    """Preserve content blocks, structured output, error state, and MCP result metadata."""

    content: tuple[dict[str, Any], ...] = ()
    structured_content: dict[str, Any] | None = None
    is_error: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ResourceDescriptor(ProtocolModel):
    """Describe a listed MCP resource without dropping its optional protocol fields."""

    name: str
    uri: str
    title: str | None = None
    description: str | None = None
    mime_type: str | None = None
    annotations: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    size: int | None = None


class ResourceContent(ProtocolModel):
    """One resource content item containing exactly one of text or encoded binary data."""

    uri: str
    mime_type: str | None = None
    text: str | None = None
    blob: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_payload(self) -> ResourceContent:
        if (self.text is None) == (self.blob is None):
            raise ValueError("resource content requires exactly one of text or blob")
        return self


class ReadResourceResult(ProtocolModel):
    """Complete non-empty resource-read contents and result-level metadata."""

    contents: tuple[ResourceContent, ...] = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
