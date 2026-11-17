export const formatBytes = (n) => {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export const shortHash = (h, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : '-');

export const formatDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const SOURCE_LABELS = {
  camera: 'Camera photograph',
  ai_generated: 'AI-generated image',
  edited: 'Edited image',
  other: 'Other',
};

export const VERDICT_META = {
  VERIFIED: { label: 'Verified provenance', tone: 'verified' },
  UNKNOWN: { label: 'Unknown provenance', tone: 'unknown' },
  CONTRADICTED: { label: 'Contradicted / suspicious', tone: 'contradicted' },
};

export const LINK_LABELS = {
  EXACT: 'Exact file',
  STRONG: 'Strong link',
  MODERATE: 'Visual match',
  WEAK: 'Weak similarity',
  NONE: 'No link',
};

export function describeCreator(creator) {
  if (!creator || creator.mode === 'anonymous') return 'Anonymous';
  if (creator.mode === 'commitment') return creator.pseudonym ? `${creator.pseudonym} (identity committed)` : 'Private (identity commitment)';
  return creator.pseudonym;
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
