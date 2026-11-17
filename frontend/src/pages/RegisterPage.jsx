import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Dropzone } from '../components/Dropzone.jsx';
import { FilePreview } from '../components/FilePreview.jsx';
import { Icon } from '../components/Icons.jsx';
import { api, mediaUrl } from '../services/api.js';
import { downloadJson, shortHash } from '../services/format.js';

const SOURCES = [
  { value: 'camera', title: 'Camera photograph', text: 'Captured with a camera or phone' },
  { value: 'ai_generated', title: 'AI-generated', text: 'Created by an image generator' },
  { value: 'edited', title: 'Edited image', text: 'Composited or substantially edited' },
  { value: 'other', title: 'Other', text: 'Graphics, scans, anything else' },
];
const CREATOR_MODES = [
  { value: 'anonymous', title: 'Anonymous', text: 'No creator information at all' },
  { value: 'pseudonym', title: 'Pseudonym', text: 'A public name you choose' },
  { value: 'commitment', title: 'Private commitment', text: 'Only a hash of your identity is published' },
];

export function RegisterPage() {
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ sourceType: 'camera', creatorMode: 'anonymous', pseudonym: '', identity: '', description: '', visibility: 'public' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fields = { ...form };
      if (form.creatorMode === 'anonymous') { delete fields.pseudonym; delete fields.identity; }
      if (form.creatorMode !== 'commitment') delete fields.identity;
      setResult(await api.register(file, fields));
    } catch (err) {
      setError(err.code === 'ALREADY_REGISTERED' ? <>This exact file is already registered. <Link to={`/record/${err.details?.recordId}`}>View the record</Link>.</> : err.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) return <RegistrationDone result={result} onAnother={() => { setResult(null); setFile(null); }} />;

  return (
    <div className="container page">
      <div className="page-header">
        <h1>Register an original image</h1>
        <p>Registration attaches provenance at creation time: ProofLens fingerprints the image, embeds an invisible watermark and Content Credentials into a shareable copy, and signs a provenance record with its Ed25519 key.</p>
      </div>
      <form className="grid-2" onSubmit={submit}>
        <div className="stack">
          {!file ? <Dropzone onFile={setFile} label="Drop the original image here" /> : <div className="card"><FilePreview file={file} onClear={() => setFile(null)} /></div>}

          <div className="card stack">
            <div>
              <h3>Source type</h3>
              <p className="small muted" style={{ marginBottom: 8 }}>This is recorded as <em>your claim</em>. ProofLens cannot check it.</p>
              <div className="choice-grid">
                {SOURCES.map((s) => (
                  <label key={s.value} className="choice">
                    <input type="radio" name="sourceType" value={s.value} checked={form.sourceType === s.value} onChange={set('sourceType')} />
                    <div><strong>{s.title}</strong><span>{s.text}</span></div>
                  </label>
                ))}
              </div>
            </div>
            <label className="field">Description <span className="field-hint">Optional, max 500 characters. Avoid personal details or locations.</span>
              <textarea maxLength={500} value={form.description} onChange={set('description')} />
            </label>
          </div>
        </div>

        <div className="stack">
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Creator & privacy</h3>
            <div className="choice-grid">
              {CREATOR_MODES.map((s) => (
                <label key={s.value} className="choice">
                  <input type="radio" name="creatorMode" value={s.value} checked={form.creatorMode === s.value} onChange={set('creatorMode')} />
                  <div><strong>{s.title}</strong><span>{s.text}</span></div>
                </label>
              ))}
            </div>
            {form.creatorMode !== 'anonymous' && (
              <label className="field">Pseudonym {form.creatorMode === 'commitment' && <span className="field-hint">(optional)</span>}
                <input type="text" maxLength={64} value={form.pseudonym} onChange={set('pseudonym')} placeholder="e.g. river_lens" />
              </label>
            )}
            {form.creatorMode === 'commitment' && (
              <label className="field">Your identity <span className="field-hint">e.g. your name or email. It is hashed with a random salt and NOT stored. You receive the salt once so you can prove authorship later.</span>
                <input type="text" maxLength={200} value={form.identity} onChange={set('identity')} />
              </label>
            )}
            <label className="field">Visibility
              <select value={form.visibility} onChange={set('visibility')}>
                <option value="public">Public: listed in the registry</option>
                <option value="unlisted">Unlisted: only found by verifying the image or by its ID</option>
              </select>
            </label>
          </div>

          <div className="alert info small">
            <strong>What is stored</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              <li>The SHA-256 hash of your file, and perceptual fingerprints of the picture.</li>
              <li>A metadata-free copy of the pixels (private) and a watermarked public copy.</li>
              <li>The signed record: source claim, optional description, pseudonym or commitment, timestamps.</li>
            </ul>
            <strong style={{ display: 'block', marginTop: 8 }}>Not stored</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              <li>Your original file with its EXIF metadata (GPS location, camera serial, etc.).</li>
              <li>Your real identity (only a salted hash if you choose a commitment).</li>
            </ul>
          </div>

          {error && <div className="alert error">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={!file || busy}>{busy ? 'Registering and signing…' : 'Register and sign'}</button>
        </div>
      </form>
    </div>
  );
}

function RegistrationDone({ result, onAnother }) {
  return (
    <div className="container page">
      <div className="alert success" style={{ marginBottom: 20 }}>
        <strong>Registered and signed.</strong> Share the <em>distribution copy</em> below: it carries the invisible watermark and Content Credentials.
      </div>
      <div className="grid-2">
        <div className="card">
          <img src={mediaUrl(result.recordId)} alt="Distribution copy" style={{ borderRadius: 6, marginBottom: 12, maxHeight: 340, objectFit: 'contain', width: '100%', background: 'var(--surface-2)' }} />
          <div className="row">
            <a className="btn btn-primary" href={mediaUrl(result.recordId)} download={`prooflens-${result.recordId}.jpg`}><Icon name="download" /> Download distribution copy</a>
            <button className="btn btn-secondary" onClick={() => downloadJson(result.receipt, `prooflens-receipt-${result.recordId.slice(0, 8)}.json`)}><Icon name="download" /> Download receipt</button>
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h3>Provenance record</h3>
            <dl className="kv">
              <dt>Record ID</dt><dd className="mono">{result.recordId}</dd>
              <dt>Watermark payload</dt><dd className="mono">{result.shortId}</dd>
              <dt>Original SHA-256</dt><dd className="hash">{shortHash(result.record.media.original.sha256, 16)}</dd>
              <dt>Copy SHA-256</dt><dd className="hash">{shortHash(result.distribution.sha256, 16)}</dd>
              <dt>pHash</dt><dd className="mono">{result.record.media.fingerprint.global}</dd>
              <dt>Watermark</dt><dd>{result.distribution.watermarked ? 'embedded (TrustMark)' : 'not embedded'}</dd>
              <dt>C2PA manifest</dt><dd>{result.distribution.c2paManifest ? 'attached (development certificate)' : 'not attached'}</dd>
              <dt>Signing key</dt><dd className="mono">{result.record.signer.keyId}</dd>
              <dt>Signature</dt><dd className="hash">{shortHash(result.signature, 20)}</dd>
            </dl>
            <div className="row" style={{ marginTop: 12 }}>
              <Link className="btn btn-secondary btn-sm" to={`/record/${result.recordId}`}>View public record</Link>
              <Link className="btn btn-secondary btn-sm" to={`/demo?record=${result.recordId}`}>Test it against transformations</Link>
              <button className="btn btn-ghost btn-sm" onClick={onAnother}>Register another</button>
            </div>
          </div>
          {result.creatorSecret && (
            <div className="alert warn">
              <strong>Save this now: it is shown only once.</strong>
              <p className="small" style={{ margin: '6px 0' }}>To prove later that you are the creator, reveal this salt and identity. Anyone can recompute SHA-256("prooflens-commitment-v1|salt|identity") and compare it with the commitment in the record.</p>
              <pre className="code">{JSON.stringify({ commitment: result.record.creator.commitment, salt: result.creatorSecret.salt, identity: result.creatorSecret.identity }, null, 2)}</pre>
              <button className="btn btn-secondary btn-sm" onClick={() => downloadJson({ commitment: result.record.creator.commitment, ...result.creatorSecret }, 'prooflens-creator-secret.json')}>Download secret</button>
            </div>
          )}
          {result.nearDuplicates?.length > 0 && (
            <div className="alert warn small">
              <strong>Similar image already registered.</strong> This picture closely resembles {result.nearDuplicates.length} existing record(s), e.g. <Link to={`/record/${result.nearDuplicates[0].recordId}`}>{result.nearDuplicates[0].recordId.slice(0, 8)}…</Link> (distance {result.nearDuplicates[0].distance}/64). Verifiers will see this ambiguity.
            </div>
          )}
          {result.notes?.length > 0 && <div className="alert warn small">{result.notes.join(' ')}</div>}
        </div>
      </div>
    </div>
  );
}
