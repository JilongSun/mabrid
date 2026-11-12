"""Preserve the integration identity of existing Hermes Sessions without resetting records."""

from alembic import op
import sqlalchemy as sa

revision = "0004_agent_session_integration"
down_revision = "0003_gateway_config_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_sessions",
        sa.Column("integration_kind", sa.String(255), nullable=False, server_default="hermes"),
    )


def downgrade() -> None:
    op.drop_column("agent_sessions", "integration_kind")
