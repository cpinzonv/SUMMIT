/**
 * One-time 6-digit codes for email/phone verification + password reset. Codes are
 * stored hashed, expire in 10 minutes, allow a few attempts, and only the newest
 * per (user, purpose) is valid. Delivery goes through the messaging service; when
 * a provider is unconfigured (dev), the code is returned so the flow is testable.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { sendEmail, sendSms, emailConfigured, smsConfigured } from './messaging.service.js';

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

const genCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Issue + deliver a fresh code for (userId, purpose), invalidating prior ones.
 * Returns { devCode } only when the channel's provider is unconfigured AND not in
 * production, so the verification flow can be exercised without real delivery.
 */
export async function issueCode({ userId, purpose, channel = 'email', destination, subject, intro }) {
  const code = genCode();
  const codeHash = await bcrypt.hash(code, 8);

  await query(
    'UPDATE verification_codes SET consumed_at = now() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL',
    [userId, purpose],
  );
  await query(
    `INSERT INTO verification_codes (user_id, purpose, code_hash, destination, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '${CODE_TTL_MIN} minutes')`,
    [userId, purpose, codeHash, destination ?? null],
  );

  const line = `${intro || 'Your Summit verification code is'} ${code}. It expires in ${CODE_TTL_MIN} minutes. If you didn't request this, you can ignore it.`;
  if (channel === 'sms') await sendSms({ to: destination, body: line });
  else await sendEmail({ to: destination, subject: subject || 'Your Summit verification code', text: line });

  const unconfigured = channel === 'sms' ? !smsConfigured() : !emailConfigured();
  const dev = env.nodeEnv !== 'production' && unconfigured;
  return { sent: true, delivered: !unconfigured, ...(dev ? { devCode: code } : {}) };
}

/** Verify + consume a code for (userId, purpose). Throws AppError on failure. */
export async function verifyCode({ userId, purpose, code }) {
  const { rows } = await query(
    `SELECT * FROM verification_codes
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose],
  );
  const rec = rows[0];
  if (!rec) throw AppError.badRequest('No active code — request a new one.');
  if (new Date(rec.expires_at) < new Date()) throw AppError.badRequest('That code has expired — request a new one.');
  if (rec.attempts >= MAX_ATTEMPTS) throw AppError.badRequest('Too many attempts — request a new code.');

  const ok = await bcrypt.compare(String(code || '').trim(), rec.code_hash);
  if (!ok) {
    await query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [rec.id]);
    throw AppError.badRequest('That code is not valid. Check it and try again.');
  }
  await query('UPDATE verification_codes SET consumed_at = now() WHERE id = $1', [rec.id]);
  return { destination: rec.destination };
}
