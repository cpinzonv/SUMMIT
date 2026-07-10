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

/**
 * FERPA data-access + admin-action audit trail (append-only `audit_logs`).
 * Records WHO did WHAT to WHOSE educational record — ids, counts, and
 * non-sensitive context ONLY; NEVER record values (grades, transcript text,
 * note bodies, file contents). Fire-and-forget: it is NOT awaited in the request
 * path and never throws — a logging failure is logged server-side only.
 *
 * The actor's role and tenant are resolved from the actor's own user row in the
 * same INSERT, so call sites only pass the action + target + subject:
 *
 *   logAudit(req, {
 *     action: 'record.view', targetType: 'transcript', targetId: classId,
 *     subjectStudentId: req.user.id, metadata: { count },
 *   });
 *
 * `req` supplies actor id (req.user.id), ip, and user-agent. Pass `tenantId` to
 * override the actor's institution (e.g. an institution-admin action scoped to
 * req.institutionId); otherwise the actor's institution_id is used.
 */
export function logAudit(req, {
  action,
  targetType = null,
  targetId = null,
  subjectStudentId = null,
  tenantId,
  metadata = null,
} = {}) {
  const actorUserId = req?.user?.id ?? null;
  const ip = req?.ip ?? null;
  const userAgent = typeof req?.get === 'function' ? req.get('user-agent') ?? null : null;
  const meta = metadata ? JSON.stringify(metadata) : null;
  const tid = tenantId ?? null;

  const p = actorUserId
    ? // Resolve actor_role + tenant (actor's institution unless overridden) inline.
      query(
        `INSERT INTO audit_logs
           (actor_user_id, actor_role, tenant_id, action, target_type, target_id, subject_student_id, ip, user_agent, metadata)
         SELECT u.id, u.role, COALESCE($8::uuid, u.institution_id), $2, $3, $4, $5::uuid, $6, $7, $9::jsonb
           FROM users u WHERE u.id = $1`,
        [actorUserId, action, targetType, targetId, subjectStudentId, ip, userAgent, tid, meta],
      )
    : // Unauthenticated / system actor (e.g. first-admin bootstrap).
      query(
        `INSERT INTO audit_logs
           (actor_user_id, actor_role, tenant_id, action, target_type, target_id, subject_student_id, ip, user_agent, metadata)
         VALUES (NULL, NULL, $7::uuid, $1, $2, $3, $4::uuid, $5, $6, $8::jsonb)`,
        [action, targetType, targetId, subjectStudentId, ip, userAgent, tid, meta],
      );

  p.catch((err) => console.error('[audit] failed to record audit log:', err?.message));
}
