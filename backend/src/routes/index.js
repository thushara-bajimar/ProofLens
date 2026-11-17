import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { uploadImage } from '../middleware/upload.js';
import * as media from '../controllers/mediaController.js';
import * as provenance from '../controllers/provenanceController.js';
import * as demo from '../controllers/demoController.js';
import { pingDb } from '../db/index.js';
import * as watermark from '../services/watermarkService.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config/index.js';

const limiter = (max) => rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please wait a minute.' } },
});
const writeLimit = limiter(Math.max(1, Math.floor(config.rateLimit.max / 3)));
const readLimit = limiter(config.rateLimit.max * 5);

export const router = Router();

router.get('/health', async (req, res) => {
  const db = (() => { try { return pingDb(); } catch { return false; } })();
  res.json({ status: db ? 'ok' : 'degraded', database: db, watermark: config.watermark.enabled ? await watermark.isAvailable() : false, c2pa: config.c2pa.enabled, time: new Date().toISOString() });
});

// Latest measured evaluation (written by `npm run evaluate`); 404 if it was never run.
router.get('/evaluation', readLimit, (req, res) => {
  const file = path.join(ROOT_DIR, 'docs', 'data', 'evaluation.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No evaluation has been run yet (npm run evaluate).' } });
  const { generatedAt, thresholds, registered, holdout, perTransform, impostorGlobal, impostorRegion } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return res.json({ generatedAt, thresholds, registeredCount: registered.length, holdoutCount: holdout.length, perTransform, impostorGlobal, impostorRegion });
});

router.post('/media/register', writeLimit, uploadImage, media.register);
router.post('/media/verify', limiter(config.rateLimit.max), uploadImage, media.verify);
router.get('/media/:id', readLimit, media.getMedia);
router.get('/media/:id/file', readLimit, media.getMediaFile);

router.get('/provenance', readLimit, provenance.list);
router.get('/provenance/:id', readLimit, provenance.getOne);
router.get('/keys', readLimit, provenance.keys);

router.post('/transform', writeLimit, demo.transform);
router.get('/demo/scenarios', readLimit, demo.scenarios);
router.post('/demo/run', writeLimit, demo.run);
router.get('/demo/results/:id', readLimit, demo.results);
router.get('/demo/results/:id/files/:step', readLimit, demo.resultFile);
router.post('/demo/tamper', writeLimit, demo.tamper);
