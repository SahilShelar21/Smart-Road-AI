from sqlalchemy import select
from sqlalchemy.orm import Session
from . import measure
from .models import Measurement, Report, Setting

# Placeholder rates: the admin must set the municipality's real rates in Settings.
DEFAULT_BUDGET = {"currency": "₹", "low": 1500, "medium": 3500, "high": 7000, "per_m2": 1500}

def get_budget(db: Session) -> dict:
    row = db.get(Setting, "budget")
    return {**DEFAULT_BUDGET, **(row.value if row and row.value else {})}

def depth_model(db: Session) -> dict:
    rows = db.execute(select(Measurement.width_cm, Measurement.length_cm, Measurement.depth_cm)
                      .where(Measurement.width_cm.is_not(None), Measurement.length_cm.is_not(None), Measurement.depth_cm.is_not(None))).all()
    return measure.fit_depth_model([tuple(r) for r in rows])

def enrich(db: Session, rows) -> list[dict]:
    """rows: iterable of (Report, longitude, latitude). Adds size, depth, danger % and cost estimate."""
    rows = list(rows)
    ids = [r.id for r, _, _ in rows]
    latest = {}
    if ids:
        for m in db.scalars(select(Measurement).where(Measurement.report_id.in_(ids)).order_by(Measurement.id)).all():
            latest[m.report_id] = m  # later rows overwrite earlier ones
    budget, dm = get_budget(db), depth_model(db)
    out = []
    for r, lng, lat in rows:
        m = latest.get(r.id)
        if m and m.width_cm and m.length_cm:
            w, l, src = m.width_cm, m.length_cm, "measured"
        elif r.est_width_cm and r.est_length_cm:
            w, l, src = r.est_width_cm, r.est_length_cm, "estimated"
        else:
            w = l = src = None
        if m and m.depth_cm:
            depth, dsrc = m.depth_cm, "measured"
        elif dm["ready"] and w and l:
            depth, dsrc = dm["k"] * (w + l) / 2, "estimated"
        else:
            depth = dsrc = None
        area = (w / 100) * (l / 100) if w and l else None
        danger = measure.danger_pct(area, r.area_frac, depth, r.confirmations, r.max_confidence)
        level = measure.danger_level(danger)
        out.append({
            "id": r.id, "latitude": lat, "longitude": lng, "gps_accuracy_m": r.gps_accuracy_m,
            "max_confidence": r.max_confidence, "detections": r.detections, "model": r.model_name,
            "status": r.status, "severity": r.severity, "source": r.source, "duplicate_of": r.duplicate_of,
            "confirmations": r.confirmations, "assigned_to": r.assigned_to, "created_at": r.created_at.isoformat(),
            "width_cm": w, "length_cm": l, "depth_cm": depth, "size_source": src, "depth_source": dsrc,
            "size_reliability": r.size_reliability if src == "estimated" else None, "distance_m": r.distance_m,
            "area_m2": area, "danger_pct": danger, "danger_level": level,
            "est_cost": measure.estimate_cost(budget, level, area), "currency": budget["currency"],
            "review": r.review, "trip_id": r.trip_id, "approved": r.approved,
        })
    return out
