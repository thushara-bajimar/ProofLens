/**
 * C2PA / Content Credentials integration (official SDK: @contentauth/c2pa-node).
 *
 * C2PA in one paragraph: a "manifest" is embedded in the file (for JPEG, in
 * APP11 segments). It contains ASSERTIONS (statements such as "these actions
 * were performed", "this was the parent image"), a CLAIM that lists hashes of
 * those assertions and a "hard binding" hash of the image bytes, and a COSE
 * SIGNATURE over the claim made with an X.509 certificate. Validators check
 * the signature, the hashes, and whether the certificate chains to a trusted
 * root on a trust list.
 *
 * What ProofLens does with it:
 *  - READ: every submitted image is checked for an embedded manifest, which is
 *    validated by the SDK (signature + hashes + trust).
 *  - SIGN (registration): the distribution copy receives a manifest signed with a
 *    DEVELOPMENT certificate generated locally. No trust list contains it, so
 *    validators correctly report the signer as untrusted. This shows the format
 *    and its fragility honestly; it is not a claim of trusted C2PA issuance.
 *
 * The ProofLens registry record is a SEPARATE system (Ed25519-signed JSON) and is
 * never labelled as C2PA.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import 'reflect-metadata'; // required by @peculiar/x509 (dependency-injection metadata)
import * as x509 from '@peculiar/x509';
import { config } from '../config/index.js';

x509.cryptoProvider.set(crypto.webcrypto);

const CA_CERT = 'dev-ca.cert.pem';
const SIGNER_CERT = 'dev-signer.cert.pem';
const SIGNER_KEY = 'dev-signer.key.pem';
const SDK_VERSION = '0.12.1';

let sdkPromise;
const sdk = () => (sdkPromise ??= import('@contentauth/c2pa-node'));

/**
 * Generates a 2-level development chain: a self-signed CA, and an end-entity
 * signing certificate issued by it (C2PA rejects self-signed signing certs).
 * Extensions follow the C2PA certificate profile: digitalSignature key usage
 * and an allowed extended key usage (emailProtection).
 */
export async function ensureDevCertificates(certDir = config.c2pa.certDir) {
  const files = [CA_CERT, SIGNER_CERT, SIGNER_KEY].map((f) => path.join(certDir, f));
  if (files.every((f) => fs.existsSync(f))) return readChain(certDir);

  const alg = { name: 'Ed25519' };
  const caKeys = await crypto.webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const signerKeys = await crypto.webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const now = new Date();
  const years = (n) => new Date(now.getTime() + n * 365 * 24 * 3600 * 1000);

  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: crypto.randomBytes(8).toString('hex'),
    name: 'CN=ProofLens Development Root CA (UNTRUSTED),O=ProofLens Dev',
    notBefore: now,
    notAfter: years(5),
    keys: caKeys,
    signingAlgorithm: alg,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(caKeys.publicKey),
    ],
  });
  const signer = await x509.X509CertificateGenerator.create({
    serialNumber: crypto.randomBytes(8).toString('hex'),
    subject: 'CN=ProofLens Development Signer (UNTRUSTED),O=ProofLens Dev',
    issuer: ca.subject,
    notBefore: now,
    notAfter: years(2),
    publicKey: signerKeys.publicKey,
    signingKey: caKeys.privateKey,
    signingAlgorithm: alg,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.emailProtection], false),
      await x509.SubjectKeyIdentifierExtension.create(signerKeys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(ca),
    ],
  });
  const pkcs8 = Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', signerKeys.privateKey));
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(files[0], ca.toString('pem'));
  fs.writeFileSync(files[1], signer.toString('pem'));
  fs.writeFileSync(files[2], `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`, { mode: 0o600 });
  return readChain(certDir);
}

function readChain(certDir) {
  const ca = fs.readFileSync(path.join(certDir, CA_CERT), 'utf8');
  const signer = fs.readFileSync(path.join(certDir, SIGNER_CERT), 'utf8');
  return {
    chainPem: Buffer.from(`${signer.trim()}\n${ca.trim()}\n`),
    keyPem: fs.readFileSync(path.join(certDir, SIGNER_KEY)),
    caPem: ca,
  };
}

/**
 * Embeds a signed C2PA manifest into a JPEG.
 * `claimedSourceType` is the REGISTRANT'S claim and is labelled as such.
 */
