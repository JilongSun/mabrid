"""Application-owned composition for bridge observation consumers."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from mabrid.bridge import BridgeObservation, BridgeObserver


class BridgeSessionObserverFactory(Protocol):
    """Supply an optional core observer when a Gateway Session is created.

    `create(session_key, endpoint_slug)` is the structural factory shape consumed
    by the coordinator. [CompositeBridgeSessionObserverFactory](observers.py:22)
    and Host/MCP Apps factories fulfill it without inheriting this Protocol.
    """

    def create(self, session_key: str, endpoint_slug: str) -> BridgeObserver | None: ...


class CompositeBridgeSessionObserverFactory:
    """Structurally implement [BridgeSessionObserverFactory](observers.py:11) by ordered fan-out.

    `create` skips absent observers and returns a composite only when at least one
    factory applies. Construction requires at least one configured factory.
    """

    def __init__(self, factories: Iterable[BridgeSessionObserverFactory]) -> None:
        self._factories = tuple(factories)
        if not self._factories:
            raise ValueError(
                "Composite bridge session observer factory requires at least one factory"
            )

    def create(self, session_key: str, endpoint_slug: str) -> BridgeObserver | None:
        """Implement [BridgeSessionObserverFactory.create](observers.py:19)."""
        observers = tuple(
            observer
            for factory in self._factories
            if (observer := factory.create(session_key, endpoint_slug)) is not None
        )
        if not observers:
            return None
        return CompositeBridgeObserver(observers)


class CompositeBridgeObserver:
    """Supply async `observe` structurally by invoking observers in configured order.

    This simple composition propagates failures; Host's bounded observer wrapper
    applies its own isolation policy rather than changing this core sink shape.

    Contract: [BridgeObserver](../../../../../../bridge/src/mabrid/bridge/contracts/observer.py:10).
    """

    def __init__(self, observers: Iterable[BridgeObserver]) -> None:
        self._observers = tuple(observers)
        if not self._observers:
            raise ValueError("Composite bridge observer requires at least one observer")

    async def observe(self, event: BridgeObservation) -> None:
        """Implement [BridgeObserver.observe](../../../../../../bridge/src/mabrid/bridge/contracts/observer.py:18)."""
        for observer in self._observers:
            await observer.observe(event)
