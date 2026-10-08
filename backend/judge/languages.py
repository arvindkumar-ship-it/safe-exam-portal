"""Judge languages. Ek hi jagah: API validation aur sandbox worker dono yahin se padhte hain."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    id: str
    label: str
    source_name: str
    compile: tuple[str, ...] | None   # {src} {exe} placeholders
    run: tuple[str, ...]              # {src} {exe} placeholders
    tl_mult: float                    # question time limit * tl_mult


LANGUAGES: dict[str, Language] = {l.id: l for l in (
    Language("cpp17", "C++17 (g++ -O2)", "main.cpp",
             ("g++", "-std=c++17", "-O2", "-pipe", "-static", "-s", "-o", "{exe}", "{src}"), ("{exe}",), 1.0),
    Language("c11", "C11 (gcc -O2)", "main.c",
             ("gcc", "-std=c11", "-O2", "-pipe", "-static", "-s", "-o", "{exe}", "{src}", "-lm"), ("{exe}",), 1.0),
    Language("python3", "Python 3", "main.py", None, ("python3", "-B", "{src}"), 3.0),
    Language("pypy3", "PyPy 3", "main.py", None, ("pypy3", "{src}"), 2.0),
)}
