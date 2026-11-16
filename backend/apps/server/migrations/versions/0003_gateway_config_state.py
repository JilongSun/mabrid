"""Remember the source and identity of the last applied Gateway topology."""

from alembic import op
import sqlalchemy as sa

revision = "0003_gateway_config_state"
down_revision = "0002_agent_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gateway_configuration_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("applied_hash", sa.String(64), nullable=True),
        sa.Column("applied_source", sa.String(32), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_gateway_configuration_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("gateway_configuration_state")
