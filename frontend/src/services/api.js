/**
 * Thin wrapper around fetch() for the ProofLens REST API.
 * Every function returns parsed JSON or throws an ApiError with the server's message.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function handle(res) {
  const type = res.headers.get('content-type') || '';
  if (!res.ok) {
    let body = {};
    if (type.includes('application/json')) body = await res.json().catch(() => ({}));
    const e = body.error || {};
    throw new ApiError(res.status, e.code || 'HTTP_ERROR', e.message || `Request failed (${res.status})`, e.details);
  }
  return type.includes('application/json') ? res.json() : res.blob();
}

const json = (method, url, body) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(handle);

export const api = {
  health: () => fetch('/api/health').then(handle),
  keys: () => fetch('/api/keys').then(handle),

  register(file, fields) {
    const form = new FormData();
    form.append('image', file);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') form.append(k, v);
    return fetch('/api/media/register', { method: 'POST', body: form }).then(handle);
  },

  verify(file, receiptText) {
    const form = new FormData();
    form.append('image', file);
    if (receiptText) form.append('receipt', receiptText);
    return fetch('/api/media/verify', { method: 'POST', body: form }).then(handle);
  },

  evaluation: () => fetch('/api/evaluation').then(handle),
  listRecords: () => fetch('/api/provenance?limit=100').then(handle),
  getRecord: (id) => fetch(`/api/provenance/${encodeURIComponent(id)}`).then(handle),

  scenarios: () => fetch('/api/demo/scenarios').then(handle),
  runDemo: (recordId, scenarios) => json('POST', '/api/demo/run', { recordId, scenarios }),
  demoResults: (runId) => fetch(`/api/demo/results/${encodeURIComponent(runId)}`).then(handle),
  tamper: (recordId, field, value) => json('POST', '/api/demo/tamper', { recordId, field, value }),

  /** Returns { blob, applied } for a custom transformation chain. */
  async transform(recordId, chain) {
    const res = await fetch('/api/transform', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId, chain }) });
    const blob = await handle(res);
    let applied = [];
    try { applied = JSON.parse(decodeURIComponent(res.headers.get('X-ProofLens-Applied') || '[]')); } catch { /* header optional */ }
    return { blob, applied };
  },
};

export const mediaUrl = (recordId) => `/api/media/${recordId}/file`;
