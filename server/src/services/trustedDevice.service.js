/**
 * "Remember this device" for 2FA. A trusted device is proven by a random secret
 * token the browser keeps (localStorage); we store only its SHA-256 hash, with a
 * 30-day expiry. Presenting a live token at login lets the user skip the 2FA step
 * from that browser. The token is the secret — user_agent/ip are stored for the
 * Settings list and as a soft binding (a leaked token won't work from a very
 * different browser). Users revoke devices in Settings; expiry is automatic.
 */
import crypto from 'node:crypto';
import { query } from '../config/db.js';

const TRUST_DAYS = 30;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Human-friendly device label from a User-Agent string ("Chrome on macOS"). */
export function deviceLabel(ua = '') {
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /iPhone|iPad|iOS/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

/** Mint + store a trust record for a device; returns the raw token for the client. */
export async function trustDevice(userId, { userAgent = '', ip = null } = {}) {
  const raw = crypto.randomBytes(48).toString('hex');
  await query(
    `INSERT INTO trusted_devices (user_id, token_hash, ua_hash, label, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '${TRUST_DAYS} days')`,
    [userId, sha256(raw), userAgent ? sha256(userAgent) : null, deviceLabel(userAgent), userAgent || null, ip],
  );
  return raw;
}

/**
 * True when `token` is a live trusted device for this user (and the same
 * browser). Refreshes last_used_at + ip on a hit. A UA mismatch is rejected so a
 * stolen token can't be replayed from a different browser.
 */
export async function isDeviceTrusted(userId, token, { userAgent = '', ip = null } = {}) {
  if (!token) return false;
  const { rows } = await query(
    `SELECT id, ua_hash FROM trusted_devices
      WHERE user_id = $1 AND token_hash = $2
        AND revoked_at IS NULL AND expires_at > now()
      LIMIT 1`,
    [userId, sha256(token)],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.ua_hash && userAgent && row.ua_hash !== sha256(userAgent)) return false;
  await query('UPDATE trusted_devices SET last_used_at = now(), ip = COALESCE($2, ip) WHERE id = $1', [row.id, ip]);
  return true;
}

/** The user's live trusted devices, newest first (for Settings). */
export async function listTrustedDevices(userId) {
  const { rows } = await query(
    `SELECT id, label, user_agent, ip, created_at, last_used_at, expires_at
       FROM trusted_devices
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_used_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
  }));
}

/** Revoke one trusted device the user owns. */
export async function revokeTrustedDevice(userId, deviceId) {
  await query(
    'UPDATE trusted_devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [deviceId, userId],
  );
}

/** Revoke every trusted device for a user (e.g. on password change / "sign out everywhere"). */
export async function revokeAllTrustedDevices(userId) {
  await query('UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}
