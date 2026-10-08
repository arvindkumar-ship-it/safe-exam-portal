"""Sandbox + judge. Linux only (fork/rlimit/seccomp). Root ho toh sandbox uid pe drop; non-root (dev/test) me uid drop skip.
Layers: rlimits (CPU/AS/FSIZE/NPROC/NOFILE) + setsid/killpg + uid drop + NO_NEW_PRIVS + seccomp denylist + output files (no pipes)."""
import ctypes
import os
import platform
import select
import shutil
import signal
import socket
import struct
import tempfile
import time
import zlib
from decimal import ROUND_DOWN, Decimal

from app.judge.checkers import check
from app.judge.languages import LANGUAGES

try:
    import resource
except ImportError:  # Windows: import chalega, judge() nahi
    resource = None

WORK = os.environ.get("JUDGE_WORK_DIR") or tempfile.gettempdir()
SANDBOX_UID = int(os.environ.get("JUDGE_UID") or 20000 + zlib.crc32(socket.gethostname().encode()) % 30000)
IS_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0
TICK_MS = 1000.0 / (os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100)
ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": "/nonexistent",
       "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"}
# address-space slack (MB): interpreter/runtime ka apna virtual footprint. Real memory enforcement RSS se bhi.
AS_SLACK = {"cpp17": 16, "c11": 16, "python3": 64, "pypy3": 700}
NPROC_RUN, NPROC_COMPILE = 32, 256
SNIP = 2000          # sample input/expected/actual ka max chars

_libc = ctypes.CDLL(None, use_errno=True) if platform.system() == "Linux" else None
if _libc is not None:
    _libc.prctl.argtypes = [ctypes.c_int] + [ctypes.c_ulong] * 4

# ---------- seccomp (denylist; arch-checked) ----------
_ARCH = {"x86_64": (0xC000003E, {"socket": 41, "ptrace": 101, "mount": 165, "umount2": 166, "pivot_root": 155, "chroot": 161,
         "reboot": 169, "kexec_load": 246, "init_module": 175, "finit_module": 313, "delete_module": 176, "bpf": 321,
         "keyctl": 250, "add_key": 248, "request_key": 249, "unshare": 272, "setns": 308, "process_vm_readv": 310,
         "process_vm_writev": 311, "io_uring_setup": 425, "io_uring_enter": 426, "io_uring_register": 427,
         "perf_event_open": 298, "setsid": 112, "setpgid": 109, "userfaultfd": 323, "syslog": 103, "swapon": 167,
         "swapoff": 168, "settimeofday": 164, "clock_settime": 227, "iopl": 172, "ioperm": 173,
         "open_by_handle_at": 304, "kcmp": 312, "acct": 163}),
         "aarch64": (0xC00000B7, {"socket": 198, "ptrace": 117, "mount": 40, "umount2": 39, "pivot_root": 41, "chroot": 51,
         "reboot": 142, "kexec_load": 104, "init_module": 105, "finit_module": 273, "delete_module": 106, "bpf": 280,
         "keyctl": 219, "add_key": 217, "request_key": 218, "unshare": 97, "setns": 268, "process_vm_readv": 270,
         "process_vm_writev": 271, "io_uring_setup": 425, "io_uring_enter": 426, "io_uring_register": 427,
         "perf_event_open": 241, "setsid": 157, "setpgid": 154, "userfaultfd": 282, "syslog": 116, "swapon": 224,
         "swapoff": 225, "settimeofday": 170, "clock_settime": 112, "open_by_handle_at": 265, "kcmp": 272, "acct": 89})}
_FILTER = None


