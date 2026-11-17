/**
 * Demo / testing runner: pushes one registered image through a fixed set of
 * scenarios (real transformations, attacks and forgeries), VERIFIES every output
 * with the normal verification pipeline, and stores the measured results.
 *
 * Nothing is predicted or hard-coded: every row in the results table is the
 * output of verifyImage() on an actually transformed file.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config, ROOT_DIR } from '../config/index.js';
import { getDb, nowIso } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { hammingDistance } from '../utils/hamming.js';
import { sha256, computePhash } from './fingerprintService.js';
import { applyChain } from './transformService.js';
import { verifyImage } from './verificationService.js';
import { loadVerifiedRecord } from './recordService.js';
import * as watermark from './watermarkService.js';

export const SCENARIOS = [
  { key: 'original', name: 'Original (registered copy, unchanged)', chain: [], expectation: 'Exact SHA-256 match' },
  { key: 'jpeg', name: 'JPEG compression (quality 50)', chain: [{ op: 'jpeg', quality: 50 }], expectation: 'Hash changes; visual match expected' },
  { key: 'resize', name: 'Resized to 40%', chain: [{ op: 'resize', scale: 0.4 }] },
  { key: 'crop_resize', name: 'Crop 80% (centre) + resize 60%', chain: [{ op: 'crop', keep: 0.8 }, { op: 'resize', scale: 0.6 }] },
  { key: 'heavy_crop', name: 'Heavy crop: 50% top-left corner', chain: [{ op: 'crop', keep: 0.5, anchor: 'top-left' }] },
  { key: 'screenshot', name: 'Phone screenshot (chat app)', chain: [{ op: 'screenshot', device: 'phone' }] },
  { key: 'metadata', name: 'Metadata removal (incl. C2PA manifest)', chain: [{ op: 'strip_metadata' }] },
  {
    key: 'chain', name: 'Chain: JPEG 70 → crop 90% → resize 60% → phone screenshot → JPEG 75',
    chain: [{ op: 'jpeg', quality: 70 }, { op: 'crop', keep: 0.9 }, { op: 'resize', scale: 0.6 }, { op: 'screenshot', device: 'phone' }, { op: 'jpeg', quality: 75 }],
  },
  { key: 'edit', name: 'Filter + caption bar (meme-style edit)', chain: [{ op: 'adjust', brightness: 1.2, saturation: 1.4 }, { op: 'caption' }] },
  { key: 'severe', name: 'Severe: 40% corner crop + rotate 8° + JPEG 25', chain: [{ op: 'crop', keep: 0.4, anchor: 'bottom-right' }, { op: 'rotate', degrees: 8 }, { op: 'jpeg', quality: 25 }] },
  { key: 'wm_removal', name: 'Attack: watermark removed, then JPEG 85', chain: [{ op: 'remove_watermark' }, { op: 'jpeg', quality: 85 }], needsRemover: true },
  { key: 'wm_transplant', name: 'Forgery: watermark copied onto an unrelated photo', special: 'transplant' },
  { key: 'tampered_record', name: 'Forgery: signed record edited (source type changed) and presented as a receipt', special: 'tamper' },
  { key: 'unknown', name: 'Unregistered, unrelated photo', special: 'unknown' },
];

const removerInstalled = () => fs.existsSync(path.join(config.watermark.modelPath, `remover_${config.watermark.variant}.onnx`));

/** Picks a sample photo that is NOT registered and does not resemble any registered image. */
async function pickUnrelatedSample(excludeGlobal) {
  const dir = path.join(ROOT_DIR, 'samples');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort() : [];
  const registered = getDb().prepare('SELECT phash FROM media_fingerprints WHERE kind = ?').all('global').map((r) => r.phash);
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const h = await computePhash(buf);
    if (hammingDistance(h, excludeGlobal) > 24 && registered.every((r) => hammingDistance(h, r) > 24)) return { buffer: buf, name: f };
  }
  // Fallback: a synthetic image (noise pattern) if no samples are installed.
  const noise = crypto.randomBytes(256 * 256 * 3);
  return { buffer: await sharp(noise, { raw: { width: 256, height: 256, channels: 3 } }).resize(800, 600).jpeg().toBuffer(), name: 'synthetic-noise' };
}

