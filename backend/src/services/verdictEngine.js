/**
 * The verdict engine: turns collected EVIDENCE into one of three verdicts.
 *
 * It is a pure function (no I/O), so every rule can be unit-tested directly.
 *
 *  VERIFIED      a trusted signed record exists AND the image is linked to it
 *                strongly enough (EXACT, STRONG or MODERATE) AND nothing conflicts.
 *  CONTRADICTED  some evidence CONFLICTS: an altered/forged record or receipt, a
 *                watermark pointing to a record the picture does not match, an
 *                embedded credential that fails validation, ...
 *  UNKNOWN       everything else. Missing evidence is NEVER treated as fake.
 *
 * Link strength between the submitted image and a record:
 *  EXACT     same SHA-256 as the registered original or its distribution copy
 *  STRONG    an independent pointer (watermark / C2PA manifest / receipt) names the
 *            record AND the perceptual fingerprint agrees
 *  MODERATE  no pointer, but the global pHash is within `strict` of exactly one record
 *            and every other record is at least `margin` further away
 *  WEAK      only a looser visual similarity (gray zone, region-only, or ambiguous)
 *  NONE      nothing
 */

export const LINK_ORDER = ['NONE', 'WEAK', 'MODERATE', 'STRONG', 'EXACT'];
const rank = (link) => LINK_ORDER.indexOf(link);

/**
 * @param {object} ev evidence collected by verificationService
 * @param {object} t  thresholds { strict, corroborate, region, margin }
 */
