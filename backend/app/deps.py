import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from .db import get_db
from .models import User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)

def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if cred is None:
        raise HTTPException(401, "Not authenticated")
    try:
        data = decode_token(cred.credentials)
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = db.get(User, int(data["sub"]))
    if user is None:
        raise HTTPException(401, "User no longer exists")
    return user

def require_roles(*roles: str):
    def check(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Insufficient role")
        return user
    return check
