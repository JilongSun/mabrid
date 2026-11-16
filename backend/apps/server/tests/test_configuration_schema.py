"""Generated file contracts complement, rather than replace, configuration semantics."""

import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, ValidationError as SchemaError
from pydantic import ValidationError

from mabrid.server.config.file import (
    BridgeRuntimeConfig,
    ProcessFileConfig,
    RuntimeFileConfig,
)
from mabrid.server.config.loader import ConfigError, resolve_runtime_document
from mabrid.server.config.schema import configuration_schemas

ROOT = Path(__file__).resolve().parents[4]
SCHEMAS = ROOT / "docs/contracts/configuration"


def test_configuration_schema_snapshots_are_deterministic_and_valid() -> None:
    documents = configuration_schemas()
    assert documents == configuration_schemas()
    for filename, document in documents.items():
        Draft202012Validator.check_schema(document)
        assert json.loads((SCHEMAS / filename).read_text(encoding="utf-8")) == document
        assert document["additionalProperties"] is False
    process_properties = documents["mabrid.schema.json"]["properties"]
    runtime_properties = documents["mabrid.runtime.schema.json"]["properties"]
    assert isinstance(process_properties, dict) and isinstance(runtime_properties, dict)
    assert set(process_properties) == {
        "bridge",
        "storage",
        "runtimeConfigFile",
    }
    assert set(runtime_properties) == {
        "upstreams",
        "endpoints",
        "agentHost",
    }


@pytest.mark.parametrize(
    ("filename", "model"),
    [("mabrid", ProcessFileConfig), ("mabrid.runtime", RuntimeFileConfig)],
)
def test_public_yaml_examples_match_generated_and_actual_models(filename: str, model) -> None:
    document = yaml.safe_load((ROOT / f"{filename}.yaml.example").read_text(encoding="utf-8"))
    Draft202012Validator(configuration_schemas()[f"{filename}.schema.json"]).validate(document)
    model.model_validate(document)


def test_enabled_host_and_all_transports_validate_offline(tmp_path: Path) -> None:
    document = {
        "upstreams": {
            "local": {"transport": "stdio", "command": "fixture-command", "args": ["--fixture"]},
            "events": {"transport": "sse", "url": "https://events.example.invalid/sse"},
            "http": {"transport": "streamable-http", "url": "https://mcp.example.invalid/mcp"},
        },
        "endpoints": {
            "tools": {
                "mode": "aggregate",
                "bindings": [{"upstream": "local"}, {"upstream": "http", "namespace": "remote"}],
            }
        },
        "agentHost": {
            "enabled": True,
            "mcpAppsEnabled": True,
            "targetId": "fixture-agent",
            "endpointSlug": "tools",
            "runtime": {
                "apiKey": "fixture-only-key",
                "sessions": {"apiRoot": "https://agent.example.invalid", "bindingId": "fixture"},
            },
        },
    }
    Draft202012Validator(configuration_schemas()["mabrid.runtime.schema.json"]).validate(document)
    bridge = BridgeRuntimeConfig(advertised_base_url="https://bridge.example.invalid")
    candidate = resolve_runtime_document(document, tmp_path / "mabrid.yaml", bridge, None, None)
    assert set(candidate.upstreams) == {"local", "events", "http"}
    with pytest.raises(ConfigError, match="advertisedBaseUrl"):
        resolve_runtime_document(
            document, tmp_path / "mabrid.yaml", BridgeRuntimeConfig(), None, None
        )


@pytest.mark.parametrize(
    "document",
    [
        {"agentHost": {"runtime": {"apiKeyEnv": "OBSOLETE"}}},
        {"upstreams": {"fixture": {"transport": "unknown"}}},
        {"endpoints": {"tools": {"bindings": [{"upstream": "fixture", "namespace": "Invalid"}]}}},
    ],
)
def test_schema_and_model_reject_invalid_public_shapes(document: dict) -> None:
    with pytest.raises(SchemaError):
        Draft202012Validator(configuration_schemas()["mabrid.runtime.schema.json"]).validate(
            document
        )
    with pytest.raises(ValidationError):
        RuntimeFileConfig.model_validate(document)


@pytest.mark.parametrize(
    "document",
    [
        {"upstreams": {"fixture": {"transport": "stdio"}}},
        {"endpoints": {"tools": {"bindings": [{"upstream": "missing"}]}}},
        {"agentHost": {"enabled": True}},
    ],
)
def test_custom_configuration_semantics_remain_enforced(document: dict) -> None:
    with pytest.raises(ValidationError):
        RuntimeFileConfig.model_validate(document)


def test_schema_generation_does_not_read_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    def reject_read(*args, **kwargs):
        raise AssertionError("Schema generation must not read configuration files")

    monkeypatch.setattr(Path, "read_text", reject_read)
    monkeypatch.setattr(Path, "read_bytes", reject_read)
    assert len(configuration_schemas()) == 2


def test_schema_cli_detects_missing_corrupt_and_changed_snapshots(tmp_path: Path) -> None:
    command = [sys.executable, "-m", "mabrid.server.config.schema", str(tmp_path)]
    missing = subprocess.run([*command, "--check"], capture_output=True, text=True, check=False)
    assert missing.returncode == 1
    assert not list(tmp_path.iterdir())
    subprocess.run(command, capture_output=True, text=True, check=True)
    subprocess.run([*command, "--check"], capture_output=True, text=True, check=True)
    snapshot = tmp_path / "mabrid.schema.json"
    for value in ("{}", "invalid json"):
        snapshot.write_text(value, encoding="utf-8")
        result = subprocess.run([*command, "--check"], capture_output=True, text=True, check=False)
        assert result.returncode == 1 and "differs" in result.stderr
        assert snapshot.read_text(encoding="utf-8") == value
