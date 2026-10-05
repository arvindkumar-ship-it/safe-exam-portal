from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.security.permissions import Role, require_roles
from app.services import export_service

router = APIRouter(tags=["exports"])


@router.get("/exams/{exam_id}/export/results.csv")
def results_csv(exam_id: str, user=Depends(require_roles(Role.INSTRUCTOR, Role.ADMIN)), db: Session = Depends(get_db)):
    data = export_service.results_csv(db, user, exam_id)  # envelope nahi, plain text/csv
    return StreamingResponse(iter([data]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="results-{exam_id}.csv"'})
