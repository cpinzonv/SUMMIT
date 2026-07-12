/**
 * Minimal migration runner: applies schema.sql to the configured database.
 * The schema is written to be idempotent (IF NOT EXISTS / guarded triggers),
 * so re-running is safe. As the app grows, swap this for a versioned migration
 * tool (e.g. node-pg-migrate) — see README.
 *
 * Runs on every boot via the `start` script (`migrate && index`). Because a
 * failure here short-circuits `&&` and the web process never starts (Railway
 * then serves a 502), we first wait for the database to become *reachable*,
 * retrying transient connection errors — the common deploy race where the app
 * container boots before Postgres is accepting connections. A genuine SQL or
 * auth error still fails fast, so real problems surface instead of looping.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../config/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_ATTEMPTS = Number(process.env.DB_MIGRATE_RETRIES || 15);
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry only when the DB is unreachable / still starting — NOT on auth or SQL
// errors, which are real misconfigurations that should fail the boot loudly.
function isTransientConnError(err) {
  const code = err?.code;
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET'].includes(code)) return true;
  // Postgres 57P03 cannot_connect_now ("the database system is starting up").
  if (code === '57P03') return true;
  return /starting up|Connection terminated|timeout expired/i.test(err?.message || '');
}

async function waitForDb() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      if (attempt > 1) console.log(`Database reachable after ${attempt} attempts.`);
      return;
    } catch (err) {
      if (!isTransientConnError(err) || attempt >= MAX_ATTEMPTS) throw err;
      const delay = Math.min(BASE_DELAY_MS * attempt, MAX_DELAY_MS);
      console.warn(
        `Database not ready (attempt ${attempt}/${MAX_ATTEMPTS}: ${err.code || err.message}); ` +
          `retrying in ${delay}ms...`,
      );
      await sleep(delay);
    }
  }
}

// Seed registration_mode ONCE from the REGISTRATION_MODE env var (first boot
// only). After this, the setting is admin-controlled via app_settings, so the
// env var is just the initial value. ON CONFLICT DO NOTHING means a later admin
// change is never overwritten by a redeploy. Fail closed: anything other than
// the literal 'open' seeds 'invite_only'.
async function seedRegistrationMode() {
  const seed = process.env.REGISTRATION_MODE === 'open' ? 'open' : 'invite_only';
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('registration_mode', $1)
     ON CONFLICT (key) DO NOTHING`,
    [seed],
  );
  console.log(`registration_mode seeded (first boot only) → default '${seed}'.`);
}

async function main() {
  await waitForDb();
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  console.log('Applying schema.sql...');
  await pool.query(sql);
  await seedRegistrationMode();
  console.log('Schema applied successfully.');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
