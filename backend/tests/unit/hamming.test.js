import { describe, it, expect } from 'vitest';
import { hammingDistance, bitsToHex } from '../../src/utils/hamming.js';

describe('hammingDistance', () => {
  it('is 0 for identical hashes', () => {
    expect(hammingDistance('a1b2c3d4e5f60718', 'a1b2c3d4e5f60718')).toBe(0);
  });
  it('counts differing bits', () => {
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('f0', '0f')).toBe(8);
    expect(hammingDistance('8', '1')).toBe(2);
  });
  it('is symmetric', () => {
    expect(hammingDistance('12ab', 'ff00')).toBe(hammingDistance('ff00', '12ab'));
  });
  it('rejects mismatched lengths and non-hex input', () => {
    expect(() => hammingDistance('ab', 'abc')).toThrow();
    expect(() => hammingDistance('zz', 'ab')).toThrow();
  });
  it('bitsToHex packs bits big-endian per nibble', () => {
    expect(bitsToHex([1, 0, 0, 0, 0, 0, 0, 1])).toBe('81');
  });
});
