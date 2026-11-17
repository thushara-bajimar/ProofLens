import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dropzone } from '../components/Dropzone.jsx';
import { FilePreview } from '../components/FilePreview.jsx';
import { api } from '../services/api.js';
import { saveResult } from './resultStore.js';

const STEPS = [
  'Checking the file is a real image',
  'Computing SHA-256 and looking for an exact match',
  'Reading embedded Content Credentials (C2PA)',
  'Computing perceptual fingerprints (and removing screenshot borders)',
  'Looking for an invisible watermark',
  'Verifying the Ed25519 signature of any matching record',
];

export function VerifyPage() {
  const [file, setFile] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const receiptText = receipt ? await receipt.text() : undefined;
      const result = await api.verify(file, receiptText);
      const previewUrl = URL.createObjectURL(file);
      saveResult({ result, fileName: file.name, previewUrl });
      navigate('/result');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container page">
      <div className="page-header">
        <h1>Verify an image</h1>
        <p>Upload any image, including a screenshot or a compressed copy from a chat. ProofLens checks several independent kinds of evidence and tells you what it can and cannot conclude.</p>
      </div>
      <div className="grid-2">
        <div className="stack">
          {!file ? <Dropzone onFile={(f) => { setFile(f); setError(null); }} /> : <div className="card"><FilePreview file={file} onClear={() => setFile(null)} /></div>}
          <div className="card">
            <h3>Optional: proof receipt</h3>
            <p className="small muted">If the sender gave you a ProofLens receipt (a small .json file), add it. Its signature is checked, and it is compared with this image and with the registry.</p>
            <div className="row">
              <label className="btn btn-secondary btn-sm">
                {receipt ? 'Change receipt' : 'Choose receipt (.json)'}
                <input type="file" accept="application/json,.json" hidden onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
              </label>
              {receipt && <span className="small">{receipt.name} <button className="btn btn-ghost btn-sm" onClick={() => setReceipt(null)}>remove</button></span>}
            </div>
          </div>
          {error && <div className="alert error">{error}</div>}
          <div className="row">
            <button className="btn btn-primary" disabled={!file || busy} onClick={submit}>{busy ? 'Verifying…' : 'Verify image'}</button>
          </div>
        </div>
        <div className="card">
          <h3>{busy ? 'Running checks…' : 'What will be checked'}</h3>
          <ul className="progress-list">
            {STEPS.map((s) => (
              <li key={s}>{busy ? <span className="spinner" /> : <span className="pill neutral">·</span>}<span>{s}</span></li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 14 }}>
            The image is processed in memory and is not stored. Only its SHA-256 hash and the verdict are logged.
          </p>
        </div>
      </div>
    </div>
  );
}
