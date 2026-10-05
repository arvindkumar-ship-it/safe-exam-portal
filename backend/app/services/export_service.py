import csv
import io
from sqlalchemy.orm import Session
from app.services import result_service

COLUMNS = ["studentEmail", "studentName", "attemptStatus", "totalMarks", "maxMarks", "passed", "riskLevel"]


def _safe(value):
    """CSV/formula injection: =,+,-,@ (aur tab/CR) se shuru text ke aage ' lagao. Numbers server-generated hain."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def results_csv(db: Session, user, exam_id: str) -> str:
    rows = result_service.list_exam_results(db, user, exam_id)  # manage check yahin hota hai
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNS)
    for r in rows:
        w.writerow([_safe(r["studentEmail"]), _safe(r["studentName"]), _safe(r["attemptStatus"]),
                    "" if r["totalMarks"] is None else r["totalMarks"], "" if r["maxMarks"] is None else r["maxMarks"],
                    "" if r["passed"] is None else str(r["passed"]).lower(), _safe(r["riskLevel"])])
    return buf.getvalue()
