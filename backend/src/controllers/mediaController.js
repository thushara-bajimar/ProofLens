import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { requireUuid } from '../utils/validate.js';
import { logger } from '../utils/logger.js';
import { imageFrom, receiptFrom } from '../middleware/upload.js';
import { registerImage } from '../services/registrationService.js';
import { verifyImage } from '../services/verificationService.js';
import { loadVerifiedRecord } from '../services/recordService.js';

const requireImage = (req) => {
  const buffer = imageFrom(req);
  if (!buffer) throw new AppError(400, 'NO_IMAGE', 'Attach an image in the "image" field.');
  return buffer;
};

/** POST /api/media/register */
export async function register(req, res) {
  const result = await registerImage(requireImage(req), req.body ?? {});
  logger.info('record registered', { recordId: result.recordId, watermarked: result.distribution.watermarked, c2pa: result.distribution.c2paManifest });
  res.status(201).json(result);
}

/** POST /api/media/verify */
export async function verify(req, res) {
  const result = await verifyImage(requireImage(req), { receipt: receiptFrom(req) });
  logger.info('verification', { verdict: result.verdict, link: result.linkStrength, ms: result.timings.totalMs });
  res.json(result);
}

/** GET /api/media/:id: permitted (non-sensitive) media information, by record ID. */
export function getMedia(req, res) {
  const v = loadVerifiedRecord(requireUuid(req.params.id));
  if (!v?.record) throw new AppError(404, 'NOT_FOUND', 'No such record.');
  const m = v.record.media;
  res.json({
    recordId: v.recordId,
    original: { sha256: m.original.sha256, mime: m.original.mime, width: m.original.width, height: m.original.height },
    distribution: { ...m.distribution, url: `/api/media/${v.recordId}/file` },
    fingerprint: { algorithm: m.fingerprint.algorithm, global: m.fingerprint.global, regionCount: m.fingerprint.regions.length },
    rawOriginalStored: false,
  });
}

/** GET /api/media/:id/file: the public distribution copy (never the private master). */
export function getMediaFile(req, res) {
  const v = loadVerifiedRecord(requireUuid(req.params.id));
  if (!v) throw new AppError(404, 'NOT_FOUND', 'No such record.');
  const file = path.resolve(config.storageDir, v.publicPath);
  if (!file.startsWith(path.resolve(config.publicDir) + path.sep) || !fs.existsSync(file)) {
    throw new AppError(404, 'NOT_FOUND', 'File not available.');
  }
  res.setHeader('Content-Disposition', `inline; filename="prooflens-${v.recordId}.jpg"`);
  // Serve relative to a fixed root: send() then refuses anything outside it.
  res.type('image/jpeg').sendFile(path.basename(file), { root: config.publicDir });
}
