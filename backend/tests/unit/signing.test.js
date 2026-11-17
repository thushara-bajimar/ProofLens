import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  generateKeyPair, keyIdFromPublicKey, publicKeyToPem, signPayload, verifyPayload,
} from '../../src/services/signingService.js';

const record = { recordId: 'r1', media: { sha256: 'ab'.repeat(32) }, sourceType: 'camera', recordVersion: 1 };

describe('Ed25519 signing', () => {
  const { publicKey, privateKey } = generateKeyPair();

  it('generates Ed25519 keys with a stable key id', () => {
    expect(publicKey.asymmetricKeyType).toBe('ed25519');
    expect(keyIdFromPublicKey(publicKey)).toMatch(/^ed25519:[0-9a-f]{16}$/);
    expect(keyIdFromPublicKey(publicKey)).toBe(keyIdFromPublicKey(crypto.createPublicKey(publicKeyToPem(publicKey))));
  });

  it('creates a 64-byte signature that verifies', () => {
    const sig = signPayload(record, privateKey);
    expect(Buffer.from(sig, 'base64')).toHaveLength(64);
    expect(verifyPayload(record, sig, publicKeyToPem(publicKey)).valid).toBe(true);
  });

  it('verifies regardless of key order (canonical form)', () => {
    const sig = signPayload(record, privateKey);
    const reordered = { recordVersion: 1, sourceType: 'camera', media: { sha256: 'ab'.repeat(32) }, recordId: 'r1' };
    expect(verifyPayload(reordered, sig, publicKey).valid).toBe(true);
  });

  it('fails when any field is modified after signing', () => {
    const sig = signPayload(record, privateKey);
    expect(verifyPayload({ ...record, sourceType: 'ai_generated' }, sig, publicKey).valid).toBe(false);
    expect(verifyPayload({ ...record, extra: 'x' }, sig, publicKey).valid).toBe(false);
  });

  it('fails with a different (attacker) key', () => {
    const attacker = generateKeyPair();
    const forged = signPayload(record, attacker.privateKey);
    expect(verifyPayload(record, forged, publicKey).valid).toBe(false);
  });

  it('rejects signature-looking strings without throwing', () => {
    expect(verifyPayload(record, 'A'.repeat(88), publicKey).valid).toBe(false);
    expect(verifyPayload(record, 'not base64!!', publicKey)).toMatchObject({ valid: false });
    expect(verifyPayload(record, 'AAAA', publicKey).reason).toMatch(/64/);
  });
});
