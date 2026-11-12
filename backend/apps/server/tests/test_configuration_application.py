from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from unittest.mock import AsyncMock
import mabrid.server.composition.configuration as configuration_composition
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

from mabrid.server.composition import BootstrapResult, bootstrap_server
from mabrid.server.composition.configuration import ConfigurationApplyError
from mabrid.server.api import create_app
from mabrid.server.config import resolve_runtime_configuration, load_runtime_candidate
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
from mabrid.server.persistence.topology import reconcile_topology
from mabrid.application.agent_host import AgentSessionRecord, RuntimeSessionReference
from mabrid.server.persistence.agent_host import SqliteAgentSessionRepository


HOST = """
agentHost:
  enabled: true
  targetId: fixture-target
  endpointSlug: fixture
  runtime:
    baseUrl: http://fixture-agent.invalid/v1
    apiKeyEnv: FIXTURE_AGENT_KEY
"""


def _static(path: Path) -> None:
    path.write_text(
        """
bridge:
  apiPort: 8765
  advertisedBaseUrl: http://mabrid.test:8765
storage:
  sqlitePath: gateway.db
""",
        encoding="utf-8",
    )


def _runtime(path: Path, url: str, *, endpoint: str = "fixture", host: str | None = None) -> None:
    path.write_text(
        (host or "")
        + f"""
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
    configuration = resolve_runtime_configuration(str(config_path))
    result = await bootstrap_server(configuration)
    try:
        yield result
    finally:
        if result.agent_host is not None:
            await result.agent_host.close()
        await result.database.close()


async def _populated_database(path: Path) -> tuple[BridgeSessionRecord, str]:
    database = SqliteDatabase(path)
    try:
        await database.migrate()
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
        async with database.session_factory.begin() as session:
            await reconcile_topology(session, [upstream], [endpoint])
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
                    integration_kind="hermes",
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


def test_component_candidates_ignore_other_sections_and_comments(tmp_path: Path) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://old.example.test/mcp")
    configuration = resolve_runtime_configuration(str(config_path))
    before = load_runtime_candidate(configuration, component="gateway")
    _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
    with runtime_path.open("a", encoding="utf-8") as stream:
        stream.write("\n# fixture comment\n")
    after = load_runtime_candidate(configuration, component="gateway")
    assert before.content_hash != after.content_hash
    assert before.gateway_signature == after.gateway_signature
    with pytest.raises(Exception, match="environment variable"):
        load_runtime_candidate(configuration, component="host")


async def test_host_application_is_independent_and_requires_idle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://old.example.test/mcp")
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        generation = (await manager.status()).generation
        _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
        status = await manager.status()
        assert not status.pending and not status.restart_required
        async with result.host_runtime.operation():
            with pytest.raises(ConfigurationApplyError) as failure:
                await manager.apply_host(status.file_hash)
            assert failure.value.code == "configuration_busy"
        applied = await manager.apply_host(status.file_hash)
        assert applied.enabled and not applied.pending
        assert (await manager.status()).generation == generation
        _runtime(runtime_path, "https://new.example.test/mcp", host=HOST.replace("120", "121"))
        gateway_applied = await manager.apply((await manager.status()).file_hash)
        assert gateway_applied.generation == generation + 1
        assert result.agent_host is not None


async def test_unsettled_run_blocks_host_identity_change_even_after_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        original = result.agent_host
        repository = SqliteAgentSessionRepository(result.database.session_factory)
        session = AgentSessionRecord(
            target_id="fixture-target",
            integration_kind="hermes",
            runtime_session=RuntimeSessionReference(
                runtime_binding_id="original", remote_session_id="remote-fixture"
            ),
            created_at=datetime.now(timezone.utc),
        )
        await repository.add(session)
        assert await repository.claim_run(session, uuid4())
        _runtime(
            runtime_path,
            "https://new.example.test/mcp",
            host=HOST.replace("fixture-target", "new-target"),
        )
        with pytest.raises(ConfigurationApplyError) as failure:
            await manager.apply_host((await manager.host_status()).file_hash)
        assert failure.value.code == "configuration_busy"
        assert result.agent_host is original
        await manager.apply((await manager.status()).file_hash)
        assert not (await manager.status()).pending
    async with _running(config_path) as result:
        assert result.agent_host is None
        manager = result.gateway_management.configuration
        assert manager is not None
        status = await manager.host_status()
        assert status.error and "another Host identity" in status.error
        assert await result.gateway_management.is_ready()
        async with result.database.session_factory() as transaction:
            assert (
                await transaction.scalar(select(func.count()).select_from(UnsettledAgentRunRow))
                == 1
            )


async def test_failed_host_preparation_keeps_current_host_and_redacts_client_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
    async with _running(config_path) as result:
        original = result.agent_host
        manager = result.gateway_management.configuration
        assert manager is not None
        _runtime(
            runtime_path,
            "https://old.example.test/mcp",
            host=HOST.replace("fixture-agent.invalid", "other.invalid"),
        )
        monkeypatch.setattr(
            configuration_composition,
            "compose_agent_host",
            AsyncMock(side_effect=ValueError("fixture-secret")),
        )
        with pytest.raises(ConfigurationApplyError) as failure:
            await manager.apply_host((await manager.host_status()).file_hash)
        assert failure.value.code == "configuration_host_error"
        assert "fixture-secret" not in str(failure.value)
        assert result.agent_host is original
        status = await manager.host_status()
        assert status.pending and status.error and "fixture-secret" not in status.error
        assert not (await manager.status()).pending


async def test_invalid_gateway_can_recover_heads_without_disabling_valid_host(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
    async with _running(config_path) as result:
        previous = result.gateway.published_endpoints[0].revision
    runtime_path.write_text(HOST + "upstreams: []\nendpoints: {}\n", encoding="utf-8")
    async with _running(config_path) as result:
        assert result.gateway.published_endpoints[0].revision == previous
        assert result.agent_host is not None
        manager = result.gateway_management.configuration
        assert manager is not None and not (await manager.status()).file_valid
        host_status = await manager.host_status()
        assert host_status.enabled and not host_status.pending and host_status.error is None


async def test_endpoint_assignment_migration_uses_running_component_dependencies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
    next_host = HOST.replace("endpointSlug: fixture", "endpointSlug: next")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None and result.agent_host is not None
        original = result.agent_host
        _runtime(runtime_path, "https://old.example.test/mcp", endpoint="next", host=next_host)
        with pytest.raises(ConfigurationApplyError):
            await manager.apply((await manager.status()).file_hash)
        with pytest.raises(ConfigurationApplyError):
            await manager.apply_host((await manager.host_status()).file_hash)
        assert result.agent_host is original
        _runtime(runtime_path, "https://old.example.test/mcp", host=next_host)
        with runtime_path.open("a", encoding="utf-8") as stream:
            stream.write("  next:\n    bindings: [{upstream: fixture}]\n")
        published = await manager.apply((await manager.status()).file_hash)
        assert set(manager.published_endpoint_slugs) == {"fixture", "next"}
        assert result.agent_host is original
        await manager.apply_host(published.file_hash)
        assert (
            result.agent_host is not None and result.agent_host.management.endpoint_slug == "next"
        )
        assert (await manager.status()).generation == published.generation
        current = result.agent_host
        _runtime(runtime_path, "https://old.example.test/mcp", endpoint="next", host=next_host)
        await manager.apply((await manager.status()).file_hash)
        assert manager.published_endpoint_slugs == ("next",)
        assert result.agent_host is current


async def test_native_sessions_toggle_retains_records_and_binding_checks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from mabrid.application.agent_host import AgentSessionError, RuntimeAgentSession

    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    native_host = (
        HOST + "    sessions:\n      apiRoot: http://native.invalid/\n      bindingId: original\n"
    )
    _runtime(runtime_path, "https://old.example.test/mcp", host=native_host)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        repository = SqliteAgentSessionRepository(result.database.session_factory)
        record = AgentSessionRecord(
            target_id="fixture-target",
            integration_kind="hermes",
            runtime_session=RuntimeSessionReference(
                runtime_binding_id="original", remote_session_id="remote-fixture"
            ),
            created_at=datetime.now(timezone.utc),
        )
        await repository.add(record)
        _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
        await manager.apply_host((await manager.host_status()).file_hash)
        disabled_native = result.agent_host
        assert disabled_native is not None and disabled_native.sessions is None
        app = create_app(result.gateway, gateway_management=result.gateway_management)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://fixture.test"
        ) as client:
            unavailable = await client.get(f"/api/v1/host/sessions/{record.session_id}")
        assert (
            unavailable.status_code == 503 and unavailable.json()["code"] == "unsupported_operation"
        )
        moved = native_host.replace("fixture-agent.invalid", "moved-agent.invalid").replace(
            "native.invalid", "moved-native.invalid"
        )
        _runtime(runtime_path, "https://old.example.test/mcp", host=moved)
        await manager.apply_host((await manager.host_status()).file_hash)
        enabled_native = result.agent_host
        assert enabled_native is not None and enabled_native.sessions is not None
        assert enabled_native.session_runtime is not None
        get_session = AsyncMock(
            return_value=RuntimeAgentSession(remote_session_id="remote-fixture")
        )
        monkeypatch.setattr(enabled_native.session_runtime, "get_session", get_session)
        assert (
            await enabled_native.sessions.reopen_session(record.session_id)
        ).session_id == record.session_id
        get_session.assert_awaited_once()
        _runtime(
            runtime_path,
            "https://old.example.test/mcp",
            host=moved.replace("bindingId: original", "bindingId: other"),
        )
        await manager.apply_host((await manager.host_status()).file_hash)
        changed_binding = result.agent_host
        assert changed_binding is not None and changed_binding.sessions is not None
        with pytest.raises(AgentSessionError) as changed:
            await changed_binding.sessions.reopen_session(record.session_id)
        assert changed.value.code == "runtime_binding_changed"
        _runtime(
            runtime_path,
            "https://old.example.test/mcp",
            host=moved.replace("fixture-target", "new-target"),
        )
        await manager.apply_host((await manager.host_status()).file_hash)
        changed_host = result.agent_host
        assert changed_host is not None and changed_host.sessions is not None
        assert await changed_host.sessions.list_sessions() == ()
        with pytest.raises(AgentSessionError) as changed_target:
            await changed_host.sessions.reopen_session(record.session_id)
        assert changed_target.value.code == "session_not_found"
        assert await repository.get(record.session_id) == record


async def test_file_changes_preserve_current_database_references(
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://old.example.test/mcp")
    bridge_session, agent_id = await _populated_database(tmp_path / "gateway.db")

    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        before = await result.gateway_management.topology_reader.read_snapshot()
        assert before.endpoints[0].endpoint_id == bridge_session.endpoint_id
        assert (
            before.endpoints[0].current_revision.revision_id == bridge_session.endpoint_revision_id
        )
        assert (await manager.status()).applied_source == "runtime_file"

        _runtime(runtime_path, "https://new.example.test/mcp")
        pending = await manager.status()
        assert pending.pending and pending.file_valid
        applied = await manager.apply(pending.file_hash)
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
    _runtime(runtime_path, "https://old.example.test/mcp")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        initial = await manager.status()
        published = result.gateway.published_endpoints[0]
        _runtime(runtime_path, "https://new.example.test/mcp")
        with pytest.raises(ConfigurationApplyError, match="changed") as conflict:
            await manager.apply(initial.file_hash)
        assert conflict.value.code == "configuration_conflict"
        assert result.gateway.published_endpoints[0] == published

        runtime_path.write_text("upstreams: [fixture-secret\n", encoding="utf-8")
        invalid = await manager.status()
        assert not invalid.file_valid and "fixture-secret" not in str(invalid.error)
        with pytest.raises(ConfigurationApplyError) as rejected:
            await manager.apply(invalid.file_hash)
        assert rejected.value.code == "configuration_invalid"
        assert result.gateway.published_endpoints[0] == published

        _runtime(runtime_path, "https://new.example.test/mcp")
        candidate = await manager.status()
        applied = await asyncio.gather(
            manager.apply(candidate.file_hash),
            manager.apply(candidate.file_hash),
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
    _runtime(runtime_path, "https://old.example.test/mcp")
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
        task = asyncio.create_task(manager.apply(candidate.file_hash))
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
    _runtime(runtime_path, "https://old.example.test/mcp")
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
                await manager.apply(candidate.file_hash)
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
            recovered = await manager.apply(status.file_hash)
            assert not recovered.recovery_required
            assert await result.gateway_management.is_ready()
        else:
            assert result.gateway.published_endpoints[0].revision.revision_number == 2
            assert status.applied_hash == candidate.desired_hash
            assert status.generation == 2 and not status.pending


async def test_recovery_rechecks_runtime_file_before_applying_a_candidate(
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
                await manager.apply(candidate.file_hash)
            runtime_path.unlink()
            unavailable = await manager.status()
            assert unavailable.recovery_required
            assert unavailable.desired_source == "unconfigured"
        with pytest.raises(ConfigurationApplyError) as conflict:
            await manager.apply(candidate.file_hash)
        assert conflict.value.code == "configuration_conflict"
        refreshed = await manager.status()
        assert refreshed.desired_source == "unconfigured"
        assert refreshed.file_hash is None and refreshed.pending
        await manager.apply(refreshed.file_hash)
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
            old_hash = initial.json()["file_hash"]
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
                json={"expected_hash": invalid.json()["file_hash"]},
            )
            assert rejected.status_code == 422 and "fixture-secret" not in rejected.text
            assert rejected.json()["code"] == "configuration_invalid"

            _runtime(runtime_path, "https://new.example.test/mcp")
            candidate = await client.get("/api/v1/gateway/configuration")
            applied = await client.post(
                "/api/v1/gateway/configuration/apply",
                json={"expected_hash": candidate.json()["file_hash"]},
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


async def test_missing_runtime_clears_publication_without_restoring_ledger_heads(
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


async def test_missing_host_endpoint_rejects_apply_and_invalid_first_start_degrades(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None and result.agent_host is not None
        _runtime(runtime_path, "https://new.example.test/mcp", endpoint="different", host=HOST)
        status = await manager.status()
        assert not status.file_valid
        with pytest.raises(ConfigurationApplyError, match="not published and enabled"):
            await manager.apply(status.file_hash)
        assert result.gateway.published_endpoints[0].revision.slug == "fixture"

    other = tmp_path / "first-start"
    other.mkdir()
    _static(other / "mabrid.yaml")
    (other / "mabrid.runtime.yaml").write_text(HOST + "endpoints: [invalid\n", encoding="utf-8")
    async with _running(other / "mabrid.yaml") as result:
        manager = result.gateway_management.configuration
        assert manager is not None and manager.has_error
        assert result.agent_host is None
        assert not await result.gateway_management.is_ready()


async def test_unconfigured_host_can_be_enabled_without_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    runtime_path.write_text(HOST, encoding="utf-8")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        unconfigured = await manager.status()
        assert unconfigured.file_valid and unconfigured.host_unavailable
        assert not unconfigured.restart_required
        assert result.agent_host is None

        _runtime(runtime_path, "https://new.example.test/mcp", host=HOST)
        status = await manager.status()
        applied = await manager.apply(status.file_hash)
        assert applied.host_unavailable and not applied.restart_required
        assert result.agent_host is None
        assert await result.gateway_management.is_ready()
        host_applied = await manager.apply_host(applied.file_hash)
        assert host_applied.enabled and not host_applied.pending
        assert result.agent_host is not None

    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None and result.agent_host is not None
        assert not (await manager.status()).host_unavailable


async def test_gateway_application_does_not_apply_changed_host(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    monkeypatch.setenv("FIXTURE_AGENT_KEY", "fixture-secret")
    _runtime(runtime_path, "https://old.example.test/mcp", host=HOST)
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None and result.agent_host is not None
        previous = result.gateway.published_endpoints[0]

        _runtime(runtime_path, "https://new.example.test/mcp", host=HOST)
        unchanged_host = await manager.status()
        assert unchanged_host.file_valid and not unchanged_host.restart_required
        _runtime(
            runtime_path,
            "https://new.example.test/mcp",
            host=HOST.replace("fixture-agent.invalid", "other-agent.invalid"),
        )
        status = await manager.status()
        assert status.file_valid and status.pending and not status.restart_required
        original_host = result.agent_host
        app = create_app(result.gateway, gateway_management=result.gateway_management)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/v1/gateway/configuration/apply",
                json={"expected_hash": status.file_hash},
            )
        assert response.status_code == 200
        assert result.agent_host is original_host
        assert result.gateway.published_endpoints[0] is not previous
        assert (await manager.status()).generation == unchanged_host.generation + 1
        assert (await manager.host_status()).pending
        await manager.apply_host(status.file_hash)
        assert result.agent_host is not original_host

        _runtime(runtime_path, "https://new.example.test/mcp", host=HOST)
        applied = await manager.apply((await manager.status()).file_hash)
        assert not applied.pending and not applied.restart_required
        assert result.gateway.published_endpoints[0] is not previous

    _runtime(runtime_path, "https://new.example.test/mcp")
    async with _running(config_path) as result:
        assert result.agent_host is None


async def test_disabled_host_changes_do_not_block_gateway_application(
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://old.example.test/mcp")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None and result.agent_host is None
        previous = result.gateway.published_endpoints[0]

        _runtime(
            runtime_path,
            "https://new.example.test/mcp",
            host="agentHost:\n  enabled: false\n  targetId: draft-target\n",
        )
        status = await manager.status()
        assert status.file_valid and status.pending and not status.restart_required
        await manager.apply(status.file_hash)
        assert result.gateway.published_endpoints[0] is not previous
        assert (await manager.host_status()).pending

        _runtime(runtime_path, "https://new.example.test/mcp", host="agentHost: {enabled: false}\n")
        applied = await manager.apply((await manager.status()).file_hash)
        assert not applied.pending and not applied.restart_required
        assert result.gateway.published_endpoints[0] is not previous


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
            await manager.apply(invalid.file_hash)


@pytest.mark.parametrize("key", ["upstreams", "endpoints"])
async def test_static_topology_keys_reject_apply_without_changing_publication(
    tmp_path: Path, key: str
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    _static(config_path)
    _runtime(tmp_path / "mabrid.runtime.yaml", "https://old.example.test/mcp")
    async with _running(config_path) as result:
        manager = result.gateway_management.configuration
        assert manager is not None
        previous = result.gateway.published_endpoints[0]
        config_path.write_text(
            config_path.read_text(encoding="utf-8") + f"\n{key}: {{}}\n", encoding="utf-8"
        )
        status = await manager.status()
        assert not status.file_valid and status.restart_required
        assert status.error and "Invalid process configuration" in status.error
        with pytest.raises(ConfigurationApplyError) as failure:
            await manager.apply(status.file_hash)
        assert failure.value.code == "configuration_invalid"
        assert result.gateway.published_endpoints[0] == previous


@pytest.mark.parametrize("collision", ["upstream", "endpoint"])
async def test_normalized_name_collisions_are_rejected_without_changing_heads(
    tmp_path: Path, collision: str
) -> None:
    config_path = tmp_path / "mabrid.yaml"
    runtime_path = tmp_path / "mabrid.runtime.yaml"
    _static(config_path)
    _runtime(runtime_path, "https://old.example.test/mcp")
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
            await manager.apply(status.file_hash)
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
            await manager.apply(status.file_hash)
        assert rejected.value.code == "configuration_ledger_error"
        assert result.gateway.published_endpoints[0] == current
        assert (await manager.status()).error is not None
