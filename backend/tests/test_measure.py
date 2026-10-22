import math
from app.measure import danger_level, danger_pct, estimate_cost, fit_depth_model, ground_size, haversine_m

W, H, HFOV, CAM_H, TILT = 640, 480, 70.0, 1.2, 10.0

def project(X, Z):
    """Forward camera model, independent of the back-projection under test."""
    f = (W / 2) / math.tan(math.radians(HFOV) / 2)
    t = math.radians(TILT)
    xc, yc, zc = X, CAM_H * math.cos(t) - Z * math.sin(t), CAM_H * math.sin(t) + Z * math.cos(t)
    return W / 2 + f * xc / zc, H / 2 + f * yc / zc

def test_ground_size_recovers_known_pothole():
    # 60 cm wide x 80 cm long patch centred 6 m ahead
    u_l, v_near = project(-0.30, 5.6); u_r, _ = project(0.30, 5.6); _, v_far = project(0.0, 6.4)
    box = {"x1": u_l, "x2": u_r, "y1": v_far, "y2": v_near}
    s = ground_size(box, W, H, CAM_H, TILT, HFOV)
    assert abs(s["length_cm"] - 80) < 3
    assert abs(s["width_cm"] - 60) / 60 < 0.10   # width is read at the box mid-row, so a small bias is expected
    assert 5.5 < s["distance_m"] < 6.6 and s["reliability"] == "ok"

def test_box_above_horizon_is_rejected():
    assert ground_size({"x1": 100, "x2": 200, "y1": 5, "y2": 40}, W, H, CAM_H, 0.0, HFOV) is None

def test_far_or_clipped_boxes_are_low_reliability():
    u, v = project(0.0, 25.0)
    far = ground_size({"x1": u - 3, "x2": u + 3, "y1": v - 2, "y2": v + 2}, W, H, CAM_H, TILT, HFOV)
    assert far and far["reliability"] == "low"

def test_depth_model_locked_until_enough_samples():
    few = [(50, 60, 5)] * 9
    assert fit_depth_model(few)["ready"] is False
    many = [(50, 60, 5.5)] * 10
    m = fit_depth_model(many)
    assert m["ready"] and abs(m["k"] - 0.1) < 1e-9 and m["mae_cm"] < 1e-9

def test_danger_and_cost():
    assert danger_pct(0.5, None, 10, 5, 1.0) == 100
    assert danger_pct(None, 0.0, None, 1, 0.0) < 10
    assert danger_level(10) == "low" and danger_level(50) == "medium" and danger_level(90) == "high"
    b = {"low": 1000, "medium": 2000, "high": 4000, "per_m2": 1000}
    assert estimate_cost(b, "medium", 0.5) == 2500 and estimate_cost(b, "low", None) == 1000

def test_haversine():
    assert abs(haversine_m(19.0, 72.8, 19.0, 72.8)) < 1e-6
    assert 110_000 < haversine_m(19.0, 72.8, 20.0, 72.8) < 112_500
