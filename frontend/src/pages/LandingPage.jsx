import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icons.jsx';
import { api } from '../services/api.js';
import { formatDate } from '../services/format.js';

const LAYERS = [
  { icon: 'hash', title: 'Exact file hash (SHA-256)', text: 'Proves a file is byte-for-byte the registered one. Strong, but lost after any re-save.' },
  { icon: 'file', title: 'Content Credentials (C2PA)', text: 'Industry-standard signed manifest inside the file. Validated when present; usually stripped by platforms and screenshots.' },
  { icon: 'drop', title: 'Invisible watermark (TrustMark)', text: 'A pointer hidden in the pixels that survives compression, resizing and screenshots. Treated as a pointer, never as proof.' },
  { icon: 'eye', title: 'Perceptual fingerprint (pHash)', text: 'Finds registered images that look the same after transformations. Evidence of similarity, not proof of origin.' },
  { icon: 'key', title: 'Signed registry record (Ed25519)', text: 'The provenance record itself is digitally signed. Any change to it is detected; forging one needs the private key.' },
];

export function LandingPage() {
  const [evaluation, setEvaluation] = useState(null);
  useEffect(() => { api.evaluation().then(setEvaluation).catch(() => setEvaluation(false)); }, []);

  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="eyebrow">Proof that survives the screenshot</div>
          <h1>A screenshot erases an image's history.<br />ProofLens helps recover it, honestly.</h1>
          <p className="lead">Check where an image came from (camera, AI generator or edit, and who registered it) even after it has been screenshotted, cropped, compressed and re-shared. ProofLens says clearly what it can prove, and what it cannot.</p>
          <div className="row" style={{ marginTop: 24 }}>
            <Link to="/verify" className="btn btn-primary"><Icon name="upload" /> Upload &amp; verify an image</Link>
            <Link to="/register" className="btn btn-secondary">Register an original</Link>
            <Link to="/demo" className="btn btn-ghost">See live transformation tests <Icon name="arrow" size={16} /></Link>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2>The screenshot problem</h2>
          <div className="flow">
            <div className="flow-step"><span className="pill passed tag">Created</span><h3>Original photo</h3><p className="small muted">Camera or generator attaches signed Content Credentials and metadata to the file.</p></div>
            <div className="flow-arrow"><Icon name="arrow" size={24} /></div>
            <div className="flow-step"><span className="pill warning tag">Shared</span><h3>Messaging app, screenshot, crop</h3><p className="small muted">Platforms strip metadata and re-encode. A screenshot is a brand-new file with no history at all.</p></div>
            <div className="flow-arrow"><Icon name="arrow" size={24} /></div>
            <div className="flow-step"><span className="pill absent tag">Received</span><h3>"Is this real?"</h3><p className="small muted">The credentials are gone. Missing credentials prove nothing, so the recipient is left guessing.</p></div>
          </div>
          <p className="muted" style={{ maxWidth: 760 }}>ProofLens attaches provenance at creation in several independent ways, so that when the fragile evidence disappears, sturdier evidence can still lead back to a signed record.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>How ProofLens checks an image</h2>
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            {LAYERS.map((l, i) => (
              <div className="card" key={l.title}>
                <div className="row" style={{ marginBottom: 8 }}><span className="layer-num">{i + 1}</span><Icon name={l.icon} /></div>
                <h3>{l.title}</h3>
                <p className="small muted" style={{ margin: 0 }}>{l.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2>Three possible answers</h2>
          <div className="grid-3">
            <div className="verdict verified" style={{ gridTemplateColumns: '1fr' }}><div><span className="verdict-label">Verified provenance</span><p style={{ marginTop: 6 }}>A signed, unaltered record was found and the image is linked to it by sufficient evidence (exact hash, or watermark + visual match, or a unique close visual match).</p></div></div>
            <div className="verdict unknown" style={{ gridTemplateColumns: '1fr' }}><div><span className="verdict-label">Unknown provenance</span><p style={{ marginTop: 6 }}>The origin could not be established. <strong>This does not mean fake.</strong> Most genuine images have no registered provenance.</p></div></div>
            <div className="verdict contradicted" style={{ gridTemplateColumns: '1fr' }}><div><span className="verdict-label">Contradicted</span><p style={{ marginTop: 6 }}>Evidence conflicts: an altered or forged record, a watermark copied onto a different picture, or a broken credential.</p></div></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Measured results</h2>
          {evaluation === null && <div className="row"><span className="spinner" /> Loading…</div>}
          {evaluation === false && <p className="muted">No evaluation has been run on this server yet. Run <code>npm run evaluate</code> to measure the system on the sample photos.</p>}
          {evaluation && (
            <>
              <p className="muted">Measured on {formatDate(evaluation.generatedAt)}: {evaluation.registeredCount} registered photos, each transformed and verified, plus {evaluation.holdoutCount} unregistered photos to detect false matches. These are real counts, including the failures.</p>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Transformation</th><th>Correctly verified</th><th>Watermark survived</th><th>Unregistered photos falsely verified</th></tr></thead>
                  <tbody>
                    {evaluation.perTransform.map((p) => (
                      <tr key={p.key}>
                        <td>{p.name}</td>
                        <td><span className={`pill ${p.verified / p.n >= 0.9 ? 'passed' : p.verified / p.n >= 0.5 ? 'warning' : 'failed'}`}>{p.verified}/{p.n}</span></td>
                        <td>{p.watermarkFound}/{p.n}</td>
                        <td>{p.holdoutFalseVerified}/{p.holdoutN}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
