/**
 * Image fingerprints.
 *
 * 1. SHA-256 (cryptographic hash of the FILE BYTES)
 *    Identifies one exact file. Changing a single bit changes the whole hash,
 *    so any re-encode, crop, resize or screenshot produces a different SHA-256
 *    even if the picture looks identical.
 *
 * 2. pHash (perceptual hash of the PICTURE)
 *    A 64-bit summary of the image's coarse structure (where it is brighter or
 *    darker at low spatial frequencies). Visually similar images get similar
 *    pHashes, so we compare them with the Hamming distance.
 *    A pHash is NOT a cryptographic identity: different images can collide,
 *    and it proves nothing about who made an image.
 *
 * pHash algorithm (the classic DCT pHash):
 *   a) convert to greyscale and shrink to 32x32 (throws away detail, noise,
 *      compression artefacts and the original size),
 *   b) 2-D Discrete Cosine Transform -> frequency coefficients,
 *   c) keep the top-left 8x8 block (the lowest frequencies = overall structure),
 *   d) each of the 64 coefficients becomes 1 if it is above the median of the
 *      63 AC coefficients (DC excluded), else 0.
 */
import crypto from 'node:crypto';
import { openImage } from './imageService.js';
import { bitsToHex, hammingDistance } from '../utils/hamming.js';

export const PHASH_ALGORITHM = 'phash-dct-64';
const N = 32; // input size for the DCT
const K = 8; // size of the low-frequency block kept

// Precomputed cosine table: COS[u][x] = cos((2x+1) u pi / 2N)
const COS = Array.from({ length: K }, (_, u) =>
  Float64Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
);

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** pHash of raw 32x32 greyscale pixels. */
function phashFromPixels(px) {
  // Separable 2-D DCT: first along rows, then along columns (only K outputs needed each way).
  const rowPass = new Float64Array(N * K); // [y][u]
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += px[y * N + x] * COS[u][x];
      rowPass[y * K + u] = s;
    }
  }
  const coeffs = new Float64Array(K * K); // [v][u]
  for (let v = 0; v < K; v++) {
    for (let u = 0; u < K; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += rowPass[y * K + u] * COS[v][y];
      coeffs[v * K + u] = s;
    }
  }
  const ac = Array.from(coeffs.subarray(1)).sort((a, b) => a - b);
  const median = (ac[31] + ac[32]) / 2;
  return bitsToHex(Array.from(coeffs, (c) => (c > median ? 1 : 0)));
}

/** pHash of an image (buffer or sharp pipeline input), optionally of a sub-rectangle. */
export async function computePhash(buffer, region) {
  // sharp applies operations in call order: auto-orient first, then cut the region.
  let img = openImage(buffer).rotate();
  if (region) img = img.extract(region);
  const px = await img.greyscale().resize(N, N, { fit: 'fill' }).raw().toBuffer();
  return phashFromPixels(px);
}

/**
 * Regions fingerprinted at REGISTRATION time, as fractions of width/height.
 * Purpose: a cropped copy no longer looks like the whole original, but it may
 * look like one of these sub-regions. Region matches are weaker evidence
 * (more comparisons = more chances of a coincidental match) and never verify
 * an image on their own.
 */
export const REGION_LAYOUT = (() => {
  const regions = [];
  for (const s of [0.9, 0.8, 0.7, 0.6]) {
    regions.push({ label: `centre-${Math.round(s * 100)}`, x: (1 - s) / 2, y: (1 - s) / 2, w: s, h: s });
  }
  const g = 2 / 3;
  const names = ['left', 'mid', 'right'];
  const rows = ['top', 'mid', 'bottom'];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      regions.push({ label: `grid-${rows[j]}-${names[i]}`, x: (i * (1 - g)) / 2, y: (j * (1 - g)) / 2, w: g, h: g });
    }
  }
  return regions;
})();

function toPixelRect(r, width, height) {
  const left = Math.round(r.x * width);
  const top = Math.round(r.y * height);
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(r.w * width))),
    height: Math.max(1, Math.min(height - top, Math.round(r.h * height))),
  };
}

