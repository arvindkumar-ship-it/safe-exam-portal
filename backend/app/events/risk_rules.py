EVENT_WEIGHTS = {
    "PAGE_HIDDEN": 5, "WINDOW_BLUR": 3, "FULLSCREEN_EXIT": 10, "CLIPBOARD_ATTEMPT": 15, "COPY_SHORTCUT": 5,
    "PASTE_SHORTCUT": 5, "DEVTOOLS_SHORTCUT": 10, "PRINT_SHORTCUT": 5, "PRINT_ATTEMPT": 10,
    "SCREENSHOT_ATTEMPT": 15, "CONTEXT_MENU_ATTEMPT": 2, "CAMERA_PERMISSION_CHANGED": 20,
    "UNAUTHORIZED_PROCESS": 30, "MULTIPLE_MONITOR": 20, "NETWORK_DISCONNECTED": 0,
}  # baaki sab default 0 (network events dahi zero)


def severity_for(weight: int) -> str:
    if weight <= 0:
        return "INFO"
    if weight <= 5:
        return "LOW"
    if weight <= 14:
        return "MEDIUM"
    return "HIGH"


def risk_level(score: int) -> str:
    if score < 20:
        return "NORMAL"
    if score < 40:
        return "WARNING"
    if score < 60:
        return "REVIEW_REQUIRED"
    return "HIGH_RISK"


def weight_for(event_type: str, metadata: dict | None) -> int:
    if (metadata or {}).get("accessibilityMode") is True:
        return 0  # accessibility mode me penalty nahi
    return EVENT_WEIGHTS.get(event_type, 0)