export function decideVerdict(ev, t) {
  const checks = [];
  const contradictions = [];
  const records = ev.records ?? {};
  const dist = ev.perceptual?.distances ?? {};

  const visuallyCorroborates = (id) => {
    const d = dist[id];
    return Boolean(d) && (d.global.distance <= t.corroborate || (d.region && d.region.distance <= t.region));
  };
  // "Clearly a different picture": far on the whole image AND on every region.
  // Between corroborated and clearly-unrelated lies a gray zone, which is
  // reported as uncertain, NOT as a contradiction (a genuine heavily edited copy
  // can land there; see docs/evaluation-results.md).
  const visuallyUnrelated = (id) => {
    const d = dist[id];
    return Boolean(d) && d.global.distance >= t.contradictGlobal && (!d.region || d.region.distance >= t.contradictRegion);
  };

  // ---- pointers: things that NAME a specific record ------------------------
  const pointers = []; // { source, recordId }
  if (ev.exact?.recordId) pointers.push({ source: 'exact', recordId: ev.exact.recordId });
  if (ev.watermark?.status === 'found' && ev.watermark.recordId) pointers.push({ source: 'watermark', recordId: ev.watermark.recordId });
  if (ev.c2pa?.status === 'valid' && ev.c2pa.recordId) pointers.push({ source: 'c2pa', recordId: ev.c2pa.recordId });
  if (ev.receipt?.provided && ev.receipt.signatureValid && ev.receipt.recordId && records[ev.receipt.recordId]) {
    pointers.push({ source: 'receipt', recordId: ev.receipt.recordId });
  }

  // ---- 1. SHA-256 exact match --------------------------------------------------
  checks.push(ev.exact?.recordId
    ? check('exact_hash', 'Exact file match (SHA-256)', 'passed',
      `This file is byte-for-byte identical to the registered ${ev.exact.which === 'distribution' ? 'distribution copy' : 'original file'}.`,
      { sha256: ev.submitted.sha256, matched: ev.exact.which })
    : check('exact_hash', 'Exact file match (SHA-256)', 'absent',
      'No registered file has exactly these bytes. This is expected for any re-saved, compressed, cropped or screenshotted copy, and does not by itself suggest manipulation.',
      { sha256: ev.submitted.sha256 }));

  // ---- 2. watermark ---------------------------------------------------------------
  const wm = ev.watermark ?? { status: 'unavailable' };
  if (wm.status === 'found' && wm.recordId) {
    if (visuallyCorroborates(wm.recordId)) {
      checks.push(check('watermark', 'Invisible watermark', 'passed',
        'A ProofLens watermark was detected. It points to a registry record, and the picture visually matches that record.',
        { payload: wm.shortId, recordId: wm.recordId }));
    } else if (!visuallyUnrelated(wm.recordId)) {
      const d = dist[wm.recordId];
      checks.push(check('watermark', 'Invisible watermark', 'warning',
        'A ProofLens watermark was detected, but the picture only loosely resembles the record it points to. This can happen after heavy edits; it could also be a copied watermark. Not enough to confirm or reject the link.',
        { payload: wm.shortId, recordId: wm.recordId, globalDistance: d?.global.distance, bestRegionDistance: d?.region?.distance }));
    } else {
      const d = dist[wm.recordId];
      contradictions.push(`The watermark points to record ${wm.recordId}, but the picture does not visually match that record (global distance ${d?.global.distance ?? '?'}/64). A watermark may have been copied onto a different image.`);
      checks.push(check('watermark', 'Invisible watermark', 'failed',
        'A watermark was detected, but the image does not look like the record it points to. Watermarks can be copied onto other images, so this is a warning sign.',
        { payload: wm.shortId, recordId: wm.recordId, globalDistance: d?.global.distance, bestRegionDistance: d?.region?.distance }));
    }
  } else if (wm.status === 'found') {
    checks.push(check('watermark', 'Invisible watermark', 'warning',
      'A watermark in ProofLens format was detected, but its ID is not in this registry. It may come from another registry or be random.',
      { payload: wm.shortId }));
  } else if (wm.status === 'foreign') {
    checks.push(check('watermark', 'Invisible watermark', 'info',
      'The watermark decoder reported a signal that is not in ProofLens format. It may be another tool’s watermark or a false detection (decoders occasionally report watermarks in unmarked images), so it is ignored.', { bits: wm.bits }));
  } else if (wm.status === 'not_found') {
    checks.push(check('watermark', 'Invisible watermark', 'absent',
      'No watermark was detected. It may never have had one, or it was lost through heavy editing or removed deliberately.', {}));
  } else {
    checks.push(check('watermark', 'Invisible watermark', 'not_checked',
      'Watermark detection is not available on this server.', { detail: wm.detail }));
  }

  // ---- 3. embedded C2PA content credentials ---------------------------------------
  const c = ev.c2pa ?? { status: 'unavailable' };
  if (c.status === 'valid') {
    checks.push(check('c2pa', 'Embedded Content Credentials (C2PA)', c.trusted ? 'passed' : 'warning',
      c.trusted
        ? 'A C2PA manifest is embedded, cryptographically valid, and signed by a trusted certificate.'
        : 'A C2PA manifest is embedded and cryptographically intact, but its signing certificate is not on a trust list (ProofLens uses a development certificate). It shows the file was not changed since signing, not who signed it.',
      { signer: c.signer, actions: c.actions, validationState: c.validationState, recordId: c.recordId }));
  } else if (c.status === 'invalid') {
    contradictions.push('The embedded C2PA manifest fails validation: the file was changed after the credential was attached, or the credential is corrupted.');
    checks.push(check('c2pa', 'Embedded Content Credentials (C2PA)', 'failed',
      'A C2PA manifest is embedded but does NOT validate. The image content no longer matches what was signed.',
      { failures: c.failures, signer: c.signer }));
  } else if (c.status === 'absent') {
    checks.push(check('c2pa', 'Embedded Content Credentials (C2PA)', 'absent',
      'No C2PA manifest is embedded. This is normal after screenshots, re-encoding or uploading to most platforms, and is not evidence of manipulation.', {}));
  } else {
    checks.push(check('c2pa', 'Embedded Content Credentials (C2PA)', 'not_checked', 'C2PA reading is not available.', { detail: c.detail }));
  }

  // ---- 4. perceptual similarity --------------------------------------------------
  const ranked = Object.entries(dist)
    .map(([recordId, d]) => ({ recordId, ...d }))
    .sort((a, b) => a.global.distance - b.global.distance);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const bestRegion = Object.entries(dist)
    .filter(([, d]) => d.region)
    .map(([recordId, d]) => ({ recordId, ...d.region }))
    .sort((a, b) => a.distance - b.distance)[0];

  // MODERATE (whole image): one record within `strict`, everyone else `margin` further away.
  let globalModerateId = null;
  if (best && best.global.distance <= t.strict) {
    const margin = runnerUp ? runnerUp.global.distance - best.global.distance : Infinity;
    if (margin >= t.margin) globalModerateId = best.recordId;
  }
  // MODERATE (part of the image, e.g. a centred crop): one record has a REGION within
  // the stricter `regionStrict`, and no other record comes within `margin` of it on
  // either fingerprint. Calibrated in docs/evaluation-results.md.
  let regionModerateId = null;
  if (bestRegion && bestRegion.distance <= t.regionStrict) {
    const others = Object.entries(dist).filter(([id]) => id !== bestRegion.recordId);
    const unique = others.every(([, d]) => (!d.region || d.region.distance >= bestRegion.distance + t.margin) && d.global.distance > t.strict);
    if (unique) regionModerateId = bestRegion.recordId;
  }
  let moderateId = globalModerateId ?? regionModerateId;
  if (globalModerateId && regionModerateId && globalModerateId !== regionModerateId) moderateId = null; // conflicting → ambiguous
  const moderateByRegion = Boolean(moderateId) && moderateId !== globalModerateId;

  const possibleMatches = ranked
    .filter((r) => r.global.distance <= t.corroborate || (r.region && r.region.distance <= t.region))
    .slice(0, 5)
    .map((r) => ({ recordId: r.recordId, globalDistance: r.global.distance, regionDistance: r.region?.distance ?? null, regionLabel: r.region?.label ?? null }));

  if (!best) {
    checks.push(check('perceptual', 'Visual similarity (perceptual hash)', 'absent', 'The registry is empty.', {}));
  } else if (best.global.distance <= t.strict) {
    const ambiguous = !moderateId;
    checks.push(check('perceptual', 'Visual similarity (perceptual hash)', ambiguous ? 'warning' : 'passed',
      ambiguous
        ? `The picture closely matches more than one registered image (distances ${best.global.distance} and ${runnerUp.global.distance} of 64). ProofLens will not pick one automatically.`
        : `The picture closely matches a registered image (${best.global.distance} of 64 fingerprint bits differ; ≤ ${t.strict} counts as a close match). Visual similarity is evidence, not cryptographic proof.`,
      { query: ev.perceptual.query, best: summarize(best), runnerUp: runnerUp ? summarize(runnerUp) : null, threshold: t.strict }));
  } else if (moderateByRegion) {
    checks.push(check('perceptual', 'Visual similarity (perceptual hash)', 'passed',
      `The picture closely matches PART of a registered image (region "${bestRegion.label}": ${bestRegion.distance} of 64 bits differ; ≤ ${t.regionStrict} required, and no other registered image comes close). This is typical of a cropped copy. Visual similarity is evidence, not cryptographic proof.`,
      { query: ev.perceptual.query, best: summarize(best), bestRegion, threshold: t.regionStrict }));
  } else if (possibleMatches.length) {
    checks.push(check('perceptual', 'Visual similarity (perceptual hash)', 'warning',
      `Only a partial or loose visual similarity was found (best whole-image distance ${best.global.distance}/64${bestRegion ? `, best region distance ${bestRegion.distance}/64` : ''}). Not enough on its own to establish a link.`,
      { query: ev.perceptual.query, best: summarize(best), bestRegion, thresholds: t }));
  } else {
    checks.push(check('perceptual', 'Visual similarity (perceptual hash)', 'absent',
      `No registered image looks similar (closest whole-image distance ${best.global.distance}/64; unrelated images typically differ by 20 or more bits).`,
      { query: ev.perceptual.query, best: summarize(best), thresholds: t }));
  }

  // ---- 5. proof receipt (optional) -----------------------------------------------
  const rc = ev.receipt;
  if (rc?.provided) {
    if (!rc.parsed) {
      contradictions.push('The supplied proof receipt is malformed.');
      checks.push(check('receipt', 'Proof receipt', 'failed', 'The supplied receipt could not be read as a ProofLens receipt.', { reason: rc.reason }));
    } else if (!rc.signatureValid) {
      contradictions.push(`The supplied proof receipt is not authentic: ${rc.reason}.`);
      checks.push(check('receipt', 'Proof receipt', 'failed',
        'The receipt\'s signature does not verify. Its contents were changed after signing, or it was not signed by ProofLens.', { reason: rc.reason, recordId: rc.recordId }));
    } else if (rc.storedMismatch) {
      contradictions.push('The supplied receipt is signed, but differs from the record stored in the registry under the same ID.');
      checks.push(check('receipt', 'Proof receipt', 'failed', 'The receipt does not match the registry\'s copy of the record.', { recordId: rc.recordId }));
    } else if (!records[rc.recordId]) {
      checks.push(check('receipt', 'Proof receipt', 'warning',
        'The receipt carries a valid ProofLens signature, but the record is not (or no longer) in this registry.', { recordId: rc.recordId }));
    } else if (ev.exact?.recordId !== rc.recordId && visuallyUnrelated(rc.recordId)) {
      contradictions.push('The supplied receipt is genuine, but it describes a different image.');
      checks.push(check('receipt', 'Proof receipt', 'failed', 'The receipt is authentic but does not describe this image.', { recordId: rc.recordId }));
    } else if (ev.exact?.recordId !== rc.recordId && !visuallyCorroborates(rc.recordId)) {
      checks.push(check('receipt', 'Proof receipt', 'warning',
        'The receipt is authentic, but this image only loosely resembles the image it describes, so the link cannot be confirmed.', { recordId: rc.recordId }));
    } else {
      checks.push(check('receipt', 'Proof receipt', 'passed', 'The receipt is authentic and describes this image.', { recordId: rc.recordId }));
    }
  }

  // ---- link strength for every relevant record ---------------------------------
  const relevant = new Set([...pointers.map((p) => p.recordId), ...possibleMatches.map((p) => p.recordId)]);
  const links = [];
  for (const recordId of relevant) {
    let link = 'NONE';
    if (ev.exact?.recordId === recordId) link = 'EXACT';
    else if (pointers.some((p) => p.recordId === recordId && p.source !== 'exact') && visuallyCorroborates(recordId)) link = 'STRONG';
    else if (moderateId === recordId) link = 'MODERATE';
    else if (possibleMatches.some((p) => p.recordId === recordId)) link = 'WEAK';
    links.push({ recordId, link, via: pointers.filter((p) => p.recordId === recordId).map((p) => p.source) });
  }
  links.sort((a, b) => rank(b.link) - rank(a.link));

  // Pointers from different sources naming different records conflict.
  const pointedIds = new Set(pointers.map((p) => p.recordId));
  if (pointedIds.size > 1) {
    contradictions.push(`Different pieces of evidence point to different records (${[...pointedIds].join(', ')}).`);
  }

  // ---- 6. signature / integrity of the records involved -------------------------
  const recordChecks = [];
  for (const { recordId, link } of links) {
    if (link === 'NONE') continue;
    const r = records[recordId];
    if (!r) continue;
    if (!r.signatureCheck.valid) {
      contradictions.push(`Registry record ${recordId} failed signature verification: ${r.signatureCheck.reason}. The record was altered after it was signed, or forged.`);
      recordChecks.push(check('signature', 'Digital signature (Ed25519)', 'failed',
        'The provenance record\'s signature does NOT verify. Its contents were changed after signing. Its claims cannot be trusted.',
        { recordId, ...r.signatureCheck }));
    } else if (r.signatureCheck.keyStatus === 'revoked') {
      recordChecks.push(check('signature', 'Digital signature (Ed25519)', 'failed',
        'The record was signed with a key that has since been revoked, so it can no longer be trusted.', { recordId, ...r.signatureCheck }));
    } else if (r.consistencyProblems.length) {
      contradictions.push(`The registry database disagrees with signed record ${recordId}: ${r.consistencyProblems.join('; ')}.`);
      recordChecks.push(check('signature', 'Digital signature (Ed25519)', 'failed',
        'The signature is valid, but the registry\'s database entries were changed and no longer match the signed record.', { recordId, problems: r.consistencyProblems }));
    } else {
      recordChecks.push(check('signature', 'Digital signature (Ed25519)', 'passed',
        'The provenance record is authentic: its Ed25519 signature verifies against the trusted ProofLens public key, and no field has changed since signing.',
        { recordId, keyId: r.signatureCheck.keyId, keyStatus: r.signatureCheck.keyStatus }));
    }
  }
  // Show one signature check, for the best-linked record.
  if (recordChecks.length) checks.push(recordChecks.find((c) => c.status === 'failed') ?? recordChecks[0]);
  else checks.push(check('signature', 'Digital signature (Ed25519)', 'not_checked', 'No candidate record was found, so there was no signature to check.', {}));

  // ---- 7. decide -------------------------------------------------------------------
  const top = links.find((l) => records[l.recordId]?.trusted) ?? null;
  const strongEnough = top && rank(top.link) >= rank('MODERATE');
  let verdict;
  if (contradictions.length) verdict = 'CONTRADICTED';
  else if (strongEnough) verdict = 'VERIFIED';
  else verdict = 'UNKNOWN';

  const linkStrength = top?.link ?? (links[0]?.link || 'NONE');
  const matchedRecordId = verdict === 'VERIFIED' ? top.recordId : (links[0]?.recordId ?? null);
  const matchedRecord = matchedRecordId ? records[matchedRecordId]?.record ?? null : null;

  checks.push(check('transformation', 'What happened to the file', 'info', describeTransformation(ev, linkStrength, matchedRecord), {
    metadata: ev.submitted.metadata,
    contentBox: ev.perceptual?.query?.contentBox ?? null,
    submittedSize: { width: ev.submitted.width, height: ev.submitted.height },
    originalSize: matchedRecord ? { width: matchedRecord.media.original.width, height: matchedRecord.media.original.height } : null,
  }));

  return {
    verdict,
    linkStrength,
    matchedRecordId,
    headline: headline(verdict, linkStrength, possibleMatches.length),
    explanation: explain(verdict, linkStrength, matchedRecord, contradictions),
    checks,
    contradictions,
    possibleMatches: verdict === 'VERIFIED' ? [] : possibleMatches,
    conclusions: conclusions(verdict, linkStrength, matchedRecord),
    thresholds: t,
  };
}

