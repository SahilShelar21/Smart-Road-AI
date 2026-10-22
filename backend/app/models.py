from datetime import datetime
from geoalchemy2 import Geometry
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="citizen")  # citizen | officer | admin
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    location = mapped_column(Geometry("POINT", srid=4326, spatial_index=True))
    gps_accuracy_m: Mapped[float | None] = mapped_column(Float)
    max_confidence: Mapped[float] = mapped_column(Float)
    detections = mapped_column(JSONB)
    model_name: Mapped[str] = mapped_column(String(255))
    image_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="reported")
    severity: Mapped[str] = mapped_column(String(10), default="low")
    source: Mapped[str] = mapped_column(String(20), default="camera")  # camera | video_file
    duplicate_of: Mapped[int | None] = mapped_column(ForeignKey("reports.id"))
    confirmations: Mapped[int] = mapped_column(Integer, default=1)
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    est_width_cm: Mapped[float | None] = mapped_column(Float)
    est_length_cm: Mapped[float | None] = mapped_column(Float)
    distance_m: Mapped[float | None] = mapped_column(Float)
    size_reliability: Mapped[str | None] = mapped_column(String(10))
    area_frac: Mapped[float | None] = mapped_column(Float)
    calib = mapped_column(JSONB)
    review: Mapped[str | None] = mapped_column(String(20))  # correct | false_positive (admin feedback for retraining)
    clean_image_path: Mapped[str | None] = mapped_column(String(500))  # blurred frame WITHOUT the drawn box (training use)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id"))
    approved: Mapped[bool] = mapped_column(Boolean, default=False)  # admitted to the public map by an admin
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class RepairPhoto(Base):
    __tablename__ = "repair_photos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # after | verification
    image_path: Mapped[str] = mapped_column(String(500))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(60))
    target: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Measurement(Base):
    """On-site tape measurements: the ground truth used to validate the estimates."""
    __tablename__ = "measurements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), index=True)
    width_cm: Mapped[float | None] = mapped_column(Float)
    length_cm: Mapped[float | None] = mapped_column(Float)
    depth_cm: Mapped[float | None] = mapped_column(Float)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value = mapped_column(JSONB)

class Trip(Base):
    __tablename__ = "trips"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(12), default="active")  # active | finished | abandoned
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    distance_m: Mapped[float] = mapped_column(Float, default=0)
    duration_s: Mapped[int] = mapped_column(Integer, default=0)
    path = mapped_column(Geometry("LINESTRING", srid=4326))
