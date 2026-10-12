"""Read contracts for persisted session snapshots and sequenced event history."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PositiveInt

from .events import SessionEvent


class InspectionQueryModel(BaseModel):
    """Immutable typed base for management inspection queries and results."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class SessionEventPageRequest(InspectionQueryModel):
    """Read bounded events after a persisted monotonic Session sequence."""

    session_id: UUID
    after: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=500)


class SequencedSessionEvent(InspectionQueryModel):
    """Attach storage sequence to an inspection event without changing its domain payload."""

    sequence: PositiveInt
    event: SessionEvent


class SessionEventPage(InspectionQueryModel):
    """Return an ordered diagnostic event page and optional continuation sequence."""

    items: tuple[SequencedSessionEvent, ...]
    next_after: int | None = Field(default=None, ge=1)
