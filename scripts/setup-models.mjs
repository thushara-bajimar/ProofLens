/**
 * Downloads the TrustMark watermark models (encoder ~17 MB, decoder ~47 MB) into
 * MODEL_PATH. With --with-remover it also downloads the watermark REMOVER
 * (~155 MB), used only by the removal-attack demo scenario.
 * The c2pa-node SDK downloads them on first use and caches them; this script
 * just triggers that ahead of time so the server starts quickly.
 */
import fs from 'node:fs';
import { config } from '../backend/src/config/index.js';

const { Trustmark } = await import('@contentauth/c2pa-node');
fs.mkdirSync(config.watermark.modelPath, { recursive: true });
const t0 = Date.now();
const withRemover = process.argv.includes('--with-remover');
console.log(`Preparing TrustMark ${config.watermark.variant}/${config.watermark.version} models in ${config.watermark.modelPath} (first run downloads ~65 MB${withRemover ? ' + 155 MB remover' : ''})...`);
await Trustmark.newTrustmark({
  variant: config.watermark.variant,
  version: config.watermark.version,
  modelPath: config.watermark.modelPath,
  loadRemover: withRemover,
});
console.log(`Models ready in ${((Date.now() - t0) / 1000).toFixed(1)} s:`);
for (const f of fs.readdirSync(config.watermark.modelPath)) {
  console.log(`  ${f}  ${(fs.statSync(`${config.watermark.modelPath}/${f}`).size / 1e6).toFixed(1)} MB`);
}
