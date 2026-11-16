from __future__ import annotations

import os
from pathlib import Path

import pytest

from mabrid.server import main as server_main
from mabrid.server.config import (
    CONFIG_FILE_NAME,
    ConfigError,
    StorageConfig,
    build_advertised_mcp_url,
    resolve_runtime_configuration,
)


TOPOLOGY = """
upstreams:
  fixture:
    transport: stdio
    command: fixture-server
endpoints:
  fixture:
    bindings: [{upstream: fixture}]
"""
STATIC = "bridge: {advertisedBaseUrl: http://mabrid.test:8765}\n"
HOST = """
agentHost:
  enabled: true
  mcpAppsEnabled: true
  targetId: fixture-target
  endpointSlug: fixture
  runtime:
    integration: hermes
    interface: openai-chat-completions
    baseUrl: http://hermes.test:8642/v1
    apiKey: fixture-secret
    sessions:
      apiRoot: http://hermes.test:8642/prefix
      bindingId: fixture-deployment
"""


def _write_config(path: Path, process: str = STATIC, topology: str = TOPOLOGY + HOST) -> None:
    path.write_text(process, encoding="utf-8")
    path.with_name("mabrid.runtime.yaml").write_text(topology, encoding="utf-8")


def test_mabrid_owns_default_deployment_identifiers() -> None:
    assert CONFIG_FILE_NAME == "mabrid.yaml"
    assert StorageConfig().sqlite_path == Path("backend/var/mabrid.db")


@pytest.mark.parametrize("runtime_present", [False, True])
@pytest.mark.parametrize("key", ["upstreams", "endpoints", "agentHost"])
def test_static_file_rejects_runtime_keys(tmp_path: Path, runtime_present: bool, key: str) -> None:
    config_path = tmp_path / "mabrid.yaml"
    config_path.write_text(f"{key}: {{}}\n", encoding="utf-8")
    if runtime_present:
        (tmp_path / "mabrid.runtime.yaml").write_text("{}\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="Invalid process configuration"):
        resolve_runtime_configuration(str(config_path))


@pytest.mark.parametrize("key", ["bridge", "storage"])
def test_runtime_file_rejects_process_settings(tmp_path: Path, key: str) -> None:
    config_path = tmp_path / "mabrid.yaml"
    _write_config(config_path, "{}", f"{key}: {{}}\n")
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_error is not None
    assert key in configuration.runtime_error
    assert configuration.runtime_source == "runtime_file"
    assert not configuration.upstreams and not configuration.endpoints


@pytest.mark.parametrize("absolute", [False, True])
def test_runtime_file_placement_preserves_static_path_bases(tmp_path: Path, absolute: bool) -> None:
    from mabrid.server.config import load_runtime_candidate
    from mabrid.server.config.editor import RuntimeFileEditor

    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "runtime" / "selected.yaml"
    runtime_path.parent.mkdir()
    selected = runtime_path.as_posix() if absolute else "runtime/selected.yaml"
    config_path.write_text(f"runtimeConfigFile: {selected}\n", encoding="utf-8")
    runtime_path.write_text(
        TOPOLOGY.replace("command: fixture-server", "command: fixture-server\n    cwd: ."),
        encoding="utf-8",
    )
    config_path.with_name("mabrid.runtime.yaml").write_text("invalid: [yaml", encoding="utf-8")

    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_path == runtime_path
    assert configuration.storage.sqlite_path == tmp_path / "backend/var/mabrid.db"
    assert configuration.upstreams["fixture"].cwd == tmp_path
    assert configuration.runtime_error is None
    assert RuntimeFileEditor(configuration).read().content_hash == configuration.runtime_hash
    config_path.write_text("runtimeConfigFile: missing.yaml\n", encoding="utf-8")
    assert load_runtime_candidate(configuration).content_hash == configuration.runtime_hash


def test_enabled_agent_host_uses_file_key_without_environment_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path)
    monkeypatch.setenv("API_SERVER_KEY", "environment-fixture-secret")

    configuration = resolve_runtime_configuration(str(config_path))

    assert configuration.agent_host.enabled is True
    assert configuration.agent_host.mcp_apps_enabled is True
    assert configuration.agent_host.target_id == "fixture-target"
    assert configuration.agent_host.endpoint_slug == "fixture"
    assert configuration.agent_host.runtime.integration == "hermes"
    assert configuration.agent_host.runtime.interface == "openai-chat-completions"
    assert configuration.agent_host.runtime.base_url == "http://hermes.test:8642/v1"
    assert configuration.agent_host.runtime.sessions is not None
    assert configuration.agent_host.runtime.sessions.api_root == "http://hermes.test:8642/prefix"
    assert configuration.agent_host.runtime.sessions.binding_id == "fixture-deployment"
    assert configuration.agent_host.runtime.api_key is not None
    assert configuration.agent_host.runtime.api_key.get_secret_value() == "fixture-secret"
    assert configuration.bridge.advertised_base_url == "http://mabrid.test:8765"
    assert configuration.runtime_source == "runtime_file"
    assert configuration.runtime_error is None
    assert set(configuration.endpoints) == {"fixture"}


