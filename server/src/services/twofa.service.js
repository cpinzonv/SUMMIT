/**
 * Two-factor authentication (TOTP). The base32 secret and backup codes are
 * stored ENCRYPTED at rest (utils/crypto). Setup stores a pending secret;
 * confirm verifies the first code, enables 2FA, and issues 10 one-time backup
 * codes. Login's second step accepts a current TOTP code or a backup code
 * (which is then consumed).
 */
import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const ISSUER = 'Summit';

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

  const ok = speakeasy.totp.verify({
    secret: decrypt(user.totp_secret),
    encoding: 'base32',
    token: normalize(code),
    window: 1,
  });
  if (!ok) throw AppError.badRequest('That code is not valid. Check your authenticator and try again.');

  const backupCodes = Array.from({ length: 10 }, makeBackupCode);
  await query('UPDATE users SET totp_enabled = true, backup_codes = $2 WHERE id = $1', [
    userId,
    encrypt(JSON.stringify(backupCodes)),
  ]);
  return { backupCodes };
}

/** Turn off 2FA after re-authenticating with the account password. */
export async function disable(userId, password) {
  const user = await getUser(userId);
  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) throw AppError.badRequest('Incorrect password.');
  await query(
    'UPDATE users SET totp_enabled = false, totp_secret = NULL, backup_codes = NULL WHERE id = $1',
    [userId],
  );
}

export function getStatus(userRow) {
  return { enabled: Boolean(userRow.totp_enabled) };
}

/**
 * Validate a login second-factor: a current TOTP code, or a backup code (which
 * is consumed on use). Returns true/false. Accepts a users row.
 */
export async function verifyLoginCode(user, code) {
  if (!user.totp_secret) return false;
  const clean = normalize(code);

  const totpOk = speakeasy.totp.verify({
    secret: decrypt(user.totp_secret),
    encoding: 'base32',
    token: clean,
    window: 1,
  });
  if (totpOk) return true;

  if (user.backup_codes) {
    const codes = JSON.parse(decrypt(user.backup_codes));
    const idx = codes.findIndex((c) => normalize(c) === clean);
    if (idx >= 0) {
      codes.splice(idx, 1); // one-time use
      await query('UPDATE users SET backup_codes = $2 WHERE id = $1', [
        user.id,
        encrypt(JSON.stringify(codes)),
      ]);
      return true;
    }
  }
  return false;
}
