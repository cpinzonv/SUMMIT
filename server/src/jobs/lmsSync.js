/**
 * Background LMS sync job.
 *
 * Every SYNC_INTERVAL_HOURS (default 4h) we re-sync every connected (user,
 * provider) account so assignments + grades stay fresh without the student
 * clicking "Sync now". Each account syncs independently — one failure is logged
 * to lms_sync_log and never blocks the others (see syncAllConnectedUsers).
 *
 * In-process via node-cron (the app runs as a single Railway web service, so no
 * separate cron dyno is needed). If we ever scale to multiple instances, guard
 * the run with a Postgres advisory lock so only one instance syncs per tick.
 */
import cron from 'node-cron';
import { syncAllConnectedUsers, SYNC_INTERVAL_HOURS } from '../services/lms.service.js';

let task = null;
let running = false;

/** Run one full pass now (also used by the cron tick). Never throws. */
export async function runLmsSyncOnce(trigger = 'cron') {
  if (running) {
    console.log('[lms-cron] previous run still in progress — skipping this tick');
    return null;
  }
  running = true;
  const startedAt = Date.now();
  try {
    const summary = await syncAllConnectedUsers({ trigger });
    console.log(
      `[lms-cron] synced ${summary.ok}/${summary.attempted} accounts ` +
        `(${summary.failed} failed) in ${Math.round((Date.now() - startedAt) / 1000)}s`,
    );
    return summary;
  } catch (err) {
    console.error('[lms-cron] run failed:', err.message);
    return null;
  } finally {
    running = false;
  }
}

/**
 * Start the recurring job. Returns the scheduled task (or null if disabled).
 * Set LMS_SYNC_CRON_DISABLED=true to turn it off (e.g. in tests / local dev).
 */
export function startLmsSyncJob() {
  if (process.env.LMS_SYNC_CRON_DISABLED === 'true') {
    console.log('[lms-cron] disabled via LMS_SYNC_CRON_DISABLED');
    return null;
  }
  if (task) return task;
  // "at minute 0, every Nth hour" — e.g. 0 */4 * * *  → 00:00, 04:00, 08:00…
  const expr = `0 */${SYNC_INTERVAL_HOURS} * * *`;
  task = cron.schedule(expr, () => {
    runLmsSyncOnce('cron');
  });
  console.log(`[lms-cron] scheduled LMS sync every ${SYNC_INTERVAL_HOURS}h (${expr})`);
  return task;
}

/** Stop the recurring job (clean shutdown). */
export function stopLmsSyncJob() {
  if (task) {
    task.stop();
    task = null;
  }
}
