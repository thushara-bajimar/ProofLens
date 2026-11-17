/**
 * Minimal structured logger. Deliberately logs NO image data, NO file names
 * supplied by users, NO IP addresses and NO keys: only events and short messages.
 */
import { config } from '../config/index.js';

function write(level, message, meta) {
  if (config.isTest && level !== 'error') return;
  const line = { t: new Date().toISOString(), level, message, ...(meta ?? {}) };
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

export const logger = {
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
};
