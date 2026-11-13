"""Validated YAML contracts for a Mabrid server deployment.

These models preserve camelCase file syntax and reject unknown fields. Agent Host credentials use
environment-variable references; legacy upstream headers and environment values may be literal.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    PositiveFloat,
    SecretStr,
    field_validator,
    model_validator,
)

from .urls import normalize_advertised_base_url


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CamelModel(BaseModel):
    """Validate deployment-file models using the agreed camel-case configuration syntax."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class BridgeRuntimeConfig(CamelModel):
    """Configure listener, advertised origin, identity, diagnostics, and transport timeout."""

    api_host: str = "0.0.0.0"
    api_port: int = 8765
    advertised_base_url: str | None = None
    proxy_name: str | None = None
    diagnostic_upstream: str | None = None
    httpx_timeout_seconds: float | None = None

    @field_validator("advertised_base_url")
    @classmethod
    def validate_advertised_base_url(cls, value: str | None) -> str | None:
        return normalize_advertised_base_url(value) if value is not None else None


class StorageConfig(CamelModel):
    """Select the local SQLite path and startup migration policy."""

    sqlite_path: Path = Path("backend/var/mabrid.db")
    auto_migrate: bool = True


class HermesSessionFileConfig(CamelModel):
    """Declare native API root and stable deployment binding for remote Session references."""

    api_root: AnyHttpUrl
    binding_id: str = Field(min_length=1)


class HermesAgentRuntimeFileConfig(CamelModel):
    """Select exactly one Host credential source without exposing its resolved value."""

    integration: Literal["hermes"] = "hermes"
    interface: Literal["openai-chat-completions"] = "openai-chat-completions"
    base_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:8642/v1")
    api_key_env: str | None = Field(default="API_SERVER_KEY", min_length=1)
    api_key: SecretStr | None = None
    timeout_seconds: PositiveFloat = 120.0
    sessions: HermesSessionFileConfig | None = None

    @model_validator(mode="before")
    @classmethod
    def select_literal_source(cls, value: object) -> object:
        if isinstance(value, dict) and any(key in value for key in ("apiKey", "api_key")):
            if not any(key in value for key in ("apiKeyEnv", "api_key_env")):
                return {**value, "apiKeyEnv": None}
        return value

    @model_validator(mode="after")
    def validate_credential(self) -> HermesAgentRuntimeFileConfig:
        if self.api_key is not None:
            if self.api_key_env is not None:
                raise ValueError("Host credentials require either apiKey or apiKeyEnv, not both")
            value = self.api_key.get_secret_value()
            if not value.strip() or "\r" in value or "\n" in value:
                raise ValueError("Host API key must be nonempty and contain no newlines")
        return self


class HostIdentityConfig(CamelModel):
    """Share Host identity and enablement invariants across file and management settings."""

    enabled: bool = False
    mcp_apps_enabled: bool = False
    target_id: str | None = Field(default=None, min_length=1)
    endpoint_slug: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9-]*$")

    @model_validator(mode="after")
    def validate_enabled_target(self) -> HostIdentityConfig:
        if self.mcp_apps_enabled and not self.enabled:
            raise ValueError("'mcpAppsEnabled' requires enabled Agent Host")
        if self.enabled and self.target_id is None:
            raise ValueError("enabled Agent Host requires 'targetId'")
        if self.enabled and self.endpoint_slug is None:
            raise ValueError("enabled Agent Host requires 'endpointSlug'")
        return self


class AgentHostFileConfig(HostIdentityConfig):
    """Add credential-bearing Hermes settings to the file-owned Host identity."""

    runtime: HermesAgentRuntimeFileConfig = Field(default_factory=HermesAgentRuntimeFileConfig)


class UpstreamFileConfig(CamelModel):
    """Validate file-backed upstream settings before resolving their transport."""

    transport: Literal["stdio", "sse", "streamable-http"]
    enabled: bool = True
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    cwd: Path | None = None
    env: dict[str, str] = Field(default_factory=dict)
    url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_transport_requirements(self) -> UpstreamFileConfig:
        if self.transport == "stdio" and not self.command:
            raise ValueError("stdio upstreams require 'command'")
        if self.transport in {"sse", "streamable-http"} and not self.url:
            raise ValueError(f"{self.transport} upstreams require 'url'")
        return self


class EndpointBindingFileConfig(CamelModel):
    """Declare a runtime binding by upstream name, namespace, order, and enablement."""

    upstream: str
    namespace: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9-]*$")
    priority: int = 0
    enabled: bool = True


class EndpointFileConfig(CamelModel):
    """Validate one runtime endpoint and its explicit upstream bindings."""

    display_name: str | None = None
    mode: Literal["passthrough", "aggregate"] = "passthrough"
    bindings: list[EndpointBindingFileConfig]
    enabled: bool = True


class ProcessFileConfig(CamelModel):
    """Validate restart-applied process settings from the static configuration file."""

    bridge: BridgeRuntimeConfig = Field(default_factory=BridgeRuntimeConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    runtime_config_file: Path | None = None


class RuntimeFileConfig(CamelModel):
    """Validate the runtime file's Gateway topology and Agent Host settings as one candidate.

    Cross-file rules, such as the Host's need for an advertised base URL, are checked by the loader.
    """

    upstreams: dict[str, UpstreamFileConfig] = Field(default_factory=dict)
    endpoints: dict[str, EndpointFileConfig] = Field(default_factory=dict)
    agent_host: AgentHostFileConfig = Field(default_factory=AgentHostFileConfig)

    @model_validator(mode="after")
    def validate_upstream_references(self) -> RuntimeFileConfig:
        for endpoint_name, endpoint in self.endpoints.items():
            for binding in endpoint.bindings:
                if binding.upstream not in self.upstreams:
                    raise ValueError(
                        f"endpoint '{endpoint_name}' references unknown upstream "
                        f"'{binding.upstream}'"
                    )
        return self
