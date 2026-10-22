from app.rules import can_delete_report, can_transition, classify

def box(w, h):
    return {"x1": 0, "y1": 0, "x2": w, "y2": h, "confidence": 0.9}

def test_severity_thresholds():
    assert classify([box(10, 10)], 640, 480) == "low"
    assert classify([box(150, 100)], 640, 480) == "medium"
    assert classify([box(300, 200)], 640, 480) == "high"
    assert classify([], 640, 480) == "low"

def test_admin_transitions():
    assert can_transition("reported", "assigned")
    assert can_transition("repaired", "verified")
    assert not can_transition("reported", "verified")
    assert not can_transition("verified", "reported")
    assert not can_transition("bogus", "assigned")

def test_officer_can_only_do_field_work():
    assert can_transition("assigned", "in_repair", "officer")
    assert can_transition("in_repair", "repaired", "officer")
    assert not can_transition("repaired", "verified", "officer")
    assert not can_transition("reported", "assigned", "officer")
    assert not can_transition("reported", "rejected", "officer")

def test_citizen_can_do_nothing():
    assert not can_transition("reported", "rejected", "citizen")

def test_delete_rules():
    assert can_delete_report("admin", False, "in_repair")
    assert can_delete_report("citizen", True, "reported")
    assert not can_delete_report("citizen", True, "assigned")
    assert not can_delete_report("citizen", False, "reported")
    assert not can_delete_report("officer", False, "in_repair")
