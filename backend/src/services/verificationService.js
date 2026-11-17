/**
 * Verification: "Can we find trustworthy evidence about where this image came from?"
 *
 * Execution order:
 *   1. validate the upload and compute its SHA-256
 *   2. exact lookup: does any registered original / distribution copy have this hash?
 *   3. read embedded C2PA manifest and compute pHashes (plain + border-trimmed for
 *      screenshots) in parallel, then decode the watermark (whole image, then the
 *      detected content area)
 *   4. compare the pHashes against every registered fingerprint (global + regions)
 *   5. optional proof receipt: verify its signature and compare with the registry
 *   6. load + re-verify the signature of every record that any evidence points to
 *   7. hand all evidence to the pure verdict engine
 *   8. log the outcome (hashes and verdict only, never the image)
 */
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { getDb, nowIso } from '../db/index.js';
import { canonicalize } from '../utils/canonicalJson.js';
import { validateImage } from './imageService.js';
import { sha256, computeQueryFingerprints, bestDistance } from './fingerprintService.js';
import * as watermark from './watermarkService.js';
import * as c2pa from './c2paService.js';
import { loadVerifiedRecord, loadVerifiedRecordByShortId, verifyRecordSignature, toPublicView } from './recordService.js';
import { decideVerdict } from './verdictEngine.js';

/** Compares the query fingerprints with every registered fingerprint. */
function perceptualDistances(query) {
  const rows = getDb().prepare(`SELECT p.id AS recordId, f.kind, f.label, f.phash
     FROM media_fingerprints f JOIN provenance_records p ON p.media_id = f.media_id`).all();
  const byRecord = new Map();
  for (const row of rows) {
    const entry = byRecord.get(row.recordId) ?? { global: null, region: null };
    const best = bestDistance(query, row.phash);
    if (row.kind === 'global') entry.global = { distance: best.distance, variant: best.variant };
    else if (!entry.region || best.distance < entry.region.distance) {
      entry.region = { distance: best.distance, variant: best.variant, label: row.label };
    }
    byRecord.set(row.recordId, entry);
  }
  return byRecord;
}

/** Parses and checks an optional proof receipt ({ format, record, signature }). */
function checkReceipt(raw) {
  if (raw === undefined || raw === null || raw === '') return { provided: false };
  let receipt = raw;
  if (typeof raw === 'string') {
    try {
      receipt = JSON.parse(raw);
    } catch {
      return { provided: true, parsed: false, reason: 'not valid JSON' };
    }
  }
  if (!receipt || typeof receipt !== 'object' || typeof receipt.signature !== 'string' || typeof receipt.record !== 'object' || !receipt.record) {
    return { provided: true, parsed: false, reason: 'missing record or signature' };
  }
  const sig = verifyRecordSignature(receipt.record, receipt.signature);
  const recordId = typeof receipt.record.recordId === 'string' ? receipt.record.recordId : null;
  const result = { provided: true, parsed: true, recordId, signatureValid: sig.valid, reason: sig.reason };
  if (sig.valid && recordId) {
    const stored = loadVerifiedRecord(recordId);
    if (stored?.record) {
      let same = false;
      try {
        same = canonicalize(stored.record) === canonicalize(receipt.record) && stored.signature === receipt.signature;
      } catch {
        same = false;
      }
      result.storedMismatch = !same;
    }
  }
  return result;
}

