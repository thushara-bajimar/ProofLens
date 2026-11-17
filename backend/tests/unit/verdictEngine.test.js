import { describe, it, expect } from 'vitest';
import { decideVerdict } from '../../src/services/verdictEngine.js';

const T = { strict: 10, regionStrict: 6, corroborate: 18, region: 10, margin: 6, contradictGlobal: 26, contradictRegion: 18 };
const record = (id, overrides = {}) => ({
  trusted: true,
  signatureCheck: { valid: true, keyKnown: true, keyStatus: 'active', keyId: 'ed25519:k' },
  consistencyProblems: [],
  record: {
    recordId: id, registeredAt: '2026-11-17T00:00:00.000Z', sourceType: 'camera', creator: { mode: 'anonymous' },
    media: { original: { width: 1200, height: 800 } },
  },
  ...overrides,
});
const dist = (g, r = null) => ({ global: { distance: g, variant: 'plain' }, region: r === null ? null : { distance: r, label: 'centre-80', variant: 'plain' } });
const base = (over = {}) => ({
  submitted: { sha256: 'x', mime: 'image/jpeg', width: 1200, height: 800, metadata: {} },
  exact: { recordId: null },
  watermark: { status: 'not_found' },
  c2pa: { status: 'absent' },
  perceptual: { query: { plain: '0'.repeat(16), trimmed: null, contentBox: null }, distances: {} },
  receipt: { provided: false },
  records: {},
  ...over,
});
const statusOf = (res, id) => res.checks.find((c) => c.id === id)?.status;

