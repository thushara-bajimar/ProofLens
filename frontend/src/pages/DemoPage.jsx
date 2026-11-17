import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, mediaUrl } from '../services/api.js';
import { StatusPill, VerdictPill } from '../components/StatusPill.jsx';
import { Icon } from '../components/Icons.jsx';
import { shortHash, LINK_LABELS, formatBytes } from '../services/format.js';
import { saveResult } from './resultStore.js';

const OP_FORMS = {
  jpeg: { label: 'JPEG re-compress', params: [{ k: 'quality', label: 'quality', def: 60, min: 5, max: 100 }] },
  resize: { label: 'Resize', params: [{ k: 'scale', label: 'scale', def: 0.5, min: 0.05, max: 1, step: 0.05 }] },
  crop: { label: 'Crop', params: [{ k: 'keep', label: 'keep', def: 0.8, min: 0.1, max: 1, step: 0.05 }], anchor: true },
  screenshot: { label: 'Screenshot', device: true },
  strip_metadata: { label: 'Strip metadata' },
  png: { label: 'Re-save as PNG' },
  webp: { label: 'WebP', params: [{ k: 'quality', label: 'quality', def: 70, min: 5, max: 100 }] },
  rotate: { label: 'Rotate', params: [{ k: 'degrees', label: 'degrees', def: 3, min: -45, max: 45 }] },
  adjust: { label: 'Filter', params: [{ k: 'brightness', label: 'brightness', def: 1.2, min: 0.3, max: 3, step: 0.1 }, { k: 'saturation', label: 'saturation', def: 1.3, min: 0, max: 3, step: 0.1 }] },
  caption: { label: 'Caption bar' },
};

