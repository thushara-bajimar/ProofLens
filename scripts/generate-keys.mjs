/**
 * Generates the server's Ed25519 signing key pair (development only).
 *
 * - The PRIVATE key is written as PKCS#8 PEM to SIGNING_KEY_PATH, outside the
 *   database and outside any web-served folder. It is gitignored.
 * - The PUBLIC key is derived from it at server start and stored in the
 *   signing_keys table, so it can be published for verification.
 *
 * Refuses to overwrite an existing key: replacing the key would make every
 * previously signed record unverifiable. Use --force only if you understand that.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../backend/src/config/index.js';

const target = config.signingKeyPath;
const force = process.argv.includes('--force');

if (fs.existsSync(target) && !force) {
  console.log(`Signing key already exists at ${path.relative(process.cwd(), target)} — leaving it unchanged.`);
  process.exit(0);
}

const { privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(`Generated Ed25519 signing key at ${path.relative(process.cwd(), target)} (development key — see docs/security-analysis.md).`);
