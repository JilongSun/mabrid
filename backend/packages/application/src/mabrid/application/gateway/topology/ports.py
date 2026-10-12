"""Persistence ports required by managed topology use cases."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from .management import TopologySnapshot
from .revisions import EndpointTopologyRevision


class TopologyReader(Protocol):
    """Load executable endpoint revisions for [GatewaySessionCoordinator](../sessions/service.py).

    `list_current_revisions` selects enabled publication; slug and revision lookups
    support Session creation. Server persistence supplies this port structurally,
    not the all-heads management view of [TopologySnapshotReader](ports.py).
    """

    async def list_current_revisions(self) -> list[EndpointTopologyRevision]: ...

    async def resolve_current_revision(
        self,
        endpoint_slug: str,
    ) -> EndpointTopologyRevision | None: ...

    async def get_revision(self, revision_id: UUID) -> EndpointTopologyRevision | None: ...


class TopologySnapshotReader(Protocol):
    """Read all current managed heads consistently through `read_snapshot`.

    The server SQL adapter supplies this shape in one read transaction, including
    disabled definitions; it is distinct from runtime [TopologyReader](ports.py).
    """

    async def read_snapshot(self) -> TopologySnapshot: ...
