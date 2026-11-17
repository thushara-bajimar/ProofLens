/**
 * Registration: attaches provenance to an image at creation time.
 *
 * Execution order (each step's output feeds the next):
 *   1. validate the upload (magic bytes, decodes, size limits)
 *   2. SHA-256 of the uploaded bytes -> reject exact duplicates
 *   3. perceptual fingerprints (global + 13 regions) of the oriented pixels
 *   4. warn if the picture is already registered under another record (near-duplicate)
 *   5. allocate recordId (UUID) and shortId (random 40 bits = watermark payload)
 *   6. build the DISTRIBUTION copy: strip metadata -> embed TrustMark -> JPEG -> attach C2PA manifest
 *   7. build the provenance record and sign its canonical JSON with Ed25519
 *   8. write files + DB rows in one transaction
 *
 * Privacy: the raw upload (with its EXIF/GPS) is NOT stored. We keep its hash,
 * a metadata-free private master copy (for the demo), and the public copy.
 * The creator's real identity is never stored: only an optional pseudonym and/or a
 * salted hash commitment whose secret is returned once to the creator.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config/index.js';
import { getDb, nowIso } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { validateImage, stripMetadata } from './imageService.js';
import { sha256, computeRegistrationFingerprints, PHASH_ALGORITHM } from './fingerprintService.js';
import { hammingDistance } from '../utils/hamming.js';
import * as watermark from './watermarkService.js';
import * as c2pa from './c2paService.js';
import { signPayload, SIGNATURE_ALGORITHM } from './signingService.js';
import { getActiveSigningKey } from './keyService.js';

export const RECORD_VERSION = 1;
export const SOURCE_TYPES = ['camera', 'ai_generated', 'edited', 'other'];
export const CREATOR_MODES = ['anonymous', 'pseudonym', 'commitment'];
export const VISIBILITIES = ['public', 'unlisted'];

/** Removes control characters and trims; returns undefined for empty strings. */
function cleanText(value, maxLength, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_FIELD', `${field} must be text.`);
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (cleaned.length > maxLength) throw new AppError(400, 'INVALID_FIELD', `${field} must be at most ${maxLength} characters.`);
  return cleaned || undefined;
}

/** Validates and normalises the registration form fields. */
export function parseRegistrationInput(body = {}) {
  const sourceType = body.sourceType;
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new AppError(400, 'INVALID_SOURCE_TYPE', `sourceType must be one of: ${SOURCE_TYPES.join(', ')}.`);
  }
  const creatorMode = body.creatorMode || 'anonymous';
  if (!CREATOR_MODES.includes(creatorMode)) {
    throw new AppError(400, 'INVALID_CREATOR_MODE', `creatorMode must be one of: ${CREATOR_MODES.join(', ')}.`);
  }
  const visibility = body.visibility || 'public';
  if (!VISIBILITIES.includes(visibility)) {
    throw new AppError(400, 'INVALID_VISIBILITY', `visibility must be one of: ${VISIBILITIES.join(', ')}.`);
  }
  const pseudonym = cleanText(body.pseudonym, 64, 'pseudonym');
  const identity = cleanText(body.identity, 200, 'identity');
  if (creatorMode === 'pseudonym' && !pseudonym) {
    throw new AppError(400, 'MISSING_PSEUDONYM', 'Enter a pseudonym or choose anonymous registration.');
  }
  if (creatorMode === 'commitment' && !identity) {
    throw new AppError(400, 'MISSING_IDENTITY', 'Enter the identity to commit to (it is hashed, not stored).');
  }
  return {
    sourceType,
    creatorMode,
    pseudonym: creatorMode === 'anonymous' ? undefined : pseudonym,
    identity: creatorMode === 'commitment' ? identity : undefined,
    description: cleanText(body.description, 500, 'description'),
    visibility,
  };
}

/**
 * Hash commitment: commitment = SHA-256("prooflens-commitment-v1" | salt | identity).
 * Publishing the commitment reveals nothing about the identity (salt is 128 random bits);
 * later the creator can reveal salt + identity and anyone can recompute the hash.
 */
export function makeCommitment(identity, saltHex = crypto.randomBytes(16).toString('hex')) {
  const commitment = crypto.createHash('sha256').update(`prooflens-commitment-v1|${saltHex}|${identity}`, 'utf8').digest('hex');
  return { commitment, salt: saltHex };
}

function newShortId(db) {
  const exists = db.prepare('SELECT 1 FROM provenance_records WHERE short_id = ?');
  for (let i = 0; i < 10; i++) {
    const candidate = crypto.randomBytes(5).toString('hex');
    if (candidate !== '0000000000' && !exists.get(candidate)) return candidate;
  }
  throw new Error('could not allocate a unique short id');
}

