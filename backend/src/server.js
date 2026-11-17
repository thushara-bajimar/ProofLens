import fs from 'node:fs';
import { config } from './config/index.js';
import { createApp } from './app.js';
import { getDb } from './db/index.js';
import { getActiveSigningKey } from './services/keyService.js';
import { ensureDevCertificates } from './services/c2paService.js';
import * as watermark from './services/watermarkService.js';
import { logger } from './utils/logger.js';

for (const dir of [config.storageDir, config.originalsDir, config.publicDir, config.tmpDir]) fs.mkdirSync(dir, { recursive: true });
getDb();
const key = getActiveSigningKey(); // fails fast with a clear message if the key is missing
if (config.c2pa.enabled) await ensureDevCertificates();
if (config.watermark.enabled) watermark.warmUp();

createApp().listen(config.port, () => {
  logger.info('ProofLens API listening', { port: config.port, keyId: key.keyId, watermark: config.watermark.enabled, c2pa: config.c2pa.enabled });
});
