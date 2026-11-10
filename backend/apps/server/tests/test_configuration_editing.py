from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
import yaml
from pydantic import SecretStr, ValidationError

from mabrid.server.config import resolve_runtime_configuration
from mabrid.server.config.editor import (
    ConfigurationEditError,
    HeaderEdit,
    HttpUpstreamEdit,
    RuntimeEditRequest,
    RuntimeFileEditor,
)
from mabrid.server.api import create_app
from mabrid.server.composition import bootstrap_server


def _editor(tmp_path: Path, content: str | None = None) -> tuple[RuntimeFileEditor, Path]:
    static = tmp_path / "mabrid.yaml"
    static.write_text("{}\n", encoding="utf-8")
    runtime = tmp_path / "mabrid.runtime.yaml"
    if content is not None:
        runtime.write_text(content, encoding="utf-8")
    return RuntimeFileEditor(resolve_runtime_configuration(str(static))), runtime


def _request(editor: RuntimeFileEditor, **updates) -> RuntimeEditRequest:
    view = editor.read()
    value = {
        "expected_hash": view.content_hash,
        "upstreams": {
            name: {
                "transport": upstream.transport,
                "enabled": upstream.enabled,
                **(
                    {
                        "url": upstream.url,
                        "headers": {key: {"action": "preserve"} for key in upstream.headers},
                    }
                    if upstream.transport != "stdio"
                    else {}
                ),
            }
            for name, upstream in view.upstreams.items()
        },
        "endpoints": {
            name: endpoint.model_dump(by_alias=True) for name, endpoint in view.endpoints.items()
        },
    }
    return RuntimeEditRequest.model_validate(value | updates)


def test_first_run_save_is_redacted_and_does_not_create_database(tmp_path: Path) -> None:
    editor, path = _editor(tmp_path)
    request = _request(
        editor,
        upstreams={
            "service": {
                "transport": "sse",
                "url": "https://example.test/sse",
                "headers": {"Authorization": {"action": "replace", "value": "fixture-secret"}},
            }
        },
    )
    content, _ = editor.prepare(request)
    result = editor.write(content, request.expected_hash)
    assert result.content_hash is not None
    assert result.upstreams["service"].headers == ["Authorization"]
    assert "fixture-secret" not in result.model_dump_json()
    assert (
        yaml.safe_load(path.read_text())["upstreams"]["service"]["headers"]["Authorization"]
        == "fixture-secret"
    )
    assert not list(tmp_path.rglob("*.db"))


def test_preserves_comments_host_and_headers_then_replaces_and_removes(tmp_path: Path) -> None:
    editor, path = _editor(
        tmp_path,
        """# Configuration note
agentHost: # preserved Host
  enabled: false
upstreams:
  service: # service note
    transport: sse
    url: https://example.test/sse
    headers:
      Authorization: fixture-old # header note
      X-Remove: fixture-remove
endpoints: {}
""",
    )
    request = _request(editor)
    content, _ = editor.prepare(request)
    editor.write(content, request.expected_hash)
    assert "# Configuration note" in path.read_text()
    assert "# preserved Host" in path.read_text()
    assert "# service note" in path.read_text()
    assert "# header note" in path.read_text()
    request = _request(editor)
    upstream = request.upstreams["service"]
    assert isinstance(upstream, HttpUpstreamEdit)
    upstream.headers = {
        "Authorization": HeaderEdit(action="replace", value=SecretStr("fixture-new")),
        "X-Remove": HeaderEdit(action="remove"),
    }
    content, _ = editor.prepare(request)
    result = editor.write(content, request.expected_hash)
    assert "fixture-new" not in result.model_dump_json()
    assert yaml.safe_load(path.read_text())["upstreams"]["service"]["headers"] == {
        "Authorization": "fixture-new"
    }


def test_conflict_and_failed_replace_leave_original_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    editor, path = _editor(tmp_path, "# original\n{}\n")
    request = _request(editor)
    content, _ = editor.prepare(request)
    path.write_text("# external edit\n{}\n", encoding="utf-8")
    with pytest.raises(ConfigurationEditError, match="file changed"):
        editor.write(content, request.expected_hash)
    request = _request(editor)
    content, _ = editor.prepare(request)

    def fail_replace(*_args) -> None:
        raise PermissionError("fixture-secret")

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(ConfigurationEditError) as error:
        editor.write(content, request.expected_hash)
    assert "fixture-secret" not in str(error.value)
    assert path.read_text() == "# external edit\n{}\n"
    assert not list(tmp_path.glob(".mabrid-runtime-*"))


def test_stdio_is_only_enablement_editable(tmp_path: Path) -> None:
    editor, path = _editor(
        tmp_path,
        "upstreams:\n  local:\n    transport: stdio\n    command: fixture-command\n    args: [fixture-sensitive-arg]\n    env: {KEY: fixture-env}\nendpoints: {}\n",
    )
    view = editor.read()
    assert "fixture-sensitive-arg" not in view.model_dump_json()
    assert "fixture-env" not in view.model_dump_json()
    request = _request(editor, upstreams={"local": {"transport": "stdio", "enabled": False}})
    content, _ = editor.prepare(request)
    editor.write(content, request.expected_hash)
    assert "fixture-sensitive-arg" in path.read_text()
    for upstreams in (
        {},
        {"local": {"transport": "sse", "url": "https://example.test/sse"}},
        {"new": {"transport": "stdio", "enabled": True}},
    ):
        with pytest.raises(ConfigurationEditError):
            editor.prepare(_request(editor, upstreams=upstreams))


