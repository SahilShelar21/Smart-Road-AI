"""users and reports

Revision ID: 0001
"""
import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="citizen"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "reports",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("location", Geometry("POINT", srid=4326, spatial_index=False), nullable=False),
        sa.Column("gps_accuracy_m", sa.Float),
        sa.Column("max_confidence", sa.Float, nullable=False),
        sa.Column("detections", JSONB, nullable=False),
        sa.Column("model_name", sa.String(255), nullable=False),
        sa.Column("image_path", sa.String(500), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="reported"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_reports_location", "reports", ["location"], postgresql_using="gist")
    op.execute("CREATE INDEX idx_reports_location_geog ON reports USING gist ((location::geography))")

def downgrade():
    op.drop_table("reports")
    op.drop_table("users")
