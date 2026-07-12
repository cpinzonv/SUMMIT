import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { startLmsSyncJob, stopLmsSyncJob } from './jobs/lmsSync.js';
import { startAccountPurgeJob, stopAccountPurgeJob } from './jobs/accountPurge.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);

  // Messaging config sanity — presence only, never the secret values. Makes a
  // misconfigured email setup obvious in the deploy logs instead of surfacing as
  // "signups get no verification email".
  console.log(
    `[boot] email: RESEND_API_KEY=${env.resendApiKey ? 'set' : 'MISSING'} · ` +
      `EMAIL_FROM=${env.emailFromFromEnv ? `set (${env.emailFrom})` : `DEFAULT (${env.emailFrom})`}`,
  );
  if (!env.emailFromFromEnv) {
    console.warn(
      `[boot] WARNING: EMAIL_FROM is not set — falling back to "${env.emailFrom}". ` +
        'Set EMAIL_FROM to a verified learnsummit.app address.',
    );
  }
  if (env.nodeEnv === 'production' && !env.resendApiKey) {
    console.warn(
      '[boot] WARNING: RESEND_API_KEY is not set in production — verification emails cannot be delivered.',
    );
  }
});

// Background LMS sync (assignments + grades) every few hours.
startLmsSyncJob();

// Daily purge of accounts past their 30-day deletion grace period.
startAccountPurgeJob();

/** Drain connections and close the pool so restarts/deploys are clean. */
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  stopLmsSyncJob();
  stopAccountPurgeJob();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
