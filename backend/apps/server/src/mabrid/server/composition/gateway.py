"""Compose the managed Gateway application with SQLite and bridge-core adapters.

This module injects infrastructure ports and composes the running Gateway.
"""

from __future__ import annotations

from dataclasses import dataclass

from mabrid.application.gateway.inspection import SessionInspectionReader
from mabrid.application.gateway.sessions import (
    GatewaySessionCoordinator,
    SessionHistoryReader,
)
from mabrid.application.gateway.topology import TopologySnapshotReader

from mabrid.server.config import RuntimeConfiguration
from mabrid.server.logging import get_logger
from mabrid.server.persistence import SqliteDatabase, SqliteReadinessProbe
from mabrid.server.persistence.sessions import (
    SqlAlchemyBridgeSessionRepository,
    SqlAlchemyBridgeSessionStoreFactory,
    SqlAlchemySessionHistoryReader,
    SqlAlchemySessionInspectionReader,
    mark_interrupted_sessions_failed,
)
from mabrid.server.persistence.topology import (
    SqlAlchemyTopologyReader,
    SqlAlchemyTopologySnapshotReader,
)

from .configuration import RuntimeConfigurationManager

logger = get_logger(__name__)


@dataclass(frozen=True)
class GatewayManagementComposition:
    """Bundle typed management reads and local readiness evidence for HTTP adapters.

    Readers are structural port implementations built by [compose_gateway](gateway.py:73).
    The async bound `is_ready` method supplies the readiness callback; no reader
    exposes SQLAlchemy, YAML, or lifecycle mutation to the API layer.
    """

    topology_reader: TopologySnapshotReader
    session_history_reader: SessionHistoryReader
    session_inspection_reader: SessionInspectionReader
    readiness_probe: SqliteReadinessProbe
    advertised_base_url: str | None
    published_endpoint_slugs: tuple[str, ...]
    configuration: RuntimeConfigurationManager | None = None

    async def is_ready(self) -> bool:
        return (
            bool(self.current_published_endpoint_slugs()) and await self.readiness_probe.is_ready()
        )

    def current_published_endpoint_slugs(self) -> tuple[str, ...]:
        if self.configuration is not None:
            return self.configuration.published_endpoint_slugs
        return self.published_endpoint_slugs


@dataclass(frozen=True)
class GatewayComposition:
    """Pair the live coordinator with its separate read-only management dependencies."""

    runtime: GatewaySessionCoordinator
    management: GatewayManagementComposition


async def compose_gateway(
    configuration: RuntimeConfiguration,
    database: SqliteDatabase,
) -> GatewayComposition:
    """Reconcile topology, recover lifecycle history, and inject application ports.

    [GatewaySessionCoordinator](../../../../../../packages/application/src/mabrid/application/gateway/sessions/service.py:52)
    receives runtime readers/stores; management receives distinct all-heads and
    paginated reader views. This function owns construction, not their use cases.
    """

    await mark_interrupted_sessions_failed(database.session_factory)
    topology_reader = SqlAlchemyTopologyReader(database.session_factory)
    session_repository = SqlAlchemyBridgeSessionRepository(database.session_factory)
    session_store_factory = SqlAlchemyBridgeSessionStoreFactory(database.session_factory)
    coordinator = GatewaySessionCoordinator(
        topology_reader,
        session_repository,
        session_store_factory,
    )
    configuration_manager = RuntimeConfigurationManager(configuration, database, coordinator)
    await configuration_manager.initialize()
    return GatewayComposition(
        runtime=coordinator,
        management=GatewayManagementComposition(
            topology_reader=SqlAlchemyTopologySnapshotReader(database.session_factory),
            session_history_reader=SqlAlchemySessionHistoryReader(database.session_factory),
            session_inspection_reader=SqlAlchemySessionInspectionReader(database.session_factory),
            readiness_probe=SqliteReadinessProbe(database.session_factory),
            advertised_base_url=configuration.bridge.advertised_base_url,
            published_endpoint_slugs=tuple(
                endpoint.revision.slug for endpoint in coordinator.published_endpoints
            ),
            configuration=configuration_manager,
        ),
    )
