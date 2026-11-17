/**
 * Canonical JSON serialisation.
 *
 * WHY: a digital signature is computed over BYTES, not over "an object".
 * `JSON.stringify({a:1,b:2})` and `JSON.stringify({b:2,a:1})` produce different
 * bytes for the same data, so a verifier could reject a genuine record (or,
 * worse, two parties could disagree about what was signed). Canonicalisation
 * gives every logically-equal object exactly one byte representation.
 *
 * Rules (a strict subset of RFC 8785, "JSON Canonicalization Scheme"):
 *  - object keys are sorted by UTF-16 code unit order (JS default sort),
 *  - no whitespace,
 *  - properties whose value is `undefined` are omitted (same as JSON.stringify),
 *  - only finite numbers are allowed, and to avoid float-formatting
 *    ambiguity across languages we only allow integers,
 *  - functions, symbols, BigInts, NaN/Infinity, Dates and other class instances are rejected
 *    instead of being silently converted.
 */
export function canonicalize(value) {
  return serialize(value, '$');
}

function serialize(value, where) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`canonicalize: only safe integers are allowed (at ${where})`);
      }
      return String(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => serialize(v === undefined ? null : v, `${where}[${i}]`)).join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`canonicalize: unsupported object type at ${where}`);
      }
      const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(value[k], `${where}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalize: unsupported type ${typeof value} at ${where}`);
  }
}
