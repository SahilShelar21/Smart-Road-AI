import os
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from ..config import settings
from ..db import get_db
from ..deps import current_user, require_roles
from ..models import Measurement, RepairPhoto, Report, User
from ..rules import can_delete_report, can_transition
from .reports import audit, get_visible, read_image, save_image, send

router = APIRouter(prefix="/api", tags=["repair-workflow"])
admin = require_roles("admin")
staff = require_roles("officer", "admin")

class Assign(BaseModel):
    officer_id: int

class StatusChange(BaseModel):
    status: str

def check_access(user: User, r: Report):
    """Officers may only touch reports assigned to them; admins may touch everything."""
    if user.role != "admin" and r.assigned_to != user.id:
        raise HTTPException(403, "This report is not assigned to you")

@router.get("/officers")
def officers(_: User = Depends(admin), db: Session = Depends(get_db)):
    """People a report can be assigned to (admins can also do officer work)."""
    rows = db.scalars(select(User).where(User.role.in_(("officer", "admin"))).order_by(User.role, User.email)).all()
    return [{"id": u.id, "email": u.email, "role": u.role} for u in rows]

@router.post("/reports/{report_id}/assign")
def assign(report_id: int, body: Assign, user: User = Depends(admin), db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    target = db.get(User, body.officer_id)
    if not r or not target or target.role not in ("officer", "admin"):
        raise HTTPException(404, "Report or officer not found")
    if r.status not in ("reported", "assigned"):
        raise HTTPException(409, f"Cannot reassign a report that is {r.status}")
    r.assigned_to, r.status = target.id, "assigned"
    audit(db, user, "report.assign", f"{r.id}->{target.id}")
    db.commit()
    return {"id": r.id, "status": r.status, "assigned_to": r.assigned_to}

@router.post("/reports/{report_id}/status")
def change_status(report_id: int, body: StatusChange, user: User = Depends(staff), db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    check_access(user, r)
    if not can_transition(r.status, body.status, "admin"):
        raise HTTPException(409, f"Cannot move from {r.status} to {body.status}")
    if not can_transition(r.status, body.status, user.role):
        raise HTTPException(403, "Only an admin can do this step")
    if body.status == "repaired":
        has_after = db.scalar(select(RepairPhoto.id).where(RepairPhoto.report_id == r.id, RepairPhoto.kind == "after").limit(1))
        if not has_after:
            raise HTTPException(422, "Upload an 'after' photo before marking as repaired")
    old, r.status = r.status, body.status
    if r.status == "reported":
        r.assigned_to = None  # unassigned
    audit(db, user, "report.status", f"{r.id}:{old}->{r.status}")
    db.commit()
    return {"id": r.id, "status": r.status}

@router.post("/reports/{report_id}/photos", status_code=201)
async def add_photo(report_id: int, kind: str = Form("after"), image: UploadFile = File(...),
                    user: User = Depends(staff), db: Session = Depends(get_db)):
    if kind not in ("after", "verification"):
        raise HTTPException(422, "kind must be 'after' or 'verification'")
    r = db.get(Report, report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    check_access(user, r)
    if kind == "after" and r.status != "in_repair":
        raise HTTPException(409, "Photos can only be added while the report is in repair")
    p = RepairPhoto(report_id=r.id, kind=kind, user_id=user.id, image_path=save_image(read_image(await image.read())))
    db.add(p)
    audit(db, user, "photo.add", f"{r.id}:{kind}")
    db.commit()
    return {"id": p.id, "kind": p.kind}

@router.get("/reports/{report_id}/photos")
def list_photos(report_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_visible(db, user, report_id)
    rows = db.scalars(select(RepairPhoto).where(RepairPhoto.report_id == report_id).order_by(RepairPhoto.id)).all()
    return [{"id": p.id, "kind": p.kind, "created_at": p.created_at.isoformat()} for p in rows]

@router.get("/photos/{photo_id}/image")
def photo_image(photo_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(RepairPhoto, photo_id)
    if not p:
        raise HTTPException(404, "Photo not found")
    get_visible(db, user, p.report_id)
    return send(p.image_path)


def remove_file(name: str):
    try:
        os.remove(os.path.join(settings.evidence_dir, os.path.basename(name)))
    except FileNotFoundError:
        pass

@router.delete("/reports/{report_id}")
def delete_report(report_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = get_visible(db, user, report_id)
    if not can_delete_report(user.role, r.user_id == user.id, r.status):
        raise HTTPException(403, "You can only delete your own report before it is assigned. Ask an admin otherwise.")
    photos = db.scalars(select(RepairPhoto).where(RepairPhoto.report_id == r.id)).all()
    files = [r.image_path] + [p.image_path for p in photos]
    if r.clean_image_path and not db.scalar(select(Report.id).where(Report.clean_image_path == r.clean_image_path, Report.id != r.id).limit(1)):
        files.append(r.clean_image_path)  # shared by other potholes of the same frame until the last one is deleted
    for m in db.scalars(select(Measurement).where(Measurement.report_id == r.id)).all():
        db.delete(m)
    for c in db.scalars(select(Report).where(Report.duplicate_of == r.id)).all():
        c.duplicate_of = None  # merged sightings become standalone entries
    if r.duplicate_of:
        parent = db.get(Report, r.duplicate_of)
        if parent:
            parent.confirmations = max(1, parent.confirmations - 1)
    for p in photos:
        db.delete(p)
    db.flush()
    db.delete(r)
    audit(db, user, "report.delete", str(report_id))
    db.commit()
    for f in files:
        remove_file(f)
    return {"deleted": report_id}

@router.delete("/photos/{photo_id}")
def delete_photo(photo_id: int, user: User = Depends(staff), db: Session = Depends(get_db)):
    p = db.get(RepairPhoto, photo_id)
    r = db.get(Report, p.report_id) if p else None
    if not p or not r:
        raise HTTPException(404, "Photo not found")
    if user.role != "admin" and not (r.assigned_to == user.id and r.status == "in_repair" and p.kind == "after"):
        raise HTTPException(403, "You can only delete the after photo of a repair that is still in progress")
    name = p.image_path
    db.delete(p)
    db.flush()
    still = db.scalar(select(RepairPhoto.id).where(RepairPhoto.report_id == r.id, RepairPhoto.kind == "after").limit(1))
    if not still and r.status in ("repaired", "verified"):
        r.status = "in_repair"  # a repair needs its after photo
    audit(db, user, "photo.delete", f"{r.id}:{photo_id}")
    db.commit()
    remove_file(name)
    return {"deleted": photo_id, "report_status": r.status}


class ApproveIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=500)
    all_pending: bool = False

@router.post("/reports/approve")
def approve_reports(body: ApproveIn, user: User = Depends(admin), db: Session = Depends(get_db)):
    """Admit hazards to the public map. Only admins can do this."""
    q = select(Report).where(Report.approved.is_(False), Report.duplicate_of.is_(None))
    if not body.all_pending:
        if not body.ids:
            raise HTTPException(422, "Give ids or set all_pending")
        q = q.where(Report.id.in_(body.ids))
    rows = db.scalars(q).all()
    for r in rows:
        r.approved = True
    audit(db, user, "report.approve", f"{len(rows)} hazard(s)")
    db.commit()
    return {"approved": len(rows)}

@router.get("/pending-count")
def pending_count(_: User = Depends(admin), db: Session = Depends(get_db)):
    n = db.scalar(select(func.count()).select_from(Report).where(Report.approved.is_(False), Report.duplicate_of.is_(None))) or 0
    return {"pending": n}
