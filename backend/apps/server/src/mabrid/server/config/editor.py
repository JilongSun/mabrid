"""Typed, redacted runtime-file editing; publication remains owned by the apply pipeline."""

from __future__ import annotations

import os
import re
import stat
import tempfile
from collections.abc import Mapping
from hashlib import sha256
from io import StringIO
from pathlib import Path
from typing import Annotated, Literal, cast

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    model_validator,
)
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap
from ruamel.yaml.error import YAMLError

from .file import AgentHostFileConfig, EndpointFileConfig, RuntimeFileConfig
from .loader import (
    RUNTIME_CONFIG_FILE_NAME,
    ConfigError,
    RuntimeFileCandidate,
    resolve_runtime_document,
)
from .runtime import RuntimeConfiguration


class EditorModel(BaseModel):
    """Reject unknown management fields instead of silently discarding edits."""

    model_config = ConfigDict(extra="forbid")


class HeaderEdit(EditorModel):
    """Express a write-only value operation without round-tripping the old value."""

    action: Literal["preserve", "replace", "remove"]
    value: SecretStr | None = None

    @model_validator(mode="after")
    def validate_value(self) -> HeaderEdit:
        if (self.action == "replace") != (self.value is not None):
            raise ValueError("Only replace requires a value.")
        return self


class HttpUpstreamEdit(EditorModel):
    """Allow HTTP connection edits with explicit header operations."""

    transport: Literal["streamable-http", "sse"]
    enabled: bool = True
    url: AnyHttpUrl
    headers: dict[str, HeaderEdit] = Field(default_factory=dict)


class StdioUpstreamEdit(EditorModel):
    """Only permit enablement changes to an existing file-managed process."""

    transport: Literal["stdio"]
    enabled: bool


class RuntimeEditRequest(EditorModel):
    """Replace editable Gateway definitions against one inspected file version."""

    expected_hash: str | None = Field(pattern=r"^[a-f0-9]{64}$")
    upstreams: dict[
        str, Annotated[HttpUpstreamEdit | StdioUpstreamEdit, Field(discriminator="transport")]
    ]
    endpoints: dict[str, EndpointFileConfig]


class UpstreamEditView(EditorModel):
    """Expose HTTP fields and header names, never process arguments or sensitive values."""

    transport: Literal["streamable-http", "sse", "stdio"]
    enabled: bool
    url: str | None = None
    headers: list[str] = Field(default_factory=list)


class HostEditView(EditorModel):
    """Summarize the preserved, read-only Host configuration."""

    enabled: bool
    target_id: str | None
    endpoint_slug: str | None


class RuntimeEditView(EditorModel):
    """Return desired file definitions independently of the applied database heads."""

    content_hash: str | None
    upstreams: dict[str, UpstreamEditView]
    endpoints: dict[str, EndpointFileConfig]
    agent_host: HostEditView


class HostRuntimeEditRequest(EditorModel):
    """Edit only Host settings using credential reference names, never resolved values."""

    expected_hash: str | None = Field(pattern=r"^[a-f0-9]{64}$")
    agent_host: AgentHostFileConfig


class HostRuntimeEditView(EditorModel):
    """Expose the desired Host and current Gateway assignment choices separately."""

    content_hash: str | None
    agent_host: AgentHostFileConfig
    published_endpoints: tuple[str, ...] = ()


