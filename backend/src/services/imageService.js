/**
 * Safe image intake: format sniffing, decoding limits, metadata inspection and
 * metadata stripping.
 *
 * Security notes:
 *  - We never trust the file name or the browser-supplied MIME type. The format
 *    is decided from the first bytes of the file ("magic bytes").
 *  - The file must then actually decode with sharp (libvips). A file that only
 *    *starts* like a JPEG but is not one is rejected.
 *  - `limitInputPixels` stops "decompression bombs" (tiny files that expand to
 *    billions of pixels and exhaust memory).
 */
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

export const SUPPORTED_FORMATS = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Detects the real format from magic bytes. Returns 'jpeg' | 'png' | 'webp' | null. */
export function sniffFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Creates a sharp pipeline with our safety limits applied. */
export function openImage(buffer) {
  return sharp(buffer, { limitInputPixels: config.upload.maxInputPixels, failOn: 'error' });
}

/**
 * Validates an uploaded buffer and returns basic facts about it.
 * Throws AppError(400/413/415) with a user-readable message on failure.
 */
export async function validateImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'No image data was received.');
  }
  if (buffer.length > config.upload.maxBytes) {
    throw new AppError(413, 'FILE_TOO_LARGE', `Images must be at most ${config.upload.maxBytes / 1024 / 1024} MB.`);
  }
  const format = sniffFormat(buffer);
  if (!format) {
    throw new AppError(415, 'UNSUPPORTED_TYPE', 'Only JPEG, PNG and WebP images are supported (file contents were checked, not the file name).');
  }
  let meta;
  try {
    meta = await openImage(buffer).metadata();
    // metadata() only reads the header; force a full decode so corrupt files fail here.
    await openImage(buffer).resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  } catch (err) {
    if (/pixel limit/i.test(err.message)) {
      throw new AppError(413, 'TOO_MANY_PIXELS', 'Image dimensions are too large to process safely.');
    }
    throw new AppError(422, 'UNDECODABLE', 'The file could not be decoded as an image. It may be corrupt or disguised.');
  }
  if (meta.format !== format) {
    throw new AppError(415, 'TYPE_MISMATCH', 'File contents do not match a single supported image format.');
  }
  return {
    format,
    mime: SUPPORTED_FORMATS[format],
    width: meta.width,
    height: meta.height,
    sizeBytes: buffer.length,
    metadata: summarizeMetadata(meta),
  };
}

/**
 * Summarises embedded metadata WITHOUT returning sensitive values.
 * We report whether EXIF / GPS / camera info exist, not what they say,
 * so the verification report can explain "metadata was stripped" vs "present".
 */
export function summarizeMetadata(meta) {
  const summary = {
    hasExif: Boolean(meta.exif),
    hasXmp: Boolean(meta.xmp),
    hasIcc: Boolean(meta.icc),
    hasGps: false,
    hasCameraInfo: false,
    software: null,
  };
  if (meta.exif) {
    try {
      const exif = exifReader(meta.exif);
      summary.hasGps = Boolean(exif.GPSInfo && Object.keys(exif.GPSInfo).length);
      summary.hasCameraInfo = Boolean(exif.Image?.Make || exif.Image?.Model);
      summary.software = typeof exif.Image?.Software === 'string' ? exif.Image.Software.slice(0, 80) : null;
    } catch {
      summary.exifUnreadable = true;
    }
  }
  return summary;
}

/**
 * Produces a privacy-safe copy: applies EXIF orientation to the pixels, then
 * re-encodes WITHOUT any metadata (sharp drops EXIF/XMP/GPS unless asked to keep it).
 */
export async function stripMetadata(buffer, format = 'jpeg') {
  const pipeline = openImage(buffer).rotate();
  return format === 'png' ? pipeline.png().toBuffer() : pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
}
