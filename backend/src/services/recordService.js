/**
 * Loading provenance records WITH verification.
 *
 * A stored record is never trusted just because it is in our database. Every
 * time it is read we:
 *   1. look up the signing key by the record's key_id in signing_keys (trusted source),
 *   2. verify the Ed25519 signature over the canonical record JSON,
 *   3. cross-check the database columns and the fingerprint table against the
 *      SIGNED contents, so that editing a row (e.g. swapping a hash, or planting a
 *      fingerprint to redirect matches) is detected.
 */
import { getDb } from '../db/index.js';
import { verifyPayload } from './signingService.js';
import { getTrustedKey } from './keyService.js';

const SELECT_RECORD = `SELECT p.id, p.media_id, p.short_id, p.record_json, p.signature, p.key_id, p.source_type,
  p.visibility, p.created_at, m.sha256, m.distribution_sha256, m.public_path
  FROM provenance_records p JOIN media_records m ON m.id = p.media_id`;

/** Verifies a record object + signature against the trusted key table. */
export function verifyRecordSignature(record, signature) {
  const keyId = record?.signer?.keyId;
  const key = keyId ? getTrustedKey(keyId) : undefined;
  if (!key) {
    return { valid: false, keyKnown: false, keyStatus: null, reason: `signing key ${keyId ?? '(none)'} is not a ProofLens key` };
  }
  const result = verifyPayload(record, signature, key.publicKeyPem);
  return { ...result, keyKnown: true, keyStatus: key.status, keyId };
}

function checkConsistency(row, record) {
  const problems = [];
  const expect = (cond, msg) => { if (!cond) problems.push(msg); };
  expect(record.recordId === row.id, 'record ID in the signed record differs from the database row');
  expect(record.shortId === row.short_id, 'watermark short ID differs from the signed record');
  expect(record.signer?.keyId === row.key_id, 'signing key ID differs from the signed record');
  expect(record.sourceType === row.source_type, 'source type column differs from the signed record');
  expect(record.privacy?.visibility === row.visibility, 'visibility column differs from the signed record');
  expect(record.media?.original?.sha256 === row.sha256, 'original SHA-256 differs from the signed record');
  expect(record.media?.distribution?.sha256 === row.distribution_sha256, 'distribution SHA-256 differs from the signed record');

  const stored = getDb().prepare('SELECT label, phash FROM media_fingerprints WHERE media_id = ?').all(row.media_id);
  const signed = new Map([['global', record.media?.fingerprint?.global], ...(record.media?.fingerprint?.regions ?? []).map((r) => [r.label, r.phash])]);
  expect(stored.length === signed.size, 'number of stored fingerprints differs from the signed record');
  for (const fp of stored) expect(signed.get(fp.label) === fp.phash, `fingerprint "${fp.label}" differs from the signed record`);
  return problems;
}

/**
 * Loads and verifies one record. Returns null if not found.
 * `trusted` is true only if the signature is valid, the key is not revoked and
 * the database is consistent with the signed contents.
 */
export function loadVerifiedRecord(recordId) {
  const row = getDb().prepare(`${SELECT_RECORD} WHERE p.id = ?`).get(recordId);
  return row ? verifyRow(row) : null;
}

export function loadVerifiedRecordByShortId(shortId) {
  const row = getDb().prepare(`${SELECT_RECORD} WHERE p.short_id = ?`).get(shortId);
  return row ? verifyRow(row) : null;
}

export function loadVerifiedRecordByMediaId(mediaId) {
  const row = getDb().prepare(`${SELECT_RECORD} WHERE p.media_id = ?`).get(mediaId);
  return row ? verifyRow(row) : null;
}

function verifyRow(row) {
  let record;
  try {
    record = JSON.parse(row.record_json);
  } catch {
    return {
      recordId: row.id, mediaId: row.media_id, record: null, signature: row.signature, publicPath: row.public_path,
      signatureCheck: { valid: false, keyKnown: false, reason: 'stored record is not valid JSON' },
      consistencyProblems: ['stored record could not be parsed'], trusted: false, visibility: row.visibility,
    };
  }
  const signatureCheck = verifyRecordSignature(record, row.signature);
  const consistencyProblems = checkConsistency(row, record);
  return {
    recordId: row.id,
    mediaId: row.media_id,
    record,
    signature: row.signature,
    publicPath: row.public_path,
    visibility: row.visibility,
    signatureCheck,
    consistencyProblems,
    trusted: signatureCheck.valid && signatureCheck.keyStatus !== 'revoked' && consistencyProblems.length === 0,
  };
}

/** Public, privacy-respecting listing (unlisted records are excluded). */
export function listPublicRecords(limit = 50) {
  return getDb()
    .prepare(`SELECT id FROM provenance_records WHERE visibility = 'public' ORDER BY created_at DESC LIMIT ?`)
    .all(Math.min(Math.max(1, limit), 200))
    .map((r) => loadVerifiedRecord(r.id));
}

/** Shape of a record that is safe to return over the API. */
export function toPublicView(v) {
  return {
    recordId: v.recordId,
    record: v.record,
    signature: v.signature,
    signatureStatus: {
      valid: v.signatureCheck.valid,
      reason: v.signatureCheck.reason,
      keyId: v.signatureCheck.keyId ?? v.record?.signer?.keyId ?? null,
      keyStatus: v.signatureCheck.keyStatus ?? null,
    },
    integrityProblems: v.consistencyProblems,
    trusted: v.trusted,
    distributionUrl: `/api/media/${v.recordId}/file`,
  };
}
