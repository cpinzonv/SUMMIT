import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { startCanvasSyncJob } from './jobs/canvas-sync-job.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  // Recurring Canvas → Summit sync (no-op unless CANVAS_SYNC_ENABLED=true).
  startCanvasSyncJob();
});

/** Drain connections and close the pool so restarts/deploys are clean. */
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
