"""Process-ready configuration resolved from file values and the environment.

Runtime configuration may contain resolved secrets and absolute local paths. It belongs only to
the deployable server and never crosses into bridge or application package contracts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, PositiveFloat, SecretStr

from .file import BridgeRuntimeConfig, EndpointFileConfig, StorageConfig


class RuntimeHermesSessionConfig(BaseModel):
    """Resolved native API root and deployment identity passed to the Session adapter."""

    api_root: str = Field(min_length=1)
    binding_id: str = Field(min_length=1)


class RuntimeHermesAgentConfig(BaseModel):
    """Resolved Hermes connection settings with secret material protected by SecretStr."""

    integration: Literal["hermes"] = "hermes"
    interface: Literal["openai-chat-completions"] = "openai-chat-completions"
    base_url: str = "http://127.0.0.1:8642/v1"
    api_key: SecretStr | None = None
    timeout_seconds: PositiveFloat = 120.0
    sessions: RuntimeHermesSessionConfig | None = None


class RuntimeAgentHostConfig(BaseModel):
    """Resolved single-Target Host selection used by server composition."""

    enabled: bool = False
    mcp_apps_enabled: bool = False
    target_id: str | None = Field(default=None, min_length=1)
    endpoint_slug: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9-]*$")
    runtime: RuntimeHermesAgentConfig = Field(default_factory=RuntimeHermesAgentConfig)


class RuntimeUpstreamConfig(BaseModel):
    """Resolved transport settings after relative paths and environment references are applied."""

    transport: Literal["stdio", "sse", "streamable-http"] = "stdio"
    enabled: bool = True
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    cwd: Path | None = None
    env: dict[str, str] = Field(default_factory=dict)
    url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    httpx_timeout_seconds: float | None = None


@dataclass(frozen=True)
class RuntimeConfiguration:
    """Typed startup settings plus the runtime-file Gateway topology and Agent Host selection.

    `agent_host` and `agent_host_signature` describe the Host settings this process started
    with; changing them in the runtime file requires a restart.
    """

    config_path: Path
    bridge: BridgeRuntimeConfig
    storage: StorageConfig
    upstreams: dict[str, RuntimeUpstreamConfig]
    endpoints: dict[str, EndpointFileConfig]
    diagnostic_upstream: str | None
    agent_host: RuntimeAgentHostConfig = field(default_factory=RuntimeAgentHostConfig)
    agent_host_signature: str | None = None
    runtime_source: Literal["runtime_file", "unconfigured", "provided"] = "provided"
    runtime_hash: str | None = None
    runtime_error: str | None = None
    static_signature: str | None = None
    host_error: str | None = None
