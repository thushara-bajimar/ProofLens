import { Link } from 'react-router-dom';
import { Icon, VERDICT_ICON } from './Icons.jsx';
import { StatusPill } from './StatusPill.jsx';
import { HashCompare, DistanceScale } from './HashCompare.jsx';
import { formatBytes, formatDate, shortHash, SOURCE_LABELS, VERDICT_META, LINK_LABELS, describeCreator } from '../services/format.js';
import { mediaUrl } from '../services/api.js';

const CHECK_ORDER = ['exact_hash', 'signature', 'watermark', 'perceptual', 'c2pa', 'receipt', 'transformation'];
const CHECK_ICON = { exact_hash: 'hash', signature: 'key', watermark: 'drop', perceptual: 'eye', c2pa: 'file', receipt: 'file', transformation: 'layers' };
const PLAIN = {
  exact_hash: 'Is this the very same file that was registered?',
  signature: 'Is the provenance record genuine and unaltered?',
  watermark: 'Does the image carry an invisible ProofLens marker?',
  perceptual: 'Does the picture look like a registered image?',
  c2pa: 'Does the file carry industry-standard Content Credentials?',
  receipt: 'Does the supplied receipt check out?',
  transformation: 'What seems to have happened to the file?',
};

function VerdictBanner({ result }) {
  const meta = VERDICT_META[result.verdict];
  return (
    <section className={`verdict ${meta.tone}`} aria-live="polite">
      <div className="verdict-icon"><Icon name={VERDICT_ICON[result.verdict]} size={28} /></div>
      <div>
        <div className="row" style={{ gap: 8 }}>
          <span className="verdict-label">{meta.label}</span>
          {result.linkStrength !== 'NONE' && <span className="pill neutral">Link: {LINK_LABELS[result.linkStrength]}</span>}
        </div>
        <h2>{result.headline}</h2>
        <p>{result.explanation}</p>
      </div>
    </section>
  );
}

