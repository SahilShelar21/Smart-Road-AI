"""Pure measurement, risk and cost maths (no framework imports, easy to test).

Width/length come from camera geometry (flat road, known lens height, tilt and field of view).
Depth CANNOT be measured from one RGB frame. It is only estimated after enough on-site tape
measurements exist to fit and check a size-to-depth ratio, and is always labelled as an estimate.
"""
import math
import statistics

MAX_RELIABLE_DIST_M = 12.0
CLIP_MARGIN_PX = 2
DEPTH_MIN_SAMPLES = 10

def _ground(u, v, W, H, f, tilt, h):
    """Pixel -> point on the road plane: (X metres right, Z metres forward), or None above the horizon."""
    x, y = (u - W / 2) / f, (v - H / 2) / f
    s, c = math.sin(tilt), math.cos(tilt)
    dy = y * c + s
    if dy <= 1e-6:
        return None
    t = h / dy
    return (t * x, t * (c - y * s))

def ground_size(box: dict, W: int, H: int, cam_h_m: float, tilt_deg: float, hfov_deg: float):
    f = (W / 2) / math.tan(math.radians(hfov_deg) / 2)
    tilt = math.radians(tilt_deg)
    x1, y1, x2, y2 = box["x1"], box["y1"], box["x2"], box["y2"]
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    pts = [_ground(u, v, W, H, f, tilt, cam_h_m) for u, v in ((cx, y2), (cx, y1), (x1, cy), (x2, cy), (cx, cy))]
    if any(p is None for p in pts):
        return None
    near, far, left, right, mid = pts
    width_cm = abs(right[0] - left[0]) * 100
    length_cm = abs(far[1] - near[1]) * 100
    dist = math.hypot(*mid)
    clipped = x1 <= CLIP_MARGIN_PX or y1 <= CLIP_MARGIN_PX or x2 >= W - CLIP_MARGIN_PX or y2 >= H - CLIP_MARGIN_PX
    ok = dist <= MAX_RELIABLE_DIST_M and not clipped and width_cm <= 300 and length_cm <= 500
    return {"width_cm": round(width_cm, 1), "length_cm": round(length_cm, 1),
            "distance_m": round(dist, 1), "reliability": "ok" if ok else "low"}

def fit_depth_model(samples):
    """samples: [(width_cm, length_cm, depth_cm)] measured on site. Returns k = median(depth / mean(width, length))."""
    valid = [(w, l, d) for w, l, d in samples if w and l and d and w > 0 and l > 0 and d > 0]
    n = len(valid)
    if n < DEPTH_MIN_SAMPLES:
        return {"k": None, "n": n, "mae_cm": None, "ready": False}
    k = statistics.median(d / ((w + l) / 2) for w, l, d in valid)
    mae = statistics.mean(abs(d - k * ((w + l) / 2)) for w, l, d in valid)
    return {"k": k, "n": n, "mae_cm": mae, "ready": True}

def danger_pct(area_m2, area_frac, depth_cm, confirmations, confidence) -> int:
    """Transparent 0-100 risk INDEX (not a physical quantity): size 45%, depth 30%, repeat reports 15%, AI confidence 10%.
    If depth is unknown its weight is shared by the other factors."""
    size = min(1.0, area_m2 / 0.5) if area_m2 is not None else min(1.0, (area_frac or 0.0) / 0.10)
    parts = [(0.45, size), (0.15, min(1.0, (confirmations or 1) / 5)), (0.10, min(1.0, confidence or 0.0))]
    if depth_cm is not None:
        parts.append((0.30, min(1.0, depth_cm / 10)))
    total = sum(w for w, _ in parts)
    return round(100 * sum(w * v for w, v in parts) / total)

def danger_level(pct: int) -> str:
    return "low" if pct < 35 else "medium" if pct < 65 else "high"

def estimate_cost(budget: dict, level: str, area_m2) -> int:
    return round(float(budget[level]) + float(budget["per_m2"]) * (area_m2 or 0.0))

def haversine_m(lat1, lng1, lat2, lng2) -> float:
    R, rad = 6371000.0, math.pi / 180
    dlat, dlng = (lat2 - lat1) * rad, (lng2 - lng1) * rad
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))