function check(id, label, status, summary, detail) {
  return { id, label, status, summary, detail };
}

function summarize(r) {
  return { recordId: r.recordId, globalDistance: r.global.distance, variant: r.global.variant, region: r.region ?? null };
}

const SOURCE_LABELS = { camera: 'a camera photograph', ai_generated: 'AI-generated', edited: 'an edited image', other: 'other media' };

function headline(verdict, link, nPossible) {
  if (verdict === 'CONTRADICTED') return 'Contradicted: the evidence conflicts with the claimed provenance';
  if (verdict === 'VERIFIED') {
    if (link === 'EXACT') return 'Verified provenance: this is the exact registered file';
    if (link === 'STRONG') return 'Verified provenance: a modified copy of a registered image';
    return 'Verified provenance: closely matches a registered image';
  }
  return nPossible ? 'Unknown provenance: possible match, but not enough evidence' : 'Unknown provenance: no origin could be established';
}

function describeCreator(record) {
  const c = record?.creator;
  if (!c || c.mode === 'anonymous') return 'an anonymous registrant';
  if (c.pseudonym) return `"${c.pseudonym}"`;
  return 'a registrant who chose to stay private (identity commitment)';
}

function explain(verdict, link, record, contradictions) {
  if (verdict === 'CONTRADICTED') {
    return `ProofLens found evidence that conflicts with the provenance this image appears to carry. ${contradictions[0]} This is a warning sign, but it does not by itself prove who manipulated what, or why.`;
  }
  if (verdict === 'UNKNOWN') {
    return 'ProofLens could not establish where this image came from. That does NOT mean it is fake: most genuine images have no registered provenance, and screenshots, crops and re-uploads remove embedded credentials.';
  }
  const when = record.registeredAt.slice(0, 10);
  const claim = `registered on ${when} by ${describeCreator(record)}, who stated it is ${SOURCE_LABELS[record.sourceType]}`;
  if (link === 'EXACT') return `This file is identical to an image ${claim}. The record is signed and unaltered.`;
  if (link === 'STRONG') return `This image carries a watermark (or credential) pointing to an image ${claim}, and it visually matches it. The file itself has been changed (for example re-compressed, resized, cropped or screenshotted), so it is a copy, not the original file.`;
  return `This image visually matches an image ${claim}. No watermark or credential confirmed the link, so this rests on visual similarity alone and is weaker evidence.`;
}

