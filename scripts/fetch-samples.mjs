/**
 * Downloads the demo / evaluation photo set from picsum.photos into samples/.
 * Picsum serves photos from Unsplash under the Unsplash License
 * (https://unsplash.com/license): free to use, no attribution required.
 * Each file is saved as picsum-<id>.jpg so its source can be traced.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../backend/src/config/index.js';

// Chosen for variety (landscapes, people, objects, textures, low-detail scenes)
// and including several visually similar landscape/sea shots so that the
// "similar but unrelated" false-positive case can be measured.
export const SAMPLE_IDS = [
  10, 11, 15, 16, 17, 20, 24, 27, 28, 29, 37, 42, 48, 54, 64, 65, 76, 82,
  96, 1001, 1011, 1015, 1016, 1018, 1036, 1039, 1043, 1044, 1050, 1062,
];

const dir = path.join(ROOT_DIR, 'samples');
fs.mkdirSync(dir, { recursive: true });
let fetched = 0;
for (const id of SAMPLE_IDS) {
  const file = path.join(dir, `picsum-${id}.jpg`);
  if (fs.existsSync(file)) continue;
  const res = await fetch(`https://picsum.photos/id/${id}/1200/800.jpg`);
  if (!res.ok) { console.warn(`  skip ${id}: HTTP ${res.status}`); continue; }
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  fetched++;
}
console.log(`Samples: ${fetched} downloaded, ${fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length} total in samples/`);
