import { useCallback, useEffect, useState } from "react";
import { codeApi } from "../../api/codeApi";
import ErrorMessage from "../../components/ErrorMessage";

export const LANGS = [["cpp17", "C++17"], ["c11", "C11"], ["python3", "Python 3"], ["pypy3", "PyPy 3"]];
export const defaultCoding = (c) => ({
  timeLimitMs: String(c?.timeLimitMs ?? 1000), memoryLimitMb: String(c?.memoryLimitMb ?? 256),
  languages: c?.languages ?? ["cpp17", "python3"], checker: c?.checker ?? "TOKENS",
  floatEps: String(c?.floatEps ?? 1e-6), scoring: c?.scoring ?? "ALL_OR_NOTHING",
});
export const codingBody = (c) => ({ timeLimitMs: Number(c.timeLimitMs), memoryLimitMb: Number(c.memoryLimitMb), languages: c.languages,
  checker: c.checker, floatEps: Number(c.floatEps), scoring: c.scoring });

export function CodingConfigFields({ value: c, onChange }) {
  const set = (k, v) => onChange({ ...c, [k]: v });
  const toggle = (l) => set("languages", c.languages.includes(l) ? c.languages.filter((x) => x !== l) : [...c.languages, l]);
  return (
    <fieldset className="form-section">
      <legend className="form-section__title">Judge settings</legend>
      <div className="grid-2">
        <label>Time limit (ms)<input type="number" min="100" max="10000" value={c.timeLimitMs} onChange={(e) => set("timeLimitMs", e.target.value)} /></label>
        <label>Memory (MB)<input type="number" min="16" max="1024" value={c.memoryLimitMb} onChange={(e) => set("memoryLimitMb", e.target.value)} /></label>
      </div>
      <div className="row row-lg">
        {LANGS.map(([id, label]) => (
          <label key={id} className="check"><input type="checkbox" checked={c.languages.includes(id)} onChange={() => toggle(id)} /> {label}</label>
        ))}
      </div>
      <div className="grid-3">
        <label>Checker
          <select value={c.checker} onChange={(e) => set("checker", e.target.value)}>
            <option value="TOKENS">Tokens (ignore whitespace)</option><option value="LINES">Lines (exact spacing)</option><option value="FLOAT">Float (tolerance)</option>
          </select>
        </label>
        {c.checker === "FLOAT" && <label>Eps<input type="number" step="any" value={c.floatEps} onChange={(e) => set("floatEps", e.target.value)} /></label>}
        <label>Scoring
          <select value={c.scoring} onChange={(e) => set("scoring", e.target.value)}>
            <option value="ALL_OR_NOTHING">All or nothing</option><option value="PARTIAL">Partial (by test weight)</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function CodingTestsPanel({ questionId }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ input: "", output: "", isSample: false, weight: "1" });
  const [kind, setKind] = useState("hidden");
  const load = useCallback(() => codeApi.listTests(questionId).then(setRows).catch(setErr), [questionId]);
  useEffect(() => { load(); }, [load]);

  async function add(tests) {
    setErr(null);
    try { await codeApi.addTests(questionId, tests); await load(); } catch (e) { setErr(e); }
  }
  async function files(e) {   // name.in + name.out (ya .ans) jodi me
    const by = {};
    for (const file of e.target.files) {
      const m = /^(.*)\.(in|out|ans)$/i.exec(file.name);
      if (m) (by[m[1]] ||= {})[m[2].toLowerCase() === "in" ? "input" : "output"] = await file.text();
    }
    e.target.value = "";
    const tests = Object.keys(by).sort().map((k) => by[k]).filter((t) => t.input != null && t.output != null)
      .map((t) => ({ ...t, isSample: kind === "sample", weight: 1 }));
    if (!tests.length) return setErr(new Error("No matching .in/.out pairs found."));
    for (let i = 0; i < tests.length; i += 50) await add(tests.slice(i, i + 50));
  }

  return (
    <fieldset aria-label="Test cases" className="form-section">
      <legend className="form-section__title">Test cases ({rows.length}) — need ≥1 sample and ≥1 hidden to publish</legend>
      <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Type</th><th className="num">Weight</th><th>Input</th><th>Output</th><th /></tr></thead>
        <tbody>{rows.map((t) => (
          <tr key={t.id}>
            <td>{t.position}</td><td><span className={`badge ${t.isSample ? "badge-info" : ""}`}>{t.isSample ? "Sample" : "Hidden"}</span></td><td className="num">{t.weight}</td>
            <td><code>{t.inputPreview}</code> ({t.inputBytes} B)</td><td><code>{t.outputPreview}</code> ({t.outputBytes} B)</td>
            <td><div className="row-actions"><button type="button" className="btn btn-danger btn-sm" onClick={async () => { try { await codeApi.deleteTest(questionId, t.id); load(); } catch (e) { setErr(e); } }}>Delete</button></div></td>
          </tr>))}</tbody>
      </table>
      </div>
      <label>Input<textarea rows={3} value={f.input} onChange={(e) => setF({ ...f, input: e.target.value })} /></label>
      <label>Expected output<textarea rows={3} value={f.output} onChange={(e) => setF({ ...f, output: e.target.value })} /></label>
      <div className="form-row">
        <label className="check grow"><input type="checkbox" checked={f.isSample} onChange={(e) => setF({ ...f, isSample: e.target.checked })} /> Sample (shown to students)</label>
        <label className="w-120">Weight<input type="number" min="1" max="1000" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></label>
        <button type="button" className="btn btn-secondary" onClick={async () => { await add([{ input: f.input, output: f.output, isSample: f.isSample, weight: Number(f.weight) || 1 }]); setF({ ...f, input: "", output: "" }); }}>Add test</button>
      </div>
      <div className="form-row">
        <label>Bulk upload (.in/.out pairs) as
          <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="hidden">Hidden</option><option value="sample">Sample</option></select>
        </label>
        <input type="file" multiple accept=".in,.out,.ans" aria-label="Upload test files" onChange={files} />
      </div>
      <ErrorMessage error={err} />
    </fieldset>
  );
}
