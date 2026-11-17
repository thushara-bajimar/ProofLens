import { Link } from 'react-router-dom';

export function HowItWorksPage() {
  return (
    <div className="container page" style={{ maxWidth: 860 }}>
      <div className="page-header">
        <h1>How it works, and where it stops working</h1>
        <p>ProofLens combines several imperfect signals. None of them proves authenticity on its own; the verdict depends on how they agree.</p>
      </div>
      <div className="stack">
        <div className="card">
          <h3>At registration</h3>
          <ol>
            <li>The upload is validated from its actual bytes (not its name).</li>
            <li><strong>SHA-256</strong> of the exact file is computed: a cryptographic fingerprint that changes completely if a single bit changes.</li>
            <li><strong>Perceptual hashes</strong> (pHash) of the whole picture and of 13 sub-regions are computed: 64-bit summaries of the picture's coarse structure.</li>
            <li>A random 40-bit ID is embedded as an invisible <strong>TrustMark watermark</strong> in a metadata-free copy, and a <strong>C2PA manifest</strong> is attached.</li>
            <li>All of this goes into a provenance record that is serialised canonically and <strong>signed with Ed25519</strong>. The private key never leaves the server.</li>
          </ol>
        </div>
        <div className="card">
          <h3>At verification</h3>
          <ol>
            <li>Exact match by SHA-256 → strongest possible link.</li>
            <li>Embedded C2PA manifest → validated with the official C2PA SDK if present.</li>
            <li>Watermark → if found, it names a record. It must agree with the visual fingerprint, because anyone can copy a watermark.</li>
            <li>pHash comparison (after removing screenshot borders) → finds visually matching records, measured by Hamming distance.</li>
            <li>Every candidate record's signature is re-verified, and the database is cross-checked against the signed contents.</li>
          </ol>
        </div>
        <div className="card">
          <h3>Known limitations</h3>
          <ul>
            <li>Crops that remove a large part of the image, off-centre crops and rotations usually defeat both the watermark and the fingerprints (result: Unknown).</li>
            <li>Perceptual hashes can collide; adversarial collisions are possible. A purely visual match is reported as weaker evidence.</li>
            <li>A signature proves the record was not altered and which key signed it. It does not prove the registrant's claims are true, or who they are.</li>
            <li>Only images registered with ProofLens can be verified. Unknown never means fake.</li>
          </ul>
          <p className="small muted">See the <Link to="/demo">live tests</Link> and the project documentation (<code>docs/</code>) for measured results.</p>
        </div>
      </div>
    </div>
  );
}
