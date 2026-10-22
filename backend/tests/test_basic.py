import numpy as np
from fastapi.testclient import TestClient
from app.main import app
from app.security import create_token, decode_token, hash_password, verify_password
from app.detector import Detector

client = TestClient(app)  # lifespan not started, so no DB needed

def test_password_roundtrip():
    h = hash_password("correct horse")
    assert verify_password("correct horse", h)
    assert not verify_password("wrong", h)

def test_token_roundtrip():
    assert decode_token(create_token(7, "admin"))["sub"] == "7"

def test_health():
    assert client.get("/api/health").json()["status"] == "ok"

def test_detect_requires_auth():
    assert client.post("/api/detect", files={"image": ("a.jpg", b"x", "image/jpeg")}).status_code == 401

def test_decode_rejects_garbage():
    import pytest
    with pytest.raises(ValueError):
        Detector.decode(b"not an image")
