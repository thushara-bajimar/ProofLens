/**
 * End-to-end API tests: real HTTP requests (supertest) against the Express app,
 * a real (in-memory) SQLite database, real sharp transformations, real Ed25519
 * signatures, real TrustMark watermarking and real C2PA manifests.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { config } from '../../src/config/index.js';
import { generateKeyPair, signPayload } from '../../src/services/signingService.js';
import { sample, syntheticImage } from '../helpers.js';

fs.rmSync(config.storageDir, { recursive: true, force: true });
const app = createApp();
const watermarkModelsPresent = fs.existsSync(`${config.watermark.modelPath}/decoder_Q.onnx`);

const register = (buffer, fields = {}) => {
  const req = request(app).post('/api/media/register');
  for (const [k, v] of Object.entries({ sourceType: 'camera', ...fields })) req.field(k, v);
  return req.attach('image', buffer, 'upload.jpg');
};
const verify = (buffer, receipt) => {
  const req = request(app).post('/api/media/verify').attach('image', buffer, 'check.jpg');
  if (receipt) req.field('receipt', typeof receipt === 'string' ? receipt : JSON.stringify(receipt));
  return req;
};
const statusOf = (body, id) => body.checks.find((c) => c.id === id)?.status;

let reg; // registration response for sample 1015
let distribution; // bytes of its public copy

beforeAll(async () => {
  const res = await register(sample(1015), { creatorMode: 'pseudonym', pseudonym: 'river_lens', description: 'Valley at dawn' });
  expect(res.status).toBe(201);
  reg = res.body;
  const file = await request(app).get(reg.distribution.url).buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  distribution = file.body;
  await register(sample(1043), { visibility: 'unlisted' }); // a second record so lookups are not trivial
});

describe('health & keys', () => {
  it('reports database connectivity', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: true });
  });
  it('publishes public keys and never private key material', async () => {
    const res = await request(app).get('/api/keys');
    expect(res.body.keys[0]).toMatchObject({ algorithm: 'Ed25519', status: 'active' });
    expect(res.text).not.toMatch(/PRIVATE KEY/);
  });
});

describe('registration', () => {
  it('returns a signed record with hashes, fingerprints and a receipt', () => {
    expect(reg.record).toMatchObject({ recordVersion: 1, sourceType: 'camera', creator: { mode: 'pseudonym', pseudonym: 'river_lens' } });
    expect(reg.record.media.original.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(reg.record.media.fingerprint.global).toMatch(/^[0-9a-f]{16}$/);
    expect(Buffer.from(reg.signature, 'base64')).toHaveLength(64);
    expect(reg.receipt.signature).toBe(reg.signature);
    expect(reg.distribution.c2paManifest).toBe(true);
  });
  it.runIf(watermarkModelsPresent)('embeds a watermark in the distribution copy', () => {
    expect(reg.distribution.watermarked).toBe(true);
  });
  it('rejects an exact duplicate with 409', async () => {
    const res = await register(sample(1015));
    expect(res.status).toBe(409);
    expect(res.body.error.details.recordId).toBe(reg.recordId);
  });
  it('warns about visually near-identical registrations', async () => {
    const res = await register(await sharp(sample(1015)).jpeg({ quality: 60 }).toBuffer(), { sourceType: 'other' });
    expect(res.status).toBe(201);
    expect(res.body.nearDuplicates.map((d) => d.recordId)).toContain(reg.recordId);
  });
  it('validates form fields', async () => {
    expect((await register(sample(1062), { sourceType: 'selfie' })).status).toBe(400);
    expect((await register(sample(1062), { creatorMode: 'pseudonym' })).body.error.code).toBe('MISSING_PSEUDONYM');
    expect((await register(sample(1062), { description: 'x'.repeat(501) })).status).toBe(400);
  });
});

describe('upload validation', () => {
  it('requires an image', async () => {
    const res = await request(app).post('/api/media/verify').field('x', '1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_IMAGE');
  });
  it('rejects a text file disguised as .jpg (MIME spoofing)', async () => {
    const res = await request(app).post('/api/media/verify').attach('image', Buffer.from('<?php echo 1; ?> not really an image'), { filename: 'cat.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(415);
  });
  it('rejects a truncated/corrupt JPEG', async () => {
    const res = await verify(sample(1015).subarray(0, 4000));
    expect(res.status).toBe(422);
  });
  it('rejects files over the size limit', async () => {
    const big = Buffer.alloc(config.upload.maxBytes + 10, 0);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    const res = await verify(big);
    expect(res.status).toBe(413);
  });
  it('ignores path-like file names', async () => {
    const res = await request(app).post('/api/media/verify').attach('image', await syntheticImage(5), '../../etc/passwd.jpg');
    expect(res.status).toBe(200);
  });
});

describe('verification', () => {
  it('Scenario 1: the registered copy is VERIFIED with an exact hash match', async () => {
    const res = await verify(distribution);
    expect(res.body).toMatchObject({ verdict: 'VERIFIED', linkStrength: 'EXACT', matchedRecordId: reg.recordId });
    expect(statusOf(res.body, 'signature')).toBe('passed');
    expect(statusOf(res.body, 'c2pa')).toBe('warning'); // valid manifest, untrusted dev certificate
  });
  it('the original file (before watermarking) also matches exactly', async () => {
    const res = await verify(sample(1015));
    expect(res.body).toMatchObject({ verdict: 'VERIFIED', linkStrength: 'EXACT' });
  });
  it('Scenario 2: JPEG compression changes SHA-256 but provenance is still found', async () => {
    const res = await verify(await sharp(distribution).jpeg({ quality: 50 }).toBuffer());
    expect(statusOf(res.body, 'exact_hash')).toBe('absent');
    expect(statusOf(res.body, 'c2pa')).toBe('absent'); // re-encoding drops the manifest
    expect(res.body.verdict).toBe('VERIFIED');
    expect(res.body.matchedRecordId).toBe(reg.recordId);
  });
  it('three-step transformation chain (JPEG → crop → resize) is still linked', async () => {
    const t = await request(app).post('/api/transform').send({ recordId: reg.recordId, chain: [{ op: 'jpeg', quality: 70 }, { op: 'crop', keep: 0.9 }, { op: 'resize', scale: 0.6 }] })
      .buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(t.status).toBe(200);
    const res = await verify(t.body);
    expect(res.body.verdict).toBe('VERIFIED');
    expect(res.body.matchedRecordId).toBe(reg.recordId);
  });
  it('an unrelated, unregistered photo is UNKNOWN (not fake)', async () => {
    const res = await verify(sample(65));
    expect(res.body.verdict).toBe('UNKNOWN');
    expect(res.body.explanation).toMatch(/does NOT mean it is fake/);
  });
  it('writes an audit log entry without storing the image', async () => {
    const before = getDb().prepare('SELECT COUNT(*) AS n FROM verification_logs').get().n;
    await verify(await syntheticImage(9));
    const row = getDb().prepare('SELECT * FROM verification_logs ORDER BY created_at DESC LIMIT 1').get();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM verification_logs').get().n).toBe(before + 1);
    expect(Object.keys(row)).not.toContain('image');
    expect(row.evidence_json.length).toBeLessThan(5000);
  });
});

describe('forgery and tampering', () => {
  it('Scenario 5: a receipt with an edited field fails signature verification', async () => {
    const forged = structuredClone(reg.receipt);
    forged.record.sourceType = 'ai_generated';
    const res = await verify(distribution, forged);
    expect(res.body.verdict).toBe('CONTRADICTED');
    expect(statusOf(res.body, 'receipt')).toBe('failed');
  });
  it('a genuine receipt passes', async () => {
    const res = await verify(distribution, reg.receipt);
    expect(res.body.verdict).toBe('VERIFIED');
    expect(statusOf(res.body, 'receipt')).toBe('passed');
  });
  it('a record re-signed with an attacker key is rejected', async () => {
    const attacker = generateKeyPair();
    const forged = structuredClone(reg.record);
    forged.sourceType = 'ai_generated';
    const res = await verify(distribution, { record: forged, signature: signPayload(forged, attacker.privateKey) });
    expect(res.body.verdict).toBe('CONTRADICTED');
  });
  it('a genuine receipt attached to a different image is CONTRADICTED', async () => {
    const res = await verify(sample(65), reg.receipt);
    expect(res.body.verdict).toBe('CONTRADICTED');
  });
  it('a signature-looking string is not accepted as a signature', async () => {
    const res = await verify(distribution, { record: reg.record, signature: 'A'.repeat(86) + '==' });
    expect(res.body.verdict).toBe('CONTRADICTED');
  });
  it('editing the stored record in the database is detected', async () => {
    const db = getDb();
    const original = db.prepare('SELECT record_json FROM provenance_records WHERE id = ?').get(reg.recordId).record_json;
    const edited = JSON.parse(original);
    edited.sourceType = 'ai_generated';
    db.prepare('UPDATE provenance_records SET record_json = ? WHERE id = ?').run(JSON.stringify(edited), reg.recordId);
    try {
      const res = await verify(distribution);
      expect(res.body.verdict).toBe('CONTRADICTED');
      expect(statusOf(res.body, 'signature')).toBe('failed');
      const pub = await request(app).get(`/api/provenance/${reg.recordId}`);
      expect(pub.body.trusted).toBe(false);
    } finally {
      db.prepare('UPDATE provenance_records SET record_json = ? WHERE id = ?').run(original, reg.recordId);
    }
  });
  it('planting a fingerprint in the lookup table is detected', async () => {
    const db = getDb();
    const mediaId = db.prepare('SELECT media_id FROM provenance_records WHERE id = ?').get(reg.recordId).media_id;
    const row = db.prepare("SELECT phash FROM media_fingerprints WHERE media_id = ? AND label = 'global'").get(mediaId);
    db.prepare("UPDATE media_fingerprints SET phash = ? WHERE media_id = ? AND label = 'global'").run('0f0f0f0f0f0f0f0f', mediaId);
    try {
      const res = await verify(distribution);
      expect(res.body.verdict).toBe('CONTRADICTED');
    } finally {
      db.prepare("UPDATE media_fingerprints SET phash = ? WHERE media_id = ? AND label = 'global'").run(row.phash, mediaId);
    }
  });
  it('/api/demo/tamper shows the forged copy failing and the stored record intact', async () => {
    const res = await request(app).post('/api/demo/tamper').send({ recordId: reg.recordId, field: 'sourceType', value: 'ai_generated' });
    expect(res.body.originalCheck.valid).toBe(true);
    expect(res.body.forgedCheck.valid).toBe(false);
  });
});

describe('provenance access and privacy', () => {
  it('returns a public record with a re-verified signature', async () => {
    const res = await request(app).get(`/api/provenance/${reg.recordId}`);
    expect(res.body).toMatchObject({ recordId: reg.recordId, trusted: true, signatureStatus: { valid: true } });
  });
  it('validates IDs and returns 404 for unknown records', async () => {
    expect((await request(app).get('/api/provenance/../../etc')).status).toBe(404);
    expect((await request(app).get('/api/provenance/not-a-uuid')).status).toBe(400);
    expect((await request(app).get('/api/provenance/7c9e6679-7425-40de-944b-e07fc1f90ae7')).status).toBe(404);
  });
  it('excludes unlisted records from the public listing', async () => {
    const res = await request(app).get('/api/provenance');
    expect(res.body.records.every((r) => r.record.privacy.visibility === 'public')).toBe(true);
  });
  it('commitment mode stores only a hash of the identity', async () => {
    const res = await register(sample(1062), { creatorMode: 'commitment', identity: 'Jane Doe <jane@example.org>' });
    expect(res.status).toBe(201);
    expect(res.body.record.creator.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.creatorSecret.salt).toMatch(/^[0-9a-f]{32}$/);
    const dump = JSON.stringify(getDb().prepare('SELECT * FROM provenance_records').all()) + JSON.stringify(getDb().prepare('SELECT * FROM media_records').all());
    expect(dump).not.toMatch(/Jane Doe|jane@example/);
  });
  it('the public copy has no EXIF/GPS metadata', async () => {
    const meta = await sharp(distribution).metadata();
    expect(meta.exif).toBeUndefined();
  });
  it('the private master copy is never served', async () => {
    const res = await request(app).get(`/api/media/${reg.recordId}`);
    expect(res.body.rawOriginalStored).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/originals/);
  });
});

describe('transformation API and demo runner', () => {
  it('rejects unknown operations and oversized chains', async () => {
    expect((await request(app).post('/api/transform').send({ recordId: reg.recordId, chain: [{ op: 'rm -rf' }] })).status).toBe(400);
    expect((await request(app).post('/api/transform').send({ recordId: reg.recordId, chain: Array(9).fill({ op: 'png' }) })).status).toBe(400);
  });
  it('runs selected scenarios and stores their measured results', async () => {
    const res = await request(app).post('/api/demo/run').send({ recordId: reg.recordId, scenarios: ['original', 'jpeg', 'tampered_record', 'unknown'] });
    expect(res.status).toBe(201);
    const byKey = Object.fromEntries(res.body.results.map((r) => [r.key, r]));
    expect(byKey.original).toMatchObject({ verdict: 'VERIFIED', exactMatch: true });
    expect(byKey.jpeg.exactMatch).toBe(false);
    expect(byKey.tampered_record.verdict).toBe('CONTRADICTED');
    expect(byKey.unknown.verdict).toBe('UNKNOWN');
    const stored = await request(app).get(`/api/demo/results/${res.body.runId}`);
    expect(stored.body.results).toHaveLength(4);
    const file = await request(app).get(byKey.jpeg.output.url);
    expect(file.status).toBe(200);
  });
});
