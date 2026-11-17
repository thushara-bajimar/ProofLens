import fs from 'node:fs';
import { AppError } from '../utils/errors.js';
import { requireUuid } from '../utils/validate.js';
import { applyChain, OPERATION_NAMES } from '../services/transformService.js';
import { runDemo, getDemoRun, getDemoFile, tamperDemo, SCENARIOS } from '../services/demoService.js';
import { loadVerifiedRecord, verifyRecordSignature } from '../services/recordService.js';
import { config } from '../config/index.js';
import path from 'node:path';

/** GET /api/demo/scenarios */
export function scenarios(req, res) {
  res.json({
    scenarios: SCENARIOS.map(({ key, name, chain, special, needsRemover }) => ({ key, name, chain: chain ?? null, special: special ?? null, needsRemover: Boolean(needsRemover) })),
    operations: OPERATION_NAMES,
  });
}

/** POST /api/transform  { recordId, chain }: returns the transformed image bytes. */
export async function transform(req, res) {
  const recordId = requireUuid(req.body?.recordId, 'recordId');
  const v = loadVerifiedRecord(recordId);
  if (!v) throw new AppError(404, 'NOT_FOUND', 'No such record.');
  const source = fs.readFileSync(path.join(config.storageDir, v.publicPath));
  const { buffer, applied } = await applyChain(source, req.body.chain);
  const format = applied.at(-1).format;
  res.setHeader('X-ProofLens-Applied', encodeURIComponent(JSON.stringify(applied.map((a) => a.label))));
  res.type(format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg').send(buffer);
}

/** POST /api/demo/run  { recordId, scenarios? } */
export async function run(req, res) {
  const recordId = requireUuid(req.body?.recordId, 'recordId');
  const keys = Array.isArray(req.body?.scenarios) ? req.body.scenarios.filter((s) => typeof s === 'string').slice(0, 30) : undefined;
  res.status(201).json(await runDemo(recordId, { scenarios: keys }));
}

/** GET /api/demo/results/:id */
export function results(req, res) {
  const r = getDemoRun(requireUuid(req.params.id));
  if (!r) throw new AppError(404, 'NOT_FOUND', 'No such demo run.');
  res.json(r);
}

/** GET /api/demo/results/:id/files/:step */
export function resultFile(req, res) {
  const runId = requireUuid(req.params.id);
  const step = Number.parseInt(req.params.step, 10);
  if (!Number.isInteger(step) || step < 1 || step > 100) throw new AppError(400, 'INVALID_STEP', 'Invalid step.');
  const file = getDemoFile(runId, step);
  if (!file || !fs.existsSync(file)) throw new AppError(404, 'NOT_FOUND', 'No such file.');
  const demoRoot = path.join(config.storageDir, 'demo');
  const rel = path.relative(demoRoot, path.resolve(file));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new AppError(404, 'NOT_FOUND', 'No such file.');
  res.sendFile(rel, { root: demoRoot });
}

/** POST /api/demo/tamper  { recordId, field, value }: forgery demonstration on a COPY of the record. */
export function tamper(req, res) {
  const recordId = requireUuid(req.body?.recordId, 'recordId');
  const t = tamperDemo(recordId, req.body?.field, req.body?.value);
  const stored = loadVerifiedRecord(recordId);
  res.json({
    ...t,
    originalCheck: verifyRecordSignature(stored.record, stored.signature),
    forgedCheck: verifyRecordSignature(t.forgedRecord, t.signature),
    storedRecordUnchanged: true,
  });
}
