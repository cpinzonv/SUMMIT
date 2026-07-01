/**
 * Background Canvas sync — runs every 6 hours. For each class linked to Canvas
 * it syncs assignments, then that class owner's grades. One class failing never
 * stops the rest; failures are logged, and a class that fails 3 runs in a row
 * raises a louder alert log.
 *
 * Guarded so it only starts when enabled and Canvas is actually configured, so
 * dev/test/CI don't hammer Canvas. Enable with CANVAS_SYNC_ENABLED=true.
 */
import cron from 'node-cron';
import { query } from '../config/db.js';
import { canvasSync } from '../services/canvas-sync.js';
import { isLmsConfigured } from '../services/lmsCredentials.service.js';

const SCHEDULE = '0 */6 * * *'; // top of the hour, every 6 hours
const ALERT_THRESHOLD = 3;

// Per-class consecutive-failure counters (in-memory; resets on restart).
const consecutiveFailures = new Map();

/** Run one full sweep over all Canvas-linked classes. Exposed for manual runs/tests. */
export async function runCanvasSyncSweep() {
  if (!(await isLmsConfigured('canvas'))) {
    console.info('[canvas-sync-job] Canvas not configured — skipping sweep.');
    return { classes: 0, ok: 0, failed: 0 };
  }

  const { rows: classes } = await query(
    `SELECT id, user_id FROM classes
      WHERE linked_lms = 'canvas' AND linked_lms_course_id IS NOT NULL
        AND archived_at IS NULL`,
  );

  const started = Date.now();
  let ok = 0;
  let failed = 0;

  for (const cls of classes) {
    try {
      await canvasSync.syncAssignmentsForClass(cls.id, { triggeredBy: 'cron' });
      // Grades are best-effort (often need teacher scope) — don't fail the class on them.
      try {
        await canvasSync.syncGradesForUser(cls.user_id, cls.id, { triggeredBy: 'cron' });
      } catch (gradeErr) {
        console.warn(`[canvas-sync-job] grade sync skipped for class ${cls.id}: ${gradeErr.message}`);
      }
      consecutiveFailures.delete(cls.id);
      ok += 1;
    } catch (err) {
      failed += 1;
      const n = (consecutiveFailures.get(cls.id) || 0) + 1;
      consecutiveFailures.set(cls.id, n);
      console.error(`[canvas-sync-job] class ${cls.id} sync failed (${n} in a row): ${err.message}`);
      if (n >= ALERT_THRESHOLD) {
        console.error(`[canvas-sync-job] ALERT: class ${cls.id} has failed ${n} consecutive syncs.`);
      }
    }
  }

  console.info(
    `[canvas-sync-job] sweep done: ${classes.length} classes, ${ok} ok, ${failed} failed in ${Date.now() - started}ms`,
  );
  return { classes: classes.length, ok, failed };
}

let task = null;

/** Schedule the recurring sweep. No-op unless CANVAS_SYNC_ENABLED=true. */
export function startCanvasSyncJob() {
  if (process.env.CANVAS_SYNC_ENABLED !== 'true') {
    console.info('[canvas-sync-job] disabled (set CANVAS_SYNC_ENABLED=true to enable).');
    return null;
  }
  if (task) return task;
  task = cron.schedule(SCHEDULE, () => {
    runCanvasSyncSweep().catch((err) => console.error('[canvas-sync-job] sweep crashed:', err.message));
  });
  console.info(`[canvas-sync-job] scheduled "${SCHEDULE}" (every 6 hours).`);
  return task;
}