export function DemoPage() {
  const [params, setParams] = useSearchParams();
  const [records, setRecords] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [error, setError] = useState(null);
  const selected = params.get('record');

  useEffect(() => {
    api.listRecords().then((r) => setRecords(r.records)).catch((e) => setError(e.message));
    api.scenarios().then((s) => setScenarios(s.scenarios)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected && records?.length) setParams({ record: records[0].recordId }, { replace: true });
  }, [records, selected, setParams]);

  return (
    <div className="container page">
      <div className="page-header">
        <h1>Demo &amp; transformation tests</h1>
        <p>Pick a registered image, push it through real transformations (compression, cropping, screenshots, attacks and forgeries) and verify every result with the normal pipeline. Every number below is measured live, nothing is pre-computed.</p>
      </div>
      {error && <div className="alert error">{error}</div>}
      <section className="card" style={{ marginBottom: 20 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>1. Choose a registered image</h3>
          <span className="spacer" />
          <Link to="/register" className="btn btn-secondary btn-sm">Register a new image</Link>
        </div>
        {records === null && <div className="row"><span className="spinner" /> Loading…</div>}
        {records?.length === 0 && <div className="alert info">No public records yet. Register an image, or run <code>npm run seed</code> to register the sample photos.</div>}
        {records?.length > 0 && (
          <div className="record-pick">
            {records.map((r) => (
              <button key={r.recordId} className={selected === r.recordId ? 'selected' : ''} onClick={() => setParams({ record: r.recordId })}>
                <img src={mediaUrl(r.recordId)} alt="" loading="lazy" />
                <span>{r.record.description || r.record.sourceType} · <span className="mono">{r.recordId.slice(0, 6)}</span></span>
              </button>
            ))}
          </div>
        )}
      </section>
      {selected && (
        <>
          <ScenarioRunner recordId={selected} scenarios={scenarios} />
          <div className="grid-2" style={{ marginTop: 20 }}>
            <ChainBuilder recordId={selected} />
            <TamperDemo recordId={selected} />
          </div>
        </>
      )}
    </div>
  );
}

function ScenarioRunner({ recordId, scenarios }) {
  const [chosen, setChosen] = useState(null);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keys = chosen ?? scenarios.map((s) => s.key);
  useEffect(() => { setRun(null); }, [recordId]);

  async function start() {
    setBusy(true);
    setError(null);
    try { setRun(await api.runDemo(recordId, keys)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const toggle = (k) => setChosen(keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]);

  return (
    <section className="card">
      <h3>2. Run the scenario suite</h3>
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        {scenarios.map((s) => (
          <label key={s.key} className="chain-chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={keys.includes(s.key)} onChange={() => toggle(s.key)} /> {s.name}
          </label>
        ))}
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={start} disabled={busy || !keys.length}>{busy ? 'Transforming and verifying…' : `Run ${keys.length} scenario${keys.length === 1 ? '' : 's'}`}</button>
        {busy && <span className="small muted">Each scenario runs the full verification pipeline (≈0.1–0.8 s each).</span>}
      </div>
      {error && <div className="alert error" style={{ marginTop: 12 }}>{error}</div>}
      {run && <RunResults run={run} />}
    </section>
  );
}

function RunResults({ run }) {
  const s = run.summary;
  return (
    <div style={{ marginTop: 18 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="pill verified">{s.VERIFIED} verified</span>
        <span className="pill unknown">{s.UNKNOWN} unknown</span>
        <span className="pill contradicted">{s.CONTRADICTED} contradicted</span>
        {s.skipped > 0 && <span className="pill neutral">{s.skipped} skipped</span>}
        <span className="spacer" />
        <span className="small muted">Run <span className="mono">{run.runId.slice(0, 8)}</span>, stored, retrievable at <code>/api/demo/results/{run.runId.slice(0, 8)}…</code></span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Output</th><th>Scenario</th><th>SHA-256 (orig → now)</th><th>pHash (orig → now)</th><th>Hamming</th>
              <th>Exact</th><th>Watermark</th><th>Visual</th><th>C2PA</th><th>Signature</th><th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {run.results.map((r) => r.skipped ? (
              <tr key={r.step}><td>-</td><td><strong>{r.name}</strong></td><td colSpan={9} className="muted">Skipped: {r.skipped}</td></tr>
            ) : (
              <tr key={r.step}>
                <td><a href={r.output.url} target="_blank" rel="noreferrer"><img className="thumb" src={r.output.url} alt="" loading="lazy" /></a><div className="small muted">{r.output.width}×{r.output.height} {r.output.format}<br />{formatBytes(r.output.bytes)}</div></td>
                <td style={{ minWidth: 220 }}>
                  <strong>{r.name}</strong>
                  <ol className="small muted" style={{ margin: '4px 0 0', paddingLeft: 16 }}>{r.applied.map((a, i) => <li key={i}>{a.label}</li>)}</ol>
                  {r.contradictions?.[0] && <div className="small" style={{ color: 'var(--contradicted)', marginTop: 4 }}>{r.contradictions[0]}</div>}
                </td>
                <td className="hash">{shortHash(r.original.sha256, 8)}<br />→ {shortHash(r.transformed.sha256, 8)}</td>
                <td className="hash">{r.original.phash}<br />→ {r.transformed.phash}{r.transformed.phashTrimmed && <><br /><span className="muted">trimmed {r.transformed.phashTrimmed}</span></>}</td>
                <td>{r.hamming}{r.hammingTrimmed !== null && <div className="small muted">trimmed: {r.hammingTrimmed}</div>}</td>
                <td>{r.exactMatch ? <StatusPill status="passed">Yes</StatusPill> : <StatusPill status="absent">No</StatusPill>}</td>
                <td><StatusPill status={r.watermark} /></td>
                <td><StatusPill status={r.perceptual} /></td>
                <td><StatusPill status={r.c2pa} /></td>
                <td><StatusPill status={r.receipt ?? r.signature}>{r.receipt ? `Receipt: ${r.receipt}` : undefined}</StatusPill></td>
                <td><VerdictPill verdict={r.verdict} /><div className="small muted">{LINK_LABELS[r.linkStrength]}{r.verdict === 'VERIFIED' && !r.matchedExpectedRecord ? ' (other record!)' : ''}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Hamming = differing bits between the registered pHash and the transformed image's pHash (0 identical, ~32 unrelated). "Trimmed" = after removing screenshot borders and UI strips.</p>
    </div>
  );
}

function ChainBuilder({ recordId }) {
  const [chain, setChain] = useState([{ op: 'jpeg', quality: 60 }, { op: 'crop', keep: 0.85, anchor: 'center' }, { op: 'screenshot', device: 'phone' }]);
  const [adding, setAdding] = useState('resize');
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { setOut(null); }, [recordId]);

  const addStep = () => {
    const f = OP_FORMS[adding];
    const step = { op: adding };
    for (const p of f.params ?? []) step[p.k] = p.def;
    if (f.anchor) step.anchor = 'center';
    if (f.device) step.device = 'phone';
    setChain((c) => [...c, step].slice(0, 8));
  };
  const update = (i, k, v) => setChain((c) => c.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const { blob, applied } = await api.transform(recordId, chain);
      const file = new File([blob], `transformed.${blob.type.split('/')[1] || 'jpg'}`, { type: blob.type });
      setOut({ file, url: URL.createObjectURL(blob), applied });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function verifyOut() {
    setBusy(true);
    try {
      const result = await api.verify(out.file);
      saveResult({ result, fileName: out.file.name, previewUrl: out.url });
      navigate('/result');
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <section className="card">
      <h3>3. Build your own transformation chain</h3>
      <ol style={{ paddingLeft: 18, margin: '0 0 12px' }}>
        {chain.map((s, i) => {
          const f = OP_FORMS[s.op];
          return (
            <li key={i} style={{ marginBottom: 6 }}>
              <div className="row" style={{ gap: 6 }}>
                <strong className="small">{f?.label ?? s.op}</strong>
                {(f?.params ?? []).map((p) => (
                  <label key={p.k} className="small muted">{p.label} <input type="number" value={s[p.k]} min={p.min} max={p.max} step={p.step ?? 1} onChange={(e) => update(i, p.k, Number(e.target.value))} style={{ width: 70, padding: '3px 6px' }} /></label>
                ))}
                {f?.anchor && <select value={s.anchor} onChange={(e) => update(i, 'anchor', e.target.value)} style={{ width: 'auto', padding: '3px 6px' }}>{['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].map((a) => <option key={a}>{a}</option>)}</select>}
                {f?.device && <select value={s.device} onChange={(e) => update(i, 'device', e.target.value)} style={{ width: 'auto', padding: '3px 6px' }}><option>phone</option><option>desktop</option></select>}
                <button className="btn btn-ghost btn-sm" onClick={() => setChain((c) => c.filter((_, j) => j !== i))} aria-label="Remove step"><Icon name="x" size={14} /></button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={adding} onChange={(e) => setAdding(e.target.value)} style={{ width: 'auto' }}>
          {Object.entries(OP_FORMS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={addStep} disabled={chain.length >= 8}>Add step</button>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={apply} disabled={busy || !chain.length}>Apply chain</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {out && (
        <div className="stack" style={{ gap: 10 }}>
          <img src={out.url} alt="Transformed" style={{ maxHeight: 260, objectFit: 'contain', borderRadius: 6, background: 'var(--surface-2)' }} />
          <div className="small muted">{out.applied.join(' → ')} · {formatBytes(out.file.size)}</div>
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={verifyOut} disabled={busy}>Verify this image</button>
            <a className="btn btn-secondary btn-sm" href={out.url} download={out.file.name}>Download</a>
          </div>
        </div>
      )}
    </section>
  );
}

function TamperDemo({ recordId }) {
  const [field, setField] = useState('sourceType');
  const [value, setValue] = useState('ai_generated');
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setRes(null); }, [recordId]);
  const valueInput = useMemo(() => field === 'sourceType'
    ? <select value={value} onChange={(e) => setValue(e.target.value)}>{['camera', 'ai_generated', 'edited', 'other'].map((v) => <option key={v}>{v}</option>)}</select>
    : <input type="text" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} />, [field, value]);

  async function go() {
    setError(null);
    try { setRes(await api.tamper(recordId, field, value)); } catch (e) { setError(e.message); }
  }
  return (
    <section className="card">
      <h3>4. Forgery attempt: edit a signed record</h3>
      <p className="small muted">An attacker changes a field of a signed record (e.g. relabels an AI image as a camera photo) but cannot produce a new signature without the private key. This edits a <em>copy</em>; the stored record is untouched.</p>
      <div className="grid-2" style={{ gap: 10, marginBottom: 10 }}>
        <label className="field">Field
          <select value={field} onChange={(e) => { setField(e.target.value); setValue(e.target.value === 'sourceType' ? 'ai_generated' : e.target.value === 'registeredAt' ? '2020-01-01T00:00:00.000Z' : 'forged text'); }}>
            <option value="sourceType">sourceType</option>
            <option value="registeredAt">registeredAt</option>
            <option value="description">description</option>
            <option value="creator.pseudonym">creator.pseudonym</option>
          </select>
        </label>
        <label className="field">New value {valueInput}</label>
      </div>
      <button className="btn btn-primary btn-sm" onClick={go}>Tamper and re-verify</button>
      {error && <div className="alert error" style={{ marginTop: 10 }}>{error}</div>}
      {res && (
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          <div className="row"><span className="small" style={{ width: 150 }}>Original record</span><StatusPill status={res.originalCheck.valid ? 'passed' : 'failed'}>{res.originalCheck.valid ? 'Signature valid' : 'Signature invalid'}</StatusPill></div>
          <div className="row"><span className="small" style={{ width: 150 }}>Forged copy</span><StatusPill status={res.forgedCheck.valid ? 'passed' : 'failed'}>{res.forgedCheck.valid ? 'Signature valid' : 'Signature invalid'}</StatusPill></div>
          <div className="small muted"><span className="mono">{res.field}</span>: “{String(res.originalValue ?? '(none)')}” → “{res.forgedValue}”. Reason: {res.forgedCheck.reason}.</div>
        </div>
      )}
    </section>
  );
}
