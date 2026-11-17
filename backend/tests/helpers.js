import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT_DIR } from '../src/config/index.js';

export const SAMPLES_DIR = path.join(ROOT_DIR, 'samples');

/** Reads a sample photo; fails loudly if `npm run samples` has not been run. */
export function sample(id) {
  const file = path.join(SAMPLES_DIR, `picsum-${id}.jpg`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run "npm run samples".`);
  return fs.readFileSync(file);
}

/** Deterministic synthetic image (for tests that must not depend on downloads). */
export function syntheticImage(seed = 1, width = 400, height = 300) {
  let s = seed;
  const rnd = (n) => { s = (s * 9301 + 49297) % 233280; return Math.floor((s / 233280) * n); };
  let shapes = '';
  for (let i = 0; i < 25; i++) {
    shapes += `<rect x="${rnd(width)}" y="${rnd(height)}" width="${20 + rnd(150)}" height="${20 + rnd(150)}" fill="rgb(${rnd(255)},${rnd(255)},${rnd(255)})"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgb(${rnd(255)},${rnd(255)},${rnd(255)})"/>${shapes}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}
