import { AppError } from '../utils/errors.js';
import { requireUuid } from '../utils/validate.js';
import { loadVerifiedRecord, listPublicRecords, toPublicView } from '../services/recordService.js';
import { listPublicKeys } from '../services/keyService.js';

/** GET /api/provenance: public records only (unlisted ones are reachable by ID only). */
export function list(req, res) {
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  res.json({ records: listPublicRecords(limit).map(toPublicView) });
}

/** GET /api/provenance/:id: re-verifies the signature on every read. */
export function getOne(req, res) {
  const v = loadVerifiedRecord(requireUuid(req.params.id));
  if (!v) throw new AppError(404, 'NOT_FOUND', 'No such record.');
  res.json(toPublicView(v));
}

/** GET /api/keys: trusted public keys, for offline verification of receipts. */
export function keys(req, res) {
  res.json({ keys: listPublicKeys() });
}
