-- ProofLens database schema (SQLite).
-- Conventions: TEXT UUID primary keys, ISO-8601 UTC timestamps, foreign keys ON.
-- PRIVATE signing keys are NEVER stored here (see storage/keys and SIGNING_KEY_PATH).

PRAGMA foreign_keys = ON;

-- Public verification keys. A record names the key that signed it (key_id);
-- verification only ever uses keys from this table, never one supplied by a client.
CREATE TABLE IF NOT EXISTS signing_keys (
  key_id          TEXT PRIMARY KEY,                       -- "ed25519:<16 hex>" = hash of the public key
  algorithm       TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
  public_key_pem  TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'revoked')),
  created_at      TEXT NOT NULL,
  revoked_at      TEXT
);

-- One row per registered image. The raw uploaded file is NOT kept: only its
-- SHA-256, a metadata-stripped private master, and the public distribution copy.
CREATE TABLE IF NOT EXISTS media_records (
  id                   TEXT PRIMARY KEY,
  sha256               TEXT NOT NULL UNIQUE,              -- hash of the file exactly as uploaded
  distribution_sha256  TEXT NOT NULL UNIQUE,              -- hash of the watermarked, stripped public copy
  mime                 TEXT NOT NULL,
  width                INTEGER NOT NULL CHECK (width > 0),
  height               INTEGER NOT NULL CHECK (height > 0),
  size_bytes           INTEGER NOT NULL CHECK (size_bytes > 0),
  master_path          TEXT NOT NULL,                     -- private, relative to STORAGE_DIR, never served
  public_path          TEXT NOT NULL,                     -- distribution copy, relative to STORAGE_DIR
  created_at           TEXT NOT NULL
);

-- Perceptual fingerprints used for lookup. They are ALSO inside the signed
-- record; verification cross-checks the two so editing this table cannot
-- silently redirect a match.
CREATE TABLE IF NOT EXISTS media_fingerprints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id   TEXT NOT NULL REFERENCES media_records(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('global', 'region')),
  label      TEXT NOT NULL,
  phash      TEXT NOT NULL CHECK (length(phash) = 16),
  UNIQUE (media_id, label)
);
CREATE INDEX IF NOT EXISTS idx_fingerprints_media ON media_fingerprints(media_id);

-- The signed provenance record. record_json is the exact canonical JSON that
-- was signed; source_type/visibility are copies for filtering only and are
-- never trusted without re-verifying the signature.
CREATE TABLE IF NOT EXISTS provenance_records (
  id              TEXT PRIMARY KEY,
  media_id        TEXT NOT NULL UNIQUE REFERENCES media_records(id) ON DELETE CASCADE,
  short_id        TEXT NOT NULL UNIQUE CHECK (length(short_id) = 10), -- 40-bit watermark payload (hex)
  record_json     TEXT NOT NULL,
  signature       TEXT NOT NULL,
  key_id          TEXT NOT NULL REFERENCES signing_keys(key_id),
  record_version  INTEGER NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('camera', 'ai_generated', 'edited', 'other')),
  visibility      TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted')),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provenance_visibility ON provenance_records(visibility, created_at);

-- Audit trail of verifications. The submitted image itself is NOT stored,
-- nor the requester's IP address.
CREATE TABLE IF NOT EXISTS verification_logs (
  id                 TEXT PRIMARY KEY,
  submitted_sha256   TEXT NOT NULL,
  verdict            TEXT NOT NULL CHECK (verdict IN ('VERIFIED', 'UNKNOWN', 'CONTRADICTED')),
  link_strength      TEXT NOT NULL,
  matched_record_id  TEXT REFERENCES provenance_records(id) ON DELETE SET NULL,
  evidence_json      TEXT NOT NULL,
  duration_ms        INTEGER NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verification_logs_created ON verification_logs(created_at);

-- A demo run = one registered record pushed through a set of transformation scenarios.
CREATE TABLE IF NOT EXISTS demo_runs (
  id          TEXT PRIMARY KEY,
  record_id   TEXT NOT NULL REFERENCES provenance_records(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  summary_json TEXT
);

-- One row per scenario in a demo run, holding the REAL measured results.
CREATE TABLE IF NOT EXISTS transformation_tests (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES demo_runs(id) ON DELETE CASCADE,
  step            INTEGER NOT NULL,
  scenario        TEXT NOT NULL,
  chain_json      TEXT NOT NULL,
  output_path     TEXT,
  sha256          TEXT NOT NULL,
  phash           TEXT NOT NULL,
  hamming         INTEGER NOT NULL,
  exact_match     INTEGER NOT NULL CHECK (exact_match IN (0, 1)),
  watermark       TEXT NOT NULL,
  verdict         TEXT NOT NULL,
  link_strength   TEXT NOT NULL,
  evidence_json   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (run_id, step)
);
