import pytest
from app.judge.checkers import check


@pytest.mark.parametrize("kind,exp,act,ok", [
    ("TOKENS", "1 2\n3", "1   2 3\r\n", True), ("TOKENS", "1 2", "1 3", False), ("TOKENS", "1 2", "1", False),
    ("LINES", "a b\nc\n", "a b  \nc\n\n\n", True), ("LINES", "a b\nc", "a  b\nc", False), ("LINES", "a\nb", "a b", False),
    ("FLOAT", "1.0 2", "1.0000001 2.0", True), ("FLOAT", "1.0", "1.1", False), ("FLOAT", "x 1", "x 1.0", True),
    ("FLOAT", "x", "y", False), ("FLOAT", "nan", "nan", True), ("FLOAT", "inf", "-inf", False),
])
def test_checkers(kind, exp, act, ok):
    assert check(kind, exp, act, 1e-6) is ok
