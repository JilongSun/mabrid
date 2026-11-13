"""YAML configuration loading for the bridge runtime."""

from __future__ import annotations

import hmac
import secrets
import os
import json
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
    RuntimeFileConfig,
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
class RuntimeFileCandidate:
    """Hold one resolved runtime-file candidate for validation and application.

    The file hash guards external edits. Component signatures identify effective settings,
    independently of comments and changes to another section.
    """

    upstreams: dict[str, RuntimeUpstreamConfig]
    endpoints: dict[str, EndpointFileConfig]
    agent_host: RuntimeAgentHostConfig
    agent_host_signature: str | None
    source: Literal["runtime_file", "unconfigured", "provided"]
    content_hash: str | None

    @property
    def gateway_signature(self) -> str:
        value = {
            "upstreams": {
                name: upstream.model_dump(mode="json") for name, upstream in self.upstreams.items()
            },
            "endpoints": {
                name: endpoint.model_dump(mode="json") for name, endpoint in self.endpoints.items()
            },
        }
        return sha256(json.dumps(value, sort_keys=True).encode("utf-8")).hexdigest()


DEFAULT_PROXY_NAME = "mabrid-gateway"


def resolve_runtime_configuration(config_path: str | None) -> RuntimeConfiguration:
    """Resolve deployment settings from the configuration file and its adjacent dotenv file.

    Listener settings, proxy identity, diagnostic upstream selection, and transport timeout
    are static-file values only. Gateway topology and Agent Host settings come only from the
    selected runtime file; an invalid runtime file starts with no Host and an explicit error.
    """
    path = _resolve_config_path(config_path)
    raw, static_hash = _read_document(path)
    process = _validate_process(raw, static_hash)
    runtime_path = process.runtime_config_file or Path(RUNTIME_CONFIG_FILE_NAME)
    if not runtime_path.is_absolute():
        runtime_path = (path.parent / runtime_path).resolve()
    load_dotenv(path.with_name(".env"), override=False)
    bridge = process.bridge.model_copy(
        update={"proxy_name": process.bridge.proxy_name or DEFAULT_PROXY_NAME}
    )
    runtime_error: str | None = None
    host_error: str | None = None
    try:
        candidate = _load_runtime_file(
            path, bridge, process.bridge.diagnostic_upstream, runtime_path=runtime_path
        )
    except ConfigError as exc:
        if exc.source != "runtime_file":
            raise
        try:
            candidate = _load_runtime_file(
                path,
                bridge,
                process.bridge.diagnostic_upstream,
                runtime_path=runtime_path,
                component="gateway",
            )
            host_error = str(exc)
        except ConfigError as gateway_error:
            host_candidate: RuntimeFileCandidate | None = None
            try:
                host_candidate = _load_runtime_file(
                    path,
                    bridge,
                    process.bridge.diagnostic_upstream,
                    runtime_path=runtime_path,
                    component="host",
                )
            except ConfigError as host_failure:
                host_error = str(host_failure)
            candidate = RuntimeFileCandidate(
                upstreams={},
                endpoints={},
                agent_host=host_candidate.agent_host
                if host_candidate
                else RuntimeAgentHostConfig(),
                agent_host_signature=host_candidate.agent_host_signature
                if host_candidate
                else _agent_host_signature(AgentHostFileConfig()),
                source="runtime_file",
                content_hash=exc.content_hash,
            )
            runtime_error = str(gateway_error)
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
        agent_host=candidate.agent_host,
        agent_host_signature=candidate.agent_host_signature,
        runtime_source=candidate.source,
        runtime_hash=candidate.content_hash,
        runtime_error=runtime_error,
        static_signature=_process_signature(process),
        host_error=host_error,
        runtime_config_file=runtime_path,
    )


def load_runtime_candidate(
    configuration: RuntimeConfiguration,
    *,
    component: Literal["all", "gateway", "host"] = "all",
) -> RuntimeFileCandidate:
    """Read the selected runtime file without applying changed process settings."""
    raw, static_hash = _read_document(configuration.config_path)
    _validate_process(raw, static_hash)
    return _load_runtime_file(
        configuration.config_path,
        configuration.bridge,
        configuration.diagnostic_upstream,
        runtime_path=configuration.runtime_path,
        component=component,
    )


def read_process_signature(path: Path) -> str:
    """Compare process settings without exposing their values to management clients."""
    raw, content_hash = _read_document(path)
    return _process_signature(_validate_process(raw, content_hash))


def _process_signature(process: ProcessFileConfig) -> str:
    return sha256(process.model_dump_json(by_alias=True).encode("utf-8")).hexdigest()


