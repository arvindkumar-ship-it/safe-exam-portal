from decimal import Decimal
from pydantic import AwareDatetime, Field, field_validator, model_validator
from app.schemas.common import CamelModel
from app.utils.clock import to_iso


class ExamCreateIn(CamelModel):
    title: str
    description: str | None = None
    duration_seconds: int = Field(gt=0)
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    show_result: bool = False
    max_attempts: int = Field(1, ge=1)
    shuffle_questions: bool = True
    shuffle_options: bool = True
    pass_marks: Decimal | None = Field(None, ge=0, max_digits=6, decimal_places=2)
    lock_on_high_risk: bool = False
    monitoring_policy: dict = Field(default_factory=dict)

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("title must not be empty")
        return v

    @model_validator(mode="after")
    def _window(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("endsAt must be after startsAt")
        return self


class ExamUpdateIn(CamelModel):
    title: str | None = None
    description: str | None = None
    duration_seconds: int | None = Field(None, gt=0)
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    show_result: bool | None = None
    max_attempts: int | None = Field(None, ge=1)
    shuffle_questions: bool | None = None
    shuffle_options: bool | None = None
    pass_marks: Decimal | None = Field(None, ge=0, max_digits=6, decimal_places=2)
    lock_on_high_risk: bool | None = None
    monitoring_policy: dict | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v):
        if v is not None and not v.strip():
            raise ValueError("title must not be empty")
        return v.strip() if v else v


class StatusIn(CamelModel):
    to: str


def exam_out(e, student: bool = False) -> dict:
    d = {"id": e.id, "title": e.title, "description": e.description, "durationSeconds": e.duration_seconds,
         "status": e.status, "startsAt": to_iso(e.starts_at), "endsAt": to_iso(e.ends_at),
         "showResult": e.show_result, "maxAttempts": e.max_attempts, "monitoringPolicy": e.monitoring_policy or {}}
    if not student:
        d.update({"shuffleQuestions": e.shuffle_questions, "shuffleOptions": e.shuffle_options,
                  "passMarks": float(e.pass_marks) if e.pass_marks is not None else None,
                  "lockOnHighRisk": e.lock_on_high_risk, "createdBy": e.created_by,
                  "createdAt": to_iso(e.created_at), "updatedAt": to_iso(e.updated_at)})
    return d
