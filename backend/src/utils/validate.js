import { AppError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Rejects anything that is not a UUID, so IDs can never contain path or SQL syntax. */
export function requireUuid(value, name = 'id') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new AppError(400, 'INVALID_ID', `${name} must be a valid UUID.`);
  }
  return value.toLowerCase();
}
