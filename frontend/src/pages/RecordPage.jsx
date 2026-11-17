import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, mediaUrl } from '../services/api.js';
import { StatusPill } from '../components/StatusPill.jsx';
import { formatDate, SOURCE_LABELS, describeCreator, downloadJson } from '../services/format.js';

export function RecordPage() {
  const { id } = useParams();
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.getRecord(id).then(setView).catch((e) => setError(e.message)); }, [id]);

  if (error) return <div className="container page"><div className="alert error">{error}</div></div>;
  if (!view) return <div className="container page"><div className="row"><span className="spinner" /> Loading record…</div></div>;
  const r = view.record;
  return (
    <div className="container page">
      <div className="page-header">
        <div className="eyebrow">Provenance record</div>
        <h1 className="mono" style={{ fontSize: '1.3rem' }}>{view.recordId}</h1>
      </div>
      <div className="grid-2">
        <div className="card">
          <img src={mediaUrl(view.recordId)} alt="Registered distribution copy" style={{ borderRadius: 6, width: '100%', maxHeight: 420, objectFit: 'contain', background: 'var(--surface-2)' }} />
        </div>
        <div className="stack">
          <div className={`alert ${view.trusted ? 'success' : 'error'}`}>
            {view.trusted
              ? 'The signature on this record was re-verified just now against the ProofLens public key. No field has changed since it was signed.'
              : `This record FAILED verification: ${[view.signatureStatus.reason, ...view.integrityProblems].join('; ')}.`}
          </div>
          <div className="card">
            <dl className="kv">
              <dt>Claimed source</dt><dd>{SOURCE_LABELS[r.sourceType]} <span className="muted small">(registrant's claim)</span></dd>
              <dt>Registered</dt><dd>{formatDate(r.registeredAt)}</dd>
              <dt>Creator</dt><dd>{describeCreator(r.creator)}</dd>
              {r.creator.commitment && (<><dt>Commitment</dt><dd className="hash">{r.creator.commitment}</dd></>)}
              {r.description && (<><dt>Description</dt><dd>{r.description}</dd></>)}
              <dt>Visibility</dt><dd>{r.privacy.visibility}</dd>
              <dt>Original SHA-256</dt><dd className="hash">{r.media.original.sha256}</dd>
              <dt>Copy SHA-256</dt><dd className="hash">{r.media.distribution.sha256}</dd>
              <dt>pHash (global)</dt><dd className="mono">{r.media.fingerprint.global}</dd>
              <dt>Region fingerprints</dt><dd>{r.media.fingerprint.regions.length}</dd>
              <dt>Watermark</dt><dd>{r.media.distribution.watermark ?? 'none'}</dd>
              <dt>Signature</dt><dd><StatusPill status={view.signatureStatus.valid ? 'passed' : 'failed'}>{view.signatureStatus.valid ? 'Valid' : 'Invalid'}</StatusPill></dd>
              <dt>Key</dt><dd className="mono">{view.signatureStatus.keyId} ({view.signatureStatus.keyStatus})</dd>
            </dl>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => downloadJson({ format: 'prooflens-receipt-v1', record: r, signature: view.signature }, `prooflens-receipt-${view.recordId.slice(0, 8)}.json`)}>Download receipt</button>
              <Link className="btn btn-secondary btn-sm" to={`/demo?record=${view.recordId}`}>Run transformation tests</Link>
            </div>
          </div>
          <details className="card tech"><summary>Signed record (canonical JSON contents)</summary><pre className="code">{JSON.stringify(r, null, 2)}</pre><div className="small muted">Signature (base64): <span className="hash">{view.signature}</span></div></details>
        </div>
      </div>
    </div>
  );
}
