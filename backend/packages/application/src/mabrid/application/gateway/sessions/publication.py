"""Publication of immutable Gateway endpoint revisions.

Published topology owns atomic index replacement and slug lookup, but no live Sessions,
transport correlation, or persistence mutation.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from uuid import UUID

from mabrid.bridge import EndpointPlan

from ..topology.ports import TopologyReader
from ..topology.revisions import EndpointTopologyRevision, build_endpoint_plan_from_revision

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PublishedEndpoint:
    """Pair a captured endpoint revision with its executable core plan and stable path."""

    revision: EndpointTopologyRevision
    plan: EndpointPlan

    @property
    def path(self) -> str:
        return f"/mcp/{self.revision.slug}"


@dataclass(frozen=True)
class PublishedTopologySnapshot:
    """Keep a complete publication index together for an atomic replacement."""

    endpoints: tuple[PublishedEndpoint, ...]
    by_slug: Mapping[str, PublishedEndpoint]


class PublishedTopology:
    """Publish complete endpoint indexes without changing captured Session plans.

    Consume [TopologyReader](../topology/ports.py:12) structurally through
    `list_current_revisions`. Candidate snapshots are validated before publication;
    this is not a live database view or the all-heads management topology snapshot.
    """

    def __init__(self, reader: TopologyReader) -> None:
        self._reader = reader
        self._snapshot = PublishedTopologySnapshot((), MappingProxyType({}))

    @property
    def endpoints(self) -> list[PublishedEndpoint]:
        return list(self._snapshot.endpoints)

    async def load(self) -> None:
        revisions = await self._reader.list_current_revisions()
        self.publish(self.prepare(revisions))

    @classmethod
    def prepare(cls, revisions: Sequence[EndpointTopologyRevision]) -> PublishedTopologySnapshot:
        """Validate and materialize an entire candidate before it becomes visible."""
        logger.info("Loading %d published endpoint(s) from topology", len(revisions))
        endpoints: list[PublishedEndpoint] = []
        by_slug: dict[str, PublishedEndpoint] = {}
        endpoint_ids: set[UUID] = set()
        for revision in revisions:
            if revision.endpoint_id in endpoint_ids or revision.slug in by_slug:
                raise ValueError(f"Duplicate published endpoint identity: {revision.slug}")
            published = cls._materialize(revision)
            bindings = [binding for binding in revision.bindings if binding.enabled]
            logger.info(
                "Published endpoint: slug=%s display_name=%s mode=%s upstreams=%s",
                revision.slug,
                revision.display_name,
                revision.mode.value,
                [binding.upstream.display_name for binding in bindings],
            )
            endpoint_ids.add(revision.endpoint_id)
            endpoints.append(published)
            by_slug[revision.slug] = published
        return PublishedTopologySnapshot(tuple(endpoints), MappingProxyType(by_slug))

    def publish(self, snapshot: PublishedTopologySnapshot) -> None:
        self._snapshot = snapshot

    def resolve(self, slug: str) -> PublishedEndpoint | None:
        return self._snapshot.by_slug.get(slug)

    @staticmethod
    def _materialize(revision: EndpointTopologyRevision) -> PublishedEndpoint:
        if not revision.enabled:
            raise ValueError(f"Cannot publish disabled endpoint: {revision.slug}")
        disabled_upstreams = [
            binding.upstream.slug
            for binding in revision.bindings
            if binding.enabled and not binding.upstream.enabled
        ]
        if disabled_upstreams:
            names = ", ".join(sorted(disabled_upstreams))
            raise ValueError(f"Cannot bind disabled upstream servers: {names}")
        return PublishedEndpoint(
            revision=revision,
            plan=build_endpoint_plan_from_revision(revision),
        )