@pytest.mark.parametrize(
    "credential",
    [
        "apiKey: literal-fixture-secret",
        "apiKey: ''",
        "apiKey: literal-fixture-secret\n    apiKeyEnv: FIXTURE_HERMES_KEY",
        "apiKeyEnv: FIXTURE_HERMES_KEY",
    ],
)
def test_file_host_credential_rejects_empty_or_obsolete_fields_safely(
    tmp_path: Path, credential: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FIXTURE_HERMES_KEY", "environment-fixture-secret")
    config_path = tmp_path / "mabrid.yaml"
    _write_config(
        config_path, topology=TOPOLOGY + HOST.replace("apiKey: fixture-secret", credential)
    )
    configuration = resolve_runtime_configuration(str(config_path))
    if credential == "apiKey: literal-fixture-secret":
        assert configuration.host_error is None
        assert configuration.agent_host.runtime.api_key is not None
        assert (
            configuration.agent_host.runtime.api_key.get_secret_value() == "literal-fixture-secret"
        )
    else:
        assert configuration.host_error is not None
        assert "literal-fixture-secret" not in configuration.host_error
        assert "environment-fixture-secret" not in configuration.host_error


def test_agent_host_can_disable_mcp_apps_workflow(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(
        config_path,
        topology=TOPOLOGY + HOST.replace("mcpAppsEnabled: true", "mcpAppsEnabled: false"),
    )
    monkeypatch.setenv("FIXTURE_HERMES_KEY", "fixture-secret")
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.agent_host.enabled is True
    assert configuration.agent_host.mcp_apps_enabled is False


def test_mcp_apps_workflow_requires_enabled_agent_host(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path, topology=TOPOLOGY + "agentHost: {mcpAppsEnabled: true}")
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_error is None and configuration.host_error is not None
    assert "requires enabled Agent Host" in configuration.host_error
    assert not configuration.agent_host.enabled and configuration.upstreams


def test_enabled_agent_host_requires_configured_file_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path, topology=TOPOLOGY + HOST.replace("    apiKey: fixture-secret\n", ""))
    monkeypatch.setenv("API_SERVER_KEY", "environment-fixture-secret")
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_error is None and configuration.host_error is not None
    assert "requires a configured credential" in configuration.host_error
    assert "environment-fixture-secret" not in configuration.host_error
    assert configuration.runtime_hash is not None
    assert not configuration.agent_host.enabled and configuration.endpoints


@pytest.mark.parametrize(
    ("environment_key", "dotenv_key", "expected"),
    [
        ("fixture-secret", None, "fixture-secret"),
        (None, "dotenv-secret", "dotenv-secret"),
        ("process-secret", "dotenv-secret", "process-secret"),
    ],
)
def test_dotenv_preserves_environment_precedence_without_supplying_host_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    environment_key: str | None,
    dotenv_key: str | None,
    expected: str,
) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(
        config_path,
        topology=TOPOLOGY
        + "agentHost: {enabled: true, targetId: fixture-target, endpointSlug: fixture}\n",
    )
    if dotenv_key is not None:
        (tmp_path / ".env").write_text(f"API_SERVER_KEY={dotenv_key}\n", encoding="utf-8")
    if environment_key is None:
        monkeypatch.delenv("API_SERVER_KEY", raising=False)
    else:
        monkeypatch.setenv("API_SERVER_KEY", environment_key)
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.host_error is not None
    assert "requires a configured credential" in configuration.host_error
    assert not configuration.agent_host.enabled
    assert configuration.agent_host.runtime.api_key is None
    assert os.environ.get("API_SERVER_KEY") == expected
    assert configuration.agent_host.mcp_apps_enabled is False


