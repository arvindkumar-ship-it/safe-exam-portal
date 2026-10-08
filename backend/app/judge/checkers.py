"""Output checkers: TOKENS (whitespace-insensitive), LINES (trailing ws/blank lines ignore), FLOAT (abs/rel eps)."""
import re

_NUM = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")
_SPECIAL = {"nan", "+nan", "-nan", "inf", "+inf", "-inf"}


def _lines(s: str) -> list[str]:
    out = [ln.rstrip(" \t\r\f\v") for ln in s.split("\n")]
    while out and not out[-1]:
        out.pop()
    return out


def _num(tok: str):
    t = tok.lower()
    if t in _SPECIAL or _NUM.match(tok):
        try:
            return float(t)
        except ValueError:
            return None
    return None


def _tok_eq(e: str, a: str, eps: float) -> bool:
    if e == a:
        return True
    x, y = _num(e), _num(a)
    if x is None or y is None:
        return False
    if x != x or y != y:                       # nan
        return x != x and y != y
    if x in (float("inf"), float("-inf")) or y in (float("inf"), float("-inf")):
        return x == y
    return abs(x - y) <= eps * max(1.0, abs(x))


def check(kind: str, expected: str, actual: str, eps: float = 1e-6) -> bool:
    if kind == "LINES":
        return _lines(expected) == _lines(actual)
    et, at = expected.split(), actual.split()
    if len(et) != len(at):
        return False
    if kind == "FLOAT":
        return all(_tok_eq(e, a, eps) for e, a in zip(et, at))
    return et == at                             # TOKENS