async function buildScenarioInput(scenario, ctx) {
  if (!scenario.special) {
    if (scenario.needsRemover && !removerInstalled()) {
      return { skipped: 'Watermark remover model not installed (run "npm run models -- --with-remover").' };
    }
    const { buffer, applied } = scenario.chain.length ? await applyChain(ctx.distribution, scenario.chain) : { buffer: ctx.distribution, applied: [] };
    return { buffer, applied };
  }
  if (scenario.special === 'unknown') {
    const s = await pickUnrelatedSample(ctx.record.media.fingerprint.global);
    return { buffer: s.buffer, applied: [{ op: 'substitute', label: `Unrelated photo (${s.name})` }] };
  }
  if (scenario.special === 'transplant') {
    const decoded = await watermark.decode(ctx.distribution);
    if (decoded.status !== 'found') return { skipped: `Watermark could not be read from the registered copy (${decoded.status}).` };
    const s = await pickUnrelatedSample(ctx.record.media.fingerprint.global);
    const forged = await watermark.embed(s.buffer, decoded.shortId);
    return {
      buffer: await sharp(forged).jpeg({ quality: 90 }).toBuffer(),
      applied: [
        { op: 'read_watermark', label: `Attacker reads payload ${decoded.shortId} from the registered copy` },
        { op: 'embed_watermark', label: `Attacker embeds it into an unrelated photo (${s.name})` },
      ],
    };
  }
  if (scenario.special === 'tamper') {
    const forgedRecord = structuredClone(ctx.record);
    forgedRecord.sourceType = ctx.record.sourceType === 'camera' ? 'ai_generated' : 'camera';
    return {
      buffer: ctx.distribution,
      receipt: { format: 'prooflens-receipt-v1', record: forgedRecord, signature: ctx.signature },
      applied: [{ op: 'edit_record', label: `Receipt edited: sourceType "${ctx.record.sourceType}" → "${forgedRecord.sourceType}", original signature kept` }],
    };
  }
  throw new Error(`unknown special scenario ${scenario.special}`);
}

