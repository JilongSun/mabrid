from __future__ import annotations

from pathlib import Path

import pytest
from mabrid.application.gateway.sessions import BridgeSessionRecord
from mabrid.application.gateway.sessions.publication import PublishedTopology
from mabrid.application.gateway.topology import (
    EndpointBinding,
    EndpointDefinition,
    StreamableHttpConnection,
    UpstreamServerDefinition,
)
from pydantic import AnyHttpUrl
from sqlalchemy import func, select

from mabrid.server.persistence import SqliteDatabase
from mabrid.server.persistence.schema import (
    EndpointRevisionRow,
    UpstreamRevisionRow,
)
from mabrid.server.persistence.sessions import SqlAlchemyBridgeSessionRepository
from mabrid.server.persistence.topology import (
    SqlAlchemyTopologySnapshotReader,
    reconcile_topology,
    seed_topology_if_empty,
)


def _topology(
    url: str, *, enabled: bool = True
) -> tuple[list[UpstreamServerDefinition], list[EndpointDefinition]]:
    upstream = UpstreamServerDefinition(
        slug="fixture",
        display_name="Fixture",
        connection=StreamableHttpConnection(url=AnyHttpUrl(url)),
        enabled=enabled,
    )
    endpoint = EndpointDefinition(
        slug="fixture",
        display_name="Fixture",
        bindings=[EndpointBinding(upstream_server_id=upstream.server_id)],
    )
    return [upstream], [endpoint]


async def test_reconciliation_preserves_seeded_identities_and_revision_history(
    tmp_path: Path,
) -> None:
    database = SqliteDatabase(tmp_path / "topology.db")
    await database.migrate()
    try:
        upstreams, endpoints = _topology("https://old.example.test/mcp")
        await seed_topology_if_empty(database.session_factory, upstreams, endpoints)
        reader = SqlAlchemyTopologySnapshotReader(database.session_factory)
        initial = await reader.read_snapshot()
        endpoint = initial.endpoints[0]
        session = BridgeSessionRecord(
            endpoint_id=endpoint.endpoint_id,
            endpoint_revision_id=endpoint.current_revision.revision_id,
        )
        repository = SqlAlchemyBridgeSessionRepository(database.session_factory)
        await repository.add(session)

        async with database.session_factory.begin() as transaction:
            same = await reconcile_topology(transaction, *_topology("https://old.example.test/mcp"))
            PublishedTopology.prepare(same.revisions)
        assert same.changed is False
        assert await reader.read_snapshot() == initial

        async with database.session_factory.begin() as transaction:
            updated = await reconcile_topology(
                transaction, *_topology("https://new.example.test/mcp")
            )
            PublishedTopology.prepare(updated.revisions)
        current = await reader.read_snapshot()
        assert updated.changed is True
        assert current.upstreams[0].server_id == initial.upstreams[0].server_id
        assert current.endpoints[0].endpoint_id == endpoint.endpoint_id
        assert current.endpoints[0].bindings[0].binding_id == endpoint.bindings[0].binding_id
        assert current.upstreams[0].current_revision.revision_number == 2
        assert current.endpoints[0].current_revision.revision_number == 2
        assert (
            current.endpoints[0].bindings[0].upstream_revision_id
            == current.upstreams[0].current_revision.revision_id
        )
        assert (await repository.get(session.session_id)) == session

        async with database.session_factory.begin() as transaction:
            retired = await reconcile_topology(transaction, [], [])
            PublishedTopology.prepare(retired.revisions)
        disabled = await reader.read_snapshot()
        assert not disabled.upstreams[0].enabled
        assert not disabled.endpoints[0].enabled
        assert (await repository.get(session.session_id)) == session

        async with database.session_factory.begin() as transaction:
            restored = await reconcile_topology(
                transaction, *_topology("https://new.example.test/mcp")
            )
            PublishedTopology.prepare(restored.revisions)
        reenabled = await reader.read_snapshot()
        assert reenabled.upstreams[0].server_id == initial.upstreams[0].server_id
        assert reenabled.endpoints[0].endpoint_id == endpoint.endpoint_id
        assert reenabled.endpoints[0].bindings[0].binding_id == endpoint.bindings[0].binding_id
        assert reenabled.upstreams[0].enabled and reenabled.endpoints[0].enabled
        assert (await repository.get(session.session_id)) == session
    finally:
        await database.close()


async def test_invalid_candidate_rolls_back_all_head_and_revision_changes(tmp_path: Path) -> None:
    database = SqliteDatabase(tmp_path / "topology.db")
    await database.migrate()
    try:
        await seed_topology_if_empty(
            database.session_factory, *_topology("https://old.example.test/mcp")
        )
        reader = SqlAlchemyTopologySnapshotReader(database.session_factory)
        initial = await reader.read_snapshot()

        with pytest.raises(ValueError, match="disabled upstream"):
            async with database.session_factory.begin() as transaction:
                candidate = await reconcile_topology(
                    transaction, *_topology("https://new.example.test/mcp", enabled=False)
                )
                PublishedTopology.prepare(candidate.revisions)

        assert await reader.read_snapshot() == initial
        async with database.session_factory() as session:
            assert await session.scalar(select(func.count()).select_from(UpstreamRevisionRow)) == 1
            assert await session.scalar(select(func.count()).select_from(EndpointRevisionRow)) == 1
    finally:
        await database.close()