describe('verdict engine', () => {
  it('UNKNOWN when nothing is found (missing evidence is not fake)', () => {
    const r = decideVerdict(base(), T);
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.conclusions.cannot.join(' ')).toMatch(/not evidence of manipulation/);
    expect(statusOf(r, 'signature')).toBe('not_checked');
  });

  it('VERIFIED/EXACT on exact hash match with valid signature', () => {
    const r = decideVerdict(base({ exact: { recordId: 'A', which: 'original' }, records: { A: record('A') }, perceptual: { query: {}, distances: { A: dist(0) } } }), T);
    expect(r).toMatchObject({ verdict: 'VERIFIED', linkStrength: 'EXACT', matchedRecordId: 'A' });
  });

  it('VERIFIED/STRONG when watermark and fingerprint agree', () => {
    const r = decideVerdict(base({ watermark: { status: 'found', shortId: 'aa', recordId: 'A' }, records: { A: record('A') }, perceptual: { query: {}, distances: { A: dist(15) } } }), T);
    expect(r).toMatchObject({ verdict: 'VERIFIED', linkStrength: 'STRONG' });
  });

  it('STRONG via watermark + region match even when the whole-image hash is far (crop)', () => {
    const r = decideVerdict(base({ watermark: { status: 'found', shortId: 'aa', recordId: 'A' }, records: { A: record('A') }, perceptual: { query: {}, distances: { A: dist(30, 6) } } }), T);
    expect(r.linkStrength).toBe('STRONG');
  });

  it('VERIFIED/MODERATE on a unique close visual match without pointer', () => {
    const r = decideVerdict(base({ records: { A: record('A'), B: record('B') }, perceptual: { query: {}, distances: { A: dist(4), B: dist(28) } } }), T);
    expect(r).toMatchObject({ verdict: 'VERIFIED', linkStrength: 'MODERATE' });
  });

  it('UNKNOWN (ambiguous) when two records are equally close', () => {
    const r = decideVerdict(base({ records: { A: record('A'), B: record('B') }, perceptual: { query: {}, distances: { A: dist(5), B: dist(7) } } }), T);
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.possibleMatches.map((p) => p.recordId)).toEqual(['A', 'B']);
    expect(statusOf(r, 'perceptual')).toBe('warning');
  });

  it('a loose region similarity alone does not verify', () => {
    const r = decideVerdict(base({ records: { A: record('A') }, perceptual: { query: {}, distances: { A: dist(30, 9) } } }), T);
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.linkStrength).toBe('WEAK');
  });

  it('a very close, unique region match (cropped copy) is MODERATE', () => {
    const r = decideVerdict(base({ records: { A: record('A'), B: record('B') }, perceptual: { query: {}, distances: { A: dist(22, 2), B: dist(26, 16) } } }), T);
    expect(r).toMatchObject({ verdict: 'VERIFIED', linkStrength: 'MODERATE', matchedRecordId: 'A' });
  });

  it('a close region match that another record also approaches is ambiguous', () => {
    const r = decideVerdict(base({ records: { A: record('A'), B: record('B') }, perceptual: { query: {}, distances: { A: dist(22, 4), B: dist(26, 8) } } }), T);
    expect(r.verdict).toBe('UNKNOWN');
  });

  it('watermark + gray-zone visual distance is UNKNOWN, not CONTRADICTED', () => {
    const r = decideVerdict(base({ watermark: { status: 'found', shortId: 'aa', recordId: 'A' }, records: { A: record('A') }, perceptual: { query: {}, distances: { A: dist(22, 16) } } }), T);
    expect(r.verdict).toBe('UNKNOWN');
    expect(statusOf(r, 'watermark')).toBe('warning');
  });

  it('CONTRADICTED when the watermark points to a record the picture does not match', () => {
    const r = decideVerdict(base({ watermark: { status: 'found', shortId: 'aa', recordId: 'A' }, records: { A: record('A') }, perceptual: { query: {}, distances: { A: dist(33, 25) } } }), T);
    expect(r.verdict).toBe('CONTRADICTED');
    expect(statusOf(r, 'watermark')).toBe('failed');
  });

  it('CONTRADICTED when the matched record signature is invalid', () => {
    const bad = record('A', { trusted: false, signatureCheck: { valid: false, keyKnown: true, keyStatus: 'active', reason: 'signature does not match record contents' } });
    const r = decideVerdict(base({ exact: { recordId: 'A', which: 'original' }, records: { A: bad }, perceptual: { query: {}, distances: { A: dist(0) } } }), T);
    expect(r.verdict).toBe('CONTRADICTED');
    expect(statusOf(r, 'signature')).toBe('failed');
  });

  it('CONTRADICTED when DB rows disagree with the signed record', () => {
    const bad = record('A', { trusted: false, consistencyProblems: ['fingerprint "global" differs from the signed record'] });
    const r = decideVerdict(base({ records: { A: bad }, perceptual: { query: {}, distances: { A: dist(2) } } }), T);
    expect(r.verdict).toBe('CONTRADICTED');
  });

  it('revoked key: not trusted, but not called a forgery', () => {
    const revoked = record('A', { trusted: false, signatureCheck: { valid: true, keyKnown: true, keyStatus: 'revoked' } });
    const r = decideVerdict(base({ exact: { recordId: 'A', which: 'original' }, records: { A: revoked }, perceptual: { query: {}, distances: { A: dist(0) } } }), T);
    expect(r.verdict).toBe('UNKNOWN');
    expect(statusOf(r, 'signature')).toBe('failed');
  });

  it('CONTRADICTED for a forged / altered receipt', () => {
    const r = decideVerdict(base({ receipt: { provided: true, parsed: true, signatureValid: false, recordId: 'A', reason: 'signature does not match record contents' } }), T);
    expect(r.verdict).toBe('CONTRADICTED');
    expect(statusOf(r, 'receipt')).toBe('failed');
  });

  it('CONTRADICTED when an embedded C2PA manifest fails validation', () => {
    const r = decideVerdict(base({ c2pa: { status: 'invalid', failures: [{ code: 'assertion.dataHash.mismatch' }] } }), T);
    expect(r.verdict).toBe('CONTRADICTED');
  });

  it('untrusted-but-valid C2PA is a warning, not a contradiction', () => {
    const r = decideVerdict(base({ c2pa: { status: 'valid', trusted: false, recordId: null } }), T);
    expect(r.verdict).toBe('UNKNOWN');
    expect(statusOf(r, 'c2pa')).toBe('warning');
  });

  it('a non-ProofLens watermark signal is ignored', () => {
    const r = decideVerdict(base({ watermark: { status: 'foreign', bits: '0101' } }), T);
    expect(r.verdict).toBe('UNKNOWN');
    expect(statusOf(r, 'watermark')).toBe('info');
  });

  it('every verdict lists what it can and cannot conclude', () => {
    for (const ev of [base(), base({ exact: { recordId: 'A', which: 'original' }, records: { A: record('A') }, perceptual: { query: {}, distances: { A: dist(0) } } })]) {
      const r = decideVerdict(ev, T);
      expect(r.conclusions.can.length).toBeGreaterThan(0);
      expect(r.conclusions.cannot.length).toBeGreaterThan(0);
      expect(r.headline).toBeTruthy();
      expect(r.explanation).toBeTruthy();
    }
  });
});
