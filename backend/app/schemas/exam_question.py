from decimal import Decimal
from pydantic import Field
from app.schemas.common import CamelModel
from app.schemas.question import question_out


class AttachIn(CamelModel):
    question_id: str
    position: int | None = Field(None, ge=1)
    marks: Decimal | None = Field(None, gt=0, max_digits=6, decimal_places=2)
    required: bool = True


class OrderIn(CamelModel):
    question_ids: list[str]


def exam_question_out(eq) -> dict:
    return {"questionId": eq.question_id, "position": eq.position, "required": eq.required,
            "marks": float(eq.marks if eq.marks is not None else eq.question.marks),
            "question": question_out(eq.question)}
