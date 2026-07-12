/**
 * Account purge job.
 *
 * Once a day we hard-delete accounts whose 30-day recovery grace period has
 * lapsed (see services/accountDeletion.service.js). Each purge removes the user
 * and ALL associated data in one transaction and is recorded to the admin audit
 * trail. A restore within the window keeps the account out of this scan.
 *
 * In-process via node-cron (the app runs as a single Railway web service, so no
 * separate cron dyno is needed). If we ever scale to multiple instances, guard
 * the run with a Postgres advisory lock so only one instance purges per tick.
 */
import cron from 'node-cron';
import { purgeExpiredAccounts, GRACE_DAYS } from '../services/accountDeletion.service.js';

let task = null;
let running = false;

/** Run one purge pass now (also used by the cron tick). Never throws. */
export async function runAccountPurgeOnce(trigger = 'cron') {
  if (running) {
    console.log('[purge-cron] previous run still in progress — skipping this tick');
    return null;
  }
  running = true;
  const startedAt = Date.now();
  try {
    const purged = await purgeExpiredAccounts();
    if (purged.length) {
      console.log(
        `[purge-cron] purged ${purged.length} account(s) past the ${GRACE_DAYS}-day grace ` +
          `in ${Math.round((Date.now() - startedAt) / 1000)}s (trigger=${trigger})`,
      );
    }
    return purged;
  } catch (err) {
    console.error('[purge-cron] run failed:', err.message);
    return null;
  } finally {
    running = false;
  }
}

/**
 * Start the recurring job. Returns the scheduled task (or null if disabled).
 * Set ACCOUNT_PURGE_CRON_DISABLED=true to turn it off (e.g. in tests / local dev).
 */
export function startAccountPurgeJob() {
  if (process.env.ACCOUNT_PURGE_CRON_DISABLED === 'true') {
    console.log('[purge-cron] disabled via ACCOUNT_PURGE_CRON_DISABLED');
    return null;
  }
  if (task) return task;
  // Daily at 03:15 — off the top of the hour so it doesn't pile onto other jobs.
  const expr = '15 3 * * *';
  task = cron.schedule(expr, () => {
    runAccountPurgeOnce('cron');
  });
  console.log(`[purge-cron] scheduled daily account purge (${expr})`);
  return task;
}

/** Stop the recurring job (clean shutdown). */
export function stopAccountPurgeJob() {
  if (task) {
    task.stop();
    task = null;
  }
}
