from typing import Literal
from pydantic import Field
from app.schemas.common import CamelModel
from app.utils.clock import to_iso


class CodeSubmitIn(CamelModel):
    question_id: str = Field(min_length=1, max_length=36)
    language: str = Field(min_length=1, max_length=16)
    source: str = Field(min_length=1)
    mode: Literal["RUN", "SUBMIT"] = "SUBMIT"


class CodingTestIn(CamelModel):
    input: str
    output: str
    is_sample: bool = False
    weight: int = Field(1, ge=1, le=1000)


class CodingTestsCreateIn(CamelModel):
    tests: list[CodingTestIn] = Field(min_length=1, max_length=50)


def submission_out(cs, with_source: bool = False) -> dict:
    d = {"id": cs.id, "attemptId": cs.attempt_id, "questionId": cs.question_id, "language": cs.language,
         "mode": cs.mode, "status": cs.status, "verdict": cs.verdict, "passed": cs.passed, "total": cs.total,
         "score": float(cs.score), "maxScore": float(cs.max_score), "timeMs": cs.time_ms, "memoryKb": cs.memory_kb,
         "failedTest": cs.failed_test, "compileOutput": cs.compile_output, "tests": cs.test_results or [],
         "createdAt": to_iso(cs.created_at), "finishedAt": to_iso(cs.finished_at)}
    if with_source:
        d["source"] = cs.source
    return d
