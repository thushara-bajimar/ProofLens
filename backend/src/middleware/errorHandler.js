/**
 * Central error handler. Known errors (AppError, upload limits) are returned with a
 * clear message; anything else becomes a generic 500 so internal details
 * (stack traces, file paths, SQL) never reach the client.
 */
import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'FILE_TOO_LARGE' : 'BAD_UPLOAD',
        message: tooLarge ? `Images must be at most ${config.upload.maxBytes / 1024 / 1024} MB.` : `Upload rejected (${err.code}).`,
      },
    });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON or is too large.' } });
  }
  if (err.status === 404 || err.statusCode === 404) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not available.' } });
  }
  logger.error('Unhandled error', { path: req.path, message: err.message });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
}
