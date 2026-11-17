/**
 * Visualises two 64-bit perceptual hashes as 8x8 grids and highlights the bits
 * that differ. The Hamming distance is simply the number of highlighted cells.
 */
const toBits = (hex) => (hex ? [...hex].flatMap((h) => parseInt(h, 16).toString(2).padStart(4, '0').split('').map(Number)) : []);

function BitGrid({ bits, diff }) {
  return (
    <div className="bitgrid" aria-hidden="true">
      {bits.map((b, i) => <span key={i} className={`bit ${b ? 'on' : ''} ${diff?.[i] ? 'diff' : ''}`} />)}
    </div>
  );
}

export function HashCompare({ a, b, labelA = 'Submitted', labelB = 'Registered' }) {
  const A = toBits(a);
  const B = toBits(b);
  if (A.length !== 64 || B.length !== 64) return null;
  const diff = A.map((bit, i) => bit !== B[i]);
  const distance = diff.filter(Boolean).length;
  return (
    <div>
      <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
        <div><div className="small muted">{labelA}</div><BitGrid bits={A} diff={diff} /><div className="hash">{a}</div></div>
        <div><div className="small muted">{labelB}</div><BitGrid bits={B} diff={diff} /><div className="hash">{b}</div></div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>{distance} of 64 bits differ (red outline). This count is the Hamming distance.</p>
    </div>
  );
}

/** Horizontal 0–64 scale with the measured distance and the matching thresholds. */
export function DistanceScale({ distance, strict, corroborate }) {
  if (!Number.isFinite(distance)) return null;
  const pos = (v) => `${(v / 64) * 100}%`;
  return (
    <div>
      <div className="scale" style={{ '--t1': pos(strict), '--t2': pos(corroborate) }}>
        <div className="scale-track" />
        <div className="scale-marker" style={{ left: pos(distance) }} title={`distance ${distance}`} />
      </div>
      <div className="scale-labels"><span>0 identical</span><span>≤{strict} close</span><span>≤{corroborate} needs a second signal</span><span>32 typical unrelated</span><span>64</span></div>
    </div>
  );
}
