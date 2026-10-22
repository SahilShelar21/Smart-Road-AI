"""Real YOLO inference. If no weights file exists, detection is unavailable (no fake output)."""
import os
import threading
import cv2
import numpy as np
from .config import settings

class DetectorUnavailable(Exception):
    pass

class Detector:
    def __init__(self):
        self._model = None
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return os.path.isfile(settings.model_path)

    @property
    def name(self) -> str:
        return os.path.basename(settings.model_path)

    def _load(self):
        if self._model is None:
            if not self.available:
                raise DetectorUnavailable(
                    f"No trained model at {settings.model_path}. Train one with ml/train.py and place it in ./models."
                )
            from ultralytics import YOLO
            self._model = YOLO(settings.model_path)
        return self._model

    @staticmethod
    def decode(data: bytes) -> np.ndarray:
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Not a valid image")
        return img

    def detect(self, img: np.ndarray) -> list[dict]:
        model = self._load()
        with self._lock:
            res = model.predict(img, conf=settings.min_confidence, verbose=False)[0]
        out = []
        for b in res.boxes:
            x1, y1, x2, y2 = (float(v) for v in b.xyxy[0].tolist())
            out.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2, "confidence": float(b.conf[0])})
        return out

detector = Detector()
