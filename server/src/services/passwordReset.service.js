/**
 * "Forgot password" flow.
 *
 * Security model:
 *  - The reset token is 32 cryptographically-random bytes (crypto.randomBytes).
 *  - We store only its SHA-256 hash (reuse hashToken, same as refresh tokens),
 *    so a database leak can't be turned into account takeovers. The raw token
 *    lives only in the emailed link.
 *  - Tokens expire after 24h and are single-use: the row is deleted on a
 *    successful reset, and any other outstanding tokens for that user are
 *    invalidated at the same time.
 *  - forgot-password never reveals whether an email exists (enumeration guard):
 *    it always resolves the same way.
 *  - Per-email rate limit (max 5 requests / hour) throttles abuse and mail spam.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { hashToken } from '../utils/jwt.js';
import { env } from '../config/env.js';
import { sendEmail, passwordResetEmail } from './email.service.js';

const SALT_ROUNDS = 12;
const TOKEN_TTL_HOURS = 24;
const RATE_LIMIT_MAX = 5; // requests …
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // … per hour, per email

// In-memory sliding-window rate limiter keyed by email. Fine for a single
// instance; swap for a shared store (Redis) if the API is horizontally scaled.
const attemptsByEmail = new Map();

function checkRateLimit(email) {
  const now = Date.now();
  const recent = (attemptsByEmail.get(email) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX) {
    throw new AppError(
      429,
      'Too many reset requests. Please wait a while before trying again.',
    );
  }
  recent.push(now);
  attemptsByEmail.set(email, recent);
}

/** Best-effort prune of expired tokens; keeps the table from growing forever. */
async function pruneExpired() {
  await query('DELETE FROM password_resets WHERE expires_at < now()');
}

/**
 * Start a reset: create a token for the account (if one exists) and email the
 * link. Always resolves to the same shape regardless of whether the email is
 * registered, so callers can return a generic response.
 */
export async function requestPasswordReset(email) {
  checkRateLimit(email);
  await pruneExpired();

  const { rows } = await query(
    'SELECT id, email, full_name FROM users WHERE email = $1',
    [email],
  );
  const user = rows[0];

  // Unknown email: silently succeed (no token, no mail) to avoid enumeration.
  if (!user) return { sent: false };

  // One live token per user: drop any earlier outstanding requests.
  await query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await query(
    `INSERT INTO password_resets (user_id, email, reset_token, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [user.id, user.email, tokenHash, expiresAt],
  );

  const resetUrl = `${env.clientUrl.replace(/\/$/, '')}/reset-password/${rawToken}`;
  const { subject, html, text } = passwordResetEmail({
    name: user.full_name,
    resetUrl,
    expiresHours: TOKEN_TTL_HOURS,
  });
  const result = await sendEmail({ to: user.email, subject, html, text });
  return { sent: result.sent };
}

/**
 * Complete a reset: validate the raw token, set the new password (bcrypt), and
 * consume the token. Runs in a transaction so token-consumption and the
 * password write commit together.
 */
export async function resetPassword(rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM password_resets WHERE reset_token = $1 FOR UPDATE',
      [tokenHash],
    );
    const record = rows[0];

    if (!record || new Date(record.expires_at) <= new Date()) {
      throw new AppError(400, 'This reset link is invalid or has expired.');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      passwordHash,
      record.user_id,
    ]);

    // Consume the token (single-use) and invalidate any siblings for the user.
    await client.query('DELETE FROM password_resets WHERE user_id = $1', [
      record.user_id,
    ]);

    // Reset a compromised password → revoke every active session so a stolen
    // refresh token can't outlive the reset.
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [record.user_id],
    );
  });
}
