"""Observer port for application-owned bridge event handling."""

from __future__ import annotations

from typing import Protocol

from .observations import BridgeObservation


class BridgeObserver(Protocol):
    """Application observation sink consumed by routers and downstream handlers.

    Any object with async `observe(BridgeObservation)` satisfies this port.
    [NoOpBridgeObserver](observer.py) discards events; application projectors
    and composed observers supply persistence and Host presentation separately.
    """

    async def observe(self, event: BridgeObservation) -> None: ...


class NoOpBridgeObserver:
    """Structurally implement [BridgeObserver](observer.py) by discarding `observe` calls."""

    async def observe(self, event: BridgeObservation) -> None:
        return None