def test_agent_host_rejects_an_unknown_runtime_integration(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(
        config_path, topology=TOPOLOGY + HOST.replace("integration: hermes", "integration: unknown")
    )
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_error is None and configuration.host_error is not None
    assert "integration" in configuration.host_error
    assert not configuration.agent_host.enabled


@pytest.mark.parametrize("runtime", [None, "", "{}", "upstreams: {}\nendpoints: {}"])
def test_missing_or_empty_runtime_configures_no_topology(
    tmp_path: Path, runtime: str | None
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    config_path.write_text("{}", encoding="utf-8")
    if runtime is not None:
        config_path.with_name("mabrid.runtime.yaml").write_text(runtime, encoding="utf-8")
    configuration = resolve_runtime_configuration(str(config_path))
    assert not configuration.upstreams and not configuration.endpoints
    assert configuration.runtime_error is None
    assert configuration.runtime_source == ("unconfigured" if runtime is None else "runtime_file")
    assert (configuration.runtime_hash is None) == (runtime is None)


def test_configuration_allows_upstreams_without_endpoints(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(
        config_path, "{}", "upstreams: {fixture: {transport: stdio, command: fixture-server}}"
    )
    configuration = resolve_runtime_configuration(str(config_path))
    assert list(configuration.upstreams) == ["fixture"]
    assert configuration.endpoints == {}


@pytest.mark.parametrize(
    "invalid",
    [
        "upstreams: [fixture-secret\n",
        "upstreams: {fixture: {transport: fixture-secret}}",
        "endpoints: {fixture: {bindings: [{upstream: missing}]}}",
    ],
)
def test_invalid_runtime_topology_is_reported_without_exposing_file_contents(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, invalid: str
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    _write_config(config_path, topology=invalid)
    monkeypatch.setenv("FIXTURE_HERMES_KEY", "fixture-secret")
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_source == "runtime_file"
    assert configuration.runtime_hash is not None
    assert configuration.runtime_error is not None
    assert "fixture-secret" not in configuration.runtime_error
    assert configuration.upstreams == {}
    assert not configuration.agent_host.enabled
    _write_config(config_path, topology=TOPOLOGY)
    assert (
        configuration.agent_host_signature
        == resolve_runtime_configuration(str(config_path)).agent_host_signature
    )


def test_enabled_agent_host_requires_advertised_base_url(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path, "{}")
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_error is None and configuration.host_error is not None
    assert "advertisedBaseUrl" in configuration.host_error
    assert not configuration.agent_host.enabled


def test_disabled_agent_host_allows_missing_advertised_base_url(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path, "{}", "agentHost: {enabled: false}")
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_error is None
    assert configuration.bridge.advertised_base_url is None


def test_agent_host_signature_tracks_the_whole_host_section(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "fixture.yaml"
    monkeypatch.setenv("FIXTURE_HERMES_KEY", "fixture-secret")
    _write_config(config_path, "{}", TOPOLOGY)
    absent = resolve_runtime_configuration(str(config_path)).agent_host_signature
    _write_config(config_path, "{}", "agentHost: {enabled: false}")
    assert resolve_runtime_configuration(str(config_path)).agent_host_signature == absent
    _write_config(config_path, "{}", "agentHost: {enabled: false, targetId: one}")
    disabled = resolve_runtime_configuration(str(config_path)).agent_host_signature
    assert disabled != absent
    _write_config(config_path)
    enabled = resolve_runtime_configuration(str(config_path)).agent_host_signature
    _write_config(config_path, topology=TOPOLOGY.replace("fixture-server", "other") + HOST)
    assert resolve_runtime_configuration(str(config_path)).agent_host_signature == enabled
    _write_config(config_path, topology=TOPOLOGY + HOST + "    timeoutSeconds: 30\n")
    changed = resolve_runtime_configuration(str(config_path)).agent_host_signature
    assert changed != enabled


@pytest.mark.parametrize(
    "advertised_base_url",
    [
        "ftp://mabrid.test",
        "http://mabrid.test/prefix",
        "http://mabrid.test?tenant=one",
        "http://mabrid.test#internal",
        "******mabrid.test",
        "http:///missing-host",
    ],
)
def test_configuration_rejects_invalid_advertised_base_url(
    tmp_path: Path, advertised_base_url: str
) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path, f"bridge:\n  advertisedBaseUrl: '{advertised_base_url}'\n")
    with pytest.raises(ConfigError, match="advertisedBaseUrl"):
        resolve_runtime_configuration(str(config_path))


def test_listener_settings_come_from_the_static_file(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(
        config_path,
        """
bridge:
  apiHost: 127.0.0.1
  apiPort: 9000
  advertisedBaseUrl: https://mabrid.example.test/
""",
    )
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.bridge.api_host == "127.0.0.1"
    assert configuration.bridge.api_port == 9000
    assert configuration.bridge.advertised_base_url == "https://mabrid.example.test"


def test_listener_defaults_to_all_interfaces(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path, "{}")
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.bridge.api_host == "0.0.0.0"
    assert configuration.bridge.api_port == 8765
    assert configuration.diagnostic_upstream is None


def test_diagnostic_upstream_references_runtime_topology(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path, "bridge: {diagnosticUpstream: fixture}", TOPOLOGY)
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.diagnostic_upstream == "fixture"
    assert configuration.runtime_error is None


def test_diagnostic_upstream_must_reference_a_configured_upstream(tmp_path: Path) -> None:
    config_path = tmp_path / "fixture.yaml"
    _write_config(config_path, "bridge: {diagnosticUpstream: missing}", TOPOLOGY)
    configuration = resolve_runtime_configuration(str(config_path))
    assert configuration.runtime_error is not None
    assert "diagnosticUpstream" in configuration.runtime_error
    assert not configuration.upstreams


def test_process_arguments_accept_only_the_configuration_path() -> None:
    assert server_main.parse_args(["--config", "fixture.yaml"]).config == "fixture.yaml"
    with pytest.raises(SystemExit):
        server_main.parse_args(["--config", "fixture.yaml", "--api-port", "9000"])


def test_build_advertised_mcp_url_uses_the_validated_origin() -> None:
    assert (
        build_advertised_mcp_url("https://mabrid.example.test", "test-endpoint")
        == "https://mabrid.example.test/mcp/test-endpoint"
    )
