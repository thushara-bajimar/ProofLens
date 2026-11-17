import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {
  sha256, computePhash, computeRegistrationFingerprints, computeQueryFingerprints, findContentBox, REGION_LAYOUT,
} from '../../src/services/fingerprintService.js';
import { hammingDistance } from '../../src/utils/hamming.js';
import { sample, syntheticImage } from '../helpers.js';

describe('SHA-256', () => {
  it('matches Node crypto and a known vector', () => {
    expect(sha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('changes completely when a single byte changes', async () => {
    const img = await syntheticImage(3);
    const modified = Buffer.from(img);
    modified[modified.length - 3] ^= 1;
    expect(sha256(img)).not.toBe(sha256(modified));
    expect(sha256(img)).toBe(crypto.createHash('sha256').update(img).digest('hex'));
  });
  it('changes after a visually lossless re-encode', async () => {
    const img = sample(1015);
    const reencoded = await sharp(img).jpeg({ quality: 95 }).toBuffer();
    expect(sha256(reencoded)).not.toBe(sha256(img));
  });
});

describe('pHash', () => {
  const img = sample(1015);

  it('is a 64-bit hex string and deterministic', async () => {
    const h = await computePhash(img);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(await computePhash(img)).toBe(h);
  });
  it('stays close after JPEG compression and resizing', async () => {
    const h = await computePhash(img);
    const jpeg = await sharp(img).jpeg({ quality: 40 }).toBuffer();
    const small = await sharp(img).resize(400).toBuffer();
    expect(hammingDistance(h, await computePhash(jpeg))).toBeLessThanOrEqual(6);
    expect(hammingDistance(h, await computePhash(small))).toBeLessThanOrEqual(6);
  });
  it('is far for an unrelated photo', async () => {
    const d = hammingDistance(await computePhash(img), await computePhash(sample(64)));
    expect(d).toBeGreaterThan(16);
  });
  it('produces global + region fingerprints at registration', async () => {
    const fp = await computeRegistrationFingerprints(img);
    expect(fp.global).toMatch(/^[0-9a-f]{16}$/);
    expect(fp.regions).toHaveLength(REGION_LAYOUT.length);
  });
});

describe('content box (screenshot border removal)', () => {
  it('finds the photo inside a simulated phone screenshot', async () => {
    const photo = await sharp(sample(1015)).resize(1080).toBuffer(); // 1080x720
    const statusBar = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="80"><rect width="1080" height="80" fill="#000"/><text x="40" y="55" font-size="40" fill="#fff">9:41</text></svg>');
    const shot = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#1c1c1e' } })
      .composite([{ input: statusBar, top: 0, left: 0 }, { input: photo, top: 600, left: 0 }])
      .png().toBuffer();
    const box = await findContentBox(shot);
    expect(box).not.toBeNull();
    expect(Math.abs(box.top - 600)).toBeLessThan(15);
    expect(Math.abs(box.height - 720)).toBeLessThan(20);
    const q = await computeQueryFingerprints(shot);
    const original = await computePhash(sample(1015));
    expect(hammingDistance(q.trimmed, original)).toBeLessThan(hammingDistance(q.plain, original));
  });
  it('returns null for an ordinary photo without borders', async () => {
    expect(await findContentBox(sample(1015))).toBeNull();
  });
});
