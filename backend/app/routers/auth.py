from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..db import get_db
from ..deps import current_user
from ..models import User
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=72)

@router.post("/register", status_code=201)
def register(body: Credentials, db: Session = Depends(get_db)):
    # Public registration always creates a citizen. Officers/admins are promoted by an admin.
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, "Email already registered")
    user = User(email=body.email.lower(), password_hash=hash_password(body.password), role="citizen")
    db.add(user)
    db.commit()
    return {"token": create_token(user.id, user.role), "role": user.role}

@router.post("/login")
def login(body: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong email or password")
    return {"token": create_token(user.id, user.role), "role": user.role}

@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "role": user.role}
