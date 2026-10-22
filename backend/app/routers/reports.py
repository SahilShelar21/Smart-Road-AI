import os
import uuid
from datetime import datetime, timedelta, timezone
import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from ..config import settings
from ..db import get_db
from ..deps import current_user
from ..detector import DetectorUnavailable, detector
from ..measure import ground_size
from ..models import AuditLog, Report, Trip, User
from ..services import enrich
from ..privacy import blur_sensitive
from ..rules import DUPLICATE_RADIUS_M, DUPLICATE_WINDOW_DAYS, classify

router = APIRouter(prefix="/api/reports", tags=["reports"])
STAFF = ("officer", "admin")

def audit(db: Session, user: User | None, action: str, target: str):
    db.add(AuditLog(user_id=user.id if user else None, action=action, target=target))

def out(r: Report, lng: float, lat: float) -> dict:
    return {
        "id": r.id, "latitude": lat, "longitude": lng, "gps_accuracy_m": r.gps_accuracy_m,
        "max_confidence": r.max_confidence, "detections": r.detections, "model": r.model_name,
        "status": r.status, "severity": r.severity, "source": r.source, "duplicate_of": r.duplicate_of,
        "confirmations": r.confirmations, "assigned_to": r.assigned_to, "created_at": r.created_at.isoformat(),
    }

def read_image(data: bytes):
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "Image too large")
    try:
        return detector.decode(data)
    except ValueError as e:
        raise HTTPException(400, str(e))

