from fastapi import APIRouter, Request
from app.errors import ok
from app.utils import clock

router = APIRouter()


@router.get("/health")
def health(request: Request):
    return ok({"status": "ok", "serverTime": clock.to_iso(clock.utc_now())}, request)
