"""Own the active Host client lifetime independently of Gateway topology revisions."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import anyio
from mabrid.bridge import BridgeObservation, BridgeObserver, ToolsPublished
from mabrid.application.gateway.sessions import BridgeSessionObserverFactory

from mabrid.server.logging import get_logger

from .agent_host import AgentHostComposition

logger = get_logger(__name__)


class HostRuntimeBusyError(RuntimeError):
    """Reject replacement while an admitted Host operation still owns its client."""


class AgentHostRuntime:
    """Serialize Host admission and idle-only replacement without client generations.

    HTTP adapters and observers retain an operation lease through their complete stream or
    callback. Replacement prepares the new composition before publishing it; failed preparation
    leaves the current composition intact. Durable Run checks belong to the configuration owner.
    """

    def __init__(self, current: AgentHostComposition | None = None) -> None:
        self._current = current
        self._operations = 0
        self._lock = anyio.Lock()

    @property
    def current(self) -> AgentHostComposition | None:
        return self._current

    @property
    def busy(self) -> bool:
        return self._operations > 0

    @asynccontextmanager
    async def operation(self) -> AsyncIterator[AgentHostComposition | None]:
        async with self._lock:
            self._operations += 1
            current = self._current
        try:
            yield current
        finally:
            with anyio.CancelScope(shield=True):
                async with self._lock:
                    self._operations -= 1

    async def replace(self, prepare: Callable[[], Awaitable[AgentHostComposition | None]]) -> None:
        async with self._lock:
            if self._operations:
                raise HostRuntimeBusyError("Host operations are in progress. Try applying later.")
            replacement = await prepare()
            previous = self._current
            self._current = replacement
            if previous is not None and previous is not replacement:
                with anyio.CancelScope(shield=True):
                    try:
                        await previous.close()
                    except Exception as exc:
                        logger.error("Retired Host cleanup failed (%s).", type(exc).__name__)

    async def close(self) -> None:
        async def disabled() -> None:
            return None

        await self.replace(disabled)


class ActiveHostObserverFactory:
    """Resolve Host projection for both existing and newly created Gateway Sessions.

    Structurally supplies the application BridgeSessionObserverFactory without making Gateway
    core depend on Host configuration. A callback lease prevents client retirement mid-projection.
    """

    def __init__(self, runtime: AgentHostRuntime) -> None:
        self._runtime = runtime

    def create(self, session_key: str, endpoint_slug: str) -> BridgeObserver:
        """Implement [BridgeSessionObserverFactory.create](../../../../../../packages/application/src/mabrid/application/gateway/sessions/observers.py:19)."""
        return _ActiveHostObserver(self._runtime, session_key, endpoint_slug)


class _ActiveHostObserver:
    """Forward each observation to the currently published Host's bounded projection."""

    def __init__(self, runtime: AgentHostRuntime, session_key: str, endpoint_slug: str) -> None:
        self._runtime = runtime
        self._session_key = session_key
        self._endpoint_slug = endpoint_slug
        self._factory: BridgeSessionObserverFactory | None = None
        self._observer: BridgeObserver | None = None
        self._tools: ToolsPublished | None = None

    async def observe(self, event: BridgeObservation) -> None:
        """Implement [BridgeObserver.observe](../../../../../../packages/bridge/src/mabrid/bridge/contracts/observer.py:18)."""
        if isinstance(event, ToolsPublished):
            self._tools = event
        async with self._runtime.operation() as current:
            factory = current.bridge_observer_factory if current is not None else None
            if factory is not self._factory:
                self._factory = factory
                self._observer = (
                    factory.create(self._session_key, self._endpoint_slug) if factory else None
                )
                if (
                    self._observer is not None
                    and self._tools is not None
                    and not isinstance(event, ToolsPublished)
                ):
                    await self._observer.observe(self._tools)
            if self._observer is not None:
                await self._observer.observe(event)
