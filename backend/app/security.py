from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from .config import settings

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode()[:72], hashed.encode())

def create_token(user_id: int, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": str(user_id), "role": role, "exp": exp}, settings.jwt_secret, algorithm="HS256")

def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
