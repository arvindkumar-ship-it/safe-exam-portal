"""Judge worker: Postgres queue (SKIP LOCKED) + LISTEN/NOTIFY wake + lease/reaper. `python -m app.judge.worker`.
Scale: multiple workers safe. Crash par lease expire -> requeue (JUDGE_MAX_TRIES ke baad SE)."""
import logging
import os
import select
import signal
import socket
import time
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select as sa_select, text

from app.config import get_settings
from app.database import SessionLocal
from app.judge import runner
from app.models.attempt import Attempt
from app.models.code_submission import CodeSubmission
from app.models.coding_test import CodingTest
from app.models.exam_question import ExamQuestion
from app.services import code_submission_service, coding_test_service
from app.utils import clock

log = logging.getLogger("judge")
JUDGE_ID = f"{socket.gethostname()}-{os.getpid()}"
_CLAIM = text("""UPDATE code_submissions SET status='JUDGING', judge_id=:j, started_at=:now, lease_until=:lease, tries=tries+1
  WHERE id=(SELECT id FROM code_submissions WHERE status='QUEUED' ORDER BY priority, queued_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING id""")


def _lease():
    return clock.utc_now() + timedelta(seconds=get_settings().JUDGE_LEASE_SECONDS)


def claim() -> str | None:
    with SessionLocal() as db:
        row = db.execute(_CLAIM, {"j": JUDGE_ID, "now": clock.utc_now(), "lease": _lease()}).first()
        db.commit()
        return row[0] if row else None


def _heartbeat(sid: str):
    with SessionLocal() as db:
        db.execute(text("UPDATE code_submissions SET lease_until=:l WHERE id=:i AND status='JUDGING'"), {"l": _lease(), "i": sid})
        db.commit()


def _finish(sid: str, res: dict):
    with SessionLocal() as db:
        cs = db.get(CodeSubmission, sid)
        cs.status, cs.verdict, cs.passed, cs.total = "DONE", res["verdict"], res["passed"], res["total"]
        cs.score, cs.time_ms, cs.memory_kb = Decimal(res["score"]), res.get("time_ms"), res.get("memory_kb")
        cs.failed_test, cs.compile_output, cs.test_results = res.get("failed_test"), res.get("compile_output"), res.get("tests", [])
        cs.finished_at, cs.lease_until = clock.utc_now(), None
        db.commit()
        code_submission_service.on_judged(db, cs)


def _system_error(sid: str, why: str):
    log.error("SE %s: %s", sid, why)
    _finish(sid, {"verdict": "SE", "passed": 0, "total": 0, "score": Decimal("0"), "tests": []})


def _process(sid: str):
    with SessionLocal() as db:
        cs = db.get(CodeSubmission, sid)
        eid = db.scalar(sa_select(Attempt.exam_id).where(Attempt.id == cs.attempt_id))
        snap = db.scalar(sa_select(ExamQuestion.snapshot).where(ExamQuestion.exam_id == eid, ExamQuestion.question_id == cs.question_id))
        rows = list(db.scalars(sa_select(CodingTest).where(CodingTest.question_id == cs.question_id).order_by(CodingTest.position)))
        lang, source, mode = cs.language, cs.source, cs.mode
        total = cs.total
    if not snap or "coding" not in snap or "testsHash" not in snap:
        return _system_error(sid, "snapshot missing")
    if coding_test_service.tests_hash(rows) != snap["testsHash"]:
        return _system_error(sid, "tests changed after publish")
    tests = [{"position": t.position, "is_sample": t.is_sample, "weight": t.weight, "input": t.input_text, "output": t.output_text} for t in rows]
    res = runner.judge(lang, source, snap["coding"], tests, mode, snap["marks"], heartbeat=lambda: _heartbeat(sid))
    _finish(sid, res)


def run_once() -> bool:
    sid = claim()
    if not sid:
        return False
    try:
        _process(sid)
    except Exception:
        log.exception("judge crashed on %s", sid)
        with SessionLocal() as db:
            tries = db.scalar(sa_select(CodeSubmission.tries).where(CodeSubmission.id == sid))
        if tries >= get_settings().JUDGE_MAX_TRIES:
            _system_error(sid, "judge crashed")
        else:
            with SessionLocal() as db:
                db.execute(text("UPDATE code_submissions SET status='QUEUED', judge_id=NULL, lease_until=NULL WHERE id=:i AND status='JUDGING'"), {"i": sid})
                db.commit()
            time.sleep(0.5)
    return True


def reap_expired() -> int:
    s, now, dead = get_settings(), clock.utc_now(), []
    with SessionLocal() as db:
        base = "FROM code_submissions WHERE status='JUDGING' AND lease_until < :now AND tries {} :m"
        p = {"now": now, "m": s.JUDGE_MAX_TRIES}
        dead = [r[0] for r in db.execute(text("UPDATE code_submissions SET status='DONE', verdict='SE', passed=0, score=0, finished_at=:now, lease_until=NULL "
                                              "WHERE id IN (SELECT id " + base.format(">=") + ") RETURNING id"), p)]
        back = [r[0] for r in db.execute(text("UPDATE code_submissions SET status='QUEUED', judge_id=NULL, lease_until=NULL "
                                              "WHERE id IN (SELECT id " + base.format("<") + ") RETURNING id"), p)]
        for i in back:
            db.execute(text("SELECT pg_notify('judge_queue', :i)"), {"i": i})
        db.commit()
        for i in dead:
            cs = db.get(CodeSubmission, i)
            code_submission_service.on_judged(db, cs)
    return len(dead) + len(back)


def _dsn() -> str:
    return get_settings().DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")


def main():
    import psycopg
    logging.basicConfig(level=logging.INFO, format="%(asctime)s judge %(message)s")
    rfd, wfd = os.pipe()
    os.set_blocking(wfd, False)
    signal.set_wakeup_fd(wfd)
    stop = []
    for sg in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sg, lambda *_: stop.append(1))
    log.info("worker %s up", JUDGE_ID)
    last_reap = 0.0
    while not stop:
        try:
            with psycopg.connect(_dsn(), autocommit=True) as conn:
                conn.execute("LISTEN judge_queue")               # pehle LISTEN, phir drain: koi wakeup miss nahi
                while not stop:
                    if time.monotonic() - last_reap > 10:
                        reap_expired()
                        last_reap = time.monotonic()
                    while not stop and run_once():
                        pass
                    if stop:
                        break
                    r, _, _ = select.select([conn.fileno(), rfd], [], [], 5.0)
                    if conn.fileno() in r:
                        conn.pgconn.consume_input()
                        while conn.pgconn.notifies():
                            pass
        except Exception:
            if stop:
                break
            log.exception("db unavailable, retry in 2s")          # migrations abhi chal rahi ho sakti hain
            time.sleep(2)
    log.info("worker stopped")


if __name__ == "__main__":
    main()
