"""YAML configuration loading for the bridge runtime."""

from __future__ import annotations

import os
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Literal

import yaml
from dotenv import load_dotenv
from pydantic import SecretStr, ValidationError

from .file import (
    AgentHostFileConfig,
    BridgeRuntimeConfig,
    EndpointFileConfig,
    ProcessFileConfig,
    TopologyFileConfig,
    UpstreamFileConfig,
)
from .runtime import (
    RuntimeAgentHostConfig,
    RuntimeConfiguration,
    RuntimeHermesAgentConfig,
    RuntimeHermesSessionConfig,
    RuntimeUpstreamConfig,
)

CONFIG_FILE_NAME = "mabrid.yaml"
RUNTIME_CONFIG_FILE_NAME = "mabrid.runtime.yaml"


class ConfigError(RuntimeError):
    """Raised when the bridge configuration is missing or invalid."""

    def __init__(
        self,
        message: str,
        *,
        content_hash: str | None = None,
        source: Literal["runtime_file", "unconfigured"] | None = None,
    ) -> None:
        super().__init__(message)
        self.content_hash = content_hash
        self.source = source


@dataclass(frozen=True)
class LoadedTopology:
    """Keep the selected topology file and its content identity together."""

    config: TopologyFileConfig
    source: Literal["runtime_file", "unconfigured"]
    content_hash: str | None


@dataclass(frozen=True)
class RuntimeTopologyCandidate:
    """Hold one resolved file candidate for validation and application."""

    upstreams: dict[str, RuntimeUpstreamConfig]
    endpoints: dict[str, EndpointFileConfig]
    source: Literal["runtime_file", "unconfigured", "provided"]
    content_hash: str | None


DEFAULT_PROXY_NAME = "mabrid-gateway"


def resolve_runtime_configuration(config_path: str | None) -> RuntimeConfiguration:
    """Resolve deployment settings from the configuration file and its adjacent dotenv file.

    Listener settings, proxy identity, diagnostic upstream selection, and transport timeout
    are static-file values only. Gateway topology comes only from the adjacent runtime file.
    """
    path = _resolve_config_path(config_path)
    raw, static_hash = _read_document(path)
    process = _validate_process(raw, static_hash)
    load_dotenv(path.with_name(".env"), override=False)
    bridge = process.bridge.model_copy(
        update={"proxy_name": process.bridge.proxy_name or DEFAULT_PROXY_NAME}
    )
    topology_error: str | None = None
    try:
        topology = _load_topology(path, bridge.diagnostic_upstream)
    except ConfigError as exc:
        if exc.source != "runtime_file":
            raise
        topology = LoadedTopology(
            config=TopologyFileConfig(),
            source="runtime_file",
            content_hash=exc.content_hash,
        )
        topology_error = str(exc)
    candidate = _resolve_topology(topology, path.parent, bridge)
    sqlite_path = process.storage.sqlite_path
    if not sqlite_path.is_absolute():
        sqlite_path = (path.parent / sqlite_path).resolve()
    return RuntimeConfiguration(
        config_path=path,
        bridge=bridge,
        storage=process.storage.model_copy(update={"sqlite_path": sqlite_path}),
        upstreams=candidate.upstreams,
        endpoints=candidate.endpoints,
        diagnostic_upstream=process.bridge.diagnostic_upstream,
        agent_host=_resolve_agent_host_config(process.agent_host),
        topology_source=topology.source,
        topology_hash=topology.content_hash,
        topology_error=topology_error,
        static_signature=_process_signature(process),
    )


def load_runtime_topology(configuration: RuntimeConfiguration) -> RuntimeTopologyCandidate:
    """Read the selected topology without applying changed process or Host settings."""
    raw, static_hash = _read_document(configuration.config_path)
    _validate_process(raw, static_hash)
    topology = _load_topology(configuration.config_path, configuration.diagnostic_upstream)
    return _resolve_topology(topology, configuration.config_path.parent, configuration.bridge)


def read_process_signature(path: Path) -> str:
    """Compare process settings without exposing their values to management clients."""
    raw, content_hash = _read_document(path)
    return _process_signature(_validate_process(raw, content_hash))


def _process_signature(process: ProcessFileConfig) -> str:
    return sha256(process.model_dump_json(by_alias=True).encode("utf-8")).hexdigest()


def _read_document(path: Path) -> tuple[dict[str, object], str]:
    try:
        content = path.read_bytes()
    except OSError as exc:
        raise ConfigError(f"Unable to read configuration file '{path.name}'.") from exc
    content_hash = sha256(content).hexdigest()
    try:
        raw = yaml.safe_load(content)
    except (UnicodeDecodeError, yaml.YAMLError) as exc:
        raise ConfigError(f"Invalid YAML in '{path.name}'.", content_hash=content_hash) from exc
    if raw is None:
        return {}, content_hash
    if not isinstance(raw, dict) or any(not isinstance(key, str) for key in raw):
        raise ConfigError(
            f"Configuration file '{path.name}' must contain a mapping.",
            content_hash=content_hash,
        )
    return raw, content_hash


