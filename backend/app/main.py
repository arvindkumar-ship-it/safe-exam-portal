import asyncio
import importlib
import logging
import pkgutil
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    task = None
    if s.ENV != "test":
        try:
            importlib.import_module("app.services.time_service")  # A-12 ke baad hi chalega
            task = asyncio.create_task(_expiry_loop(s.EXPIRY_SWEEP_SECONDS))
        except ImportError:
            pass
    yield
    if task:
        task.cancel()


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
