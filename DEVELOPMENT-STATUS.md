# ProofLens: Development Status

_Last updated: 2026-11-17_

## Current status
**MVP complete.** All planned phases (0–9) are implemented, tested and documented. Not yet committed
to git. No visual browser walkthrough has been done yet. The frontend builds and every page's API
flow was exercised over HTTP through the Vite proxy.

## Completed features
| Area | Status |
|---|---|
| Monorepo (npm workspaces), `.env.example`, setup scripts (keys, models, samples, seed) | ✅ |
| Canonical JSON, Ed25519 signing/verification, key table | ✅ |
| SHA-256, DCT pHash, 13 region fingerprints, screenshot content-box detection | ✅ |
| SQLite schema (7 tables, FKs, UNIQUE constraints, indexes) | ✅ |
| Registration: validation, duplicate check, near-duplicate warning, EXIF strip, TrustMark watermark, C2PA manifest, signed record, receipt, identity commitment | ✅ |
| Verification: exact / C2PA / watermark (whole + content area) / perceptual / receipt evidence, record re-verification + DB consistency, verdict engine, audit log | ✅ |
| Transformations (11 ops incl. screenshot simulation and watermark-removal attack), demo runner (14 scenarios), tamper demo | ✅ |
| REST API (15 endpoints), rate limiting, helmet, error handling | ✅ |
| Frontend: Landing, Verify, Results dashboard, Register, Demo & tests, Record, How it works | ✅ |
| Evaluation script + generated results (570 verifications) | ✅ |
| Docs (10 required + evaluation results), README, presentation package, study guide | ✅ |

## Tests passed
- `npm test`: **78/78** (6 files: canonical JSON, Hamming, signing, fingerprints, verdict engine, API integration).
- `npm run build`: frontend production build succeeds.
- `npm run evaluate`: 0 false VERIFIED / 0 false CONTRADICTED on 190 hold-out checks; see `docs/evaluation-results.md`.
- End-to-end through the dev servers: health ok; exact → VERIFIED EXACT; JPEG + crop + screenshot chain → VERIFIED STRONG; unregistered → UNKNOWN; 14-scenario demo → 9 verified / 3 unknown / 2 contradicted.

## Known issues / limitations
- Off-centre crops ≥ 30% and rotations are not recovered (UNKNOWN). See `docs/limitations-and-future-scope.md`.
- Watermark detection varies between registrations (random payloads).
- Development signing key and C2PA certificate (untrusted by design).
- npm 11 `allow-scripts` warnings for better-sqlite3 / c2pa-node. They work without the scripts on the test machine; the fallback is documented in the setup guide.
- No authentication; registration is open.
- Thresholds were tuned on the evaluation data itself (documented caveat).

## Bugs found and fixed during development
- TrustMark false detection on an unmarked photo → strict 61-bit payload format check.
- Genuine desktop screenshot falsely CONTRADICTED → three-band watermark rule (corroborated / gray / clearly unrelated).
- `sendFile` refused paths containing dot-directories → files served relative to a fixed `root`.

## Next steps (optional)
1. Walk through the UI in a browser and add screenshots to `README.md`.
2. Fill in the contributors table.
3. Initial git commit.
4. Future work items in `docs/limitations-and-future-scope.md`.
