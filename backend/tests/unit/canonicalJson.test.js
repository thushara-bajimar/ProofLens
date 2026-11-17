import { describe, it, expect } from 'vitest';
import { canonicalize } from '../../src/utils/canonicalJson.js';

describe('canonicalize', () => {
  it('sorts keys recursively and removes whitespace', () => {
    expect(canonicalize({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });
  it('gives identical output for logically equal objects', () => {
    expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }));
  });
  it('omits undefined properties and keeps null', () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });
  it('rejects non-integer numbers, NaN and Dates', () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow();
    expect(() => canonicalize({ a: NaN })).toThrow();
    expect(() => canonicalize({ a: new Date() })).toThrow();
  });
  it('escapes strings safely', () => {
    expect(canonicalize({ s: 'quote " and \n newline' })).toBe('{"s":"quote \\" and \\n newline"}');
  });
});