_HOST_FINGERPRINT_KEY = secrets.token_bytes(32)


def _agent_host_signature(config: AgentHostFileConfig) -> str:
    settings = config.model_dump(mode="json", by_alias=True, exclude={"runtime": {"api_key"}})
    runtime = config.runtime
    credential = (
        runtime.api_key.get_secret_value()
        if runtime.api_key is not None
        else os.environ.get(runtime.api_key_env, "")
        if runtime.api_key_env is not None
        else ""
    )
    payload = (
        json.dumps(settings, sort_keys=True).encode("utf-8") + b"\0" + credential.encode("utf-8")
    )
    return hmac.digest(_HOST_FINGERPRINT_KEY, payload, "sha256").hex()


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


def _load_runtime_file(
    config_path: Path,
    bridge: BridgeRuntimeConfig,
    diagnostic_upstream: str | None,
    *,
    runtime_path: Path | None = None,
    component: Literal["all", "gateway", "host"] = "all",
) -> RuntimeFileCandidate:
    runtime_path = runtime_path or config_path.with_name(RUNTIME_CONFIG_FILE_NAME)
    if runtime_path.exists():
        try:
            runtime_raw, content_hash = _read_document(runtime_path)
        except ConfigError as exc:
            raise ConfigError(
                str(exc), content_hash=exc.content_hash, source="runtime_file"
            ) from exc
        source: Literal["runtime_file", "unconfigured"] = "runtime_file"
    else:
        runtime_raw = {}
        content_hash = None
        source = "unconfigured"
    return resolve_runtime_document(
        runtime_raw,
        config_path,
        bridge,
        diagnostic_upstream,
        content_hash,
        source,
        component=component,
    )


def resolve_runtime_document(
    runtime_raw: dict[str, object],
    config_path: Path,
    bridge: BridgeRuntimeConfig,
    diagnostic_upstream: str | None,
    content_hash: str | None,
    source: Literal["runtime_file", "unconfigured"] = "runtime_file",
    *,
    component: Literal["all", "gateway", "host"] = "all",
) -> RuntimeFileCandidate:
    """Resolve a complete candidate identically for file loading and validated editing."""
    try:
        selected = dict(runtime_raw)
        if component == "gateway":
            selected.pop("agentHost", None)
        elif component == "host":
            selected.pop("upstreams", None)
            selected.pop("endpoints", None)
        config = RuntimeFileConfig.model_validate(selected)
    except ValidationError as exc:
        raise ConfigError(
            f"Invalid runtime configuration: {_validation_summary(exc)}",
            content_hash=content_hash,
            source=source,
        ) from exc
    if (
        component != "host"
        and diagnostic_upstream is not None
        and diagnostic_upstream not in config.upstreams
    ):
        raise ConfigError(
            f"'bridge.diagnosticUpstream' references unknown upstream '{diagnostic_upstream}'",
            content_hash=content_hash,
            source=source,
        )
    if config.agent_host.enabled and bridge.advertised_base_url is None:
        raise ConfigError(
            "enabled Agent Host requires 'bridge.advertisedBaseUrl'",
            content_hash=content_hash,
            source=source,
        )
    try:
        agent_host = _resolve_agent_host_config(config.agent_host)
    except ConfigError as exc:
        raise ConfigError(str(exc), content_hash=content_hash, source=source) from exc
    return RuntimeFileCandidate(
        upstreams={
            name: _to_runtime_upstream_config(upstream, config_path.parent, bridge)
            for name, upstream in config.upstreams.items()
        },
        endpoints=config.endpoints,
        agent_host=agent_host,
        agent_host_signature=_agent_host_signature(config.agent_host),
        source=source,
        content_hash=content_hash,
    )


def _validation_summary(error: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(part) for part in item['loc']) or 'configuration'}: {item['msg']}"
        for item in error.errors(include_input=False, include_context=False, include_url=False)
    )


def _resolve_agent_host_config(config: AgentHostFileConfig) -> RuntimeAgentHostConfig:
    runtime = config.runtime
    api_key = (
        runtime.api_key.get_secret_value()
        if runtime.api_key is not None
        else os.environ.get(runtime.api_key_env)
        if runtime.api_key_env is not None
        else None
    )
    if config.enabled and not api_key:
        if runtime.api_key_env is not None:
            raise ConfigError(
                f"Agent Host is enabled but environment variable '{runtime.api_key_env}' is not set"
            )
        raise ConfigError("Enabled Agent Host requires a configured credential")
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
