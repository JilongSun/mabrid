"""Durable provenance for the most recently applied Gateway topology."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class GatewayConfigurationStateRow(Base):
    """Remember applied file identity independently of revision history."""

    __tablename__ = "gateway_configuration_state"
    __table_args__ = (CheckConstraint("id = 1", name="ck_gateway_configuration_singleton"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    applied_hash: Mapped[str | None] = mapped_column(String(64))
    applied_source: Mapped[str] = mapped_column(String(32))
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