def save_clean(blurred) -> str:
    """Blurred frame WITHOUT the drawn box: used (after admin review) as clean training data."""
    os.makedirs(settings.evidence_dir, exist_ok=True)
    name = f"{uuid.uuid4().hex}.jpg"
    cv2.imwrite(os.path.join(settings.evidence_dir, name), blurred, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return name

def save_image(img, box: dict | None = None, already_blurred: bool = False) -> str:
    os.makedirs(settings.evidence_dir, exist_ok=True)
    name = f"{uuid.uuid4().hex}.jpg"
    out = img.copy() if already_blurred else blur_sensitive(img)  # blur faces/plates
    if box:  # mark which pothole this entry is about
        cv2.rectangle(out, (int(box["x1"]), int(box["y1"])), (int(box["x2"]), int(box["y2"])), (24, 197, 245), 3)
    cv2.imwrite(os.path.join(settings.evidence_dir, name), out, [cv2.IMWRITE_JPEG_QUALITY, 90])  # re-encoding drops EXIF
    return name

MAX_PER_FRAME = 20

@router.post("", status_code=201)
async def create_report(
    image: UploadFile = File(...),
    latitude: float = Form(..., ge=-90, le=90),
    longitude: float = Form(..., ge=-180, le=180),
    accuracy_m: float | None = Form(None),
    source: str = Form("camera"),
    min_conf: float | None = Form(None, ge=0, le=1),
    cam_height_m: float | None = Form(None, ge=0.3, le=3.0),
    tilt_deg: float | None = Form(None, ge=-10, le=60),
    hfov_deg: float | None = Form(None, ge=40, le=120),
    trip_id: int | None = Form(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """One report entry PER pothole found in the frame."""
    if source not in ("camera", "video_file"):
        raise HTTPException(422, "Invalid source")
    img = read_image(await image.read())
    try:
        dets = detector.detect(img)  # re-run on the server: client-side results are never trusted
    except DetectorUnavailable as e:
        raise HTTPException(503, str(e))
    floor = max(settings.min_confidence, min_conf or 0)
    dets = sorted((d for d in dets if d["confidence"] >= floor), key=lambda d: -d["confidence"])[:MAX_PER_FRAME]
    if not dets:
        raise HTTPException(422, "No pothole detected in the submitted image")
    h, w = img.shape[:2]
    if trip_id is not None:
        trip = db.get(Trip, trip_id)
        if not trip or trip.user_id != user.id or trip.status != "active":
            raise HTTPException(409, "That trip is not active")
    calib = {"cam_height_m": cam_height_m, "tilt_deg": tilt_deg, "hfov_deg": hfov_deg} if (cam_height_m and tilt_deg is not None and hfov_deg) else None

    point = func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326)
    geo = func.geography(Report.location)
    pt_geo = func.geography(point)
    # Unresolved hazards already known near this spot. GPS cannot tell potholes metres apart, so:
    # if k potholes are seen here and m are already known, the first m are treated as repeat sightings
    # and the remaining k-m become NEW entries.
    existing = db.scalars(
        select(Report)
        .where(
            Report.duplicate_of.is_(None),
            Report.status.notin_(("verified", "rejected")),
            Report.created_at > datetime.now(timezone.utc) - timedelta(days=DUPLICATE_WINDOW_DAYS),
            func.ST_DWithin(geo, pt_geo, DUPLICATE_RADIUS_M),
        )
        .order_by(func.ST_Distance(geo, pt_geo), Report.id)
        .limit(len(dets))
    ).all()

    blurred = blur_sensitive(img)
    clean_name = save_clean(blurred)
    created, merged = [], 0
    for i, d in enumerate(dets):
        match = existing[i] if i < len(existing) else None
        if match:
            match.confirmations += 1
            merged += 1
        size = ground_size(d, w, h, **{"cam_h_m": cam_height_m, "tilt_deg": tilt_deg, "hfov_deg": hfov_deg}) if calib else None
        r = Report(
            est_width_cm=size["width_cm"] if size else None, est_length_cm=size["length_cm"] if size else None,
            distance_m=size["distance_m"] if size else None, size_reliability=size["reliability"] if size else None,
            area_frac=((d["x2"] - d["x1"]) * (d["y2"] - d["y1"])) / (w * h), calib=calib,
            clean_image_path=clean_name, trip_id=trip_id, approved=(user.role == "admin"),
            user_id=user.id, location=point, gps_accuracy_m=accuracy_m,
            max_confidence=d["confidence"], detections=[d], model_name=detector.name,
            image_path=save_image(blurred, d, already_blurred=True), severity=classify([d], w, h),
            source=source, duplicate_of=match.id if match else None,
        )
        db.add(r)
        created.append(r)
    audit(db, user, "report.create", f"{len(created)} potholes, {merged} matched existing")
    db.commit()
    for r in created:
        db.refresh(r)
    return {"count": len(created), "new": len(created) - merged, "merged": merged,
            "reports": enrich(db, [(r, longitude, latitude) for r in created])}

@router.get("")
def list_reports(user: User = Depends(current_user), db: Session = Depends(get_db),
                 scope: str | None = None, status: str | None = None, approval: str | None = None,
                 date_from: datetime | None = None, date_to: datetime | None = None,
                 limit: int = Query(5, ge=1, le=100), offset: int = Query(0, ge=0)):
    """scope: mine (submitted by me) | assigned (assigned to me) | all (admin only).
    approval: pending (not yet admitted to the map) | approved. date_to is exclusive."""
    scope = scope or {"citizen": "mine", "officer": "assigned", "admin": "all"}.get(user.role, "mine")
    if scope not in ("mine", "assigned", "all"):
        raise HTTPException(422, "Invalid scope")
    if scope == "all" and user.role != "admin":
        raise HTTPException(403, "Admins only")
    if scope == "assigned" and user.role == "citizen":
        raise HTTPException(403, "Officers only")
    conds = []
    if scope == "mine":
        conds.append(Report.user_id == user.id)
    elif scope == "assigned":
        conds += [Report.assigned_to == user.id, Report.duplicate_of.is_(None)]
    else:
        conds.append(Report.duplicate_of.is_(None))
    if status:
        conds.append(Report.status == status)
    if approval in ("pending", "approved"):
        conds.append(Report.approved.is_(approval == "approved"))
    if date_from:
        conds.append(Report.created_at >= date_from)
    if date_to:
        conds.append(Report.created_at < date_to)
    total = db.scalar(select(func.count()).select_from(Report).where(*conds)) or 0
    rows = db.execute(select(Report, func.ST_X(Report.location), func.ST_Y(Report.location))
                      .where(*conds).order_by(Report.created_at.desc()).limit(limit).offset(offset)).all()
    items = enrich(db, rows)
    if user.role == "admin" and rows:
        ids = {r.user_id for r, _, _ in rows} | {r.assigned_to for r, _, _ in rows if r.assigned_to}
        emails = {u.id: u.email for u in db.scalars(select(User).where(User.id.in_(ids))).all()}
        for it, (r, _, _) in zip(items, rows):
            it["reporter"], it["assignee"] = emails.get(r.user_id), emails.get(r.assigned_to)
    return {"items": items, "total": total}

def can_view(user: User, r: Report) -> bool:
    return user.role == "admin" or r.user_id == user.id or (user.role == "officer" and r.assigned_to == user.id)

def get_visible(db: Session, user: User, report_id: int) -> Report:
    r = db.get(Report, report_id)
    if r is None or not can_view(user, r):
        raise HTTPException(404, "Report not found")
    return r

def send(path: str):
    p = os.path.join(settings.evidence_dir, os.path.basename(path))
    if not os.path.isfile(p):
        raise HTTPException(404, "Evidence file missing")
    return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})

@router.get("/{report_id}/image")
def report_image(report_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return send(get_visible(db, user, report_id).image_path)
