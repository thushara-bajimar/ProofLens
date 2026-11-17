/**
 * SQLite connection (better-sqlite3).
 *
 * better-sqlite3 is synchronous, which is fine here: queries take microseconds
 * and it makes transactions simple. Every query uses prepared statements with
 * bound parameters (`?` / `@name`), so user input is never concatenated into SQL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db;

export function getDb() {
  if (db) return db;
  if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = undefined;
}

/** Simple connectivity check used by /api/health. */
export function pingDb() {
  return getDb().prepare('SELECT 1 AS ok').get().ok === 1;
}

export const nowIso = () => new Date().toISOString();