export async function runDemo(recordId, { scenarios } = {}) {
  const stored = loadVerifiedRecord(recordId);
  if (!stored) throw new AppError(404, 'NOT_FOUND', 'No such record.');
  if (!stored.record) throw new AppError(409, 'RECORD_UNREADABLE', 'The stored record cannot be read.');
  const selected = scenarios?.length ? SCENARIOS.filter((s) => scenarios.includes(s.key)) : SCENARIOS;
  if (!selected.length) throw new AppError(400, 'INVALID_SCENARIOS', 'No known scenarios selected.');

  const distribution = fs.readFileSync(path.join(config.storageDir, stored.publicPath));
  const ctx = { record: stored.record, signature: stored.signature, distribution };
  const runId = crypto.randomUUID();
  const runDir = path.join(config.storageDir, 'demo', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const db = getDb();
  db.prepare('INSERT INTO demo_runs (id, record_id, created_at) VALUES (?, ?, ?)').run(runId, recordId, nowIso());

  const results = [];
  let step = 0;
  for (const scenario of selected) {
    step++;
    const startedAt = performance.now();
    let input;
    try {
      input = await buildScenarioInput(scenario, ctx);
    } catch (err) {
      input = { skipped: `Transformation failed: ${err.message}` };
    }
    if (input.skipped) {
      results.push({ step, key: scenario.key, name: scenario.name, skipped: input.skipped });
      continue;
    }
    const meta = await sharp(input.buffer).metadata();
    const ext = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpg';
    const outRel = path.join('demo', runId, `${step}.${ext}`);
    fs.writeFileSync(path.join(config.storageDir, outRel), input.buffer);

    const v = await verifyImage(input.buffer, { receipt: input.receipt });
    const phash = v.fingerprints.plain;
    const checkStatus = (id) => v.checks.find((c) => c.id === id)?.status ?? 'not_checked';
    const result = {
      step,
      key: scenario.key,
      name: scenario.name,
      applied: input.applied,
      output: { url: `/api/demo/results/${runId}/files/${step}`, width: meta.width, height: meta.height, format: meta.format, bytes: input.buffer.length },
      original: { sha256: stored.record.media.distribution.sha256, phash: stored.record.media.fingerprint.global },
      transformed: { sha256: sha256(input.buffer), phash, phashTrimmed: v.fingerprints.trimmed },
      hamming: hammingDistance(phash, stored.record.media.fingerprint.global),
      hammingTrimmed: v.fingerprints.trimmed ? hammingDistance(v.fingerprints.trimmed, stored.record.media.fingerprint.global) : null,
      exactMatch: checkStatus('exact_hash') === 'passed',
      watermark: checkStatus('watermark'),
      c2pa: checkStatus('c2pa'),
      perceptual: checkStatus('perceptual'),
      signature: checkStatus('signature'),
      receipt: input.receipt ? checkStatus('receipt') : null,
      verdict: v.verdict,
      linkStrength: v.linkStrength,
      matchedRecordId: v.matchedRecordId,
      matchedExpectedRecord: v.matchedRecordId === recordId,
      headline: v.headline,
      contradictions: v.contradictions,
      verificationMs: v.timings.totalMs,
      totalMs: Math.round(performance.now() - startedAt),
    };
    results.push(result);
    db.prepare(`INSERT INTO transformation_tests (id, run_id, step, scenario, chain_json, output_path, sha256, phash, hamming, exact_match,
       watermark, verdict, link_strength, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), runId, step, scenario.key, JSON.stringify(input.applied), outRel, result.transformed.sha256, phash,
        result.hamming, result.exactMatch ? 1 : 0, result.watermark, result.verdict, result.linkStrength, JSON.stringify(result), nowIso());
  }
  const summary = summarize(results);
  db.prepare('UPDATE demo_runs SET summary_json = ? WHERE id = ?').run(JSON.stringify(summary), runId);
  return { runId, recordId, createdAt: nowIso(), summary, results };
}

function summarize(results) {
  const counts = { VERIFIED: 0, UNKNOWN: 0, CONTRADICTED: 0, skipped: 0 };
  for (const r of results) counts[r.skipped ? 'skipped' : r.verdict]++;
  return counts;
}

export function getDemoRun(runId) {
  const run = getDb().prepare('SELECT id, record_id AS recordId, created_at AS createdAt, summary_json FROM demo_runs WHERE id = ?').get(runId);
  if (!run) return null;
  const rows = getDb().prepare('SELECT evidence_json FROM transformation_tests WHERE run_id = ? ORDER BY step').all(runId);
  return { runId: run.id, recordId: run.recordId, createdAt: run.createdAt, summary: JSON.parse(run.summary_json ?? '{}'), results: rows.map((r) => JSON.parse(r.evidence_json)) };
}

/** Resolves the stored output file of a demo step (IDs validated by the route). */
export function getDemoFile(runId, step) {
  const row = getDb().prepare('SELECT output_path FROM transformation_tests WHERE run_id = ? AND step = ?').get(runId, step);
  return row ? path.join(config.storageDir, row.output_path) : null;
}

/**
 * Forgery demonstration on the RECORD itself: changes one field of a COPY of the
 * signed record and re-verifies the original signature. The stored record is untouched.
 */
export function tamperDemo(recordId, field, value) {
  const stored = loadVerifiedRecord(recordId);
  if (!stored?.record) throw new AppError(404, 'NOT_FOUND', 'No such record.');
  const allowed = { sourceType: ['camera', 'ai_generated', 'edited', 'other'], registeredAt: null, description: null, 'creator.pseudonym': null };
  if (!(field in allowed)) throw new AppError(400, 'INVALID_FIELD', `field must be one of: ${Object.keys(allowed).join(', ')}`);
  if (typeof value !== 'string' || value.length > 200) throw new AppError(400, 'INVALID_VALUE', 'value must be a short string');
  if (allowed[field] && !allowed[field].includes(value)) throw new AppError(400, 'INVALID_VALUE', `value must be one of: ${allowed[field].join(', ')}`);

  const forged = structuredClone(stored.record);
  if (field === 'creator.pseudonym') forged.creator = { ...forged.creator, mode: 'pseudonym', pseudonym: value };
  else forged[field] = value;
  return { field, originalValue: field === 'creator.pseudonym' ? stored.record.creator?.pseudonym ?? null : stored.record[field], forgedValue: value, forgedRecord: forged, signature: stored.signature };
}
