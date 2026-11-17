/**
 * Real image transformations (sharp), used by the demo/testing page and the
 * evaluation script. Each operation actually changes pixels and/or encoding.
 * Nothing here renames files or fakes a change.
 *
 * A transformation CHAIN is an array of steps, e.g.
 *   [{ op: 'jpeg', quality: 70 }, { op: 'crop', keep: 0.9 }, { op: 'screenshot', device: 'phone' }]
 */
import sharp from 'sharp';
import { AppError } from '../utils/errors.js';
import { openImage } from './imageService.js';
import * as watermark from './watermarkService.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const ANCHORS = {
  center: [0.5, 0.5], 'top-left': [0, 0], 'top-right': [1, 0], 'bottom-left': [0, 1], 'bottom-right': [1, 1],
  top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5],
};

/** Status bar / chat chrome drawn as SVG so the screenshot contains real UI pixels. */
function phoneChrome(width, topBar, bottomBar, height) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${topBar}" fill="#1f2c34"/>
    <text x="48" y="62" font-family="Arial" font-size="40" fill="#ffffff">9:41</text>
    <rect x="${width - 160}" y="34" width="70" height="32" rx="6" fill="none" stroke="#fff" stroke-width="4"/>
    <rect x="${width - 154}" y="40" width="48" height="20" fill="#fff"/>
    <circle cx="80" cy="170" r="44" fill="#6b7c85"/>
    <text x="150" y="160" font-family="Arial" font-size="42" fill="#ffffff">Family group</text>
    <text x="150" y="208" font-family="Arial" font-size="30" fill="#aebac1">forwarded many times</text>
    <rect y="${height - bottomBar}" width="${width}" height="${bottomBar}" fill="#1f2c34"/>
    <rect x="40" y="${height - bottomBar + 40}" width="${width - 200}" height="100" rx="50" fill="#2a3942"/>
    <text x="90" y="${height - bottomBar + 105}" font-family="Arial" font-size="36" fill="#8696a0">Message</text>
  </svg>`);
}

function desktopChrome(width, height) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#f3f3f3"/>
    <rect width="${width}" height="74" fill="#dee1e6"/>
    <rect x="12" y="10" width="300" height="40" rx="8" fill="#ffffff"/>
    <text x="30" y="38" font-family="Arial" font-size="18" fill="#333">news-site.example</text>
    <rect y="${height - 48}" width="${width}" height="48" fill="#202020"/>
  </svg>`);
}

