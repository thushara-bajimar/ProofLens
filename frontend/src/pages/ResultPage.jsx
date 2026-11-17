import { Link } from 'react-router-dom';
import { VerificationResult } from '../components/VerificationResult.jsx';
import { loadResult } from './resultStore.js';

export function ResultPage() {
  const entry = loadResult();
  if (!entry) {
    return (
      <div className="container page">
        <h1>No result yet</h1>
        <p>Verify an image first.</p>
        <Link className="btn btn-primary" to="/verify">Verify an image</Link>
      </div>
    );
  }
  return (
    <div className="container page">
      <div className="row page-header">
        <div>
          <h1 style={{ marginBottom: 4 }}>Verification result</h1>
          <p className="muted small" style={{ margin: 0 }}>Verification ID <span className="mono">{entry.result.verificationId}</span></p>
        </div>
        <span className="spacer" />
        <Link className="btn btn-secondary" to="/verify">Verify another image</Link>
      </div>
      <VerificationResult result={entry.result} submittedUrl={entry.previewUrl} fileName={entry.fileName} />
    </div>
  );
}
