"""Sandbox + runner asli process chalate hain (Linux + g++ chahiye)."""
import platform
import shutil
import pytest
from app.judge.runner import judge

pytestmark = pytest.mark.skipif(platform.system() != "Linux" or not shutil.which("g++"), reason="needs Linux + g++")
CFG = {"timeLimitMs": 1000, "memoryLimitMb": 64, "checker": "TOKENS", "scoring": "ALL_OR_NOTHING"}
T = [{"position": 1, "is_sample": True, "weight": 1, "input": "1 2\n", "output": "3\n"},
     {"position": 2, "is_sample": False, "weight": 3, "input": "5 7\n", "output": "12\n"}]
CPP = "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}"
PY = "print(sum(map(int,input().split())))"


def v(lang, src, cfg=CFG, mode="SUBMIT"):
    return judge(lang, src, cfg, T, mode, 10)


def test_accept_python_and_cpp():
    for lang, src in (("python3", PY), ("cpp17", CPP)):
        r = v(lang, src)
        assert (r["verdict"], r["passed"], r["total"], str(r["score"])) == ("AC", 2, 2, "10")


@pytest.mark.parametrize("lang,src,want", [
    ("python3", "print(1)", "WA"), ("python3", "import sys; sys.exit(3)", "RE"),
    ("python3", "x=bytearray(400<<20)", "MLE"), ("python3", "while True: print('a'*1000)", "OLE"),
    ("python3", "import socket; socket.socket()", "RE"),            # seccomp: network band
    ("cpp17", "int main(){", "CE"), ("cpp17", "#include <vector>\nint main(){std::vector<char> v(300<<20,1);}", "MLE"),
    ("cpp17", "int main(){int*p=0;*p=1;}", "RE"),
])
def test_failure_verdicts(lang, src, want):
    assert v(lang, src)["verdict"] == want


def test_tle_cpp():
    assert v("cpp17", "int main(){for(;;);}", {**CFG, "timeLimitMs": 300})["verdict"] == "TLE"


def test_fork_bomb_contained():
    assert v("python3", "import os\nwhile True: os.fork()")["verdict"] in ("RE", "TLE")


def test_partial_and_hidden_not_leaked():
    r = v("python3", "print(3)", {**CFG, "scoring": "PARTIAL"})   # sample pass, hidden fail
    assert r["verdict"] == "PARTIAL" and str(r["score"]) == "2.50" and r["failed_test"] == 2   # 10 * 1/4
    hidden = [t for t in r["tests"] if not t["isSample"]][0]
    assert "input" not in hidden and "expected" not in hidden and "actual" not in hidden


def test_run_mode_samples_only_no_score():
    r = v("python3", PY, mode="RUN")
    assert r["total"] == 1 and r["verdict"] == "AC" and str(r["score"]) == "0"


def test_compile_output_hides_paths():
    assert "/judge_" not in judge("cpp17", "int main(){", CFG, T, "SUBMIT", 10)["compile_output"]
