import pytest
from app.events.risk_rules import EVENT_WEIGHTS, risk_level, severity_for, weight_for


@pytest.mark.parametrize("score,level", [(0, "NORMAL"), (19, "NORMAL"), (20, "WARNING"), (39, "WARNING"),
                                         (40, "REVIEW_REQUIRED"), (59, "REVIEW_REQUIRED"), (60, "HIGH_RISK"), (500, "HIGH_RISK")])
def test_level_boundaries(score, level):
    assert risk_level(score) == level


@pytest.mark.parametrize("w,sev", [(0, "INFO"), (1, "LOW"), (5, "LOW"), (6, "MEDIUM"), (14, "MEDIUM"), (15, "HIGH"), (30, "HIGH")])
def test_severity(w, sev):
    assert severity_for(w) == sev


def test_weights_and_network_zero_accessibility_zero():
    assert EVENT_WEIGHTS["FULLSCREEN_EXIT"] == 10 and EVENT_WEIGHTS["UNAUTHORIZED_PROCESS"] == 30
    assert weight_for("NETWORK_DISCONNECTED", {}) == 0 and weight_for("NETWORK_RECONNECTED", {}) == 0
    assert weight_for("HEARTBEAT_MISSED", {}) == 0 and weight_for("SOMETHING_ELSE", {}) == 0
    assert weight_for("FULLSCREEN_EXIT", {"accessibilityMode": True}) == 0
    assert weight_for("FULLSCREEN_EXIT", {"accessibilityMode": "yes"}) == 10
