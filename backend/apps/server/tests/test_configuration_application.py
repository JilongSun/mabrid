from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from alembic import command
from alembic.config import Config
from anyio import to_thread
from mabrid.application.gateway.sessions import BridgeSessionRecord, BridgeSessionStatus
from mabrid.application.gateway.topology import (
    EndpointBinding,
    EndpointDefinition,
    StreamableHttpConnection,
    UpstreamServerDefinition,
)
from pydantic import AnyHttpUrl
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSessionTransaction

from mabrid.server import main as server_main
from mabrid.server.composition import BootstrapResult, bootstrap_server
from mabrid.server.composition.configuration import ConfigurationApplyError
from mabrid.server.api import create_app
from mabrid.server.config import ConfigError, resolve_runtime_configuration
from mabrid.server.persistence import SqliteDatabase
from mabrid.server.persistence.schema import (
    AgentSessionRow,
    EndpointBindingRow,
    EndpointRevisionRow,
    UnsettledAgentRunRow,
    UpstreamRevisionRow,
    UpstreamServerRow,
)
from mabrid.server.persistence.sessions import SqlAlchemyBridgeSessionRepository
from mabrid.server.persistence.topology import seed_topology_if_empty


def _static(path: Path, *, host: bool = False) -> None:
    agent_host = (
        """
agentHost:
  enabled: true
  targetId: fixture-target
  endpointSlug: fixture
  runtime:
    baseUrl: http://fixture-agent.invalid/v1
    apiKeyEnv: FIXTURE_AGENT_KEY
"""
        if host
        else ""
    )
    path.write_text(
        f"""
bridge:
  apiPort: 8765
  advertisedBaseUrl: http://mabrid.test:8765
storage:
  sqlitePath: gateway.db
{agent_host}
upstreams:
  fixture:
    transport: streamable-http
    url: https://old.example.test/mcp
endpoints:
  fixture:
    bindings:
      - upstream: fixture
""",
        encoding="utf-8",
    )


def _runtime(path: Path, url: str, *, endpoint: str = "fixture") -> None:
    path.write_text(
        f"""
upstreams:
  fixture:
    transport: streamable-http
    url: {url}
endpoints:
  {endpoint}:
    bindings:
      - upstream: fixture
""",
        encoding="utf-8",
    )


@asynccontextmanager
async def _running(config_path: Path) -> AsyncIterator[BootstrapResult]:
    configuration = resolve_runtime_configuration(
        str(config_path), defer_legacy_topology_errors=True
    )
    result = await bootstrap_server(configuration)
    try:
        yield result
    finally:
        if result.agent_host is not None:
            await result.agent_host.close()
        await result.database.close()


async def _old_database(path: Path) -> tuple[BridgeSessionRecord, str]:
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "migrations")
    )
    config.set_main_option("sqlalchemy.url", f"sqlite+aiosqlite:///{path.as_posix()}")
    await to_thread.run_sync(command.upgrade, config, "0002_agent_sessions")
    database = SqliteDatabase(path)
    try:
        upstream = UpstreamServerDefinition(
            slug="fixture",
            display_name="fixture",
            connection=StreamableHttpConnection(url=AnyHttpUrl("https://old.example.test/mcp")),
        )
        endpoint = EndpointDefinition(
            slug="fixture",
            display_name="fixture",
            bindings=[EndpointBinding(upstream_server_id=upstream.server_id)],
        )
        await seed_topology_if_empty(database.session_factory, [upstream], [endpoint])
        async with database.session_factory() as session:
            revision_id = await session.scalar(select(EndpointRevisionRow.revision_id))
        assert revision_id is not None
        bridge_session = BridgeSessionRecord(
            endpoint_id=endpoint.endpoint_id,
            endpoint_revision_id=revision_id,
            status=BridgeSessionStatus.CLOSED,
        )
        await SqlAlchemyBridgeSessionRepository(database.session_factory).add(bridge_session)
        agent_id = uuid4()
        async with database.session_factory.begin() as session:
            session.add(
                AgentSessionRow(
                    session_id=agent_id,
                    target_id="fixture-target",
                    runtime_binding_id="fixture-binding",
                    remote_session_id="remote-fixture",
                    created_at=datetime.now(timezone.utc),
                )
            )
            await session.flush()
            session.add(
                UnsettledAgentRunRow(
                    target_id="fixture-target",
                    session_id=agent_id,
                    run_id=uuid4(),
                    runtime_binding_id="fixture-binding",
                    remote_run_id="run-fixture",
                )
            )
        return bridge_session, str(agent_id)
    finally:
        await database.close()


