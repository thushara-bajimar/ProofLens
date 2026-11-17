/**
 * Central configuration. Every tunable value lives here so the rest of the
 * code never reads process.env directly.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '../../..');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const env = process.env;
const resolvePath = (p) => (path.isAbsolute(p) ? p : path.join(ROOT_DIR, p));
const bool = (v, d) => (v === undefined ? d : !['false', '0', 'no'].includes(String(v).toLowerCase()));
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);

const storageDir = resolvePath(env.STORAGE_DIR || 'storage');

export const config = {
  port: int(env.PORT, 4000),
  corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173',
  isTest: env.NODE_ENV === 'test' || env.VITEST === 'true',

  dbPath: env.DB_PATH === ':memory:' ? ':memory:' : resolvePath(env.DB_PATH || 'database/prooflens.db'),
  storageDir,
  originalsDir: path.join(storageDir, 'originals'),
  publicDir: path.join(storageDir, 'public'),
  tmpDir: path.join(storageDir, 'tmp'),

  signingKeyPath: resolvePath(env.SIGNING_KEY_PATH || 'storage/keys/signing-ed25519.pem'),

  watermark: {
    enabled: bool(env.WATERMARK_ENABLED, true),
    modelPath: resolvePath(env.MODEL_PATH || 'storage/models'),
    variant: 'Q',
    version: 'BCH_5',
    strength: 0.95,
  },

  c2pa: {
    enabled: bool(env.C2PA_ENABLED, true),
    certDir: resolvePath(env.C2PA_CERT_DIR || 'storage/c2pa'),
  },

  upload: {
    maxBytes: int(env.MAX_UPLOAD_MB, 15) * 1024 * 1024,
    maxInputPixels: int(env.MAX_INPUT_PIXELS, 40_000_000),
  },

  rateLimit: {
    windowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: int(env.RATE_LIMIT_MAX, 60),
  },

  /**
   * Perceptual-hash thresholds (Hamming distance out of 64 bits), calibrated with
   * `npm run evaluate` on 20 registered + 10 unregistered photos x 19 transformations
   * (see docs/evaluation-results.md). Measured: the closest IMPOSTOR (a different
   * photo) was never below 16 on the whole image or 14 on the best region.
   */
  matching: {
    strict: 10,          // whole-image distance accepted as a MODERATE link (impostor min 16)
    regionStrict: 6,     // region distance accepted as a MODERATE link for crops (impostor min 14)
    corroborate: 18,     // whole-image distance accepted when a watermark/credential independently names the record
    region: 10,          // region distance accepted as corroboration, or listed as a "possible match"
    margin: 6,           // the best candidate must beat every other record by this much
    contradictGlobal: 26, // a pointer is CONTRADICTED only if the picture is this far on the whole image...
    contradictRegion: 18, // ...AND this far on every region (i.e. looks like an unrelated photo)
  },

};
