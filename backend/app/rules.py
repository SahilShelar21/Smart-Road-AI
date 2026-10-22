"""Pure business rules (no framework imports) so they are easy to unit test."""

# Severity is an IMAGE-BASED HEURISTIC: fraction of the frame covered by the largest detected box.
# It depends on camera distance and is NOT a physical measurement. Calibrate before relying on it.
SEVERITY_MEDIUM = 0.02
SEVERITY_HIGH = 0.06

def classify(dets: list[dict], width: int, height: int) -> str:
    if not dets or width <= 0 or height <= 0:
        return "low"
    frac = max((d["x2"] - d["x1"]) * (d["y2"] - d["y1"]) for d in dets) / (width * height)
    return "high" if frac >= SEVERITY_HIGH else "medium" if frac >= SEVERITY_MEDIUM else "low"

TRANSITIONS = {
    "reported": {"assigned", "rejected"},
    "assigned": {"in_repair", "reported"},
    "in_repair": {"repaired"},
    "repaired": {"verified", "in_repair"},
    "verified": set(),
    "rejected": set(),
}

# Officers may only do the field work; everything else (assigning, rejecting, closing) is admin-only.
OFFICER_TRANSITIONS = {"assigned": {"in_repair"}, "in_repair": {"repaired"}}

def can_transition(old: str, new: str, role: str = "admin") -> bool:
    if role == "admin":
        return new in TRANSITIONS.get(old, set())
    if role == "officer":
        return new in OFFICER_TRANSITIONS.get(old, set())
    return False

DUPLICATE_RADIUS_M = 15
DUPLICATE_WINDOW_DAYS = 30

def can_delete_report(role: str, is_owner: bool, status: str) -> bool:
    """Admins can delete any report. Everyone else only their OWN report, and only before it is assigned."""
    if role == "admin":
        return True
    return is_owner and status == "reported"
