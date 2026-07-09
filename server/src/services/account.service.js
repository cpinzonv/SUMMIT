/**
 * Account security & recovery — Settings-side flows (Phase 2):
 *   • Phone number      — add + verify by SMS code (used later for password reset).
 *   • Recovery email    — add + verify a backup email (used if the primary is lost).
 *   • Change primary    — move to a new email, confirmed by a code sent to the NEW
 *                         address, with a heads-up notification to the OLD one.
 *
 * Every "add" issues a one-time code (see verification.service) and stores the
 * pending destination unverified; the matching "verify" consumes the code and
 * flips the *_verified flag (or swaps the primary email). Returns the refreshed
 * public user so the client can update the Settings view in place.
 */
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { issueCode, verifyCode } from './verification.service.js';
import { sendEmail } from './messaging.service.js';
import { toPublicUser } from './auth.service.js';

const publicUser = async (userId) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw AppError.notFound('User not found.');
  return toPublicUser(rows[0]);
};

// Loose E.164-ish normalization: keep a leading + and digits, drop the rest.
const normalizePhone = (raw) => {
  const trimmed = String(raw || '').trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw AppError.badRequest('Enter a valid phone number, including country code.');
  }
  return `${plus}${digits}`;
};

/* ------------------------------------------------------------------ Phone */

/** Store a (still-unverified) phone and text it a verification code. */
export async function addPhone(userId, rawPhone) {
  const phone = normalizePhone(rawPhone);
  await query('UPDATE users SET phone = $1, phone_verified = false WHERE id = $2', [phone, userId]);
  const { devCode } = await issueCode({
    userId,
    purpose: 'phone',
    channel: 'sms',
    destination: phone,
    intro: 'Your Summit phone verification code is',
  });
  return { phone, ...(devCode ? { devCode } : {}) };
}

/** Confirm the SMS code and mark the phone verified. */
export async function verifyPhone(userId, code) {
  await verifyCode({ userId, purpose: 'phone', code });
  await query('UPDATE users SET phone_verified = true WHERE id = $1', [userId]);
  return { user: await publicUser(userId) };
}

/** Remove the phone number entirely. */
export async function removePhone(userId) {
  await query('UPDATE users SET phone = NULL, phone_verified = false WHERE id = $1', [userId]);
  return { user: await publicUser(userId) };
}

/* --------------------------------------------------------- Recovery email */

/** Store a (still-unverified) backup email and send it a verification code. */
export async function addRecoveryEmail(userId, rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();

  // Can't reuse your own primary, or an address already tied to another account.
  const me = (await query('SELECT email FROM users WHERE id = $1', [userId])).rows[0];
  if (me && email === String(me.email).toLowerCase()) {
    throw AppError.badRequest('That is already your primary email.');
  }
  const clash = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (clash.rows[0]) throw AppError.conflict('That email is already in use on another account.');

  await query('UPDATE users SET recovery_email = $1, recovery_email_verified = false WHERE id = $2', [email, userId]);
  const { devCode } = await issueCode({
    userId,
    purpose: 'recovery_email',
    channel: 'email',
    destination: email,
    subject: 'Confirm your Summit recovery email',
    intro: 'Use this code to confirm your Summit recovery email:',
  });
  return { recoveryEmail: email, ...(devCode ? { devCode } : {}) };
}

/** Confirm the backup-email code and mark it verified. */
export async function verifyRecoveryEmail(userId, code) {
  await verifyCode({ userId, purpose: 'recovery_email', code });
  await query('UPDATE users SET recovery_email_verified = true WHERE id = $1', [userId]);
  return { user: await publicUser(userId) };
}

/** Remove the recovery email entirely. */
export async function removeRecoveryEmail(userId) {
  await query('UPDATE users SET recovery_email = NULL, recovery_email_verified = false WHERE id = $1', [userId]);
  return { user: await publicUser(userId) };
}

/* ------------------------------------------------------ Change primary email */

/**
 * Begin a primary-email change: validate the new address is free, then send a
 * code to it. The code's stored destination IS the pending new email, so the
 * verify step knows where to move the account without trusting client input.
 */
export async function requestEmailChange(userId, rawEmail) {
  const newEmail = String(rawEmail || '').trim().toLowerCase();
  const me = (await query('SELECT email FROM users WHERE id = $1', [userId])).rows[0];
  if (!me) throw AppError.notFound('User not found.');
  if (newEmail === String(me.email).toLowerCase()) {
    throw AppError.badRequest('That is already your email address.');
  }
  const clash = await query('SELECT 1 FROM users WHERE email = $1', [newEmail]);
  if (clash.rows[0]) throw AppError.conflict('That email is already in use on another account.');

  const { devCode } = await issueCode({
    userId,
    purpose: 'change_email',
    channel: 'email',
    destination: newEmail,
    subject: 'Confirm your new Summit email',
    intro: 'Use this code to confirm your new Summit email address:',
  });
  return { pendingEmail: newEmail, ...(devCode ? { devCode } : {}) };
}

/**
 * Finish the change: consume the code, swap the primary email to the address the
 * code was sent to, and notify the OLD address so a hijack is visible.
 */
export async function verifyEmailChange(userId, code) {
  const before = (await query('SELECT email FROM users WHERE id = $1', [userId])).rows[0];
  if (!before) throw AppError.notFound('User not found.');
  const oldEmail = before.email;

  const { destination: newEmail } = await verifyCode({ userId, purpose: 'change_email', code });
  if (!newEmail) throw AppError.badRequest('This change request is no longer valid — start again.');

  // Guard against the address being claimed between request and verify.
  const clash = await query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [newEmail, userId]);
  if (clash.rows[0]) throw AppError.conflict('That email is already in use on another account.');

  await query('UPDATE users SET email = $1, email_verified = true WHERE id = $2', [newEmail, userId]);

  // Heads-up to the previous address (fire-and-forget; sendEmail never throws).
  await sendEmail({
    to: oldEmail,
    subject: 'Your Summit email address was changed',
    text: `The email address on your Summit account was just changed to ${newEmail}. If you did this, no action is needed. If you didn't, contact support right away — your account may be compromised.`,
  });

  return { user: await publicUser(userId) };
}
