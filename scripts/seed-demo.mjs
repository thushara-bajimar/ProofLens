/**
 * Registers a few sample photos in the DEVELOPMENT registry so the demo page has
 * something to work with. Safe to re-run: already-registered files are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../backend/src/config/index.js';
import { registerImage } from '../backend/src/services/registrationService.js';

const SEEDS = [
  { id: 1015, sourceType: 'camera', creatorMode: 'pseudonym', pseudonym: 'river_lens', description: 'River valley, demo sample' },
  { id: 1043, sourceType: 'camera', creatorMode: 'anonymous', description: 'Mountain lake, demo sample' },
  { id: 64, sourceType: 'edited', creatorMode: 'pseudonym', pseudonym: 'studio_demo', description: 'Portrait, demo sample (claimed edited)' },
  { id: 1062, sourceType: 'ai_generated', creatorMode: 'anonymous', description: 'Demo sample labelled as AI-generated (label is a claim)' },
];

for (const s of SEEDS) {
  const file = path.join(ROOT_DIR, 'samples', `picsum-${s.id}.jpg`);
  if (!fs.existsSync(file)) { console.warn(`missing ${file}, run "npm run samples"`); continue; }
  try {
    const { id, ...fields } = s;
    const r = await registerImage(fs.readFileSync(file), fields);
    console.log(`registered picsum-${id} -> ${r.recordId} (watermark: ${r.distribution.watermarked}, c2pa: ${r.distribution.c2paManifest})`);
  } catch (err) {
    if (err.code === 'ALREADY_REGISTERED') console.log(`picsum-${s.id} already registered (${err.details?.recordId})`);
    else throw err;
  }
}
process.exit(0);
