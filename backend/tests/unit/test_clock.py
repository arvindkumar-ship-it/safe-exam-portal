from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS
from app.services import time_service as ts

T = datetime(2030, 1, 1, tzinfo=timezone.utc)
A = NS(expires_at=T)


def test_boundary_second():
    assert not ts.is_expired(A, T - timedelta(seconds=1))
    assert ts.is_expired(A, T)
    assert ts.remaining_seconds(A, T - timedelta(seconds=30)) == 30
    assert ts.remaining_seconds(A, T + timedelta(seconds=30)) == 0


def test_grace():
    assert ts.within_submit_grace(A, T + timedelta(seconds=4))
    assert not ts.within_submit_grace(A, T + timedelta(seconds=5))