def _validate_process(raw: dict[str, object], content_hash: str) -> ProcessFileConfig:
    try:
        return ProcessFileConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(
            f"Invalid process configuration: {_validation_summary(exc)}",
            content_hash=content_hash,
        ) from exc


def _load_topology(config_path: Path, diagnostic_upstream: str | None) -> LoadedTopology:
    runtime_path = config_path.with_name(RUNTIME_CONFIG_FILE_NAME)
    if runtime_path.exists():
        try:
            topology_raw, content_hash = _read_document(runtime_path)
        except ConfigError as exc:
            raise ConfigError(
                str(exc), content_hash=exc.content_hash, source="runtime_file"
            ) from exc
        source: Literal["runtime_file", "unconfigured"] = "runtime_file"
    else:
        topology_raw = {}
        content_hash = None
        source = "unconfigured"
    try:
        config = TopologyFileConfig.model_validate(topology_raw)
    except ValidationError as exc:
        raise ConfigError(
            f"Invalid topology configuration: {_validation_summary(exc)}",
            content_hash=content_hash,
            source=source,
        ) from exc
    if diagnostic_upstream is not None and diagnostic_upstream not in config.upstreams:
        raise ConfigError(
            f"'bridge.diagnosticUpstream' references unknown upstream '{diagnostic_upstream}'",
            content_hash=content_hash,
            source=source,
        )
    return LoadedTopology(config=config, source=source, content_hash=content_hash)


def _validation_summary(error: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(part) for part in item['loc']) or 'configuration'}: {item['msg']}"
        for item in error.errors(include_input=False, include_context=False, include_url=False)
    )


def _resolve_topology(
    topology: LoadedTopology, config_dir: Path, bridge: BridgeRuntimeConfig
) -> RuntimeTopologyCandidate:
    return RuntimeTopologyCandidate(
        upstreams={
            name: _to_runtime_upstream_config(upstream, config_dir, bridge)
            for name, upstream in topology.config.upstreams.items()
        },
        endpoints=topology.config.endpoints,
        source=topology.source,
        content_hash=topology.content_hash,
    )


def _resolve_agent_host_config(config: AgentHostFileConfig) -> RuntimeAgentHostConfig:
    runtime = config.runtime
    api_key = os.environ.get(runtime.api_key_env)
    if config.enabled and not api_key:
        raise ConfigError(
            f"Agent Host is enabled but environment variable '{runtime.api_key_env}' is not set"
        )
    return RuntimeAgentHostConfig(
        enabled=config.enabled,
        mcp_apps_enabled=config.mcp_apps_enabled,
        target_id=config.target_id,
        endpoint_slug=config.endpoint_slug,
        runtime=RuntimeHermesAgentConfig(
            integration=runtime.integration,
            interface=runtime.interface,
            base_url=str(runtime.base_url),
            api_key=SecretStr(api_key) if api_key is not None else None,
            timeout_seconds=runtime.timeout_seconds,
            sessions=(
                RuntimeHermesSessionConfig(
                    api_root=str(runtime.sessions.api_root), binding_id=runtime.sessions.binding_id
                )
                if runtime.sessions is not None
                else None
            ),
        ),
    )


def _resolve_config_path(path: str | None) -> Path:
    if path is not None:
        resolved = Path(path).expanduser().resolve()
        if not resolved.is_file():
            raise ConfigError(f"Config file not found: {resolved}")
        return resolved

    candidates = [Path.cwd() / CONFIG_FILE_NAME, _project_root() / CONFIG_FILE_NAME]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()

    expected = candidates[-1]
    raise ConfigError(
        f"No bridge config file found. Create '{CONFIG_FILE_NAME}' in the repo root or pass --config. Expected default path: {expected}"
    )


def _project_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / CONFIG_FILE_NAME).is_file():
            return parent
    return Path.cwd()


def _to_runtime_upstream_config(
    upstream: UpstreamFileConfig,
    config_dir: Path,
    bridge: BridgeRuntimeConfig,
) -> RuntimeUpstreamConfig:
    cwd = upstream.cwd
    if cwd is not None and not cwd.is_absolute():
        cwd = (config_dir / cwd).resolve()

    return RuntimeUpstreamConfig(
        transport=upstream.transport,
        enabled=upstream.enabled,
        command=upstream.command,
        args=upstream.args,
        cwd=cwd,
        env=upstream.env,
        url=upstream.url,
        headers=upstream.headers,
        httpx_timeout_seconds=bridge.httpx_timeout_seconds,
    )