class ConfigurationEditError(RuntimeError):
    """Carry safe editing failures without file contents or sensitive request values."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class RuntimeFileEditor:
    """Preserve untouched YAML under the configuration manager's serialization lock."""

    def __init__(self, configuration: RuntimeConfiguration) -> None:
        self._configuration = configuration
        self._path = configuration.config_path.with_name(RUNTIME_CONFIG_FILE_NAME)

    def read(self) -> RuntimeEditView:
        document, content_hash = self._read()
        return self._view(document, content_hash)

    def read_host(self) -> HostRuntimeEditView:
        document, content_hash = self._read()
        return self._host_view(document, content_hash)

    def prepare_host(self, request: HostRuntimeEditRequest) -> tuple[bytes, RuntimeFileCandidate]:
        document, content_hash = self._read()
        if request.expected_hash != content_hash:
            raise ConfigurationEditError(
                "configuration_conflict", "The file changed. Reload before saving."
            )
        node = document.setdefault("agentHost", CommentedMap())
        self._merge_host(node, request.agent_host.model_dump(mode="json", by_alias=True))
        stream = StringIO()
        self._yaml().dump(document, stream)
        content = stream.getvalue().encode("utf-8")
        try:
            candidate = resolve_runtime_document(
                cast(dict[str, object], document),
                self._configuration.config_path,
                self._configuration.bridge,
                self._configuration.diagnostic_upstream,
                sha256(content).hexdigest(),
            )
        except ConfigError as exc:
            raise ConfigurationEditError("configuration_invalid", str(exc)) from exc
        return content, candidate

    @classmethod
    def _merge_host(cls, node: CommentedMap, values: dict[str, object]) -> None:
        for key, value in values.items():
            if isinstance(value, dict):
                child = node.get(key)
                if not isinstance(child, CommentedMap):
                    child = CommentedMap()
                    node[key] = child
                cls._merge_host(child, value)
            elif node.get(key) != value:
                node[key] = value

    def write_host(self, content: bytes, expected_hash: str | None) -> HostRuntimeEditView:
        self.write(content, expected_hash)
        return self._host_view(
            self._yaml().load(content.decode("utf-8")), sha256(content).hexdigest()
        )

    def prepare(self, request: RuntimeEditRequest) -> tuple[bytes, RuntimeFileCandidate]:
        """Merge edits without writing, then use the shared complete-candidate resolver."""
        document, content_hash = self._read()
        if request.expected_hash != content_hash:
            raise ConfigurationEditError(
                "configuration_conflict", "The file changed. Reload before saving."
            )
        current = self._validate(document)
        for name, upstream in current.upstreams.items():
            if upstream.transport == "stdio" and not isinstance(
                request.upstreams.get(name), StdioUpstreamEdit
            ):
                raise ConfigurationEditError(
                    "configuration_invalid",
                    "Stdio entries must be retained and can only change enablement.",
                )
        upstream_nodes = document.setdefault("upstreams", CommentedMap())
        for name in list(upstream_nodes):
            if name not in request.upstreams:
                del upstream_nodes[name]
        for name, edit in request.upstreams.items():
            self._validate_new_name(name, current.upstreams)
            previous = current.upstreams.get(name)
            if isinstance(edit, StdioUpstreamEdit):
                if previous is None or previous.transport != "stdio":
                    raise ConfigurationEditError(
                        "configuration_invalid", "New stdio entries must be configured on disk."
                    )
                upstream_nodes[name]["enabled"] = edit.enabled
                continue
            node = upstream_nodes.setdefault(name, CommentedMap())
            node["transport"] = edit.transport
            node["enabled"] = edit.enabled
            node["url"] = str(edit.url)
            headers = node.setdefault("headers", CommentedMap())
            for key, operation in edit.headers.items():
                if not key or "\r" in key or "\n" in key:
                    raise ConfigurationEditError(
                        "configuration_invalid",
                        "Header names must be nonempty and contain no newlines.",
                    )
                if operation.action == "preserve" and key not in headers:
                    raise ConfigurationEditError(
                        "configuration_invalid", "Cannot preserve a header that is not configured."
                    )
                if operation.action == "remove":
                    headers.pop(key, None)
                elif operation.action == "replace":
                    assert operation.value is not None
                    value = operation.value.get_secret_value()
                    if "\r" in value or "\n" in value:
                        raise ConfigurationEditError(
                            "configuration_invalid", "Header values cannot contain newlines."
                        )
                    headers[key] = value
        endpoint_nodes = document.setdefault("endpoints", CommentedMap())
        for name in list(endpoint_nodes):
            if name not in request.endpoints:
                del endpoint_nodes[name]
        for name, edit in request.endpoints.items():
            self._validate_new_name(name, current.endpoints)
            node = endpoint_nodes.setdefault(name, CommentedMap())
            values = edit.model_dump(mode="json", by_alias=True)
            for key, value in values.items():
                if node.get(key) != value:
                    node[key] = value
        stream = StringIO()
        self._yaml().dump(document, stream)
        content = stream.getvalue().encode("utf-8")
        try:
            candidate = resolve_runtime_document(
                cast(dict[str, object], document),
                self._configuration.config_path,
                self._configuration.bridge,
                self._configuration.diagnostic_upstream,
                sha256(content).hexdigest(),
            )
        except ConfigError as exc:
            raise ConfigurationEditError("configuration_invalid", str(exc)) from exc
        return content, candidate

    def write(self, content: bytes, expected_hash: str | None) -> RuntimeEditView:
        """Replace a validated document; a second hash check detects external intervening edits."""
        view = self._view(self._yaml().load(content.decode("utf-8")), sha256(content).hexdigest())
        temporary: Path | None = None
        try:
            descriptor, name = tempfile.mkstemp(prefix=".mabrid-runtime-", dir=self._path.parent)
            temporary = Path(name)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            if self._path.exists():
                os.chmod(temporary, stat.S_IMODE(self._path.stat().st_mode))
            _, current_hash = self._read()
            if current_hash != expected_hash:
                raise ConfigurationEditError(
                    "configuration_conflict", "The file changed. Reload before saving."
                )
            os.replace(temporary, self._path)
            return view
        except OSError as exc:
            raise ConfigurationEditError(
                "configuration_file_error",
                "Unable to save the runtime file. Check directory access and mounts.",
            ) from exc
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _read(self) -> tuple[CommentedMap, str | None]:
        try:
            if self._path.is_symlink():
                raise ConfigurationEditError(
                    "configuration_file_error", "Editing a symlinked runtime file is unsupported."
                )
            try:
                content = self._path.read_bytes()
            except FileNotFoundError:
                return CommentedMap(), None
            document = self._yaml().load(content.decode("utf-8"))
            if document is None:
                document = CommentedMap()
            if not isinstance(document, CommentedMap):
                raise ConfigurationEditError(
                    "configuration_invalid", "The runtime file must contain a mapping."
                )
            self._validate(document)
            return document, sha256(content).hexdigest()
        except (YAMLError, UnicodeError) as exc:
            raise ConfigurationEditError(
                "configuration_invalid",
                "Invalid runtime YAML. Repair the file on disk before editing.",
            ) from exc
        except OSError as exc:
            raise ConfigurationEditError(
                "configuration_file_error", "Unable to read the runtime file."
            ) from exc

    @staticmethod
    def _validate(document: CommentedMap) -> RuntimeFileConfig:
        try:
            return RuntimeFileConfig.model_validate(document)
        except ValidationError as exc:
            raise ConfigurationEditError(
                "configuration_invalid",
                "Invalid runtime fields. Repair the file on disk before editing.",
            ) from exc

    @staticmethod
    def _validate_new_name(name: str, current: Mapping[str, object]) -> None:
        if name not in current and re.fullmatch(r"[a-z][a-z0-9-]*", name) is None:
            raise ConfigurationEditError(
                "configuration_invalid",
                "New keys must start with a lowercase letter and contain only lowercase letters, digits, or hyphens.",
            )

    @staticmethod
    def _yaml() -> YAML:
        yaml = YAML()
        yaml.preserve_quotes = True
        return yaml

    def _host_view(self, document: CommentedMap, content_hash: str | None) -> HostRuntimeEditView:
        return HostRuntimeEditView(
            content_hash=content_hash,
            agent_host=self._validate(document).agent_host,
        )

    def _view(self, document: CommentedMap, content_hash: str | None) -> RuntimeEditView:
        config = self._validate(document)
        return RuntimeEditView(
            content_hash=content_hash,
            upstreams={
                name: UpstreamEditView(
                    transport=upstream.transport,
                    enabled=upstream.enabled,
                    url=upstream.url if upstream.transport != "stdio" else None,
                    headers=list(upstream.headers) if upstream.transport != "stdio" else [],
                )
                for name, upstream in config.upstreams.items()
            },
            endpoints=config.endpoints,
            agent_host=HostEditView(
                enabled=config.agent_host.enabled,
                target_id=config.agent_host.target_id,
                endpoint_slug=config.agent_host.endpoint_slug,
            ),
        )
