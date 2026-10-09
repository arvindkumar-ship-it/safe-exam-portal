import asyncio
import importlib
import logging
import pkgutil
import subprocess
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app import routes
from app.config import get_settings
from app.errors import new_request_id, register_error_handlers

log = logging.getLogger("safeexam")


async def _expiry_loop(interval: int):
    from app.database import session_scope
    from app.services import time_service
    while True:
        await asyncio.sleep(interval)
        try:
            def run():
                with session_scope() as db:
                    return time_service.auto_submit_expired(db)
            await asyncio.to_thread(run)
        except Exception:
            log.exception("expiry sweep failed")


async def _judge_supervisor():
    """Judge worker ko child process me chalata hai aur mar jaye to restart karta hai (JUDGE_EMBEDDED=true)."""
    proc = None
    try:
        while True:
            if proc is None or proc.poll() is not None:
                if proc is not None:
                    log.error("embedded judge exited rc=%s, restarting", proc.returncode)
                proc = subprocess.Popen([sys.executable, "-m", "app.judge.worker"])
                log.info("embedded judge started pid=%s", proc.pid)
            await asyncio.sleep(5)
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    task = None
    judge_task = None
    if s.JUDGE_EMBEDDED and s.ENV != "test":
        judge_task = asyncio.create_task(_judge_supervisor())
    if s.ENV != "test":
        try:
            importlib.import_module("app.services.time_service")  # A-12 ke baad hi chalega
            task = asyncio.create_task(_expiry_loop(s.EXPIRY_SWEEP_SECONDS))
        except ImportError:
            pass
    yield
    if task:
        task.cancel()
    if judge_task:
        judge_task.cancel()
        try:
            await judge_task
        except asyncio.CancelledError:
            pass


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="SafeExam API", lifespan=lifespan)
    register_error_handlers(app)

    @app.middleware("http")
    async def request_id_mw(request: Request, call_next):
        request.state.request_id = new_request_id()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    # CORS sirf ALLOWED_ORIGINS
    app.add_middleware(CORSMiddleware, allow_origins=s.origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    for m in sorted(pkgutil.iter_modules(routes.__path__), key=lambda m: m.name):
        app.include_router(importlib.import_module(f"app.routes.{m.name}").router)
    return app


app = create_app()