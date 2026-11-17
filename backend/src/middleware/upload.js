/**
 * Multipart upload handling (multer).
 * - Files are held in MEMORY, never written to disk with a user-chosen name,
 *   so path traversal through file names is impossible.
 * - One file only, size-limited; text fields are limited in count and size.
 * - The browser-provided MIME type is ignored; imageService sniffs magic bytes.
 */
import multer from 'multer';
import { config } from '../config/index.js';

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: 2, fields: 12, fieldSize: 64 * 1024, parts: 16 },
}).fields([{ name: 'image', maxCount: 1 }, { name: 'receipt', maxCount: 1 }]);

/** Returns the uploaded image buffer from req (or undefined). */
export const imageFrom = (req) => req.files?.image?.[0]?.buffer;

/** A receipt may be sent as a JSON file or as a text field. */
export function receiptFrom(req) {
  const file = req.files?.receipt?.[0];
  if (file) return file.buffer.toString('utf8');
  return req.body?.receipt;
}