/** Finds already-registered images that look the same (for a duplicate warning). */
function findNearDuplicates(db, globalHash) {
  const rows = db.prepare(`SELECT f.phash, p.id AS recordId FROM media_fingerprints f
     JOIN provenance_records p ON p.media_id = f.media_id WHERE f.kind = 'global'`).all();
  return rows
    .map((r) => ({ recordId: r.recordId, distance: hammingDistance(globalHash, r.phash) }))
    .filter((r) => r.distance <= config.matching.strict)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

export async function registerImage(buffer, rawInput) {
  const input = parseRegistrationInput(rawInput);
  const info = await validateImage(buffer);
  const db = getDb();
  const signingKey = getActiveSigningKey();

  const originalSha = sha256(buffer);
  const existing = db.prepare(`SELECT p.id FROM media_records m JOIN provenance_records p ON p.media_id = m.id
     WHERE m.sha256 = ? OR m.distribution_sha256 = ?`).get(originalSha, originalSha);
  if (existing) {
    throw new AppError(409, 'ALREADY_REGISTERED', 'This exact file is already registered.', { recordId: existing.id });
  }

  const fingerprint = await computeRegistrationFingerprints(buffer);
  const nearDuplicates = findNearDuplicates(db, fingerprint.global);

  const recordId = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  const shortId = newShortId(db);

  // --- distribution copy -------------------------------------------------
  const master = await stripMetadata(buffer, 'png'); // lossless, metadata-free, oriented
  const notes = [];
  let pixels = master;
  let watermarkScheme = null;
  if (config.watermark.enabled) {
    try {
      pixels = await watermark.embed(master, shortId);
      watermarkScheme = watermark.WATERMARK_SCHEME;
    } catch (err) {
      notes.push(`Watermark not embedded: ${err.message}`);
    }
  } else {
    notes.push('Watermark not embedded: disabled by configuration');
  }
  let distribution = await sharp(pixels).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  let c2paAttached = false;
  if (config.c2pa.enabled) {
    try {
      distribution = await c2pa.signJpeg(distribution, { recordId, shortId, claimedSourceType: input.sourceType });
      c2paAttached = true;
    } catch (err) {
      notes.push(`C2PA manifest not attached: ${err.message}`);
    }
  }
  const distributionSha = sha256(distribution);

  // --- creator --------------------------------------------------------------
  const creator = { mode: input.creatorMode };
  if (input.pseudonym) creator.pseudonym = input.pseudonym;
  let creatorSecret;
  if (input.creatorMode === 'commitment') {
    const { commitment, salt } = makeCommitment(input.identity);
    creator.commitment = commitment;
    creatorSecret = { salt, identity: input.identity, note: 'Shown once and not stored. Keep it to prove authorship later.' };
  }

  // --- signed record ----------------------------------------------------------
  const record = {
    recordVersion: RECORD_VERSION,
    recordId,
    shortId,
    registeredAt: nowIso(),
    sourceType: input.sourceType,
    description: input.description,
    creator,
    media: {
      original: { sha256: originalSha, mime: info.mime, width: info.width, height: info.height, sizeBytes: info.sizeBytes },
      distribution: { sha256: distributionSha, mime: 'image/jpeg', watermark: watermarkScheme, c2paManifest: c2paAttached },
      fingerprint: { algorithm: PHASH_ALGORITHM, global: fingerprint.global, regions: fingerprint.regions },
    },
    privacy: { visibility: input.visibility, metadataStripped: true, gpsCollected: false, rawOriginalStored: false },
    signer: { keyId: signingKey.keyId, algorithm: SIGNATURE_ALGORITHM, issuer: 'ProofLens registry (development)' },
  };
  const signature = signPayload(record, signingKey.privateKey);
  const recordJson = JSON.stringify(record);

  // --- persist ------------------------------------------------------------------
  const masterRel = path.join('originals', `${mediaId}.png`);
  const publicRel = path.join('public', `${mediaId}.jpg`);
  fs.mkdirSync(config.originalsDir, { recursive: true });
  fs.mkdirSync(config.publicDir, { recursive: true });
  fs.writeFileSync(path.join(config.storageDir, masterRel), master);
  fs.writeFileSync(path.join(config.storageDir, publicRel), distribution);

  const createdAt = record.registeredAt;
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO media_records (id, sha256, distribution_sha256, mime, width, height, size_bytes, master_path, public_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(mediaId, originalSha, distributionSha, info.mime, info.width, info.height, info.sizeBytes, masterRel, publicRel, createdAt);
      const fp = db.prepare('INSERT INTO media_fingerprints (media_id, kind, label, phash) VALUES (?, ?, ?, ?)');
      fp.run(mediaId, 'global', 'global', fingerprint.global);
      for (const r of fingerprint.regions) fp.run(mediaId, 'region', r.label, r.phash);
      db.prepare(`INSERT INTO provenance_records (id, media_id, short_id, record_json, signature, key_id, record_version, source_type, visibility, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(recordId, mediaId, shortId, recordJson, signature, signingKey.keyId, RECORD_VERSION, input.sourceType, input.visibility, createdAt);
    })();
  } catch (err) {
    fs.rmSync(path.join(config.storageDir, masterRel), { force: true });
    fs.rmSync(path.join(config.storageDir, publicRel), { force: true });
    if (/UNIQUE constraint failed: media_records/.test(err.message)) {
      throw new AppError(409, 'ALREADY_REGISTERED', 'This exact file was registered concurrently.');
    }
    throw err;
  }

  return {
    recordId,
    shortId,
    record,
    signature,
    receipt: { format: 'prooflens-receipt-v1', record, signature },
    distribution: { url: `/api/media/${recordId}/file`, sha256: distributionSha, watermarked: Boolean(watermarkScheme), c2paManifest: c2paAttached },
    nearDuplicates,
    creatorSecret,
    notes,
  };
}
