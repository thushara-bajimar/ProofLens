/**
 * Manages the server signing key and the table of trusted public keys.
 *
 * - The private key is loaded from disk once and kept in memory only.
 * - Its public half is registered in `signing_keys` so that verification can look
 *   keys up BY ID from a trusted source (our DB), never from the request.
 */
import { config } from '../config/index.js';
import { getDb, nowIso } from '../db/index.js';
import { loadSigningKey } from './signingService.js';

let activeKey;

export function getActiveSigningKey() {
  if (activeKey) return activeKey;
  activeKey = loadSigningKey(config.signingKeyPath, { createIfMissing: config.isTest });
  getDb()
    .prepare(
      `INSERT INTO signing_keys (key_id, algorithm, public_key_pem, status, created_at)
       VALUES (?, 'Ed25519', ?, 'active', ?)
       ON CONFLICT(key_id) DO NOTHING`,
    )
    .run(activeKey.keyId, activeKey.publicKeyPem, nowIso());
  return activeKey;
}

/** Returns { keyId, publicKeyPem, status } or undefined if the key is unknown. */
export function getTrustedKey(keyId) {
  getActiveSigningKey();
  return getDb()
    .prepare('SELECT key_id AS keyId, public_key_pem AS publicKeyPem, status FROM signing_keys WHERE key_id = ?')
    .get(keyId);
}

export function listPublicKeys() {
  getActiveSigningKey();
  return getDb()
    .prepare('SELECT key_id AS keyId, algorithm, public_key_pem AS publicKeyPem, status, created_at AS createdAt, revoked_at AS revokedAt FROM signing_keys ORDER BY created_at')
    .all();
}

/** For tests only: forget the cached key (e.g. after the DB is reset). */
export function resetKeyCache() {
  activeKey = undefined;
}
