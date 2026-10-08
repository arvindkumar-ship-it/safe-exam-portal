import { useEffect, useRef, useState } from "react";
import { codeApi } from "../../api/codeApi";

export const VERDICT = { AC: "Accepted", WA: "Wrong Answer", TLE: "Time Limit Exceeded", MLE: "Memory Limit Exceeded",
  RE: "Runtime Error", CE: "Compilation Error", OLE: "Output Limit Exceeded", SE: "System Error", PARTIAL: "Partial" };
const LABEL = { cpp17: "C++17", c11: "C11", python3: "Python 3", pypy3: "PyPy 3" };
const MAX_BYTES = 65536;
const bytes = (s) => new TextEncoder().encode(s).length;
const DELAYS = [200, 300, 400, 600, 800, 1000];

export default function CodingPane({ question, attemptId, value, onChange }) {
  const cfg = question.coding || {};
  const langs = cfg.languages?.length ? cfg.languages : ["python3"];
  const draft = value && typeof value === "object" ? value : {};
  const [lang, setLang] = useState(langs.includes(draft.language) ? draft.language : langs[0]);
  const [src, setSrc] = useState(draft.source || "");
  const [cur, setCur] = useState(null);       // abhi dikhne wala submission
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hist, setHist] = useState([]);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    codeApi.list(attemptId, question.id).then((r) => alive.current && setHist(r || [])).catch(() => {});
    return () => { alive.current = false; };
  }, [attemptId, question.id]);

  const edit = (l, s) => { setLang(l); setSrc(s); onChange({ language: l, source: s }); };

  async function go(mode) {
    if (busy) return;
    if (!src.trim()) return setErr("Write some code first.");
    if (bytes(src) > MAX_BYTES) return setErr("Code is too large (64 KB max).");
    setErr(""); setBusy(true);
    try {
      let s = await codeApi.submit(attemptId, { questionId: question.id, language: lang, source: src, mode });
      setCur(s);
      const t0 = Date.now();
      for (let i = 0; s.status !== "DONE" && alive.current; i++) {
        if (Date.now() - t0 > 120000) { setErr("Judging is taking long. Check the history below in a moment."); break; }
        await new Promise((r) => setTimeout(r, DELAYS[Math.min(i, DELAYS.length - 1)]));
        s = await codeApi.get(attemptId, s.id);
        if (alive.current) setCur(s);
      }
      if (alive.current) setHist((await codeApi.list(attemptId, question.id)) || []);
    } catch (e) {
      if (alive.current) setErr(e?.message || "Request failed.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function onKey(e) {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b } = e.target;
      edit(lang, src.slice(0, a) + "    " + src.slice(b));
      requestAnimationFrame(() => { e.target.selectionStart = e.target.selectionEnd = a + 4; });
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      go("RUN");
    }
  }

  return (
    <div className="coding-pane">
      <p className="coding-meta">Time limit {cfg.timeLimitMs} ms · Memory {cfg.memoryLimitMb} MB</p>
      {(cfg.samples || []).map((s, i) => (
        <div key={i} className="samples">
          <div><span className="sample-label">Sample input {i + 1}</span><pre>{s.input}</pre></div>
          <div><span className="sample-label">Sample output {i + 1}</span><pre>{s.output}</pre></div>
        </div>
      ))}
      <div className="coding-toolbar">
        <label>Language
          <select value={lang} onChange={(e) => edit(e.target.value, src)} disabled={busy}>
            {langs.map((l) => <option key={l} value={l}>{LABEL[l] || l}</option>)}
          </select>
        </label>
      </div>
      <textarea
        aria-label="Code editor" className="code-editor" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={src}
        onChange={(e) => edit(lang, e.target.value)} onKeyDown={onKey} rows={18}
      />
      <div className="coding-actions">
        <small>{bytes(src)} / {MAX_BYTES} bytes · Ctrl+Enter = Run</small>
        <button type="button" className="btn btn-secondary" onClick={() => go("RUN")} disabled={busy}>Run samples</button>
        <button type="button" className="btn btn-primary" onClick={() => go("SUBMIT")} disabled={busy}>Submit</button>
      </div>
      {err && <div role="alert" className="error-message">{err}</div>}
      {cur && <Result s={cur} />}
      {hist.length > 0 && (
        <details>
          <summary>My submissions ({hist.length})</summary>
          <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Mode</th><th>Lang</th><th>Verdict</th><th>Passed</th><th>Score</th><th /></tr></thead>
            <tbody>{hist.map((h) => (
              <tr key={h.id}>
                <td>{new Date(h.createdAt).toLocaleTimeString()}</td><td>{h.mode}</td><td>{LABEL[h.language] || h.language}</td>
                <td>{h.status === "DONE" ? VERDICT[h.verdict] || h.verdict : h.status}</td>
                <td>{h.passed}/{h.total}</td><td>{h.mode === "SUBMIT" ? h.score : "—"}</td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={async () => { const d = await codeApi.get(attemptId, h.id); setCur(d); edit(d.language, d.source ?? src); }}>Load</button></td>
              </tr>))}</tbody>
          </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Result({ s }) {
  if (s.status !== "DONE") return <p role="status" aria-live="polite">{s.status === "QUEUED" ? "In queue…" : "Judging…"}</p>;
  const ok = s.verdict === "AC";
  return (
    <div role="status" aria-live="polite" className={`verdict ${ok ? "verdict--ok" : "verdict--bad"}`}>
      <h4>{VERDICT[s.verdict] || s.verdict}{s.failedTest ? ` on test ${s.failedTest}` : ""}</h4>
      <p>
        Passed {s.passed}/{s.total}
        {s.mode === "SUBMIT" && <> · Score {s.score}/{s.maxScore}</>}
        {s.timeMs != null && <> · {s.timeMs} ms</>}
        {s.memoryKb != null && <> · {(s.memoryKb / 1024).toFixed(1)} MB</>}
      </p>
      {s.compileOutput && <pre>{s.compileOutput}</pre>}
      {s.tests.length > 0 && (
        <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Verdict</th><th>Time</th></tr></thead>
          <tbody>{s.tests.map((t) => (
            <tr key={t.position}>
              <td>{t.isSample ? `${t.position} (sample)` : t.position}</td><td>{t.verdict}</td><td>{t.timeMs} ms</td>
              {t.isSample && t.verdict !== "AC" && <td><pre>expected: {t.expected}{"\n"}got: {t.actual}</pre></td>}
            </tr>))}</tbody>
        </table>
        </div>
      )}
    </div>
  );
}