export async function verifyImage(buffer, { receipt: rawReceipt } = {}) {
  const started = performance.now();
  const timings = {};
  const lap = (name, since) => { timings[name] = Math.round(performance.now() - since); };

  let t = performance.now();
  const info = await validateImage(buffer);
  const submittedSha = sha256(buffer);
  lap('validateAndHash', t);

  // 2. exact lookup
  const exactRow = getDb().prepare(`SELECT p.id AS recordId, CASE WHEN m.sha256 = ? THEN 'original' ELSE 'distribution' END AS which
     FROM media_records m JOIN provenance_records p ON p.media_id = m.id
     WHERE m.sha256 = ? OR m.distribution_sha256 = ?`).get(submittedSha, submittedSha, submittedSha);

  // 3. independent signals, in parallel
  t = performance.now();
  const [c2paResult, query] = await Promise.all([
    c2pa.readManifest(buffer, info.mime).then((r) => { lap('c2pa', t); return r; }),
    computeQueryFingerprints(buffer).then((r) => { lap('fingerprint', t); return r; }),
  ]);
  t = performance.now();
  const wmResult = await watermark.decode(buffer, query.contentBox);
  lap('watermark', t);

  // Resolve pointers to record IDs.
  const records = {};
  const load = (id) => {
    if (id && !(id in records)) {
      const v = loadVerifiedRecord(id);
      if (v) records[id] = v;
    }
    return records[id];
  };
  const wm = { ...wmResult };
  if (wm.status === 'found') {
    const v = loadVerifiedRecordByShortId(wm.shortId);
    wm.recordId = v?.recordId ?? null;
    if (v) records[v.recordId] = v;
  }
  const c2paEvidence = { ...c2paResult, recordId: null };
  if (c2paResult.status === 'valid' && c2paResult.proofLensRecordId && load(c2paResult.proofLensRecordId)) {
    c2paEvidence.recordId = c2paResult.proofLensRecordId;
  }
  if (exactRow) load(exactRow.recordId);

  // 4. perceptual comparison
  t = performance.now();
  const all = perceptualDistances(query);
  const receipt = checkReceipt(rawReceipt);
  const keep = new Set(
    [...all.entries()]
      .sort((a, b) => a[1].global.distance - b[1].global.distance)
      .slice(0, 5)
      .map(([id]) => id),
  );
  for (const [id, d] of all) {
    // keep everything that could matter for a match OR for the uniqueness (margin) check
    if (d.global.distance <= config.matching.corroborate + config.matching.margin || (d.region && d.region.distance <= config.matching.region + config.matching.margin)) keep.add(id);
  }
  for (const id of [exactRow?.recordId, wm.recordId, c2paEvidence.recordId, receipt.recordId]) if (id && all.has(id)) keep.add(id);
  const distances = {};
  for (const id of keep) {
    distances[id] = all.get(id);
    load(id);
  }
  if (receipt.recordId) load(receipt.recordId);
  lap('lookup', t);

  const evidence = {
    submitted: { sha256: submittedSha, mime: info.mime, width: info.width, height: info.height, sizeBytes: info.sizeBytes, metadata: info.metadata },
    exact: exactRow ? { recordId: exactRow.recordId, which: exactRow.which } : { recordId: null },
    watermark: wm,
    c2pa: c2paEvidence,
    perceptual: { query, distances },
    receipt,
    records,
  };
  const result = decideVerdict(evidence, config.matching);
  const durationMs = Math.round(performance.now() - started);

  // 8. audit log (no image, no IP)
  const logId = crypto.randomUUID();
  const loggedRecordId = result.matchedRecordId && records[result.matchedRecordId] ? result.matchedRecordId : null;
  getDb().prepare(`INSERT INTO verification_logs (id, submitted_sha256, verdict, link_strength, matched_record_id, evidence_json, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(logId, submittedSha, result.verdict, result.linkStrength, loggedRecordId,
      JSON.stringify({ checks: result.checks.map((c) => ({ id: c.id, status: c.status })), contradictions: result.contradictions }),
      durationMs, nowIso());

  const involved = Object.values(records).map(toPublicView);
  return {
    verificationId: logId,
    ...result,
    matchedRecord: result.matchedRecordId && records[result.matchedRecordId] ? toPublicView(records[result.matchedRecordId]) : null,
    involvedRecords: involved,
    submitted: evidence.submitted,
    fingerprints: { plain: query.plain, trimmed: query.trimmed, contentBox: query.contentBox },
    timings: { ...timings, totalMs: durationMs },
  };
}

