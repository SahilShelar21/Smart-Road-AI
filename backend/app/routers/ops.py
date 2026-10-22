import json
import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from ..config import settings
from ..db import get_db
from ..deps import current_user, require_roles
from ..detector import detector
from ..models import AuditLog, Measurement, RepairPhoto, Report, Trip, User
from ..security import hash_password
from ..services import enrich, get_budget
from .reports import STAFF, audit

router = APIRouter(prefix="/api", tags=["operations"])
staff = require_roles("officer", "admin")
admin = require_roles("admin")

@router.get("/map")
def map_points(include_pending: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """GeoJSON of ADMITTED primary reports (admins may also ask for pending ones). No images or reporter identity."""
    q = select(Report, func.ST_X(Report.location), func.ST_Y(Report.location)).where(Report.duplicate_of.is_(None))
    if not (include_pending and user.role == "admin"):
        q = q.where(Report.approved.is_(True))
    feats = [{
        "type": "Feature", "geometry": {"type": "Point", "coordinates": [it["longitude"], it["latitude"]]},
        "properties": {"id": it["id"], "severity": it["severity"], "status": it["status"], "confidence": it["max_confidence"],
                       "confirmations": it["confirmations"], "created_at": it["created_at"],
                       "danger_pct": it["danger_pct"], "danger_level": it["danger_level"], "approved": it["approved"]},
    } for it in enrich(db, db.execute(q).all())]
    return {"type": "FeatureCollection", "features": feats}

@router.get("/stats")
def stats(days: int = Query(14, ge=0, le=365), _: User = Depends(admin), db: Session = Depends(get_db)):
    """Everything is computed live from the database. days=0 means all time (no comparison)."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days) if days else None
    before = now - timedelta(days=2 * days) if days else None
    prim = Report.duplicate_of.is_(None)
    dup = Report.duplicate_of.is_not(None)
    cur = [Report.created_at >= since] if since else []
    prev = [Report.created_at >= before, Report.created_at < since] if since else None

    def count(*conds):
        return db.scalar(select(func.count()).select_from(Report).where(*conds)) or 0

    def avg_conf(conds):
        v = db.scalar(select(func.avg(Report.max_confidence)).where(*conds))
        return float(v) if v is not None else None

    def verified(*conds):
        return db.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.action == "report.status", AuditLog.target.like("%->verified"), *conds)) or 0

    def group(col):
        return dict(db.execute(select(col, func.count()).where(prim, *cur).group_by(col)).all())

    kpi = {
        "unique_hazards": {"value": count(prim, *cur), "previous": count(prim, *prev) if prev else None},
        "duplicates_merged": {"value": count(dup, *cur), "previous": count(dup, *prev) if prev else None},
        "avg_confidence": {"value": avg_conf(cur), "previous": avg_conf(prev) if prev else None},
        "repairs_verified": {
            "value": verified(AuditLog.created_at >= since) if since else verified(),
            "previous": verified(AuditLog.created_at >= before, AuditLog.created_at < since) if since else None,
        },
    }

    span = days or 90
    start_day = (now - timedelta(days=span - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    day = func.date_trunc("day", Report.created_at)
    rows = db.execute(select(day, func.count(), func.avg(Report.max_confidence))
                      .where(Report.created_at >= start_day).group_by(day).order_by(day)).all()
    by_day = {d.date().isoformat(): (c, a) for d, c, a in rows}
    per_day = []
    for i in range(span):
        d = (start_day + timedelta(days=i)).date().isoformat()
        c, a = by_day.get(d, (0, None))
        per_day.append({"day": d, "count": c, "avg_confidence": float(a) if a is not None else None})

    metrics_file = os.path.join(os.path.dirname(settings.model_path), "metrics.json")
    metrics = json.load(open(metrics_file)) if os.path.isfile(metrics_file) else None
    items = enrich(db, db.execute(select(Report, func.ST_X(Report.location), func.ST_Y(Report.location)).where(prim, *cur)).all())
    open_items = [i for i in items if i["status"] not in ("verified", "rejected")]
    budget = {"currency": get_budget(db)["currency"], "open_total": sum(i["est_cost"] for i in open_items),
              "all_total": sum(i["est_cost"] for i in items), "open_count": len(open_items)}
    danger_levels = {lv: sum(1 for i in items if i["danger_level"] == lv) for lv in ("low", "medium", "high")}
    avg_danger = round(sum(i["danger_pct"] for i in items) / len(items)) if items else None
    return {
        "budget": budget, "danger_levels": danger_levels, "avg_danger": avg_danger,
        "pending_approval": count(prim, Report.approved.is_(False)),
        "days": days, "kpi": kpi,
        "by_status": group(Report.status), "by_severity": group(Report.severity),
        "per_day": per_day,
        "model": {"file": detector.name, "weights_present": detector.available, "offline_evaluation": metrics},
        "notes": "Severity is an image-area heuristic, not a physical measurement. Width/length/depth estimation is not implemented.",
    }

@router.get("/users")
def users(_: User = Depends(admin), db: Session = Depends(get_db)):
    return [{"id": u.id, "email": u.email, "role": u.role} for u in db.scalars(select(User).order_by(User.id)).all()]

class RoleChange(BaseModel):
    role: str

@router.post("/users/{user_id}/role")
def set_role(user_id: int, body: RoleChange, me: User = Depends(admin), db: Session = Depends(get_db)):
    if body.role not in ("citizen", "officer", "admin"):
        raise HTTPException(422, "Invalid role")
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if u.id == me.id:
        raise HTTPException(409, "You cannot change your own role")
    u.role = body.role
    audit(db, me, "user.role", f"{u.id}->{body.role}")
    db.commit()
    return {"id": u.id, "role": u.role}

@router.get("/audit")
def audit_log(_: User = Depends(admin), db: Session = Depends(get_db), limit: int = 100):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 500))).all()
    return [{"id": a.id, "user_id": a.user_id, "action": a.action, "target": a.target, "at": a.created_at.isoformat()} for a in rows]


class NewUser(BaseModel):
    email: str = Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=72)
    role: str = "citizen"

@router.post("/users", status_code=201)
def create_user(body: NewUser, me: User = Depends(admin), db: Session = Depends(get_db)):
    if body.role not in ("citizen", "officer", "admin"):
        raise HTTPException(422, "Invalid role")
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Email already registered")
    u = User(email=email, password_hash=hash_password(body.password), role=body.role)
    db.add(u)
    audit(db, me, "user.create", f"{email}:{body.role}")
    db.commit()
    return {"id": u.id, "email": u.email, "role": u.role}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, me: User = Depends(admin), db: Session = Depends(get_db)):
    if user_id == me.id:
        raise HTTPException(409, "You cannot delete your own account")
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    n = db.scalar(select(func.count()).select_from(Report).where(Report.user_id == u.id)) or 0
    ph = db.scalar(select(func.count()).select_from(RepairPhoto).where(RepairPhoto.user_id == u.id)) or 0
    extra = (db.scalar(select(func.count()).select_from(Measurement).where(Measurement.user_id == u.id)) or 0) + \
            (db.scalar(select(func.count()).select_from(Trip).where(Trip.user_id == u.id)) or 0)
    if n or ph or extra:
        raise HTTPException(409, f"{u.email} has {n} report(s), {ph} photo(s) and {extra} measurement(s)/trip(s). Delete those first, or just change their role.")
    for r in db.scalars(select(Report).where(Report.assigned_to == u.id)).all():
        r.assigned_to = None
        if r.status in ("assigned", "in_repair"):
            r.status = "reported"
    for a in db.scalars(select(AuditLog).where(AuditLog.user_id == u.id)).all():
        a.user_id = None
    db.flush()
    email = u.email
    db.delete(u)
    audit(db, me, "user.delete", email)
    db.commit()
    return {"deleted": user_id}