async def test_existing_database_migrates_and_file_changes_preserve_references(
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    bridge_session, agent_id = await _old_database(tmp_path / "gateway.db")

    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        before = await result.gateway_management.topology_reader.read_snapshot()
        assert before.endpoints[0].endpoint_id == bridge_session.endpoint_id
        assert (
            before.endpoints[0].current_revision.revision_id == bridge_session.endpoint_revision_id
        )
        assert (await manager.status()).applied_source == "legacy_file"

        _runtime(runtime_path, "https://new.example.test/mcp")
        pending = await manager.status()
        assert pending.pending and pending.file_valid
        applied = await manager.apply(pending.desired_hash)
        assert applied.generation == 2 and not applied.pending
        after = await result.gateway_management.topology_reader.read_snapshot()
        assert after.endpoints[0].endpoint_id == bridge_session.endpoint_id
        assert after.endpoints[0].current_revision.revision_number == 2
        assert after.upstreams[0].server_id == before.upstreams[0].server_id
        assert (
            after.endpoints[0].bindings[0].binding_id == before.endpoints[0].bindings[0].binding_id
        )
        assert (
            await SqlAlchemyBridgeSessionRepository(result.database.session_factory).get(
                bridge_session.session_id
            )
            == bridge_session
        )
        async with result.database.session_factory() as session:
            agent = await session.scalar(select(AgentSessionRow))
            unsettled = await session.scalar(select(UnsettledAgentRunRow))
            assert agent is not None and str(agent.session_id) == agent_id
            assert agent.runtime_binding_id == "fixture-binding"
            assert unsettled is not None and unsettled.remote_run_id == "run-fixture"


async def test_conflict_invalid_candidate_and_concurrent_apply_are_safe(tmp_path: Path) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        initial = await manager.status()
        published = result.gateway.published_endpoints[0]
        _runtime(runtime_path, "https://new.example.test/mcp")
        with pytest.raises(ConfigurationApplyError, match="changed") as conflict:
            await manager.apply(initial.desired_hash)
        assert conflict.value.code == "configuration_conflict"
        assert result.gateway.published_endpoints[0] == published

        runtime_path.write_text("upstreams: [fixture-secret\n", encoding="utf-8")
        invalid = await manager.status()
        assert not invalid.file_valid and "fixture-secret" not in str(invalid.error)
        with pytest.raises(ConfigurationApplyError) as rejected:
            await manager.apply(invalid.desired_hash)
        assert rejected.value.code == "configuration_invalid"
        assert result.gateway.published_endpoints[0] == published

        _runtime(runtime_path, "https://new.example.test/mcp")
        candidate = await manager.status()
        applied = await asyncio.gather(
            manager.apply(candidate.desired_hash),
            manager.apply(candidate.desired_hash),
        )
        assert [status.generation for status in applied] == [2, 2]
        assert all(not status.pending for status in applied)
        async with result.database.session_factory() as session:
            assert await session.scalar(select(func.count()).select_from(UpstreamRevisionRow)) == 2
            assert await session.scalar(select(func.count()).select_from(EndpointRevisionRow)) == 2


async def test_cancellation_after_commit_keeps_publication_and_status_consistent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        _runtime(runtime_path, "https://new.example.test/mcp")
        candidate = await manager.status()
        committed = asyncio.Event()
        release = asyncio.Event()
        original_exit = AsyncSessionTransaction.__aexit__

        async def pause_after_commit(transaction, exc_type, exc_value, traceback):
            outcome = await original_exit(transaction, exc_type, exc_value, traceback)
            if exc_type is None:
                committed.set()
                await release.wait()
            return outcome

        monkeypatch.setattr(AsyncSessionTransaction, "__aexit__", pause_after_commit)
        task = asyncio.create_task(manager.apply(candidate.desired_hash))
        await asyncio.wait_for(committed.wait(), timeout=5)
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

        current = await result.gateway_management.topology_reader.read_snapshot()
        status = await manager.status()
        assert current.endpoints[0].current_revision.revision_number == 2
        assert result.gateway.published_endpoints[0].revision.revision_number == 2
        assert status.generation == 2
        assert status.applied_hash == candidate.desired_hash


@pytest.mark.parametrize("reload_fails", [False, True])
async def test_uncertain_commit_reloads_or_disables_publication_safely(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, reload_fails: bool
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        _runtime(runtime_path, "https://new.example.test/mcp")
        candidate = await manager.status()
        original_exit = AsyncSessionTransaction.__aexit__
        injected = False

        async def fail_after_commit(transaction, exc_type, exc_value, traceback):
            nonlocal injected
            outcome = await original_exit(transaction, exc_type, exc_value, traceback)
            if exc_type is None and not injected:
                injected = True
                raise SQLAlchemyError("fixture-secret")
            return outcome

        async def fail_reload() -> None:
            raise SQLAlchemyError("fixture-secret")

        with monkeypatch.context() as patch:
            patch.setattr(AsyncSessionTransaction, "__aexit__", fail_after_commit)
            if reload_fails:
                patch.setattr(result.gateway, "load_published_endpoints", fail_reload)
            with pytest.raises(ConfigurationApplyError) as rejected:
                await manager.apply(candidate.desired_hash)
            status = await manager.status()
            assert status.recovery_required == reload_fails
            if reload_fails:
                assert not result.gateway.published_endpoints
                assert not await result.gateway_management.is_ready()
        assert rejected.value.code == "configuration_storage_error"
        assert "fixture-secret" not in str(rejected.value)
        status = await manager.status()
        assert not status.recovery_required
        assert status.error and "fixture-secret" not in status.error
        if reload_fails:
            assert result.gateway.published_endpoints
            assert await result.gateway_management.is_ready()
            recovered = await manager.apply(status.desired_hash)
            assert not recovered.recovery_required
            assert await result.gateway_management.is_ready()
        else:
            assert result.gateway.published_endpoints[0].revision.revision_number == 2
            assert status.applied_hash == candidate.desired_hash
            assert status.generation == 2 and not status.pending


async def test_recovery_rechecks_file_adoption_before_selecting_a_candidate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        _runtime(runtime_path, "https://new.example.test/mcp")
        candidate = await manager.status()
        original_exit = AsyncSessionTransaction.__aexit__
        injected = False

        async def fail_after_commit(transaction, exc_type, exc_value, traceback):
            nonlocal injected
            outcome = await original_exit(transaction, exc_type, exc_value, traceback)
            if exc_type is None and not injected:
                injected = True
                raise SQLAlchemyError("fixture-only failure")
            return outcome

        async def fail_reload() -> None:
            raise SQLAlchemyError("fixture-only failure")

        with monkeypatch.context() as patch:
            patch.setattr(AsyncSessionTransaction, "__aexit__", fail_after_commit)
            patch.setattr(result.gateway, "load_published_endpoints", fail_reload)
            with pytest.raises(ConfigurationApplyError):
                await manager.apply(candidate.desired_hash)
            runtime_path.unlink()
            stale = await manager.status()
        with pytest.raises(ConfigurationApplyError) as conflict:
            await manager.apply(stale.desired_hash)
        assert conflict.value.code == "configuration_conflict"
        refreshed = await manager.status()
        assert refreshed.desired_source == "unconfigured"
        assert refreshed.desired_hash is None and refreshed.pending
        await manager.apply(refreshed.desired_hash)
        assert not result.gateway.published_endpoints


async def test_management_apply_reports_stale_invalid_and_successful_candidates(
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    async with _running(config_path) as result:
        app = create_app(result.gateway, gateway_management=result.gateway_management)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            initial = await client.get("/api/v1/gateway/configuration")
            assert initial.status_code == 200 and initial.json()["generation"] == 1
            old_hash = initial.json()["desired_hash"]
            assert (
                await client.post("/api/v1/gateway/configuration/apply", json={})
            ).status_code == 422
            _runtime(runtime_path, "https://new.example.test/mcp")
            conflict = await client.post(
                "/api/v1/gateway/configuration/apply", json={"expected_hash": old_hash}
            )
            assert conflict.status_code == 409
            assert conflict.json()["code"] == "configuration_conflict"

            runtime_path.write_text("upstreams: [fixture-secret\n", encoding="utf-8")
            invalid = await client.get("/api/v1/gateway/configuration")
            assert not invalid.json()["file_valid"] and "fixture-secret" not in invalid.text
            assert invalid.json()["desired_source"] == "runtime_file"
            rejected = await client.post(
                "/api/v1/gateway/configuration/apply",
                json={"expected_hash": invalid.json()["desired_hash"]},
            )
            assert rejected.status_code == 422 and "fixture-secret" not in rejected.text
            assert rejected.json()["code"] == "configuration_invalid"

            _runtime(runtime_path, "https://new.example.test/mcp")
            candidate = await client.get("/api/v1/gateway/configuration")
            applied = await client.post(
                "/api/v1/gateway/configuration/apply",
                json={"expected_hash": candidate.json()["desired_hash"]},
            )
            assert applied.status_code == 200
            assert applied.json()["generation"] == 2 and not applied.json()["pending"]
            status = await client.get("/api/v1/gateway/status")
            assert status.json()["topology_mode"] == "generation_applied"
            assert status.json()["published_endpoint_slugs"] == ["fixture"]


async def test_invalid_runtime_restart_uses_last_known_good_and_reports_error(
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://known-good.example.test/mcp")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        previous = await manager.status()
        previous_revision = result.gateway.published_endpoints[0].revision

    runtime_path.write_text("upstreams: [fixture-secret\n", encoding="utf-8")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        status = await manager.status()
        assert not status.file_valid and status.pending
        assert status.applied_hash == previous.applied_hash
        assert status.applied_source == "runtime_file"
        assert status.error and "fixture-secret" not in status.error
        assert result.gateway.published_endpoints[0].revision == previous_revision
        assert await result.gateway_management.is_ready()


async def test_missing_adopted_runtime_does_not_restore_stale_legacy_topology(
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://new.example.test/mcp")
    async with _running(config_path) as result:
        assert result.gateway.published_endpoints

    runtime_path.unlink()
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        status = await manager.status()
        assert status.applied_source == "unconfigured" and not status.pending
        assert not result.gateway.published_endpoints
        assert not await result.gateway_management.is_ready()


@pytest.mark.parametrize(
    ("original", "invalid"),
    [
        ("transport: streamable-http", "transport: unsupported"),
        ("upstream: fixture", "upstream: missing"),
    ],
)
async def test_missing_adopted_runtime_ignores_invalid_legacy_topology(
    tmp_path: Path, original: str, invalid: str
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://new.example.test/mcp")
    async with _running(config_path) as result:
        assert result.gateway.published_endpoints

    legacy = config_path.read_text(encoding="utf-8")
    assert original in legacy
    config_path.write_text(legacy.replace(original, invalid), encoding="utf-8")
    runtime_path.unlink()

    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        status = await manager.status()
        assert status.file_valid and status.error is None
        assert status.applied_source == "unconfigured" and not status.pending
        assert not result.gateway.published_endpoints
        assert not await result.gateway_management.is_ready()


async def test_invalid_legacy_topology_is_rejected_before_runtime_adoption(tmp_path: Path) -> None:
    config_path = tmp_path / "mabrid.yaml"
    _static(config_path)
    legacy = config_path.read_text(encoding="utf-8")
    config_path.write_text(
        legacy.replace("transport: streamable-http", "transport: unsupported"),
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="Invalid topology configuration"):
        resolve_runtime_configuration(str(config_path))
    with pytest.raises(ConfigError, match="Invalid topology configuration"):
        async with _running(config_path):
            pytest.fail("Invalid legacy topology must not be published")


async def test_server_entry_point_ignores_invalid_legacy_after_runtime_adoption(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://new.example.test/mcp")
    async with _running(config_path):
        pass

    legacy = config_path.read_text(encoding="utf-8")
    config_path.write_text(
        legacy.replace("transport: streamable-http", "transport: unsupported"),
        encoding="utf-8",
    )
    runtime_path.unlink()
    served = False

    async def serve(_runtime: server_main.MabridServerRuntime) -> None:
        nonlocal served
        served = True

    monkeypatch.setattr(server_main.MabridServerRuntime, "serve", serve)
    await server_main.serve_runtime(server_main.parse_args(["--config", str(config_path)]))
    assert served


async def test_missing_host_endpoint_rejects_apply_and_invalid_first_start_degrades(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path, host=True)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    _runtime(runtime_path, "https://old.example.test/mcp")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None and result.agent_host is not None
        _runtime(runtime_path, "https://new.example.test/mcp", endpoint="different")
        status = await manager.status()
        assert not status.file_valid
        with pytest.raises(ConfigurationApplyError, match="not published and enabled"):
            await manager.apply(status.desired_hash)
        assert result.gateway.published_endpoints[0].revision.slug == "fixture"

    other = tmp_path / "first-start"
    other.mkdir()
    _static(other / "mabrid.yaml", host=True)
    (other / "mabrid.runtime.yaml").write_text("endpoints: [invalid\n", encoding="utf-8")
    async with _running(other / "mabrid.yaml") as result:
        manager = result.gateway_management.configuration
        assert manager is not None and manager.has_error
        assert result.agent_host is None
        assert not await result.gateway_management.is_ready()


async def test_unconfigured_host_can_be_enabled_after_a_later_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path, host=True)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    runtime_path.write_text("{}\n", encoding="utf-8")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        unconfigured = await manager.status()
        assert unconfigured.file_valid and unconfigured.host_unavailable
        assert not unconfigured.restart_required
        assert result.agent_host is None

        _runtime(runtime_path, "https://new.example.test/mcp")
        status = await manager.status()
        applied = await manager.apply(status.desired_hash)
        assert applied.host_unavailable and applied.restart_required
        assert result.agent_host is None
        assert await result.gateway_management.is_ready()

    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None and result.agent_host is not None
        assert not (await manager.status()).host_unavailable


async def test_static_setting_changes_are_reported_but_not_hot_applied(tmp_path: Path) -> None:
    config_path = tmp_path / "mabrid.yaml"
    _static(config_path)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        assert not (await manager.status()).restart_required
        config_path.write_text(
            config_path.read_text(encoding="utf-8").replace("apiPort: 8765", "apiPort: 9876"),
            encoding="utf-8",
        )
        status = await manager.status()
        assert status.restart_required
        assert result.gateway_management.advertised_base_url == "http://mabrid.test:8765"
        config_path.write_text("bridge: [fixture-secret\n", encoding="utf-8")
        invalid = await manager.status()
        assert not invalid.file_valid and invalid.desired_source == "unknown"
        assert invalid.desired_hash is None and "fixture-secret" not in str(invalid.error)
        with pytest.raises(ConfigurationApplyError):
            await manager.apply(invalid.desired_hash)


@pytest.mark.parametrize("collision", ["upstream", "endpoint"])
async def test_normalized_name_collisions_are_rejected_without_changing_heads(
    tmp_path: Path, collision: str
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        previous = result.gateway.published_endpoints[0]
        extra_upstream = (
            "  Fixture: {transport: stdio, command: fixture}\n" if collision == "upstream" else ""
        )
        extra_endpoint = (
            "  Fixture: {bindings: [{upstream: fixture}]}\n" if collision == "endpoint" else ""
        )
        runtime_path.write_text(
            "upstreams:\n"
            "  fixture: {transport: stdio, command: fixture}\n"
            f"{extra_upstream}"
            "endpoints:\n"
            "  fixture: {bindings: [{upstream: fixture}]}\n"
            f"{extra_endpoint}",
            encoding="utf-8",
        )
        status = await manager.status()
        assert not status.file_valid
        assert status.error and "resolve to slug" in status.error
        with pytest.raises(ConfigurationApplyError):
            await manager.apply(status.desired_hash)
        assert result.gateway.published_endpoints[0] == previous


@pytest.mark.parametrize("corrupt", ["upstream", "binding"])
async def test_inconsistent_ledger_does_not_replace_running_snapshot(
    tmp_path: Path, corrupt: str
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://old.example.test/mcp")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        current = result.gateway.published_endpoints[0]
        async with result.database.session_factory.begin() as session:
            if corrupt == "upstream":
                upstream = await session.scalar(select(UpstreamServerRow))
                assert upstream is not None
                upstream.url = "https://inconsistent.example.test/mcp"
            else:
                binding = await session.scalar(select(EndpointBindingRow))
                assert binding is not None
                binding.priority += 1
        status = await manager.status()
        with pytest.raises(ConfigurationApplyError) as rejected:
            await manager.apply(status.desired_hash)
        assert rejected.value.code == "configuration_ledger_error"
        assert result.gateway.published_endpoints[0] == current
        assert (await manager.status()).error is not None
