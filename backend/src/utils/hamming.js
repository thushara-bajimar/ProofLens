/**
 * Hamming distance between two equal-length hex fingerprints:
 * the number of bit positions in which they differ.
 *
 * For a 64-bit pHash: 0 = identical fingerprint, 64 = every bit differs.
 * Two unrelated images land around 32 on average (each bit is a coin flip).
 */
const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export function hammingDistance(hexA, hexB) {
  if (typeof hexA !== 'string' || typeof hexB !== 'string' || hexA.length !== hexB.length) {
    throw new TypeError('hammingDistance: inputs must be hex strings of equal length');
  }
  let distance = 0;
  for (let i = 0; i < hexA.length; i++) {
    const a = parseInt(hexA[i], 16);
    const b = parseInt(hexB[i], 16);
    if (Number.isNaN(a) || Number.isNaN(b)) throw new TypeError('hammingDistance: invalid hex digit');
    distance += POPCOUNT_NIBBLE[a ^ b];
  }
  return distance;
}

/** Converts an array of 0/1 bits into a hex string (4 bits per hex digit). */
export function bitsToHex(bits) {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  }
  return hex;
}