function conclusions(verdict, link, record) {
  const can = [];
  const cannot = [
    "Whether the registrant's claims (source type, description) are true. ProofLens records claims; it does not verify them.",
    'The real-world identity of the creator. Signatures prove which KEY signed, not which person.',
  ];
  if (verdict === 'VERIFIED') {
    can.push('A ProofLens record for this image exists and has not been altered since it was signed.');
    can.push(`When it was registered (${record.registeredAt}) and what was claimed at that time.`);
    if (link === 'EXACT') can.push('This exact file is the registered one, bit for bit.');
    else {
      can.push('This image is linked to the registered one by the evidence listed above.');
      cannot.push('That every pixel is unchanged: this file is NOT the original file, and small local edits may not be detected by visual fingerprints.');
    }
    if (link === 'MODERATE') cannot.push('Rule out a different but visually near-identical image (perceptual hashes can collide).');
  } else if (verdict === 'UNKNOWN') {
    can.push('No trustworthy registered origin was found with the available evidence.');
    cannot.push('Whether the image is authentic or fake. Absence of provenance is not evidence of manipulation.');
  } else {
    can.push('At least one piece of evidence conflicts with the provenance claimed for this image.');
    cannot.push('Who caused the conflict or whether it was intentional.');
  }
  return { can, cannot };
}

