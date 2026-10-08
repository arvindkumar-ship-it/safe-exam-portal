from app.config import get_settings


def effective_policy(exam) -> dict:
    """Exam ki monitoringPolicy + platform default. Frontend aur server dono yahi dekhte hain => dono ek jaisa behave karte hain."""
    return {"autoSubmitOnViolation": get_settings().STRICT_MODE_DEFAULT, **(exam.monitoring_policy or {})}