/** Width/height after EXIF orientation is applied (90° rotations swap them). */
export async function orientedSize(buffer) {
  const meta = await openImage(buffer).metadata();
  const swap = meta.orientation >= 5 && meta.orientation <= 8;
  return swap ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/** Full fingerprint set stored for a registered original. */
export async function computeRegistrationFingerprints(buffer) {
  const { width, height } = await orientedSize(buffer);
  const global = await computePhash(buffer);
  const regions = await Promise.all(
    REGION_LAYOUT.map(async (r) => ({ label: r.label, phash: await computePhash(buffer, toPixelRect(r, width, height)) })),
  );
  return { algorithm: PHASH_ALGORITHM, global, regions };
}

/**
 * Finds the main "content box" of an image by removing uniform borders and
 * separated UI strips (status bars, navigation bars, letterboxing).
 *
 * Method: shrink to <=256 px wide greyscale, mark each row as "content" if its
 * pixel standard deviation is above a small threshold, take the LONGEST run of
 * content rows (so a status bar separated by a flat band is discarded), then do
 * the same for columns inside that band. Returns null if nothing meaningful
 * would be removed.
 */
export async function findContentBox(buffer) {
  const oriented = openImage(buffer).rotate();
  const meta = await orientedSize(buffer);
  const scale = Math.min(1, 256 / Math.max(meta.width, meta.height));
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));
  const px = await oriented.clone().greyscale().resize(w, h, { fit: 'fill' }).raw().toBuffer();

  const STD_THRESHOLD = 4;
  const stdOf = (get, n) => {
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const v = get(i);
      s += v;
      s2 += v * v;
    }
    const mean = s / n;
    return Math.sqrt(Math.max(0, s2 / n - mean * mean));
  };
  const longestRun = (flags) => {
    let best = [0, -1];
    let start = -1;
    for (let i = 0; i <= flags.length; i++) {
      if (i < flags.length && flags[i]) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        if (i - 1 - start > best[1] - best[0]) best = [start, i - 1];
        start = -1;
      }
    }
    return best;
  };

  const rowFlags = Array.from({ length: h }, (_, y) => stdOf((x) => px[y * w + x], w) > STD_THRESHOLD);
  const [top, bottom] = longestRun(rowFlags);
  if (bottom < top) return null;
  const colFlags = Array.from({ length: w }, (_, x) =>
    stdOf((i) => px[(top + i) * w + x], bottom - top + 1) > STD_THRESHOLD,
  );
  const [left, right] = longestRun(colFlags);
  if (right < left) return null;

  const box = {
    left: Math.floor(left / scale),
    top: Math.floor(top / scale),
    width: Math.min(meta.width - Math.floor(left / scale), Math.ceil((right - left + 1) / scale)),
    height: Math.min(meta.height - Math.floor(top / scale), Math.ceil((bottom - top + 1) / scale)),
  };
  const removedFraction = 1 - (box.width * box.height) / (meta.width * meta.height);
  // Ignore negligible trims (<2% of the area) and degenerate boxes.
  if (removedFraction < 0.02 || box.width < 32 || box.height < 32) return null;
  return { ...box, removedFraction: Number(removedFraction.toFixed(3)) };
}

/**
 * Fingerprints computed for a SUBMITTED image: the plain pHash plus, when the
 * image has removable borders/UI strips, the pHash of its content box.
 */
export async function computeQueryFingerprints(buffer) {
  const plain = await computePhash(buffer);
  const box = await findContentBox(buffer);
  const trimmed = box ? await computePhash(buffer, box) : null;
  return { algorithm: PHASH_ALGORITHM, plain, trimmed, contentBox: box };
}

/** Smallest distance between any query variant and a target hash. */
export function bestDistance(query, targetHex) {
  const candidates = [{ variant: 'plain', hex: query.plain }];
  if (query.trimmed) candidates.push({ variant: 'trimmed', hex: query.trimmed });
  let best = null;
  for (const c of candidates) {
    const d = hammingDistance(c.hex, targetHex);
    if (!best || d < best.distance) best = { distance: d, variant: c.variant };
  }
  return best;
}
