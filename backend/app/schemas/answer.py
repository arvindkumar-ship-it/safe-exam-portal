from typing import Any
from pydantic import Field
from app.schemas.common import CamelModel


class AnswerIn(CamelModel):
    answer_value: Any
    version: int = Field(ge=0)
