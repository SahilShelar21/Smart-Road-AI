"""size estimates, measurements, settings, trips, AI review

Revision ID: 0003
"""
import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003"
down_revision = "0002"

def upgrade():
    op.create_table(
        "trips",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="active"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("distance_m", sa.Float, nullable=False, server_default="0"),
        sa.Column("duration_s", sa.Integer, nullable=False, server_default="0"),
        sa.Column("path", Geometry("LINESTRING", srid=4326, spatial_index=False)),
    )
    op.create_table(
        "measurements",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("report_id", sa.Integer, sa.ForeignKey("reports.id"), nullable=False, index=True),
        sa.Column("width_cm", sa.Float), sa.Column("length_cm", sa.Float), sa.Column("depth_cm", sa.Float),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "settings",
        sa.Column("key", sa.String(60), primary_key=True),
        sa.Column("value", JSONB, nullable=False),
    )
    for name, typ in [("est_width_cm", sa.Float), ("est_length_cm", sa.Float), ("distance_m", sa.Float),
                      ("size_reliability", sa.String(10)), ("area_frac", sa.Float), ("calib", JSONB),
                      ("review", sa.String(20)), ("clean_image_path", sa.String(500))]:
        op.add_column("reports", sa.Column(name, typ))
    op.add_column("reports", sa.Column("trip_id", sa.Integer, sa.ForeignKey("trips.id")))

def downgrade():
    for c in ("trip_id", "clean_image_path", "review", "calib", "area_frac", "size_reliability", "distance_m", "est_length_cm", "est_width_cm"):
        op.drop_column("reports", c)
    op.drop_table("settings")
    op.drop_table("measurements")
    op.drop_table("trips")
