import time
import weakref
from collections import defaultdict, deque
from fastapi import Request
from app.errors import AppError

_all: "weakref.WeakSet[RateLimiter]" = weakref.WeakSet()


class RateLimiter:
    """Simple in-memory sliding window (single process ke liye)."""
    def __init__(self, max_calls: int, window_seconds: int):
        self.max_calls, self.window = max_calls, window_seconds
        self.hits: dict[str, deque] = defaultdict(deque)
        _all.add(self)

    def hit(self, key: str) -> None:
        now, q = time.monotonic(), self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max_calls:
            raise AppError("RATE_LIMITED", "Too many requests. Please try again later.")
        q.append(now)


def reset_all() -> None:
    for rl in list(_all):
        rl.hits.clear()


def rate_limit(name: str, max_calls: int, window: int):
    limiter = RateLimiter(max_calls, window)

    def dep(request: Request):
        limiter.hit(f"{name}:{request.client.host if request.client else 'x'}")
    return dep
