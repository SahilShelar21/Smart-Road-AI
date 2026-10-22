from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from ..config import settings
from ..deps import current_user
from ..detector import DetectorUnavailable, detector
from ..models import User

router = APIRouter(prefix="/api", tags=["detection"])

@router.post("/detect")
async def detect(image: UploadFile = File(...), user: User = Depends(current_user)):
    data = await image.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "Image too large")
    try:
        img = detector.decode(data)
        dets = detector.detect(img)
    except DetectorUnavailable as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    h, w = img.shape[:2]
    return {"model": detector.name, "image_width": w, "image_height": h, "detections": dets}