export async function signJpeg(jpegBuffer, { recordId, shortId, claimedSourceType, title }) {
  const { Builder, LocalSigner } = await sdk();
  const chain = await ensureDevCertificates();
  const manifest = {
    claim_generator_info: [{ name: 'ProofLens', version: '0.1.0' }],
    title: title || `prooflens-${recordId}.jpg`,
    format: 'image/jpeg',
    assertions: [
      {
        label: 'c2pa.actions',
        data: {
          actions: [
            {
              action: 'c2pa.created',
              digitalSourceType: DIGITAL_SOURCE_TYPES[claimedSourceType] ?? DIGITAL_SOURCE_TYPES.other,
              description: 'Source type as claimed by the registrant (not independently verified).',
            },
            { action: 'c2pa.watermarked', description: 'Invisible TrustMark watermark carrying the ProofLens record pointer.' },
          ],
        },
      },
      {
        // Soft binding = a link between the manifest and the PIXELS (here: the
        // TrustMark watermark), which can survive when the manifest itself is stripped.
        label: 'c2pa.soft-binding',
        data: {
          alg: 'com.adobe.trustmark.Q',
          blocks: [{ scope: {}, value: Buffer.from(shortId, 'hex').toString('base64') }],
        },
      },
      {
        label: 'org.prooflens.registration',
        data: { recordId, shortId, registry: 'ProofLens development registry', claimedSourceType },
      },
    ],
  };
  const builder = await Builder.withJsonAsync(manifest);
  const signer = LocalSigner.newSigner(chain.chainPem, chain.keyPem, 'ed25519');
  const output = { buffer: null };
  builder.sign(signer, { buffer: jpegBuffer, mimeType: 'image/jpeg' }, output);
  if (!output.buffer) throw new Error('C2PA signing produced no output');
  return output.buffer;
}

const DIGITAL_SOURCE_TYPES = {
  camera: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
  ai_generated: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  edited: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeCapture',
  other: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation',
};

/**
 * Reads and validates an embedded C2PA manifest.
 * Returns:
 *  { status: 'absent' }                        no manifest (very common: stripped by platforms/screenshots)
 *  { status: 'valid',  trusted, ... }          cryptographically valid; trusted=false if signer not on a trust list
 *  { status: 'invalid', failures: [...] }      manifest present but fails validation (tampering or corruption)
 *  { status: 'unavailable', detail }           SDK could not run
 */
export async function readManifest(buffer, mimeType) {
  if (!config.c2pa.enabled) return { status: 'unavailable', detail: 'C2PA disabled by configuration' };
  let reader;
  try {
    const { Reader } = await sdk();
    reader = await Reader.fromAsset({ buffer, mimeType });
  } catch (err) {
    // The SDK throws for manifests it cannot parse; that is a validation failure, not absence.
    return { status: 'invalid', failures: [{ code: 'manifest.unreadable', explanation: err.message.slice(0, 200) }] };
  }
  if (!reader) return { status: 'absent' };

  const store = reader.json();
  const active = reader.getActive();
  const statuses = store.validation_status ?? [];
  const results = store.validation_results?.activeManifest;
  const failures = [...(results?.failure ?? []), ...statuses.filter((s) => !isUntrustedOnly(s.code))]
    .map((s) => ({ code: s.code, explanation: s.explanation }));
  const untrusted = statuses.some((s) => isUntrustedOnly(s.code)) ||
    (results?.failure ?? []).some((s) => isUntrustedOnly(s.code));
  const realFailures = failures.filter((f) => !isUntrustedOnly(f.code));
  const registration = active?.assertions?.find((a) => a.label === 'org.prooflens.registration')?.data ?? null;

  return {
    status: realFailures.length ? 'invalid' : 'valid',
    validationState: store.validation_state ?? null,
    trusted: store.validation_state === 'Trusted' && !untrusted,
    failures: dedupe(realFailures),
    signer: {
      issuer: active?.signature_info?.issuer ?? null,
      commonName: active?.signature_info?.common_name ?? null,
      algorithm: active?.signature_info?.alg ?? null,
      time: active?.signature_info?.time ?? null,
    },
    claimGenerator: active?.claim_generator_info?.[0]?.name ?? active?.claim_generator ?? null,
    actions: (active?.assertions?.find((a) => a.label.startsWith('c2pa.actions'))?.data?.actions ?? [])
      .map((a) => ({ action: a.action, digitalSourceType: a.digitalSourceType ?? null })),
    proofLensRecordId: registration?.recordId ?? null,
    sdk: `@contentauth/c2pa-node ${SDK_VERSION}`,
  };
}

// "signingCredential.untrusted" means the signature is fine but the certificate
// does not chain to a trusted root. That is a trust problem, not tampering.
function isUntrustedOnly(code) {
  return code === 'signingCredential.untrusted';
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => (seen.has(f.code) ? false : seen.add(f.code)));
}