const OPERATIONS = {
  /** Resize to a width (px) or scale factor (0-1]. Keeps aspect ratio. */
  async resize(buf, { width, scale }) {
    const meta = await openImage(buf).metadata();
    const w = width ? clamp(Math.round(num(width, meta.width)), 16, 8000) : Math.max(16, Math.round(meta.width * clamp(num(scale, 0.5), 0.05, 1)));
    return { buffer: await openImage(buf).resize({ width: w }).toBuffer(), label: `Resize to ${w}px wide` };
  },
  /** JPEG re-encode at a given quality (what messaging apps and social networks do). */
  async jpeg(buf, { quality }) {
    const q = clamp(Math.round(num(quality, 70)), 5, 100);
    return { buffer: await openImage(buf).jpeg({ quality: q }).toBuffer(), label: `JPEG quality ${q}` };
  },
  async png(buf) {
    return { buffer: await openImage(buf).png().toBuffer(), label: 'Re-save as PNG' };
  },
  async webp(buf, { quality }) {
    const q = clamp(Math.round(num(quality, 75)), 5, 100);
    return { buffer: await openImage(buf).webp({ quality: q }).toBuffer(), label: `WebP quality ${q}` };
  },
  /** Crop keeping `keep` (0-1) of each side, positioned at `anchor`. */
  async crop(buf, { keep, anchor = 'center' }) {
    const k = clamp(num(keep, 0.8), 0.1, 1);
    const [ax, ay] = ANCHORS[anchor] ?? ANCHORS.center;
    const { width, height } = await openImage(buf).metadata();
    const w = Math.max(16, Math.round(width * k));
    const h = Math.max(16, Math.round(height * k));
    const rect = { left: Math.round((width - w) * ax), top: Math.round((height - h) * ay), width: w, height: h };
    return { buffer: await openImage(buf).extract(rect).toBuffer(), label: `Crop to ${Math.round(k * 100)}% (${anchor})` };
  },
  /** Removes EXIF/XMP/ICC and any embedded C2PA manifest by re-encoding the pixels. */
  async strip_metadata(buf) {
    const meta = await openImage(buf).metadata();
    const pipeline = openImage(buf).rotate();
    const out = meta.format === 'png' ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 92 }).toBuffer();
    return { buffer: out, label: 'Strip all metadata' };
  },
  /**
   * Simulated screenshot: the image is displayed inside app UI on a phone
   * (1080x2340, chat app chrome) or a desktop browser window, rescaled the way the
   * screen would display it, and the WHOLE screen is captured as PNG.
   */
  async screenshot(buf, { device = 'phone' }) {
    const oriented = await openImage(buf).rotate().toBuffer();
    if (device === 'desktop') {
      const W = 1920;
      const H = 1080;
      const shown = await sharp(oriented).resize({ width: 1000, height: 820, fit: 'inside' }).toBuffer();
      const m = await sharp(shown).metadata();
      const out = await sharp(desktopChrome(W, H))
        .composite([{ input: shown, left: Math.round((W - m.width) / 2), top: 74 + Math.round((H - 122 - m.height) / 2) }])
        .png().toBuffer();
      return { buffer: out, label: 'Desktop browser screenshot (1920x1080 PNG)' };
    }
    const W = 1080;
    const H = 2340;
    const TOP = 250;
    const BOTTOM = 180;
    const shown = await sharp(oriented).resize({ width: W - 120, height: H - TOP - BOTTOM - 200, fit: 'inside' }).toBuffer();
    const m = await sharp(shown).metadata();
    const out = await sharp({ create: { width: W, height: H, channels: 3, background: '#0b141a' } })
      .composite([
        { input: phoneChrome(W, TOP, BOTTOM, H), left: 0, top: 0 },
        { input: shown, left: 60, top: TOP + 100 },
      ])
      .png().toBuffer();
    return { buffer: out, label: 'Phone screenshot in a chat app (1080x2340 PNG)' };
  },
  /** Small rotation with background fill: misaligns everything slightly. */
  async rotate(buf, { degrees }) {
    const d = clamp(num(degrees, 3), -45, 45);
    const meta = await openImage(buf).metadata();
    const rotated = await openImage(buf).rotate(d, { background: '#ffffff' }).toBuffer();
    // crop back to the original size around the centre, like a "straighten" tool
    const r = await sharp(rotated).metadata();
    const out = await sharp(rotated).extract({
      left: Math.max(0, Math.round((r.width - meta.width) / 2)), top: Math.max(0, Math.round((r.height - meta.height) / 2)),
      width: Math.min(meta.width, r.width), height: Math.min(meta.height, r.height),
    }).jpeg({ quality: 90 }).toBuffer();
    return { buffer: out, label: `Rotate ${d}°` };
  },
  /** Brightness / saturation change (a typical filter). */
  async adjust(buf, { brightness, saturation }) {
    const b = clamp(num(brightness, 1.15), 0.3, 3);
    const s = clamp(num(saturation, 1.2), 0, 3);
    return { buffer: await openImage(buf).modulate({ brightness: b, saturation: s }).toBuffer(), label: `Filter (brightness ×${b}, saturation ×${s})` };
  },
  /** Adds a caption bar with text (meme-style). */
  async caption(buf, { text = 'You will not believe this' }) {
    const meta = await openImage(buf).metadata();
    const bar = Math.round(meta.height * 0.15);
    const safe = String(text).slice(0, 60).replace(/[<>&"']/g, '');
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${bar}"><rect width="100%" height="100%" fill="#fff"/><text x="50%" y="62%" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="${Math.round(bar * 0.45)}" fill="#000">${safe}</text></svg>`);
    const out = await openImage(buf).extend({ top: bar, background: '#ffffff' }).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
    return { buffer: out, label: 'Add caption bar' };
  },
  /** ATTACK: remove the TrustMark watermark with the public remover network. */
  async remove_watermark(buf) {
    const out = await watermark.removeWatermark(buf);
    return { buffer: out, label: 'Watermark removal attack (TrustMark remover)' };
  },
};

export const OPERATION_NAMES = Object.keys(OPERATIONS);
export const MAX_CHAIN_LENGTH = 8;

export function validateChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0 || chain.length > MAX_CHAIN_LENGTH) {
    throw new AppError(400, 'INVALID_CHAIN', `A transformation chain must have 1-${MAX_CHAIN_LENGTH} steps.`);
  }
  for (const step of chain) {
    if (!step || typeof step !== 'object' || !OPERATIONS[step.op]) {
      throw new AppError(400, 'INVALID_OPERATION', `Unknown transformation. Allowed: ${OPERATION_NAMES.join(', ')}.`);
    }
  }
  return chain;
}

/** Applies each step in order. Returns the final buffer and a log of what was done. */
export async function applyChain(buffer, chain) {
  validateChain(chain);
  let current = buffer;
  const applied = [];
  for (const step of chain) {
    const { buffer: out, label } = await OPERATIONS[step.op](current, step);
    current = out;
    const meta = await sharp(current).metadata();
    applied.push({ op: step.op, label, width: meta.width, height: meta.height, format: meta.format, bytes: current.length });
  }
  return { buffer: current, applied };
}
