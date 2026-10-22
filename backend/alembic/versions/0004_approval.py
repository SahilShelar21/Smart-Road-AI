"""admin approval before a hazard appears on the map

Revision ID: 0004
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"

def upgrade():
    # existing reports were already visible, so they start as approved; new ones default to pending
    op.add_column("reports", sa.Column("approved", sa.Boolean, nullable=False, server_default=sa.true()))
    op.alter_column("reports", "approved", server_default=sa.false())

def downgrade():
    op.drop_column("reports", "approved")