def _build_filter():
    arch = _ARCH.get(platform.machine())
    if not arch or _libc is None:
        return None
    audit, nrs = arch
    ins = [(0x20, 0, 0, 4), (0x15, 0, 0, audit), (0x20, 0, 0, 0)]
    x32 = platform.machine() == "x86_64"
    if x32:
        ins.append((0x35, 0, 0, 0x40000000))
    first = len(ins)
    ins += [(0x15, 0, 0, n) for n in nrs.values()]
    allow, deny, kill = len(ins), len(ins) + 1, len(ins) + 2
    ins += [(0x06, 0, 0, 0x7FFF0000), (0x06, 0, 0, 0x00050000 | 1), (0x06, 0, 0, 0x80000000)]
    ins[1] = (0x15, 0, kill - 2, audit)
    if x32:
        ins[3] = (0x35, kill - 4, 0, 0x40000000)
    for i in range(first, allow):
        ins[i] = (0x15, deny - i - 1, 0, ins[i][3])
    buf = b"".join(struct.pack("HBBI", c, jt, jf, k) for c, jt, jf, k in ins)
    arr = ctypes.create_string_buffer(buf, len(buf))
    prog = struct.pack("HxxxxxxQ", len(ins), ctypes.addressof(arr))
    return arr, ctypes.create_string_buffer(prog, len(prog))


def _install_seccomp():
    global _FILTER
    if _FILTER is None:
        _FILTER = _build_filter() or False
    if not _FILTER:
        return
    _libc.prctl(38, 1, 0, 0, 0)                      # NO_NEW_PRIVS
    _libc.prctl(22, 2, ctypes.addressof(_FILTER[1]), 0, 0)   # SECCOMP_MODE_FILTER


# ---------- process spawn ----------
def _spawn(argv, cwd, fds, limits, sandbox, uid_drop):
    """fork -> limits -> setsid -> fds -> uid drop -> seccomp -> exec. Returns pid. Child kabhi return nahi karta."""
    exe = shutil.which(argv[0], path=ENV["PATH"]) or argv[0]
    pid = os.fork()
    if pid:
        return pid
    try:
        for r, v in limits:
            resource.setrlimit(r, (v, v))
        os.setsid()
        for i, fd in enumerate(fds):
            os.dup2(fd, i)
        os.closerange(3, 1024)
        os.chdir(cwd)
        if uid_drop:
            os.setgroups([])
            os.setgid(SANDBOX_UID)
            os.setuid(SANDBOX_UID)
        if sandbox:
            _install_seccomp()
        os.execve(exe, argv, {**ENV, "TMPDIR": cwd})
    except BaseException:
        pass
    os._exit(127)


