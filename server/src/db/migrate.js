/**
 * Minimal migration runner: applies schema.sql to the configured database.
 * The schema is written to be idempotent (IF NOT EXISTS / guarded triggers),
 * so re-running is safe. As the app grows, swap this for a versioned migration
 * tool (e.g. node-pg-migrate) — see README.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../config/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema.sql...');
  await pool.query(sql);
  console.log('Schema applied successfully.');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
