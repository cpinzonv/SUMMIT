import pg from 'pg';
import { env } from './env.js';

const { Pool, types } = pg;

// DATE (OID 1082) columns are calendar dates with no time/zone. node-pg's default
// parser turns them into JS Date objects at local midnight, which then serialize
// to a shifted UTC timestamp. Keep them as plain 'YYYY-MM-DD' strings instead.
types.setTypeParser(1082, (value) => value);

/**
 * A single shared connection pool for the process. Import { query, pool, withTransaction }
 * anywhere that needs the database.
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // An idle client errored (e.g. the DB dropped the connection). Log it; the
  // pool will replace the client on the next checkout.
  console.error('Unexpected PG pool error:', err);
});

/** Run a parameterized query against the pool. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `fn` inside a transaction, committing on success and rolling back on any
 * thrown error. `fn` receives a dedicated client — use client.query(...).
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
