"""Outbound ports owned by the Agent Host application."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Protocol
from uuid import UUID

from ..contracts import AgentAdapterEvent, AgentRuntimeProfile, StartRunCommand
from ..contracts.capabilities import RuntimeCapabilityObservation
from ..contracts.session import (
    AgentSessionRecord,
    CreateAgentSessionCommand,
    HistoryPageQuery,
    RuntimeAgentSession,
    RuntimeHistoryPage,
    RuntimeRunHandle,
    RuntimeRunState,
    RuntimeSessionReference,
    RuntimeSessionRunEvent,
    RuntimeStopReceipt,
    StartSessionRunCommand,
    UnsettledSessionRun,
)


class AgentRuntime(Protocol):
    """Provider-neutral execution consumed by [AgentHostService](service.py).

    `profile` describes locally implemented behavior and `run` yields adapter
    events. [HermesChatCompletionsAdapter](../integrations/hermes/chat_completions.py)
    provides both structurally; wire SDK types stay inside the integration.
    """

    @property
    def profile(self) -> AgentRuntimeProfile: ...

    def run(self, command: StartRunCommand) -> AsyncGenerator[AgentAdapterEvent, None]: ...


class RuntimeCapabilityProbe(Protocol):
    """Read-only discovery consumed by [AgentHostCapabilityService](capabilities.py).

    `inspect_capabilities` returns evidence, not effective product support. Both
    Hermes adapters satisfy this shape independently of their execution ports.
    """

    async def inspect_capabilities(self) -> RuntimeCapabilityObservation: ...


class ManagedAgentRuntime(AgentRuntime, Protocol):
    """Extend [AgentRuntime](ports.py) with deployment-owned async `close`.

    The concrete adapter supplies lifecycle cleanup structurally; server
    composition owns cleanup, while the application consumes the narrower port.
    """

    async def close(self) -> None: ...


class AgentRunSettlement(Protocol):
    """Await local workflow completion before the application releases Run ownership.

    [HostRunSettlement](../../host/settlement.py) structurally supplies
    `wait_until_settled`; this does not itself verify remote runtime exit.
    """

    async def wait_until_settled(self, run_id: UUID) -> None: ...


class AgentSessionRepository(Protocol):
    """Durable identity and unresolved-Run storage for [AgentSessionService](sessions.py).

    `add`/`get`/`list_sessions`/`update_runtime_session` preserve Session bindings.
    `get_unsettled_run`/`claim_run`/`record_runtime_run`/`release_run` preserve
    single-Target ownership across restart.
    No transcript storage is required. The server's SQLite adapter supplies these
    methods structurally and is injected by [compose_host_capabilities](../../host/composition.py).
    """

    async def add(self, session: AgentSessionRecord) -> None: ...

    async def get(self, session_id: UUID) -> AgentSessionRecord | None: ...

    async def list_sessions(
        self, *, target_id: str, limit: int, offset: int
    ) -> tuple[AgentSessionRecord, ...]: ...

    async def update_runtime_session(
        self,
        session_id: UUID,
        *,
        expected: RuntimeSessionReference,
        replacement: RuntimeSessionReference,
    ) -> bool: ...

    async def get_unsettled_run(self, target_id: str) -> UnsettledSessionRun | None: ...

    async def claim_run(self, session: AgentSessionRecord, run_id: UUID) -> bool: ...

    async def record_runtime_run(
        self, target_id: str, run_id: UUID, handle: RuntimeRunHandle
    ) -> None: ...

    async def release_run(self, target_id: str, run_id: UUID) -> None: ...


class RuntimeSessionCatalog(Protocol):
    """Create and reopen remote Sessions for [AgentSessionService](sessions.py).

    [HermesSessionAdapter](../integrations/hermes/sessions.py) structurally
    supplies `create_session` and `get_session`; the runtime owns conversation data.
    """

    async def create_session(self, command: CreateAgentSessionCommand) -> RuntimeAgentSession: ...

    async def get_session(self, reference: RuntimeSessionReference) -> RuntimeAgentSession: ...


class RuntimeSessionHistory(Protocol):
    """Load runtime-owned history through `read_history`, without transcript replay.

    Supplied by [HermesSessionAdapter](../integrations/hermes/sessions.py) and
    consumed by [AgentSessionService](sessions.py) independently of execution.
    """

    async def read_history(
        self, reference: RuntimeSessionReference, query: HistoryPageQuery
    ) -> RuntimeHistoryPage: ...


class RuntimeSessionExecution(Protocol):
    """Continue a bound remote Session through an async `run_session` event source.

    [HermesSessionAdapter](../integrations/hermes/sessions.py) supplies this
    structural port; [AgentSessionService](sessions.py) owns local admission.
    """

    def run_session(
        self, reference: RuntimeSessionReference, command: StartSessionRunCommand
    ) -> AsyncGenerator[RuntimeSessionRunEvent, None]: ...


class RuntimeSessionRunControl(Protocol):
    """Remote stop/status evidence consumed by [AgentSessionService](sessions.py).

    [HermesSessionAdapter](../integrations/hermes/sessions.py) supplies
    `request_stop` and `get_run_state` structurally. Stop acceptance is not exit.
    """

    async def request_stop(self, handle: RuntimeRunHandle) -> RuntimeStopReceipt: ...

    async def get_run_state(self, handle: RuntimeRunHandle) -> RuntimeRunState: ...
