/**
 * Self-serve account deletion — soft-delete with a 30-day recovery grace period,
 * then a permanent purge.
 *
 *   requestAccountDeletion  Settings "Danger Zone": high-friction, server-enforced
 *                           re-auth (current password + TOTP when 2FA is on) plus a
 *                           typed email confirmation. Institutional (school-managed)
 *                           accounts CANNOT self-delete. On success the account is
 *                           soft-deleted (deleted_at + status='pending_deletion')
 *                           and EVERY session/refresh token is revoked immediately
 *                           — the user is logged out everywhere. No data is dropped.
 *   restoreAccount          During the 30-day window a login lands on the Restore
 *                           screen (see auth.service login/loginTwoFactor). Calling
 *                           this clears deleted_at/status and reactivates fully.
 *   purgeExpiredAccounts    Daily cron (jobs/accountPurge.js): hard-deletes accounts
 *                           whose deleted_at is older than the grace period and ALL
 *                           associated data, then records the purge to the audit log.
 *
 * The purge relies on ON DELETE CASCADE from users(id) for the bulk of user-owned
 * data, but three tables hold the user's rows via ON DELETE SET NULL (or no FK at
 * all) and would otherwise be ORPHANED — they are deleted explicitly, BEFORE the
 * user row, while user_id is still populated. See purgeUser() for the enumeration.
 */
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { verifyReauth, toPublicUser } from './auth.service.js';
import { revokeAllTrustedDevices } from './trustedDevice.service.js';

// Recovery window: the account is deactivated-but-restorable for this many days
// after a deletion request; after it lapses the purge job removes it for good.
export const GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const scheduledPurgeDate = (deletedAt) => new Date(new Date(deletedAt).getTime() + GRACE_DAYS * DAY_MS);

/**
 * Mark the caller's account for deletion. Verifies (server-side, never trusting
 * the client) that: the account is not institution-managed; the typed
 * confirmation matches the account email; the current password is correct; and,
 * when 2FA is enabled, a valid TOTP/backup code is supplied. Only then does it
 * soft-delete and revoke every session. Returns the scheduled purge date.
 */
export async function requestAccountDeletion(userId, { password, totpCode, confirmEmail } = {}) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) throw AppError.notFound('User not found.');
  if (user.deleted_at) {
    // Already pending — idempotent, report the existing schedule.
    return { scheduledFor: scheduledPurgeDate(user.deleted_at) };
  }

  // Institutional accounts are managed by their school and cannot self-delete.
  if (user.institution_id) {
    throw AppError.forbidden('Your account is managed by your institution. Contact your administrator to remove it.');
  }

  // The confirmation string must exactly match the account email (case-insensitive).
  const typed = String(confirmEmail || '').trim().toLowerCase();
  if (!typed || typed !== String(user.email).toLowerCase()) {
    throw AppError.badRequest('Type your email address exactly to confirm deletion.');
  }

  // Re-auth: throws on a wrong password, or a missing/invalid TOTP when 2FA is on.
  await verifyReauth(userId, { password, totpCode });

  const deletedAt = await withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE users SET deleted_at = now(), account_status = 'pending_deletion'
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING deleted_at`,
      [userId],
    );
    // Revoke every refresh token and invalidate outstanding access tokens (M1
    // watermark) so the account is logged out everywhere immediately.
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    await client.query('UPDATE users SET sessions_invalidated_at = now() WHERE id = $1', [userId]);
    return upd.rows[0]?.deleted_at ?? new Date();
  });
  // Drop remembered-2FA devices too (own transaction inside the helper).
  await revokeAllTrustedDevices(userId);

  return { scheduledFor: scheduledPurgeDate(deletedAt) };
}

/**
 * Reactivate a pending-deletion account (explicit "Restore" step). Clears the
 * soft-delete markers. Throws if the account is no longer restorable (already
 * active, or already purged). Returns the refreshed public user.
 */
export async function restoreAccount(userId) {
  const { rows } = await query(
    `UPDATE users SET deleted_at = NULL, account_status = 'active'
      WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING *`,
    [userId],
  );
  if (!rows[0]) throw AppError.badRequest('This account can no longer be restored.');
  return { user: toPublicUser(rows[0]) };
}

/**
 * Hard-delete a single user and EVERY row of their data, in one transaction.
 *
 * Cascade (ON DELETE CASCADE from users(id)) removes the bulk automatically:
 *   classes → assignments → grades, assignment_submissions; attendance;
 *   class_files (uploaded file blobs are base64 rows in this table — no external
 *   object storage), transcripts, notes, flashcards, decks, deck_settings,
 *   deck_study_stats, card_reviews, learning_streaks, learning_sessions,
 *   mastery_levels, learning_sessions, podcasts, quizzes, study_guides,
 *   mind_maps, user_learning_stats; plus refresh_tokens, trusted_devices,
 *   verification_codes, gcal_events, lms_connections, lms_sync_log, plan_items,
 *   archives, activities → activity_projects → activity_tasks, usage_counters,
 *   user_invites, waitlist, premium_whitelist(user_id).
 *
 * These three tables reference the user via ON DELETE SET NULL (or no FK at all),
 * so a plain user delete would leave the user's rows ORPHANED. Delete them
 * explicitly FIRST, while user_id is still set:
 *   • security_events  (user_id  → SET NULL)
 *   • gate_events      (user_id  → SET NULL)
 *   • audit_logs       (actor_user_id / subject_student_id → no FK)
 */
async function purgeUser(userId, { email } = {}) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM security_events WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM gate_events WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM audit_logs WHERE actor_user_id = $1 OR subject_student_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    // Record the purge to the admin audit trail — written AFTER the user's own
    // audit rows are gone, with a null (system) actor so it survives the purge.
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata)
       VALUES (NULL, 'system', 'account.purge', 'user', $1, $2::jsonb)`,
      [userId, JSON.stringify({ email: email ?? null, graceDays: GRACE_DAYS })],
    );
  });
}

/**
 * Find every account whose grace period has lapsed and hard-purge each one.
 * Returns the list of purged { id, email } for the caller to log. `now` is
 * injectable for tests.
 */
export async function purgeExpiredAccounts({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - GRACE_DAYS * DAY_MS);
  const { rows } = await query(
    `SELECT id, email FROM users
      WHERE account_status = 'pending_deletion' AND deleted_at IS NOT NULL AND deleted_at <= $1`,
    [cutoff],
  );
  const purged = [];
  for (const u of rows) {
    await purgeUser(u.id, { email: u.email });
    purged.push({ id: u.id, email: u.email });
  }
  return purged;
}