function describeTransformation(ev, link, record) {
  const parts = [];
  const m = ev.submitted.metadata ?? {};
  if (link === 'EXACT') return 'The file has not been changed at all since registration.';
  if (!record) {
    parts.push(m.hasExif ? 'The file still contains EXIF metadata.' : 'The file has no EXIF metadata (typical of screenshots and platform uploads).');
    return parts.join(' ');
  }
  const o = record.media.original;
  if (ev.submitted.width !== o.width || ev.submitted.height !== o.height) {
    parts.push(`Dimensions changed from ${o.width}×${o.height} to ${ev.submitted.width}×${ev.submitted.height}.`);
  }
  const ratioO = o.width / o.height;
  const ratioS = ev.submitted.width / ev.submitted.height;
  if (Math.abs(ratioO - ratioS) / ratioO > 0.03) parts.push('The aspect ratio changed, which suggests cropping or added borders.');
  if (ev.perceptual?.query?.contentBox) parts.push(`Uniform borders or UI strips were detected and removed for comparison (${Math.round(ev.perceptual.query.contentBox.removedFraction * 100)}% of the area), as in a screenshot.`);
  if (ev.submitted.mime !== 'image/jpeg') parts.push(`The file was re-saved as ${ev.submitted.mime}.`);
  parts.push('The file bytes differ from the registered file (re-encoded).');
  return parts.join(' ');
}
