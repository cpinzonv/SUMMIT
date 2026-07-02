import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { startLmsSyncJob, stopLmsSyncJob } from './jobs/lmsSync.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

// Background LMS sync (assignments + grades) every few hours.
startLmsSyncJob();

/** Drain connections and close the pool so restarts/deploys are clean. */
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  stopLmsSyncJob();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
