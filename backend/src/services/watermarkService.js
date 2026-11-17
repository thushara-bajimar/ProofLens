/**
 * Invisible watermarking with TrustMark (Adobe, open source), used through the
 * official C2PA Node SDK (`@contentauth/c2pa-node`).
 *
 * What TrustMark does: a small neural network adds a barely visible residual
 * pattern to the image that encodes up to 61 bits (variant Q, BCH_5 error
 * correction). A matching decoder network reads the bits back, even after
 * JPEG compression, resizing and moderate cropping.
 *
 * How ProofLens uses it: we embed the record's 40-bit `shortId`. A verifier can
 * then go from the pixels straight to a registry record ("lightweight lookup").
 *
 * What it is NOT: proof. The TrustMark model is public, so anyone can read a
 * payload, or write any payload into any image, and the SDK even ships a
 * watermark REMOVER. The watermark is therefore only a POINTER; the verdict
 * engine requires the image's fingerprint to agree with the record it points to.
 */
import sharp from 'sharp';
import { config } from '../config/index.js';
import { openImage } from './imageService.js';

export const WATERMARK_SCHEME = `trustmark-${config.watermark.variant}-${config.watermark.version}`;
export const PAYLOAD_BITS = 40;
// TrustMark BCH_5 carries 61 data bits. ProofLens uses the first 40 for the record
// short ID and requires the remaining 21 to be zero. This format check matters:
// in testing, the decoder reported a (75-bit) "watermark" in an UNMARKED photo
// (samples/picsum-1015.jpg), i.e. decoders do produce false detections.
export const TRUSTMARK_DATA_BITS = 61;

let trustmarkPromise;
let removerPromise;
let queue = Promise.resolve();

/** Runs model calls one at a time (ONNX sessions are not assumed to be re-entrant). */
function serialized(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function loadTrustmark(loadRemover) {
  const { Trustmark } = await import('@contentauth/c2pa-node');
  return Trustmark.newTrustmark({
    variant: config.watermark.variant,
    version: config.watermark.version,
    modelPath: config.watermark.modelPath,
    loadRemover,
  });
}

function getTrustmark() {
  if (!config.watermark.enabled) return Promise.reject(new Error('watermarking disabled by configuration'));
  if (!trustmarkPromise) {
    trustmarkPromise = loadTrustmark(false).catch((err) => {
      trustmarkPromise = undefined; // allow a retry later
      throw err;
    });
  }
  return trustmarkPromise;
}

/** Starts loading the models in the background (called at server start). */
export function warmUp() {
  getTrustmark().catch(() => {});
}

export async function isAvailable() {
  try {
    await getTrustmark();
    return true;
  } catch {
    return false;
  }
}

export const shortIdToBits = (shortId) =>
  BigInt(`0x${shortId}`).toString(2).padStart(PAYLOAD_BITS, '0');

export const bitsToShortId = (bits) => BigInt(`0b${bits.slice(0, PAYLOAD_BITS)}`).toString(16).padStart(10, '0');

/** Returns a PNG of the oriented, metadata-free pixels (what TrustMark expects). */
async function toCleanPng(buffer) {
  return openImage(buffer).rotate().removeAlpha().png().toBuffer();
}

/**
 * Embeds `shortId` (10 hex chars) into the image.
 * Returns a lossless PNG buffer of the watermarked pixels.
 */
export async function embed(buffer, shortId) {
  const tm = await getTrustmark();
  const png = await toCleanPng(buffer);
  const { width, height } = await sharp(png).metadata();
  const raw = await serialized(() => tm.encode(png, config.watermark.strength, shortIdToBits(shortId)));
  return sharp(Buffer.from(raw), { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/**
 * Tries to read a ProofLens payload from the image.
 * Returns one of:
 *  { status: 'found', shortId, bits }
 *  { status: 'not_found', detail }                 decoder found no valid watermark
 *  { status: 'foreign', bits }                     decoder reported a payload that is not in ProofLens format
 *                                                  (another tool's watermark, or a false detection)
 *  { status: 'unavailable', detail }               models not installed / disabled
 */
export async function decode(buffer, contentBox) {
  const whole = await decodeOnce(buffer);
  if (whole.status === 'found' || whole.status === 'unavailable' || !contentBox) return { ...whole, region: 'whole image' };
  // Screenshots / captioned images: the watermarked picture is only part of the frame.
  // TrustMark rescales the whole input to 256x256, so decode the detected content box too.
  const cropped = await openImage(buffer).rotate().extract({
    left: contentBox.left, top: contentBox.top, width: contentBox.width, height: contentBox.height,
  }).png().toBuffer();
  const inner = await decodeOnce(cropped);
  if (inner.status === 'found') return { ...inner, region: 'detected content area' };
  return { ...whole, region: 'whole image' };
}

async function decodeOnce(buffer) {
  let tm;
  try {
    tm = await getTrustmark();
  } catch (err) {
    return { status: 'unavailable', detail: err.message };
  }
  let bits;
  try {
    const png = await toCleanPng(buffer);
    bits = await serialized(() => tm.decode(png));
  } catch (err) {
    return { status: 'not_found', detail: /corrupt or missing/i.test(err.message) ? 'no watermark detected' : err.message };
  }
  if (typeof bits !== 'string' || !/^[01]+$/.test(bits) || bits.length !== TRUSTMARK_DATA_BITS) {
    return { status: 'foreign', bits: String(bits).slice(0, 80) };
  }
  // ProofLens payloads put the 40-bit ID first and leave the remaining bits zero.
  if (/1/.test(bits.slice(PAYLOAD_BITS))) return { status: 'foreign', bits };
  return { status: 'found', shortId: bitsToShortId(bits), bits };
}

/**
 * ATTACK SIMULATION ONLY (demo page): uses TrustMark's own remover network to
 * strip the watermark, showing that removal tools exist and what happens next.
 */
export async function removeWatermark(buffer) {
  if (!removerPromise) {
    removerPromise = loadTrustmark(true).catch((err) => {
      removerPromise = undefined;
      throw err;
    });
  }
  const tm = await removerPromise;
  const png = await toCleanPng(buffer);
  return Buffer.from(await serialized(() => tm.remove(png)));
}
