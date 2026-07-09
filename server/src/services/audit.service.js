/**
 * Security audit trail. logSecurityEvent records account-security actions to the
 * security_events table for institutional review. It is BEST-EFFORT: it never
 * throws (a logging failure must not break the request) and never stores
 * secrets — pass only non-sensitive `detail` (e.g. { reason: 'bad_password' }),
 * never passwords, tokens, or one-time codes.
 */
import { query } from '../config/db.js';

/**
 * @param {object} e
 * @param {string} e.action   e.g. 'login', 'password_change', 'password_reset', '2fa_enable', '2fa_disable'
 * @param {'success'|'failure'} e.outcome
 * @param {string} [e.userId]  the affected user's id, if known
 * @param {string} [e.email]   the attempted/affected email
 * @param {string} [e.ip]      client IP (req.ip)
 * @param {object} [e.detail]  small, non-sensitive context
 */
export async function logSecurityEvent({ action, outcome, userId, email, ip, detail } = {}) {
  try {
    await query(
      `INSERT INTO security_events (user_id, email, action, outcome, ip, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId ?? null, email ?? null, action, outcome, ip ?? null, detail ? JSON.stringify(detail) : null],
    );
  } catch (err) {
    // Never let auditing failures surface to the user; just note it server-side.
    console.error('[audit] failed to record security event:', err?.message);
  }
}
