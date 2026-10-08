import logging
import uuid
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("safeexam")

STATUS = {
    "VALIDATION_ERROR": 422, "UNAUTHENTICATED": 401, "TOKEN_EXPIRED": 401, "TOKEN_REVOKED": 401,
    "INVALID_CREDENTIALS": 401, "ACCOUNT_INACTIVE": 403, "ACCOUNT_LOCKED": 423, "FORBIDDEN": 403,
    "NOT_FOUND": 404, "EMAIL_ALREADY_EXISTS": 409, "RATE_LIMITED": 429, "INTERNAL_ERROR": 500,
    "INVALID_STATE_TRANSITION": 409, "EXAM_NOT_EDITABLE": 409, "EXAM_NOT_PUBLISHABLE": 422,
    "EXAM_NOT_AVAILABLE": 409, "QUESTION_IN_USE": 409, "INVALID_ANSWER": 422,
    "QUESTION_NOT_IN_ATTEMPT": 404, "ATTEMPT_ALREADY_ACTIVE": 409, "ATTEMPT_LIMIT_REACHED": 409,
    "ATTEMPT_NOT_ACTIVE": 409, "ATTEMPT_ALREADY_SUBMITTED": 409, "ATTEMPT_EXPIRED": 409,
    "ANSWER_VERSION_CONFLICT": 409, "EVENT_TYPE_UNKNOWN": 422, "EVENT_METADATA_TOO_LARGE": 422,
    "EVENT_TIMESTAMP_INVALID": 422, "EVENT_MIXED_SOURCE": 422, "RESULT_NOT_AVAILABLE": 403,
    "REVIEW_NOT_ALLOWED": 409, "DUPLICATE_SUBMISSION": 409, "SUBMISSION_LIMIT_REACHED": 409,
}


class AppError(Exception):
    def __init__(self, code: str, message: str | None = None, status_code: int | None = None, details: dict | None = None):
        self.code = code
        self.message = message or code.replace("_", " ").capitalize()
        self.status_code = status_code or STATUS.get(code, 400)
        self.details = details
        super().__init__(self.message)


def _rid(request: Request | None) -> str:
    return getattr(request.state, "request_id", "req_unknown") if request is not None else "req_unknown"


def ok(data, request: Request | None = None) -> dict:
    return {"data": data, "error": None, "requestId": _rid(request)}


def error_body(code: str, message: str, request: Request | None, details: dict | None = None) -> dict:
    err = {"code": code, "message": message}
    if details:
        err["details"] = details
    return {"data": None, "error": err, "requestId": _rid(request)}


def new_request_id() -> str:
    return "req_" + uuid.uuid4().hex[:8]


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error")  # stack trace sirf log me, response me nahi
        return JSONResponse(status_code=500, content=error_body("INTERNAL_ERROR", "Something went wrong.", request))

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content=error_body(exc.code, exc.message, request, exc.details))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        fields = [f"{'.'.join(str(p) for p in e['loc'] if p != 'body')}: {e['msg']}" for e in exc.errors()]
        return JSONResponse(status_code=422, content=error_body("VALIDATION_ERROR", "; ".join(fields)[:500], request, {"fields": fields}))

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        code = {404: "NOT_FOUND", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 405: "VALIDATION_ERROR"}.get(exc.status_code, "INTERNAL_ERROR")
        return JSONResponse(status_code=exc.status_code, content=error_body(code, str(exc.detail), request))