def test_invalid_candidate_never_writes(tmp_path: Path) -> None:
    editor, path = _editor(tmp_path, "{}\n")
    with pytest.raises(ValidationError):
        editor.prepare(
            _request(editor, upstreams={"bad": {"transport": "sse", "url": "not-a-url"}})
        )
    assert path.read_text() == "{}\n"


@asynccontextmanager
async def _client(tmp_path: Path, content: str | None = None):
    editor, path = _editor(tmp_path, content)
    static = tmp_path / "mabrid.yaml"
    static.write_text("storage: {sqlitePath: fixture.db}\n", encoding="utf-8")
    result = await bootstrap_server(resolve_runtime_configuration(str(static)))
    app = create_app(result.gateway, gateway_management=result.gateway_management)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.test"
        ) as client:
            yield client, result, editor, path
    finally:
        if result.agent_host is not None:
            await result.agent_host.close()
        await result.database.close()


async def test_http_save_then_explicit_apply_and_stale_conflict(tmp_path: Path) -> None:
    async with _client(tmp_path) as (client, result, editor, _path):
        read = await client.get("/api/v1/gateway/configuration/runtime")
        assert read.status_code == 200 and read.json()["content_hash"] is None
        request = _request(
            editor,
            upstreams={"service": {"transport": "sse", "url": "https://example.test/sse"}},
            endpoints={"entry": {"bindings": [{"upstream": "service"}]}},
        )
        saved = await client.put(
            "/api/v1/gateway/configuration/runtime",
            json=request.model_dump(mode="json", by_alias=True),
        )
        assert saved.status_code == 200
        assert not result.gateway.published_endpoints
        status = (await client.get("/api/v1/gateway/configuration")).json()
        assert status["generation"] == 1 and status["pending"]
        stale = await client.put(
            "/api/v1/gateway/configuration/runtime",
            json=request.model_dump(mode="json", by_alias=True),
        )
        assert stale.status_code == 409 and stale.json()["code"] == "configuration_conflict"
        applied = await client.post(
            "/api/v1/gateway/configuration/apply",
            json={"expected_hash": saved.json()["content_hash"]},
        )
        assert applied.status_code == 200 and applied.json()["generation"] == 2
        assert len(result.gateway.published_endpoints) == 1


async def test_invalid_binding_and_secret_request_values_are_not_returned(tmp_path: Path) -> None:
    async with _client(tmp_path, "{}\n") as (client, _result, editor, path):
        request = _request(
            editor,
            upstreams={"service": {"transport": "sse", "url": "https://example.test/sse"}},
            endpoints={
                "entry": {
                    "mode": "aggregate",
                    "bindings": [
                        {"upstream": "service", "namespace": "same"},
                        {"upstream": "service", "namespace": "same"},
                    ],
                }
            },
        )
        invalid = await client.put(
            "/api/v1/gateway/configuration/runtime",
            json=request.model_dump(mode="json", by_alias=True),
        )
        assert invalid.status_code == 422 and path.read_text() == "{}\n"
        payload = request.model_dump(mode="json", by_alias=True)
        payload["upstreams"]["service"]["command"] = "fixture-sensitive-command"
        invalid = await client.put("/api/v1/gateway/configuration/runtime", json=payload)
        assert invalid.status_code == 422
        assert "fixture-sensitive-command" not in invalid.text
        assert path.read_text() == "{}\n"


def test_new_stdio_and_host_edits_are_rejected(tmp_path: Path) -> None:
    editor, _path = _editor(tmp_path)
    with pytest.raises(ConfigurationEditError, match="New stdio"):
        editor.prepare(
            _request(editor, upstreams={"local": {"transport": "stdio", "enabled": True}})
        )
    with pytest.raises(ValidationError):
        RuntimeEditRequest.model_validate(
            {
                "expected_hash": None,
                "upstreams": {},
                "endpoints": {},
                "agentHost": {"enabled": True},
            }
        )


def test_external_edit_after_prepare_and_missing_header_preservation(tmp_path: Path) -> None:
    editor, path = _editor(tmp_path, "{}\n")
    request = _request(editor)
    path.write_text("# external\n{}\n", encoding="utf-8")
    with pytest.raises(ConfigurationEditError, match="file changed"):
        editor.prepare(request)
    with pytest.raises(ConfigurationEditError, match="Cannot preserve"):
        editor.prepare(
            _request(
                editor,
                upstreams={
                    "service": {
                        "transport": "sse",
                        "url": "https://example.test/sse",
                        "headers": {"Missing": {"action": "preserve"}},
                    }
                },
            )
        )


def test_duplicate_yaml_keys_rejected_without_overwriting(tmp_path: Path) -> None:
    editor, path = _editor(tmp_path, "upstreams: {}\nupstreams: {}\n")
    with pytest.raises(ConfigurationEditError):
        editor.read()
    assert path.read_text() == "upstreams: {}\nupstreams: {}\n"


def test_setup_example_comments_and_host_template_survive_editing(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[4]
    example = (root / "mabrid.runtime.yaml.example").read_text(encoding="utf-8")
    editor, path = _editor(tmp_path, example)
    request = _request(editor)
    request.endpoints["test-endpoint"].display_name = "Updated endpoint"
    content, _ = editor.prepare(request)
    response = editor.write(content, request.expected_hash)
    assert "# agentHost:" in path.read_text()
    assert "#     apiKeyEnv: API_SERVER_KEY" in path.read_text()
    assert "# Any change to the agentHost section" in path.read_text()
    assert "# headers: {}" in path.read_text()
    assert "apiKeyEnv" not in response.model_dump_json()
    assert response.endpoints["test-endpoint"].display_name == "Updated endpoint"