def _cpu_ms(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            s = f.read()
        p = s[s.rindex(")") + 2:].split()
        return (int(p[11]) + int(p[12])) * TICK_MS
    except (OSError, ValueError, IndexError):
        return 0.0


def _reap(pgid):
    while True:
        try:
            if os.waitpid(-pgid, os.WNOHANG)[0] == 0:
                return
        except ChildProcessError:
            return


def _kill_group(pgid):
    for _ in range(200):
        try:
            os.killpg(pgid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            break
        _reap(pgid)
        time.sleep(0.0005)
    _reap(pgid)


def _run(argv, cwd, stdin_fd, out_fd, err_fd, limits, cpu_ms, wall_s, sandbox, uid_drop):
    """Returns dict(status, cpu_ms, rss_kb, killed). cpu_ms par early kill: /proc tick poll, pidfd se instant wake."""
    t0 = time.monotonic()
    pid = _spawn(argv, cwd, (stdin_fd, out_fd, err_fd), limits, sandbox, uid_drop)
    try:
        pfd = os.pidfd_open(pid)
    except (AttributeError, OSError):
        pfd = None
    killed = None
    try:
        while True:
            rp, status, ru = os.wait4(pid, os.WNOHANG)
            if rp:
                break
            if cpu_ms and _cpu_ms(pid) > cpu_ms + 2 * TICK_MS:
                killed = "TLE"
            elif time.monotonic() - t0 > wall_s:
                killed = "TLE"
            if killed:
                os.killpg(pid, signal.SIGKILL)
                _, status, ru = os.wait4(pid, 0)
                break
            if pfd is not None:
                select.select([pfd], [], [], 0.01)
            else:
                time.sleep(0.002)
    finally:
        if pfd is not None:
            os.close(pfd)
        _kill_group(pid)
    return {"status": status, "cpu_ms": int((ru.ru_utime + ru.ru_stime) * 1000), "rss_kb": ru.ru_maxrss, "killed": killed}


def _self_rss_kb():
    try:
        with open("/proc/self/status") as f:
            return next(int(l.split()[1]) for l in f if l.startswith("VmRSS"))
    except (OSError, StopIteration):
        return 1 << 20


def _clean_tmp():
    if not IS_ROOT:
        return
    for d in ("/tmp", "/var/tmp", "/dev/shm"):
        try:
            for n in os.listdir(d):
                p = os.path.join(d, n)
                if os.lstat(p).st_uid == SANDBOX_UID:
                    shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) and not os.path.islink(p) else os.unlink(p)
        except OSError:
            pass


# ---------- compile ----------
def _compile(lang, wd, src, exe):
    cmd = [a.format(src=src, exe=exe) for a in lang.compile]
    ofd = os.open(os.path.join(wd, ".cc"), os.O_CREAT | os.O_RDWR | os.O_TRUNC, 0o600)
    try:
        mb = 1 << 20
        lim = [(resource.RLIMIT_CPU, 15), (resource.RLIMIT_AS, 1536 * mb), (resource.RLIMIT_FSIZE, 64 * mb),
               (resource.RLIMIT_NPROC, NPROC_COMPILE), (resource.RLIMIT_NOFILE, 256), (resource.RLIMIT_CORE, 0)]
        if IS_ROOT:
            os.chown(wd, SANDBOX_UID, SANDBOX_UID)
        dn = os.open(os.devnull, os.O_RDONLY)
        try:
            r = _run(cmd, wd, dn, ofd, ofd, lim, 0, 25, False, IS_ROOT)
        finally:
            os.close(dn)
        os.lseek(ofd, 0, os.SEEK_SET)
        out = os.read(ofd, 8192).decode("utf-8", "replace")
    finally:
        os.close(ofd)
    ok = r["status"] == 0 and os.path.exists(os.path.join(wd, exe))
    if r["killed"]:
        out = "Compilation timed out."
    out = out.replace(wd + "/", "").replace(wd, "").strip()
    if IS_ROOT:                                   # exe/dir ab sandboxed program se modify nahi hone chahiye
        os.chown(wd, 0, 0)
        os.chmod(wd, 0o711)
        for n in os.listdir(wd):
            os.chown(os.path.join(wd, n), 0, 0)
    if ok:
        os.chmod(os.path.join(wd, exe), 0o755)
    return ok, out[:4000] or ("Compilation failed." if not ok else "")


# ---------- one test ----------
def _one(lang, wd, src, exe, cfg, t, expected_cap):
    mb = 1 << 20
    tl_ms = int(cfg["timeLimitMs"] * lang.tl_mult)
    mem_kb = int(cfg["memoryLimitMb"]) * 1024
    cap = min(max(len(t["output"]) * 2 + 65536, mb), 64 * mb)
    ip, op, ep = (os.path.join(wd, n) for n in (".in", ".out", ".err"))
    for p, data in ((ip, t["input"].encode()),):
        with open(p, "wb") as f:
            f.write(data)
    ifd = os.open(ip, os.O_RDONLY)
    ofd = os.open(op, os.O_CREAT | os.O_RDWR | os.O_TRUNC, 0o600)
    efd = os.open(ep, os.O_CREAT | os.O_RDWR | os.O_TRUNC, 0o600)
    try:
        asb = (cfg["memoryLimitMb"] + AS_SLACK[lang.id]) * mb
        lim = [(resource.RLIMIT_CPU, int(tl_ms / 1000) + 2), (resource.RLIMIT_AS, asb), (resource.RLIMIT_STACK, min(asb, 512 * mb)),
               (resource.RLIMIT_FSIZE, cap), (resource.RLIMIT_NPROC, NPROC_RUN), (resource.RLIMIT_NOFILE, 64),
               (resource.RLIMIT_CORE, 0)]
        argv = [a.format(src=src, exe=exe) for a in lang.run]
        argv[0] = os.path.join(wd, exe) if argv[0] == exe else argv[0]
        base_rss = _self_rss_kb()
        r = _run(argv, wd, ifd, ofd, efd, lim, tl_ms, tl_ms / 1000 * 1.5 + 1.0, True, IS_ROOT)
        osz = os.fstat(ofd).st_size
        os.lseek(efd, 0, os.SEEK_SET)
        err = os.read(efd, 4096).decode("utf-8", "replace")
        os.lseek(ofd, 0, os.SEEK_SET)
        actual = os.read(ofd, cap).decode("utf-8", "replace") if osz < cap else ""
    finally:
        for fd in (ifd, ofd, efd):
            os.close(fd)
        _clean_tmp()
    st = r["status"]
    sig = os.WTERMSIG(st) if os.WIFSIGNALED(st) else 0
    code = os.WEXITSTATUS(st) if os.WIFEXITED(st) else -1
    base = base_rss
    peak_known = r["rss_kb"] > base + 512            # ru_maxrss me fork-time parent RSS floor hota hai
    mem = r["rss_kb"] if peak_known else None
    if osz >= cap or sig == signal.SIGXFSZ:
        v = "OLE"
    elif r["killed"] or r["cpu_ms"] > tl_ms or sig == signal.SIGXCPU:
        v = "TLE"
    elif (peak_known and r["rss_kb"] > mem_kb) or any(m in err for m in ("MemoryError", "bad_alloc", "Cannot allocate memory")) \
            or (sig == signal.SIGKILL):
        v = "MLE"
    elif sig or code != 0:
        v = "RE"
    else:
        v = "AC" if check(cfg.get("checker", "TOKENS"), t["output"], actual, cfg.get("floatEps", 1e-6)) else "WA"
    row = {"position": t["position"], "isSample": bool(t["is_sample"]), "verdict": v, "timeMs": min(r["cpu_ms"], tl_ms * 2), "memoryKb": mem}
    if t["is_sample"]:
        row.update(input=t["input"][:SNIP], expected=t["output"][:SNIP], actual=actual[:SNIP])
    return row


def judge(language, source, cfg, tests, mode, max_marks, heartbeat=None):
    """tests: [{position,is_sample,weight,input,output}]. mode RUN -> sirf samples, score 0."""
    lang = LANGUAGES[language]
    if not shutil.which((lang.compile or lang.run)[0], path=ENV["PATH"]):   # image me toolchain nahi => CE nahi, system problem
        raise RuntimeError(f"{(lang.compile or lang.run)[0]} not installed on this judge")
    sel = [t for t in sorted(tests, key=lambda x: x["position"]) if t["is_sample"] or mode != "RUN"]
    res = {"verdict": "AC", "passed": 0, "total": len(sel), "score": Decimal("0"), "time_ms": None, "memory_kb": None,
           "failed_test": None, "compile_output": None, "tests": []}
    _libc and _libc.prctl(36, 1, 0, 0, 0)            # CHILD_SUBREAPER: orphans adopt + reap
    wd = tempfile.mkdtemp(prefix="judge_", dir=WORK)
    try:
        src, exe = lang.source_name, "prog"
        with open(os.path.join(wd, src), "w", encoding="utf-8") as f:
            f.write(source)
        os.chmod(os.path.join(wd, src), 0o644)
        if lang.compile:
            ok, out = _compile(lang, wd, src, exe)
            if not ok:
                res.update(verdict="CE", compile_output=out)
                return res
        else:
            exe = src
            if IS_ROOT:
                os.chmod(wd, 0o711)
        first_fail, pw, tw = None, 0, sum(t["weight"] for t in sel) or 1
        for t in sel:
            if heartbeat:
                heartbeat()
            row = _one(lang, wd, src, exe, cfg, t, None)
            res["tests"].append(row)
            res["time_ms"] = max(res["time_ms"] or 0, row["timeMs"])
            if row["memoryKb"]:
                res["memory_kb"] = max(res["memory_kb"] or 0, row["memoryKb"])
            if row["verdict"] == "AC":
                res["passed"] += 1
                pw += t["weight"]
            else:
                first_fail = first_fail or row
                if cfg.get("scoring") != "PARTIAL" or mode == "RUN":
                    break
        if first_fail:
            res["failed_test"] = first_fail["position"]
            res["verdict"] = "PARTIAL" if (cfg.get("scoring") == "PARTIAL" and mode != "RUN" and res["passed"]) else first_fail["verdict"]
        if mode != "RUN":
            dm = Decimal(str(max_marks))
            res["score"] = dm if not first_fail else (
                (dm * pw / tw).quantize(Decimal("0.01"), ROUND_DOWN) if cfg.get("scoring") == "PARTIAL" else Decimal("0"))
        return res
    finally:
        shutil.rmtree(wd, ignore_errors=True)
        _clean_tmp()