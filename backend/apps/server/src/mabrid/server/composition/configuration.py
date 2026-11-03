"""Own serialized file-backed Gateway configuration application for one process."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

import anyio
from mabrid.application.gateway.sessions import GatewaySessionCoordinator
from sqlalchemy.exc import SQLAlchemyError

from mabrid.server.config import (
    ConfigError,
    RuntimeConfiguration,
    RuntimeTopologyCandidate,
    load_runtime_topology,
    read_process_signature,
)
from mabrid.server.logging import get_logger
from mabrid.server.persistence import SqliteDatabase
from mabrid.server.persistence.schema import GatewayConfigurationStateRow
from mabrid.server.persistence.topology import TopologyLedgerError, reconcile_topology

from .topology import TopologyConfigurationError, build_topology_definitions

logger = get_logger(__name__)


@dataclass(frozen=True)
class GatewayConfigurationStatus:
    """Distinguish the running publication from the currently selected file."""

    generation: int
    applied_at: datetime
    applied_hash: str | None
    applied_source: str
    desired_hash: str | None
    desired_source: str
    file_valid: bool
    pending: bool
    error: str | None
    restart_required: bool
    host_unavailable: bool
    recovery_required: bool


class ConfigurationStorageError(RuntimeError):
    """Report a database failure without exposing SQL parameters or connection values."""


class ConfigurationApplyError(RuntimeError):
    """Report a safe invalid-candidate or stale-file conflict to the management adapter."""

    def __init__(
        self,
        code: Literal[
            "configuration_invalid",
            "configuration_conflict",
            "configuration_ledger_error",
            "configuration_storage_error",
        ],
        message: str,
    ):
        super().__init__(message)
        self.code = code


class GatewayConfigurationManager:
    """Serialize reconciliation, publication, and status for the current Gateway process.

    SQLite heads and the active publication move together under one apply lock. Existing
    Sessions keep their captured plans; this service does not mutate Agent Host composition.
    """

    def __init__(
        self,
        configuration: RuntimeConfiguration,
        database: SqliteDatabase,
        gateway: GatewaySessionCoordinator,
    ) -> None:
        self._configuration = configuration
        self._database = database
        self._gateway = gateway
        self._lock = anyio.Lock()
        self._generation = 0
        self._applied_at = datetime.now(timezone.utc)
        self._applied_hash: str | None = None
        self._applied_source = "unconfigured"
        self._last_error: str | None = None
        self._host_unavailable = False
        self._recovery_required = False

    @property
    def published_endpoint_slugs(self) -> tuple[str, ...]:
        return tuple(endpoint.revision.slug for endpoint in self._gateway.published_endpoints)

    @property
    def has_error(self) -> bool:
        return self._last_error is not None

    def mark_host_unavailable(self) -> None:
        self._host_unavailable = True

    async def initialize(self) -> None:
        """Publish the startup candidate, or report and retain last-known-good heads."""
        async with self._database.session_factory() as session:
            state = await session.get(GatewayConfigurationStateRow, 1)
            if state is not None:
                self._applied_hash = state.applied_hash
                self._applied_source = state.applied_source
                self._applied_at = state.applied_at.replace(tzinfo=timezone.utc)

        error = self._configuration.topology_error
        candidate = RuntimeTopologyCandidate(
            upstreams=self._configuration.upstreams,
            endpoints=self._configuration.endpoints,
            source=self._configuration.topology_source,
            content_hash=self._configuration.topology_hash,
        )
        if error is None:
            try:
                await self._reconcile_and_publish(candidate, allow_unconfigured_host=True)
            except TopologyConfigurationError as exc:
                if self._configuration.topology_source != "runtime_file":
                    raise
                error = str(exc)
        if error is not None:
            logger.error("Runtime topology could not be applied: %s", error)
            await self._gateway.load_published_endpoints()
            if state is None:
                self._applied_source = "ledger"
            self._last_error = error
        else:
            self._last_error = None
        if self._generation == 0:
            self._generation = 1

    async def status(self) -> GatewayConfigurationStatus:
        async with self._lock:
            if self._recovery_required:
                await self._recover_after_storage_error()
            return self._status()

    async def apply(self, expected_hash: str | None) -> GatewayConfigurationStatus:
        """Apply exactly the file version the caller inspected, without restarting."""
        async with self._lock:
            if self._recovery_required:
                await self._recover_after_storage_error()
                if self._recovery_required:
                    raise ConfigurationApplyError(
                        "configuration_storage_error",
                        self._last_error or "The configuration ledger is unavailable.",
                    )
            try:
                candidate = load_runtime_topology(self._configuration)
            except ConfigError as exc:
                self._last_error = str(exc)
                raise ConfigurationApplyError("configuration_invalid", str(exc)) from exc
            if candidate.content_hash != expected_hash:
                raise ConfigurationApplyError(
                    "configuration_conflict",
                    "The configuration file changed. Refresh its status before applying.",
                )
            try:
                await self._reconcile_and_publish(
                    candidate, allow_unconfigured_host=self._host_unavailable
                )
            except TopologyConfigurationError as exc:
                self._last_error = str(exc)
                raise ConfigurationApplyError("configuration_invalid", str(exc)) from exc
            except TopologyLedgerError as exc:
                self._last_error = "The topology ledger is inconsistent; check the server logs."
                logger.error("Configuration application failed: %s", exc)
                raise ConfigurationApplyError(
                    "configuration_ledger_error", self._last_error
                ) from exc
            except ConfigurationStorageError as exc:
                raise ConfigurationApplyError("configuration_storage_error", str(exc)) from exc
            return self._status()

    async def _reconcile_and_publish(
        self, candidate: RuntimeTopologyCandidate, *, allow_unconfigured_host: bool = False
    ) -> bool:
        upstreams, endpoints = build_topology_definitions(
            self._configuration, candidate, allow_unconfigured_host=allow_unconfigured_host
        )
        changed: bool | None = None
        failure: (
            TopologyConfigurationError | TopologyLedgerError | ConfigurationStorageError | None
        ) = None

        async def commit_and_publish() -> None:
            nonlocal changed, failure
            # The child finishes publication even if the request task is directly cancelled.
            with anyio.CancelScope(shield=True):
                try:
                    async with self._database.session_factory.begin() as session:
                        result = await reconcile_topology(session, upstreams, endpoints)
                        try:
                            publication = self._gateway.prepare_publication(result.revisions)
                        except ValueError as exc:
                            raise TopologyConfigurationError(
                                "The candidate topology cannot be published."
                            ) from exc
                        state = await session.get(GatewayConfigurationStateRow, 1)
                        if state is None:
                            state = GatewayConfigurationStateRow(id=1)
                            session.add(state)
                        applied_at = datetime.now(timezone.utc)
                        state.applied_hash = candidate.content_hash
                        state.applied_source = candidate.source
                        state.applied_at = applied_at
                    self._gateway.publish(publication)
                    self._applied_at = applied_at
                    self._applied_hash = candidate.content_hash
                    self._applied_source = candidate.source
                    self._last_error = None
                    self._recovery_required = False
                    if self._generation == 0:
                        self._generation = 1
                    elif result.changed:
                        self._generation += 1
                    changed = result.changed
                except (TopologyConfigurationError, TopologyLedgerError) as exc:
                    failure = exc
                except SQLAlchemyError as exc:
                    logger.error(
                        "Configuration database operation failed (%s).", type(exc).__name__
                    )
                    await self._recover_after_storage_error()
                    failure = ConfigurationStorageError(
                        self._last_error or "The configuration database operation failed."
                    )

        async with anyio.create_task_group() as group:
            group.start_soon(commit_and_publish)
        if failure is not None:
            raise failure
        if changed is None:
            raise RuntimeError("Configuration application was cancelled before publication.")
        return changed

    async def _recover_after_storage_error(self) -> None:
        previous = tuple(item.revision.revision_id for item in self._gateway.published_endpoints)
        try:
            async with self._database.session_factory() as session:
                state = await session.get(GatewayConfigurationStateRow, 1)
            await self._gateway.load_published_endpoints()
        except (SQLAlchemyError, ValueError) as exc:
            logger.error("Unable to reload the configuration ledger (%s).", type(exc).__name__)
            self._gateway.publish(self._gateway.prepare_publication(()))
            self._recovery_required = True
            self._last_error = (
                "The topology ledger could not be reloaded. New sessions are unavailable; "
                "retry application or restart after restoring the database."
            )
        else:
            self._recovery_required = False
            self._last_error = (
                "The configuration database operation failed; the published topology was reloaded."
            )
            if state is not None:
                self._applied_hash = state.applied_hash
                self._applied_source = state.applied_source
                self._applied_at = state.applied_at.replace(tzinfo=timezone.utc)
        current = tuple(item.revision.revision_id for item in self._gateway.published_endpoints)
        if self._generation == 0:
            self._generation = 1
        elif current != previous:
            self._generation += 1

    def _status(self) -> GatewayConfigurationStatus:
        desired_hash: str | None = None
        desired_source = "unknown"
        error: str | None = None
        valid = True
        try:
            candidate = load_runtime_topology(self._configuration)
            desired_hash = candidate.content_hash
            desired_source = candidate.source
            build_topology_definitions(
                self._configuration, candidate, allow_unconfigured_host=self._host_unavailable
            )
        except ConfigError as exc:
            desired_hash = exc.content_hash if exc.source is not None else None
            desired_source = exc.source or "unknown"
            error = str(exc)
            valid = False
        except TopologyConfigurationError as exc:
            error = str(exc)
            valid = False

        restart_required = False
        if self._configuration.static_signature is not None:
            try:
                restart_required = (
                    read_process_signature(self._configuration.config_path)
                    != self._configuration.static_signature
                )
            except ConfigError as exc:
                restart_required = True
                error = error or str(exc)
                valid = False
        if self._host_unavailable:
            target_slug = self._configuration.agent_host.endpoint_slug
            restart_required |= target_slug in self.published_endpoint_slugs

        return GatewayConfigurationStatus(
            generation=self._generation,
            applied_at=self._applied_at,
            applied_hash=self._applied_hash,
            applied_source=self._applied_source,
            desired_hash=desired_hash,
            desired_source=desired_source,
            file_valid=valid,
            pending=(
                not valid
                or desired_hash != self._applied_hash
                or desired_source != self._applied_source
            ),
            error=error or self._last_error,
            restart_required=restart_required,
            host_unavailable=self._host_unavailable,
            recovery_required=self._recovery_required,
        )
