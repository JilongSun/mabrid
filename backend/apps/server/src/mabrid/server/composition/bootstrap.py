"""Top-level resource assembly for one deployable Mabrid server process.

Bootstrap owns migration and composition failure cleanup. Long-running Gateway and HTTP lifecycles
start later in the server runtime and close in reverse ownership order.
"""

from __future__ import annotations

from dataclasses import dataclass
import anyio

from mabrid.application.gateway.sessions import (
    GatewaySessionCoordinator,
)
from mabrid.application.host import HostEventStream, McpAppsComposition

from mabrid.server.config import RuntimeConfiguration
from mabrid.server.logging import get_logger
from mabrid.server.persistence import SqliteDatabase

from .agent_host import AgentHostComposition, HostConfigurationError, compose_agent_host
from .gateway import GatewayManagementComposition, compose_gateway
from .host_runtime import ActiveHostObserverFactory, AgentHostRuntime

logger = get_logger(__name__)


@dataclass(frozen=True)
class BootstrapResult:
    """Return composed process resources and typed surfaces for later runtime startup."""

    gateway: GatewaySessionCoordinator
    gateway_management: GatewayManagementComposition
    database: SqliteDatabase
    host_runtime: AgentHostRuntime

    @property
    def agent_host(self) -> AgentHostComposition | None:
        return self.host_runtime.current

    @property
    def mcp_apps(self) -> McpAppsComposition | None:
        current = self.agent_host
        return current.capabilities.mcp_apps if current is not None else None

    @property
    def host_events(self) -> HostEventStream | None:
        current = self.agent_host
        return current.capabilities.events if current is not None else None


async def bootstrap_server(configuration: RuntimeConfiguration) -> BootstrapResult:
    """Own migrations, resource construction, and failure cleanup before HTTP serving.

    Gateway observers come from the Host factory's structural `create` contract;
    later runtime startup owns live task groups. Failures close clients then DB.
    """

    database = SqliteDatabase(configuration.storage.sqlite_path)
    logger.info("SQLite database opened: %s", configuration.storage.sqlite_path)
    agent_host: AgentHostComposition | None = None
    try:
        if configuration.storage.auto_migrate:
            logger.info("Running database migrations")
            await database.migrate()
        gateway = await compose_gateway(configuration, database)
        manager = gateway.management.configuration
        target_slug = configuration.agent_host.endpoint_slug
        if configuration.host_error is not None:
            logger.error("Agent Host not started: %s", configuration.host_error)
            if manager is not None:
                manager.mark_host_unavailable()
        elif (
            manager is not None
            and configuration.agent_host.enabled
            and (
                target_slug is None
                or gateway.runtime.resolve_published_endpoint(target_slug) is None
            )
        ):
            logger.error("Agent Host not started: its assigned endpoint is unavailable.")
            manager.mark_host_unavailable()
        else:
            try:
                agent_host = await compose_agent_host(configuration, gateway.runtime, database)
            except HostConfigurationError as exc:
                logger.error("Agent Host not started: %s", exc)
                if manager is not None:
                    manager.mark_host_unavailable(str(exc))
        host_runtime = AgentHostRuntime(agent_host)
        if manager is not None:
            manager.bind_host_runtime(host_runtime)
        gateway.runtime.configure_session_observer_factory(ActiveHostObserverFactory(host_runtime))
    except BaseException:
        logger.exception("Bootstrap failed - closing composed resources")
        with anyio.CancelScope(shield=True):
            try:
                if agent_host is not None:
                    await agent_host.close()
            finally:
                await database.close()
        raise
    return BootstrapResult(
        gateway=gateway.runtime,
        gateway_management=gateway.management,
        database=database,
        host_runtime=host_runtime,
    )
