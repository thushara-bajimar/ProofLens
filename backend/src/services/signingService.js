/**
 * Ed25519 signing and verification of provenance records.
 *
 * Ed25519 is a digital-signature scheme on the edwards25519 elliptic curve.
 *  - The PRIVATE key (32 bytes of secret) can create signatures.
 *  - The PUBLIC key (32 bytes) can only CHECK them.
 *  - A signature (64 bytes) is valid only for the exact message bytes it was made on.
 *
 * So if anyone changes even one character of a signed record, verification fails,
 * and nobody without the private key can produce a new valid signature.
 *
 * We sign the canonical JSON of the record (see utils/canonicalJson.js), so the
 * bytes being signed are unambiguous.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../utils/canonicalJson.js';

export const SIGNATURE_ALGORITHM = 'Ed25519';

/** Generates a fresh key pair (KeyObjects). */
export function generateKeyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

/**
 * Stable identifier for a public key: "ed25519:" + first 16 hex chars of
 * SHA-256 over the DER-encoded public key. Records reference keys by this ID.
 */
export function keyIdFromPublicKey(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `ed25519:${crypto.createHash('sha256').update(der).digest('hex').slice(0, 16)}`;
}

export function publicKeyToPem(publicKey) {
  return publicKey.export({ type: 'spki', format: 'pem' });
}

/**
 * Loads the server's private signing key from disk.
 * In test mode a missing key is generated automatically; otherwise a missing key
 * is a configuration error (run `npm run keys`).
 */
export function loadSigningKey(keyPath, { createIfMissing = false } = {}) {
  if (!fs.existsSync(keyPath)) {
    if (!createIfMissing) {
      throw new Error(`Signing key not found at ${keyPath}. Run "npm run keys" first.`);
    }
    const { privateKey } = generateKeyPair();
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Signing key must be an Ed25519 key');
  }
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyPem: publicKeyToPem(publicKey),
    keyId: keyIdFromPublicKey(publicKey),
  };
}

/** Signs canonical(payload) and returns a base64 signature. */
export function signPayload(payload, privateKey) {
  const message = Buffer.from(canonicalize(payload), 'utf8');
  return crypto.sign(null, message, privateKey).toString('base64');
}

/**
 * Verifies a base64 signature over canonical(payload).
 * Returns { valid, reason }. Never throws for malformed input: a malformed
 * signature or key is simply "not valid", with the reason recorded.
 */
export function verifyPayload(payload, signatureB64, publicKeyPemOrObject) {
  try {
    if (typeof signatureB64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureB64)) {
      return { valid: false, reason: 'signature is not valid base64' };
    }
    const signature = Buffer.from(signatureB64, 'base64');
    if (signature.length !== 64) {
      return { valid: false, reason: `signature has ${signature.length} bytes, Ed25519 requires 64` };
    }
    const publicKey =
      typeof publicKeyPemOrObject === 'string' ? crypto.createPublicKey(publicKeyPemOrObject) : publicKeyPemOrObject;
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      return { valid: false, reason: 'public key is not an Ed25519 key' };
    }
    const message = Buffer.from(canonicalize(payload), 'utf8');
    const valid = crypto.verify(null, message, publicKey, signature);
    return { valid, reason: valid ? 'signature matches record contents' : 'signature does not match record contents' };
  } catch (err) {
    return { valid: false, reason: `verification error: ${err.message}` };
  }
}
