from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from .config import settings
from .db import SessionLocal
from .detector import detector
from .models import User
from .routers import auth, detect, insights, ops, reports, workflow
from .security import hash_password

@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.admin_email and settings.admin_password:
        with SessionLocal() as db:
            if not db.scalar(select(User).where(User.email == settings.admin_email.lower())):
                db.add(User(email=settings.admin_email.lower(), password_hash=hash_password(settings.admin_password), role="admin"))
                db.commit()
    yield

app = FastAPI(title="SmartRoad AI", version="0.1.0", lifespan=lifespan)
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

app.include_router(auth.router)
app.include_router(detect.router)
app.include_router(reports.router)
app.include_router(workflow.router)
app.include_router(ops.router)
app.include_router(insights.router)

@app.get("/api/health")
def health():
    return {"status": "ok", "model_loaded_possible": detector.available, "model": detector.name}
