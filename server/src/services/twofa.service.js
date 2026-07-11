/**
 * Two-factor authentication (TOTP). The base32 secret is stored ENCRYPTED at
 * rest (utils/crypto). Backup codes are stored HASHED (bcrypt) — a DB read can't
 * reveal them — as a JSON array of hashes; each is single-use. Setup stores a
 * pending secret; confirm verifies the first code, enables 2FA, and issues 10
 * one-time backup codes. Login's second step accepts a current TOTP code (each
 * time-step usable only once — replay-protected) or a backup code (consumed).
 */
import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const ISSUER = 'Summit';
const SALT_ROUNDS = 12; // same cost as account passwords (M7)
const STEP_SECONDS = 30; // standard TOTP period

async function getUser(userId) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw AppError.notFound('User not found');
  return rows[0];
}

const makeBackupCode = () => {
  const hex = crypto.randomBytes(5).toString('hex'); // 10 chars
  return `${hex.slice(0, 5)}-${hex.slice(5)}`;
};
const normalize = (s) => String(s || '').replace(/[\s-]/g, '').toLowerCase();
const hashBackupCode = (code) => bcrypt.hash(normalize(code), SALT_ROUNDS);
const currentStep = () => Math.floor(Date.now() / 1000 / STEP_SECONDS);

/** Generate 10 fresh backup codes; return { plain, hashed } (plain shown once). */
async function freshBackupCodes() {
  const plain = Array.from({ length: 10 }, makeBackupCode);
  const hashed = await Promise.all(plain.map(hashBackupCode));
  return { plain, hashed };
}

/** Parse the stored backup_codes column into an array of bcrypt hashes.
 *  The new format is a plaintext JSON array of hashes (starts with '['). Any
 *  other value (null, or a legacy `v1:`-encrypted blob) → no usable codes. */
function parseHashedCodes(stored) {
  if (!stored || !String(stored).startsWith('[')) return null;
  try {
    const arr = JSON.parse(stored);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

/**
 * Verify a TOTP code with single-use-per-step replay protection (M6). Keeps
 * window:1 for clock skew but rejects a code whose time-step was already
 * consumed. Returns true (and records the step) on a fresh valid code.
 */
async function verifyTotpFresh(user, clean) {
  const res = speakeasy.totp.verifyDelta({
    secret: decrypt(user.totp_secret),
    encoding: 'base32',
    token: clean,
    window: 1,
  });
  if (!res) return false; // undefined → no match within the window
  const step = currentStep() + res.delta;
  if (user.totp_last_step != null && step <= Number(user.totp_last_step)) {
    return false; // this step (or an earlier one) already used — replay
  }
  await query('UPDATE users SET totp_last_step = $2 WHERE id = $1', [user.id, step]);
  return true;
}

/** Step 1: create a pending secret and return a QR code to scan. */
export async function setup(userId) {
  const user = await getUser(userId);
  if (user.totp_enabled) throw AppError.badRequest('Two-factor authentication is already enabled.');

  const secret = speakeasy.generateSecret({ length: 20 });
  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret.base32,
    encoding: 'base32',
    label: user.email,
    issuer: ISSUER,
  });

  // Store the not-yet-enabled secret so confirm() can verify the first code.
  await query('UPDATE users SET totp_secret = $2, totp_enabled = false WHERE id = $1', [
    userId,
    encrypt(secret.base32),
  ]);

  const qrCode = await QRCode.toDataURL(otpauthUrl);
  return { qrCode, otpauthUrl, secret: secret.base32 };
}

/** Step 2: verify the first code, enable 2FA, and return 10 backup codes (once). */
export async function confirm(userId, code) {
  const user = await getUser(userId);
  if (user.totp_enabled) throw AppError.badRequest('Two-factor authentication is already enabled.');
  if (!user.totp_secret) throw AppError.badRequest('Start 2FA setup first.');

  const res = speakeasy.totp.verifyDelta({
    secret: decrypt(user.totp_secret),
    encoding: 'base32',
    token: normalize(code),
    window: 1,
  });
  if (!res) throw AppError.badRequest('That code is not valid. Check your authenticator and try again.');

  const { plain, hashed } = await freshBackupCodes();
  await query('UPDATE users SET totp_enabled = true, backup_codes = $2 WHERE id = $1', [
    userId,
    JSON.stringify(hashed),
  ]);
  return { backupCodes: plain };
}

/**
 * Regenerate the 10 backup codes after re-authenticating with the password.
 * Used to migrate legacy (encrypted) codes to hashed, or to rotate them.
 */
export async function regenerateBackupCodes(userId, password) {
  const user = await getUser(userId);
  if (!user.totp_enabled) throw AppError.badRequest('Enable two-factor authentication first.');
  const ok = await bcrypt.compare(password || '', user.password_hash || '');
  if (!ok) throw AppError.badRequest('Incorrect password.');
  const { plain, hashed } = await freshBackupCodes();
  await query('UPDATE users SET backup_codes = $2 WHERE id = $1', [userId, JSON.stringify(hashed)]);
  return { backupCodes: plain };
}

/** Turn off 2FA after re-authenticating with the account password. */
export async function disable(userId, password) {
  const user = await getUser(userId);
  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) throw AppError.badRequest('Incorrect password.');
  await query(
    'UPDATE users SET totp_enabled = false, totp_secret = NULL, backup_codes = NULL, totp_last_step = NULL WHERE id = $1',
    [userId],
  );
}

export function getStatus(userRow) {
  const enabled = Boolean(userRow.totp_enabled);
  // Legacy (encrypted) or missing codes → prompt a regeneration into hashed form.
  const hasHashedCodes = Boolean(userRow.backup_codes && String(userRow.backup_codes).startsWith('['));
  return { enabled, backupCodesStale: enabled && !hasHashedCodes };
}

/**
 * Validate a login second-factor: a current (fresh) TOTP code, or a backup code
 * (bcrypt-compared and consumed on use). Returns true/false. Accepts a users row.
 * Legacy encrypted backup codes are no longer accepted — the user regenerates.
 */
export async function verifyLoginCode(user, code) {
  if (!user.totp_secret) return false;
  const clean = normalize(code);

  if (await verifyTotpFresh(user, clean)) return true;

  const codes = parseHashedCodes(user.backup_codes);
  if (codes) {
    for (let i = 0; i < codes.length; i += 1) {
      // Constant-time hash compare (bcrypt). On match, consume just this code.
      if (await bcrypt.compare(clean, codes[i])) {
        codes.splice(i, 1);
        await query('UPDATE users SET backup_codes = $2 WHERE id = $1', [user.id, JSON.stringify(codes)]);
        return true;
      }
    }
  }
  return false;
}
