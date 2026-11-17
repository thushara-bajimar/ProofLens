/**
 * Evaluation / threshold calibration.
 *
 * Runs the REAL pipeline on the sample photos in an isolated, temporary registry:
 *   - REGISTERED set (20 photos): registered, then each transformed copy is verified.
 *     Measures: correct-match rate, watermark survival, pHash distances (genuine).
 *   - HOLD-OUT set (10 photos, never registered, several deliberately similar to
 *     registered landscapes): each transformed copy is verified.
 *     Measures: false matches (an unregistered image reported as VERIFIED),
 *     nearest-impostor pHash distances.
 *
 * Output: docs/data/evaluation.json (raw) and docs/evaluation-results.md (tables).
 * Nothing is estimated: every number is counted from actual runs.
 *
 * Usage: npm run evaluate            (all transforms)
 *        npm run evaluate -- --quick (fewer transforms)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prooflens-eval-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.STORAGE_DIR = path.join(tmp, 'storage');
process.env.SIGNING_KEY_PATH = path.join(tmp, 'keys', 'eval.pem');
process.env.C2PA_CERT_DIR = path.join(tmp, 'c2pa');

const { ROOT_DIR, config } = await import('../backend/src/config/index.js');
const { registerImage } = await import('../backend/src/services/registrationService.js');
const { verifyImage } = await import('../backend/src/services/verificationService.js');
const { loadVerifiedRecord } = await import('../backend/src/services/recordService.js');
const { applyChain } = await import('../backend/src/services/transformService.js');
const { computeRegistrationFingerprints, computeQueryFingerprints, bestDistance } = await import('../backend/src/services/fingerprintService.js');

const REGISTERED = [10, 15, 17, 20, 24, 27, 28, 29, 37, 42, 48, 54, 64, 76, 96, 1001, 1011, 1015, 1043, 1062];
const HOLDOUT = [11, 16, 65, 82, 1016, 1018, 1036, 1039, 1044, 1050];

const TRANSFORMS = [
  { key: 'none', name: 'No change (registered copy)', chain: [] },
  { key: 'jpeg50', name: 'JPEG q50', chain: [{ op: 'jpeg', quality: 50 }] },
  { key: 'jpeg20', name: 'JPEG q20', chain: [{ op: 'jpeg', quality: 20 }] },
  { key: 'resize40', name: 'Resize 40%', chain: [{ op: 'resize', scale: 0.4 }] },
  { key: 'webp', name: 'WebP q60', chain: [{ op: 'webp', quality: 60 }] },
  { key: 'strip', name: 'Metadata removal', chain: [{ op: 'strip_metadata' }] },
  { key: 'crop90', name: 'Crop 90% centre', chain: [{ op: 'crop', keep: 0.9 }] },
  { key: 'crop75', name: 'Crop 75% centre', chain: [{ op: 'crop', keep: 0.75 }] },
  { key: 'crop60', name: 'Crop 60% centre', chain: [{ op: 'crop', keep: 0.6 }] },
  { key: 'crop70tl', name: 'Crop 70% top-left', chain: [{ op: 'crop', keep: 0.7, anchor: 'top-left' }] },
  { key: 'crop50tl', name: 'Crop 50% top-left', chain: [{ op: 'crop', keep: 0.5, anchor: 'top-left' }] },
  { key: 'shot_phone', name: 'Phone screenshot', chain: [{ op: 'screenshot', device: 'phone' }] },
  { key: 'shot_desktop', name: 'Desktop screenshot', chain: [{ op: 'screenshot', device: 'desktop' }] },
  { key: 'filter', name: 'Brightness/saturation filter', chain: [{ op: 'adjust', brightness: 1.2, saturation: 1.4 }] },
  { key: 'caption', name: 'Caption bar added', chain: [{ op: 'caption' }] },
  { key: 'rotate5', name: 'Rotate 5°', chain: [{ op: 'rotate', degrees: 5 }] },
  {
    key: 'chain3', name: 'Chain: JPEG 70 → crop 90% → resize 60%',
    chain: [{ op: 'jpeg', quality: 70 }, { op: 'crop', keep: 0.9 }, { op: 'resize', scale: 0.6 }],
  },
  {
    key: 'chain5', name: 'Chain: JPEG 70 → crop 90% → resize 60% → phone screenshot → JPEG 75',
    chain: [{ op: 'jpeg', quality: 70 }, { op: 'crop', keep: 0.9 }, { op: 'resize', scale: 0.6 }, { op: 'screenshot', device: 'phone' }, { op: 'jpeg', quality: 75 }],
  },
  { key: 'severe', name: 'Severe: crop 40% corner + rotate 8° + JPEG 25', chain: [{ op: 'crop', keep: 0.4, anchor: 'bottom-right' }, { op: 'rotate', degrees: 8 }, { op: 'jpeg', quality: 25 }] },
];
const QUICK = new Set(['none', 'jpeg50', 'crop75', 'shot_phone', 'chain5', 'severe']);
const transforms = process.argv.includes('--quick') ? TRANSFORMS.filter((t) => QUICK.has(t.key)) : TRANSFORMS;

const sample = (id) => fs.readFileSync(path.join(ROOT_DIR, 'samples', `picsum-${id}.jpg`));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

// ---- register ---------------------------------------------------------------
const registered = new Map(); // sampleId -> { recordId, distribution, fp }
for (const id of REGISTERED) {
  const r = await registerImage(sample(id), { sourceType: 'camera' });
  const distribution = fs.readFileSync(path.join(config.storageDir, loadVerifiedRecord(r.recordId).publicPath));
  registered.set(id, { recordId: r.recordId, distribution, fp: r.record.media.fingerprint, watermarked: r.distribution.watermarked });
}
log(`registered ${registered.size} photos`);
const recordToSample = new Map([...registered].map(([id, v]) => [v.recordId, id]));

// fingerprints of every registered image, for nearest-impostor distances
const allFp = [...registered].map(([id, v]) => ({ id, fp: v.fp }));
function nearest(query, excludeId) {
  let global = 99;
  let region = 99;
  for (const { id, fp } of allFp) {
    if (id === excludeId) continue;
    global = Math.min(global, bestDistance(query, fp.global).distance);
    for (const r of fp.regions) region = Math.min(region, bestDistance(query, r.phash).distance);
  }
  return { global, region };
}

// ---- run --------------------------------------------------------------------
const rows = [];
for (const t of transforms) {
  for (const [id, reg] of registered) {
    const { buffer } = t.chain.length ? await applyChain(reg.distribution, t.chain) : { buffer: reg.distribution };
    const v = await verifyImage(buffer);
    const q = await computeQueryFingerprints(buffer);
    const own = bestDistance(q, reg.fp.global).distance;
    const ownRegion = Math.min(...reg.fp.regions.map((r) => bestDistance(q, r.phash).distance));
    rows.push({
      set: 'registered', sample: id, transform: t.key, verdict: v.verdict, link: v.linkStrength,
      correct: v.verdict === 'VERIFIED' && v.matchedRecordId === reg.recordId,
      wrongRecord: v.verdict === 'VERIFIED' && v.matchedRecordId !== reg.recordId ? recordToSample.get(v.matchedRecordId) ?? 'unknown' : null,
      watermark: v.checks.find((c) => c.id === 'watermark').status,
      genuineGlobal: own, genuineRegion: ownRegion, impostor: nearest(q, id), ms: v.timings.totalMs,
    });
  }
  for (const id of HOLDOUT) {
    const base = sample(id);
    const { buffer } = t.chain.length ? await applyChain(base, t.chain) : { buffer: base };
    const v = await verifyImage(buffer);
    const q = await computeQueryFingerprints(buffer);
    rows.push({
      set: 'holdout', sample: id, transform: t.key, verdict: v.verdict, link: v.linkStrength,
      falseMatch: v.verdict === 'VERIFIED', matchedSample: v.matchedRecordId ? recordToSample.get(v.matchedRecordId) : null,
      watermark: v.checks.find((c) => c.id === 'watermark').status,
      impostor: nearest(q, null), ms: v.timings.totalMs,
    });
  }
  log(`transform ${t.key} done`);
}

// ---- summarise --------------------------------------------------------------
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { min: s[0], p50: q(0.5), p90: q(0.9), max: s.at(-1) };
};

const perTransform = transforms.map((t) => {
  const reg = rows.filter((r) => r.set === 'registered' && r.transform === t.key);
  const hold = rows.filter((r) => r.set === 'holdout' && r.transform === t.key);
  const count = (arr, f) => arr.filter(f).length;
  return {
    key: t.key, name: t.name, n: reg.length,
    verified: count(reg, (r) => r.correct),
    byLink: Object.fromEntries(['EXACT', 'STRONG', 'MODERATE'].map((l) => [l, count(reg, (r) => r.correct && r.link === l)])),
    unknown: count(reg, (r) => r.verdict === 'UNKNOWN'),
    contradicted: count(reg, (r) => r.verdict === 'CONTRADICTED'),
    wrongRecord: count(reg, (r) => r.wrongRecord),
    watermarkFound: count(reg, (r) => r.watermark === 'passed'),
    genuineGlobal: stats(reg.map((r) => r.genuineGlobal)),
    genuineRegion: stats(reg.map((r) => r.genuineRegion)),
    holdoutN: hold.length,
    holdoutFalseVerified: count(hold, (r) => r.falseMatch),
    holdoutContradicted: count(hold, (r) => r.verdict === 'CONTRADICTED'),
    holdoutWatermarkFalse: count(hold, (r) => r.watermark === 'passed' || r.watermark === 'failed'),
    medianMs: stats(reg.map((r) => r.ms)).p50,
  };
});
const impostorGlobal = stats(rows.map((r) => r.impostor.global));
const impostorRegion = stats(rows.map((r) => r.impostor.region));

const out = {
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform },
  thresholds: config.matching,
  registered: REGISTERED, holdout: HOLDOUT,
  perTransform, impostorGlobal, impostorRegion, rows,
};
fs.mkdirSync(path.join(ROOT_DIR, 'docs', 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT_DIR, 'docs', 'data', 'evaluation.json'), JSON.stringify(out, null, 2));

let md = `# Evaluation results (generated)\n\n> Generated by \`npm run evaluate\` on ${out.generatedAt} (Node ${process.version}, ${process.platform}).\n> Every number below is counted from real runs of the verification pipeline. Re-running produces\n> slightly different watermark results because each registration embeds a new random ID.\n\n`;
md += `**Setup:** ${REGISTERED.length} registered photos, ${HOLDOUT.length} unregistered hold-out photos (several are landscapes visually similar to registered ones). Thresholds (Hamming distance out of 64): ${Object.entries(config.matching).map(([k, v]) => `${k}=${v}`).join(', ')}.

> **Caveat:** the thresholds were chosen by looking at these same measurements (the impostor minimums below). The hold-out photos were never registered, but a larger, independent test set would be needed for an unbiased error-rate estimate.\n\n`;
md += '## Registered photos: was the correct record verified?\n\n| Transformation | Verified (correct record) | EXACT / STRONG / MODERATE | Unknown | Contradicted | Wrong record | Watermark detected | Genuine pHash distance (median, max) | Median verify time |\n|---|---|---|---|---|---|---|---|---|\n';
for (const p of perTransform) {
  md += `| ${p.name} | ${p.verified}/${p.n} (${pct(p.verified, p.n)}) | ${p.byLink.EXACT} / ${p.byLink.STRONG} / ${p.byLink.MODERATE} | ${p.unknown} | ${p.contradicted} | ${p.wrongRecord} | ${p.watermarkFound}/${p.n} | ${p.genuineGlobal.p50}, ${p.genuineGlobal.max} | ${p.medianMs} ms |\n`;
}
md += '\n## Unregistered hold-out photos: false matches\n\n| Transformation | Falsely VERIFIED | CONTRADICTED | Watermark falsely reported |\n|---|---|---|---|\n';
for (const p of perTransform) md += `| ${p.name} | ${p.holdoutFalseVerified}/${p.holdoutN} | ${p.holdoutContradicted}/${p.holdoutN} | ${p.holdoutWatermarkFalse}/${p.holdoutN} |\n`;
md += `\n## Nearest-impostor distances (all queries vs. every OTHER registered image)\n\n| Fingerprint | min | median | 90th pct | max |\n|---|---|---|---|---|\n| Whole image (global) | ${impostorGlobal.min} | ${impostorGlobal.p50} | ${impostorGlobal.p90} | ${impostorGlobal.max} |\n| Best of 13 regions | ${impostorRegion.min} | ${impostorRegion.p50} | ${impostorRegion.p90} | ${impostorRegion.max} |\n`;
md += '\nA threshold is safe only if it stays below the minimum impostor distance. Raw per-image data: `docs/data/evaluation.json`.\n';
fs.writeFileSync(path.join(ROOT_DIR, 'docs', 'evaluation-results.md'), md);
log('wrote docs/evaluation-results.md and docs/data/evaluation.json');
console.log(md);
fs.rmSync(tmp, { recursive: true, force: true });
