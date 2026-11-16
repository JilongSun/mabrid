"""Reconcile one complete file-backed Gateway topology in a caller-owned transaction."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

from mabrid.application.gateway.topology import (
    EndpointBinding,
    EndpointDefinition,
    EndpointTopologyRevision,
    UpstreamRevision,
    UpstreamServerDefinition,
)
from mabrid.bridge import EndpointMode
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..schema import (
    EndpointBindingRevisionRow,
    EndpointBindingRow,
    EndpointRevisionRow,
    EndpointRow,
    UpstreamRevisionRow,
    UpstreamServerRow,
)
from .mappers import (
    binding_to_row,
    endpoint_head_to_row,
    endpoint_revision_to_row,
    upstream_head_to_row,
    upstream_revision_from_row,
    upstream_revision_to_row,
)
from .reader import _revision_from_row


@dataclass(frozen=True)
class ReconciledTopology:
    """Return candidate revisions before the transaction commits and publication changes."""

    revisions: tuple[EndpointTopologyRevision, ...]
    changed: bool


class TopologyLedgerError(ValueError):
    """Report inconsistent persistent heads without exposing connection values."""


async def reconcile_topology(
    session: AsyncSession,
    upstreams: list[UpstreamServerDefinition],
    endpoints: list[EndpointDefinition],
) -> ReconciledTopology:
    """Update heads and immutable revisions without deleting historical Session references."""
    desired_upstreams = {item.slug: item for item in upstreams}
    desired_endpoints = {item.slug: item for item in endpoints}
    if len(desired_upstreams) != len(upstreams) or len(desired_endpoints) != len(endpoints):
        raise ValueError("Topology contains duplicate normalized object identities")

    upstream_heads = {row.slug: row for row in await session.scalars(select(UpstreamServerRow))}
    upstream_ids: dict[UUID, UUID] = {}
    current_upstreams: dict[UUID, UpstreamRevision] = {}
    changed = False

    for slug, desired in desired_upstreams.items():
        head = upstream_heads.get(slug)
        canonical = desired.model_copy(
            update={
                "server_id": head.server_id if head is not None else desired.server_id,
                "metadata": head.metadata_json if head is not None else desired.metadata,
            }
        )
        upstream_ids[desired.server_id] = canonical.server_id
        revision, updated = await _reconcile_upstream(session, head, canonical)
        current_upstreams[canonical.server_id] = revision
        changed |= updated

    for slug, head in upstream_heads.items():
        if slug in desired_upstreams:
            continue
        current = await _require_upstream_revision(session, head)
        retired = UpstreamServerDefinition(
            server_id=head.server_id,
            slug=head.slug,
            display_name=head.display_name,
            connection=current.connection,
            enabled=False,
            metadata=head.metadata_json,
        )
        revision, updated = await _reconcile_upstream(session, head, retired)
        current_upstreams[head.server_id] = revision
        changed |= updated

    endpoint_heads = {row.slug: row for row in await session.scalars(select(EndpointRow))}
    published: list[EndpointTopologyRevision] = []
    for slug, desired in desired_endpoints.items():
        head = endpoint_heads.get(slug)
        bindings = await _desired_bindings(session, head, desired.bindings, upstream_ids)
        canonical = desired.model_copy(
            update={
                "endpoint_id": head.endpoint_id if head is not None else desired.endpoint_id,
                "metadata": head.metadata_json if head is not None else desired.metadata,
                "bindings": bindings,
            }
        )
        revision, updated = await _reconcile_endpoint(session, head, canonical, current_upstreams)
        changed |= updated
        if canonical.enabled:
            published.append(await _revision_from_row(session, revision))

    for slug, head in endpoint_heads.items():
        if slug in desired_endpoints:
            continue
        bindings = [
            EndpointBinding(
                binding_id=row.binding_id,
                upstream_server_id=row.upstream_server_id,
                namespace=row.namespace,
                priority=row.priority,
                enabled=row.enabled,
            )
            for row in await _current_bindings(session, head.endpoint_id)
        ]
        retired = EndpointDefinition(
            endpoint_id=head.endpoint_id,
            slug=head.slug,
            display_name=head.display_name,
            mode=EndpointMode(head.mode),
            bindings=bindings,
            enabled=False,
            metadata=head.metadata_json,
        )
        _, updated = await _reconcile_endpoint(session, head, retired, current_upstreams)
        changed |= updated

    return ReconciledTopology(tuple(published), changed)


async def _require_upstream_revision(
    session: AsyncSession, head: UpstreamServerRow
) -> UpstreamRevision:
    if head.current_revision_id is None:
        raise TopologyLedgerError(f"Upstream has no current revision: {head.server_id}")
    row = await session.get(UpstreamRevisionRow, head.current_revision_id)
    if row is None or row.server_id != head.server_id:
        raise TopologyLedgerError(f"Invalid current upstream revision: {head.server_id}")
    fields = ("slug", "display_name", "transport", "enabled", "metadata_json")
    if row.transport == "stdio":
        fields += ("command", "args_json", "cwd", "env_json")
    elif row.transport == "sse":
        fields += ("url", "headers_json")
    elif row.transport == "streamable-http":
        fields += ("url", "headers_json", "timeout_seconds")
    if any(getattr(head, field) != getattr(row, field) for field in fields):
        raise TopologyLedgerError(
            f"Upstream head differs from its current revision: {head.server_id}"
        )
    return upstream_revision_from_row(row)


async def _reconcile_upstream(
    session: AsyncSession,
    head: UpstreamServerRow | None,
    desired: UpstreamServerDefinition,
) -> tuple[UpstreamRevision, bool]:
    current = await _require_upstream_revision(session, head) if head is not None else None
    if current is not None and (
        current.slug == desired.slug
        and current.display_name == desired.display_name
        and current.connection == desired.connection
        and current.enabled == desired.enabled
        and current.metadata == desired.metadata
    ):
        return current, False

    replacement = upstream_head_to_row(desired)
    if head is None:
        head = replacement
        session.add(head)
        await session.flush()
    else:
        head.display_name = replacement.display_name
        head.transport = replacement.transport
        head.url = replacement.url
        head.command = replacement.command
        head.args_json = replacement.args_json or []
        head.cwd = replacement.cwd
        head.env_json = replacement.env_json or {}
        head.headers_json = replacement.headers_json or {}
        head.timeout_seconds = replacement.timeout_seconds
        head.enabled = replacement.enabled
        head.metadata_json = replacement.metadata_json
    revision = upstream_revision_to_row(desired, uuid4())
    revision.revision_number = current.revision_number + 1 if current is not None else 1
    session.add(revision)
    await session.flush()
    head.current_revision_id = revision.revision_id
    return upstream_revision_from_row(revision), True


async def _current_bindings(session: AsyncSession, endpoint_id: UUID) -> list[EndpointBindingRow]:
    return list(
        await session.scalars(
            select(EndpointBindingRow)
            .where(EndpointBindingRow.endpoint_id == endpoint_id)
            .order_by(EndpointBindingRow.binding_id)
        )
    )


async def _desired_bindings(
    session: AsyncSession,
    head: EndpointRow | None,
    desired: list[EndpointBinding],
    upstream_ids: dict[UUID, UUID],
) -> list[EndpointBinding]:
    remaining = await _current_bindings(session, head.endpoint_id) if head is not None else []
    result: list[EndpointBinding] = []
    for binding in desired:
        server_id = upstream_ids[binding.upstream_server_id]
        exact = [
            row
            for row in remaining
            if row.upstream_server_id == server_id and row.namespace == binding.namespace
        ]
        candidates = [row for row in remaining if row.upstream_server_id == server_id]
        match = exact[0] if exact else candidates[0] if len(candidates) == 1 else None
        if match is not None:
            remaining.remove(match)
        result.append(
            binding.model_copy(
                update={
                    "binding_id": match.binding_id if match is not None else binding.binding_id,
                    "upstream_server_id": server_id,
                }
            )
        )
    return result


async def _reconcile_endpoint(
    session: AsyncSession,
    head: EndpointRow | None,
    desired: EndpointDefinition,
    upstreams: dict[UUID, UpstreamRevision],
) -> tuple[EndpointRevisionRow, bool]:
    current: EndpointRevisionRow | None = None
    current_bindings: list[EndpointBindingRow] = []
    if head is not None:
        if head.current_revision_id is None:
            raise TopologyLedgerError(f"Endpoint has no current revision: {head.endpoint_id}")
        current = await session.get(EndpointRevisionRow, head.current_revision_id)
        if current is None or current.endpoint_id != head.endpoint_id:
            raise TopologyLedgerError(f"Invalid current endpoint revision: {head.endpoint_id}")
        fields = ("slug", "display_name", "mode", "enabled", "metadata_json")
        if any(getattr(head, field) != getattr(current, field) for field in fields):
            raise TopologyLedgerError(
                f"Endpoint head differs from its current revision: {head.endpoint_id}"
            )
        current_bindings = await _current_bindings(session, head.endpoint_id)

    desired_binding_values = {
        binding.binding_id: (
            upstreams[binding.upstream_server_id].revision_id,
            binding.namespace,
            binding.priority,
            binding.enabled,
        )
        for binding in desired.bindings
    }
    current_binding_values: dict[UUID, tuple[UUID, str | None, int, bool]] = {}
    if current is not None:
        rows = (
            await session.scalars(
                select(EndpointBindingRevisionRow).where(
                    EndpointBindingRevisionRow.endpoint_revision_id == current.revision_id
                )
            )
        ).all()
        current_binding_values = {
            row.binding_id: (row.upstream_revision_id, row.namespace, row.priority, row.enabled)
            for row in rows
        }
        revision_bindings: dict[UUID, tuple[UUID, str | None, int, bool]] = {}
        for row in rows:
            upstream = await session.get(UpstreamRevisionRow, row.upstream_revision_id)
            if upstream is None:
                raise TopologyLedgerError(
                    f"Endpoint has an invalid upstream revision: {current.endpoint_id}"
                )
            revision_bindings[row.binding_id] = (
                upstream.server_id,
                row.namespace,
                row.priority,
                row.enabled,
            )
        head_bindings = {
            row.binding_id: (row.upstream_server_id, row.namespace, row.priority, row.enabled)
            for row in current_bindings
        }
        if revision_bindings != head_bindings:
            raise TopologyLedgerError(
                f"Endpoint bindings differ from its current revision: {current.endpoint_id}"
            )
    if current is not None and (
        current.slug == desired.slug
        and current.display_name == desired.display_name
        and current.mode == desired.mode.value
        and current.enabled == desired.enabled
        and current.metadata_json == desired.metadata
        and current_binding_values == desired_binding_values
    ):
        return current, False

    if head is None:
        head = endpoint_head_to_row(desired)
        session.add(head)
        await session.flush()
    else:
        head.display_name = desired.display_name
        head.mode = desired.mode.value
        head.enabled = desired.enabled
        head.metadata_json = desired.metadata

    previous_by_id = {row.binding_id: row for row in current_bindings}
    desired_ids = {binding.binding_id for binding in desired.bindings}
    for row in current_bindings:
        if row.binding_id not in desired_ids:
            await session.delete(row)
    for binding in desired.bindings:
        row = previous_by_id.get(binding.binding_id)
        if row is None:
            session.add(binding_to_row(desired.endpoint_id, binding))
        else:
            row.upstream_server_id = binding.upstream_server_id
            row.namespace = binding.namespace
            row.priority = binding.priority
            row.enabled = binding.enabled

    revision = endpoint_revision_to_row(desired, uuid4())
    revision.revision_number = current.revision_number + 1 if current is not None else 1
    session.add(revision)
    await session.flush()
    session.add_all(
        EndpointBindingRevisionRow(
            binding_revision_id=uuid4(),
            binding_id=binding.binding_id,
            endpoint_revision_id=revision.revision_id,
            upstream_revision_id=upstreams[binding.upstream_server_id].revision_id,
            namespace=binding.namespace,
            priority=binding.priority,
            enabled=binding.enabled,
        )
        for binding in desired.bindings
    )
    head.current_revision_id = revision.revision_id
    await session.flush()
    return revision, True
