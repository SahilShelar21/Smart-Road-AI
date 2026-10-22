"""severity, duplicates, assignment, repair photos, audit log

Revision ID: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"

def upgrade():
    op.add_column("reports", sa.Column("severity", sa.String(10), nullable=False, server_default="low"))
    op.add_column("reports", sa.Column("source", sa.String(20), nullable=False, server_default="camera"))
    op.add_column("reports", sa.Column("duplicate_of", sa.Integer, sa.ForeignKey("reports.id")))
    op.add_column("reports", sa.Column("confirmations", sa.Integer, nullable=False, server_default="1"))
    op.add_column("reports", sa.Column("assigned_to", sa.Integer, sa.ForeignKey("users.id")))
    op.create_table(
        "repair_photos",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("report_id", sa.Integer, sa.ForeignKey("reports.id"), nullable=False, index=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("image_path", sa.String(500), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("action", sa.String(60), nullable=False),
        sa.Column("target", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

def downgrade():
    op.drop_table("audit_log")
    op.drop_table("repair_photos")
    for c in ("assigned_to", "confirmations", "duplicate_of", "source", "severity"):
        op.drop_column("reports", c)
