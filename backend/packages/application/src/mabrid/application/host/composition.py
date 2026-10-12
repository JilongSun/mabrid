"""Typed process capability assembly; deployment resources remain server-owned."""

from dataclasses import dataclass

from ..agent_host import (
    AgentHostService,
    AgentToolActivityObserverFactory,
    InMemoryToolActivityStore,
    AgentSessionService,
    AgentSessionRepository,
    AgentRuntime,
    AgentTarget,
    AgentRunCoordinator,
    AgentOperationAttributionObserverFactory,
    InMemoryOperationRunAttributionRegistry,
    OperationRunAttributionRegistry,
    RuntimeSessionCatalog,
    RuntimeSessionHistory,
    RuntimeSessionExecution,
    RuntimeSessionRunControl,
    restore_target_run_ownership,
)
from ..mcp_apps import InMemoryWidgetEventStore, McpAppsLifecycleObserverFactory
from ..gateway.sessions import BridgeSessionObserverFactory
from .service import HostEventStream, HostSessionEventStream
from .settlement import HostRunSettlement, HostObservationFactory


@dataclass(frozen=True)
class NativeSessionPorts:
    """Bundle one deployment binding and separately typed native Session behaviors."""

    binding_id: str
    catalog: RuntimeSessionCatalog
    history: RuntimeSessionHistory
    execution: RuntimeSessionExecution
    control: RuntimeSessionRunControl


@dataclass(frozen=True)
class McpAppsComposition:
    """Pair process-local widget events with the factory that projects Gateway observations."""

    events: InMemoryWidgetEventStore
    bridge_observer_factory: McpAppsLifecycleObserverFactory


def compose_mcp_apps(
    endpoint_slug: str, operation_attributions: OperationRunAttributionRegistry
) -> McpAppsComposition:
    """Wire the attribution registry's read view to a widget writer and observer factory."""

    events = InMemoryWidgetEventStore()
    return McpAppsComposition(
        events=events,
        bridge_observer_factory=McpAppsLifecycleObserverFactory(
            endpoint_slug, operation_attributions, events
        ),
    )


@dataclass(frozen=True)
class HostCapabilityComposition:
    """Expose typed, shared Host capabilities without owning server deployment resources.

    [compose_host_capabilities](composition.py) shares one coordinator across
    native/compatibility ingress and connects structurally typed stores/factories.
    """

    agent_host: AgentHostService
    sessions: AgentSessionService | None
    attributions: InMemoryOperationRunAttributionRegistry
    bridge_observer_factory: HostObservationFactory
    mcp_apps: McpAppsComposition | None
    events: HostEventStream
    settlement: HostRunSettlement
    tool_activity: InMemoryToolActivityStore
    session_events: HostSessionEventStream | None


async def compose_host_capabilities(
    target: AgentTarget,
    runtime: AgentRuntime,
    repository: AgentSessionRepository,
    *,
    native: NativeSessionPorts | None = None,
    mcp_apps_enabled: bool = False,
    observer_timeout_seconds: float = 5.0,
    settlement_timeout_seconds: float = 5.0,
) -> HostCapabilityComposition:
    """Assemble structural ports and shared ownership, not deployment clients or secrets.

    Restore durable ownership first, then order attribution/activity/widget
    projection and expose reader views to [HostEventStream](service.py) and its
    native counterpart. [NativeSessionPorts](composition.py) may share one
    adapter object while retaining distinct behavior-oriented type boundaries.
    """

    coordinator = AgentRunCoordinator((target,))
    await restore_target_run_ownership(repository, coordinator, target.target_id)
    attributions = InMemoryOperationRunAttributionRegistry()
    tool_activity = InMemoryToolActivityStore()
    factories: list[BridgeSessionObserverFactory] = [
        AgentOperationAttributionObserverFactory(coordinator, attributions),
        AgentToolActivityObserverFactory(attributions, tool_activity),
    ]
    apps = (
        compose_mcp_apps(target.endpoint_assignment.endpoint_slug, attributions)
        if mcp_apps_enabled
        else None
    )
    if apps is not None:
        factories.append(apps.bridge_observer_factory)
    settlement = HostRunSettlement(
        apps.events if apps is not None else None, timeout_seconds=settlement_timeout_seconds
    )
    service = AgentHostService(target, runtime, coordinator, settlement)
    sessions = (
        AgentSessionService(
            target_id=target.target_id,
            runtime_binding_id=native.binding_id,
            repository=repository,
            catalog=native.catalog,
            history=native.history,
            execution=native.execution,
            control=native.control,
            coordinator=coordinator,
            settlement=settlement,
        )
        if native is not None
        else None
    )
    return HostCapabilityComposition(
        agent_host=service,
        sessions=sessions,
        attributions=attributions,
        bridge_observer_factory=HostObservationFactory(
            coordinator,
            attributions,
            settlement,
            factories,
            timeout_seconds=observer_timeout_seconds,
        ),
        mcp_apps=apps,
        events=HostEventStream(
            service, apps.events if apps is not None else None, settlement, tool_activity
        ),
        settlement=settlement,
        tool_activity=tool_activity,
        session_events=HostSessionEventStream(
            sessions, apps.events if apps is not None else None, settlement, tool_activity
        )
        if sessions is not None
        else None,
    )