function CheckCard({ check }) {
  const hasDetail = check.detail && Object.keys(check.detail).length > 0;
  return (
    <div className={`check ${check.status}`}>
      <div className="check-head">
        <div className="check-icon"><Icon name={CHECK_ICON[check.id] ?? 'info'} size={16} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{check.label}</div>
          <div className="muted small">{PLAIN[check.id]}</div>
        </div>
        <StatusPill status={check.status} />
      </div>
      <div className="check-body">
        <p>{check.summary}</p>
        {hasDetail && (
          <details className="tech">
            <summary>Technical details</summary>
            <pre className="code">{JSON.stringify(check.detail, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function RecordPanel({ view, submittedUrl }) {
  if (!view?.record) return null;
  const r = view.record;
  return (
    <div className="card">
      <div className="card-title"><Icon name="file" /><h3>Matched provenance record</h3></div>
      <div className="compare-imgs" style={{ marginBottom: 14 }}>
        {submittedUrl && <figure><img src={submittedUrl} alt="Submitted image" /><figcaption>Submitted image</figcaption></figure>}
        <figure><img src={mediaUrl(view.recordId)} alt="Registered distribution copy" /><figcaption>Registered copy</figcaption></figure>
      </div>
      <dl className="kv">
        <dt>Claimed source</dt><dd>{SOURCE_LABELS[r.sourceType]} <span className="muted small">(registrant's claim)</span></dd>
        <dt>Registered</dt><dd>{formatDate(r.registeredAt)}</dd>
        <dt>Creator</dt><dd>{describeCreator(r.creator)}</dd>
        {r.description && (<><dt>Description</dt><dd>{r.description}</dd></>)}
        <dt>Record ID</dt><dd className="mono">{view.recordId}</dd>
        <dt>Signed by key</dt><dd className="mono">{view.signatureStatus.keyId}</dd>
        <dt>Signature</dt><dd>{view.signatureStatus.valid ? <StatusPill status="passed">Valid</StatusPill> : <StatusPill status="failed">Invalid</StatusPill>}</dd>
        <dt>Original size</dt><dd>{r.media.original.width} × {r.media.original.height}</dd>
      </dl>
      <div className="row" style={{ marginTop: 12 }}>
        <Link className="btn btn-secondary btn-sm" to={`/record/${view.recordId}`}>Open record</Link>
      </div>
    </div>
  );
}

export function VerificationResult({ result, submittedUrl, fileName }) {
  const checks = [...result.checks].sort((a, b) => CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id));
  const perceptual = result.checks.find((c) => c.id === 'perceptual');
  const registeredHash = result.matchedRecord?.record?.media?.fingerprint?.global
    ?? result.involvedRecords?.find((r) => r.recordId === result.possibleMatches?.[0]?.recordId)?.record?.media?.fingerprint?.global;
  const usedTrimmed = perceptual?.detail?.best?.variant === 'trimmed' || perceptual?.detail?.bestRegion?.variant === 'trimmed';
  const queryHash = usedTrimmed && result.fingerprints.trimmed ? result.fingerprints.trimmed : result.fingerprints.plain;
  const globalDistance = perceptual?.detail?.best?.globalDistance;
  const counts = checks.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});

  return (
    <div className="stack">
      <VerdictBanner result={result} />

      {result.contradictions.length > 0 && (
        <div className="alert error">
          <strong>Conflicting evidence</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{result.contradictions.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
        <div className="stack">
          <div className="row">
            <h3 style={{ margin: 0 }}>Evidence checked</h3>
            <span className="spacer" />
            <span className="small muted">
              {counts.passed ?? 0} passed · {counts.failed ?? 0} failed · {(counts.absent ?? 0) + (counts.not_checked ?? 0)} not found / not checked · {counts.warning ?? 0} caution
            </span>
          </div>
          {checks.map((c) => <CheckCard key={c.id} check={c} />)}
        </div>

        <div className="stack">
          <div className="card conclude">
            <h3>What this result means</h3>
            <div className="small muted" style={{ marginBottom: 6 }}>ProofLens can conclude:</div>
            <ul>{result.conclusions.can.map((c, i) => <li key={i}><span className="yes"><Icon name="check" size={16} /></span><span>{c}</span></li>)}</ul>
            <div className="small muted" style={{ margin: '14px 0 6px' }}>ProofLens cannot conclude:</div>
            <ul>{result.conclusions.cannot.map((c, i) => <li key={i}><span className="no"><Icon name="minus" size={16} /></span><span>{c}</span></li>)}</ul>
          </div>

          <RecordPanel view={result.matchedRecord} submittedUrl={submittedUrl} />

          {result.possibleMatches?.length > 0 && (
            <div className="card">
              <h3>Possible matches (not confirmed)</h3>
              <p className="small muted">These registered images look somewhat similar, but the evidence is not strong or unique enough to link them. More evidence (the original file, a receipt) would be needed.</p>
              {result.possibleMatches.map((m) => (
                <div key={m.recordId} className="row" style={{ marginBottom: 8 }}>
                  <img src={mediaUrl(m.recordId)} alt="" style={{ width: 64, height: 44, objectFit: 'cover', borderRadius: 4 }} />
                  <div className="small">
                    <Link to={`/record/${m.recordId}`} className="mono">{m.recordId.slice(0, 8)}…</Link>
                    <div className="muted">whole-image distance {m.globalDistance}/64{m.regionDistance !== null ? ` · best region ${m.regionDistance}/64` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {registeredHash && (
            <div className="card">
              <h3>Perceptual fingerprint comparison</h3>
              <HashCompare a={queryHash} b={registeredHash} labelA={usedTrimmed ? 'Submitted (borders removed)' : 'Submitted'} />
              {Number.isFinite(globalDistance) && <DistanceScale distance={globalDistance} strict={result.thresholds.strict} corroborate={result.thresholds.corroborate} />}
            </div>
          )}

          <div className="card">
            <h3>Submitted file</h3>
            <dl className="kv">
              {fileName && (<><dt>Name</dt><dd>{fileName}</dd></>)}
              <dt>Detected type</dt><dd>{result.submitted.mime}</dd>
              <dt>Dimensions</dt><dd>{result.submitted.width} × {result.submitted.height}</dd>
              <dt>Size</dt><dd>{formatBytes(result.submitted.sizeBytes)}</dd>
              <dt>SHA-256</dt><dd className="hash" title={result.submitted.sha256}>{shortHash(result.submitted.sha256, 16)}</dd>
              <dt>EXIF metadata</dt><dd>{result.submitted.metadata.hasExif ? `present${result.submitted.metadata.hasGps ? ' (includes GPS!)' : ''}` : 'none'}</dd>
              <dt>Checked in</dt><dd>{result.timings.totalMs} ms</dd>
            </dl>
          </div>
        </div>
      </div>

      <details className="card tech">
        <summary>Full technical report (JSON)</summary>
        <pre className="code">{JSON.stringify({ verificationId: result.verificationId, verdict: result.verdict, linkStrength: result.linkStrength, matchedRecordId: result.matchedRecordId, thresholds: result.thresholds, fingerprints: result.fingerprints, timings: result.timings, checks: result.checks }, null, 2)}</pre>
      </details>
    </div>
  );
}
