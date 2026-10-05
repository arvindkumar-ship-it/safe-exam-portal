from decimal import Decimal
from typing import Literal
from pydantic import Field, field_validator
from app.schemas.common import CamelModel

QType = Literal["MCQ_SINGLE", "MCQ_MULTIPLE", "SHORT_TEXT"]


class QuestionCreateIn(CamelModel):
    question_type: QType
    prompt: str = Field(min_length=1)
    options: list[dict] | None = None
    correct_answer: object | None = None
    marks: Decimal = Field(gt=0, max_digits=6, decimal_places=2)
    negative_marks: Decimal = Field(Decimal("0"), ge=0, max_digits=6, decimal_places=2)
    explanation: str | None = None

    @field_validator("prompt")
    @classmethod
    def _p(cls, v):
        if not v.strip():
            raise ValueError("prompt must not be empty")
        return v


class QuestionUpdateIn(CamelModel):
    prompt: str | None = Field(None, min_length=1)
    options: list[dict] | None = None
    correct_answer: object | None = None
    marks: Decimal | None = Field(None, gt=0, max_digits=6, decimal_places=2)
    negative_marks: Decimal | None = Field(None, ge=0, max_digits=6, decimal_places=2)
    explanation: str | None = None


def question_out(q) -> dict:
    """Instructor/admin view: correctAnswer ke saath."""
    return {"id": q.id, "questionType": q.question_type, "prompt": q.prompt, "options": q.options,
            "correctAnswer": q.correct_answer, "marks": float(q.marks), "negativeMarks": float(q.negative_marks),
            "explanation": q.explanation, "isActive": q.is_active, "version": q.version, "createdBy": q.created_by}
