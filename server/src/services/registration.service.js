/**
 * Gated registration: invite codes, the email allowlist, and the launch
 * waitlist. Signup is open or invite_only per REGISTRATION_MODE (env, fail
 * closed). In invite_only mode a signup needs a valid invite code OR an
 * allowlisted email — enforced server-side in middleware/registrationGate.js.
 *
 * Distinct from the institution-admin onboarding flow (user_invites / the
 * /auth/invite/:token routes).
 */
import { randomBytes } from 'node:crypto';
import { query } from '../config/db.js';
import { env } from '../config/env.js';

export function registrationMode() {
  return env.registrationMode;
}

export function isRegistrationOpen() {
  return env.registrationMode === 'open';
}

/** True when `email` is on the ALLOWED_EMAILS allowlist (case-insensitive). */
export function isEmailAllowed(email) {
  if (!email) return false;
  return env.allowedEmails.includes(String(email).trim().toLowerCase());
}

const normalizeCode = (code) => String(code || '').trim().toUpperCase();

/**
 * Return the invite-code row if it exists and is currently usable (not revoked,
 * not expired, uses remaining), else null. Does NOT consume a use.
 */
export async function findValidInviteCode(code) {
  const c = normalizeCode(code);
  if (!c) return null;
  const { rows } = await query(
    `SELECT * FROM invite_codes
      WHERE code = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND use_count < max_uses
      LIMIT 1`,
    [c],
  );
  return rows[0] || null;
}

/**
 * Atomically spend one use of an invite code, but only if it is still valid.
 * The guard lives in the WHERE clause so concurrent signups can't over-spend a
 * limited code. Returns true when a use was actually consumed.
 */
export async function consumeInviteCode(code) {
  const c = normalizeCode(code);
  if (!c) return false;
  const { rowCount } = await query(
    `UPDATE invite_codes SET use_count = use_count + 1
      WHERE code = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND use_count < max_uses`,
    [c],
  );
  return rowCount > 0;
}

// ---- Admin management -------------------------------------------------------

// Human-readable, single-word prefixes; the suffix uses an unambiguous alphabet
// (no 0/O/1/I) so codes are easy to read aloud and type.
const DEFAULT_PREFIX = 'FOUNDING';
const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(prefix) {
  const p = (normalizeCode(prefix) || DEFAULT_PREFIX).replace(/[^A-Z0-9]/g, '') || DEFAULT_PREFIX;
  let suffix = '';
  for (const b of randomBytes(4)) suffix += SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length];
  return `${p}-${suffix}`;
}

export async function createInviteCode({ maxUses = 1, expiresAt = null, note = null, prefix, createdBy = null } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode(prefix);
    try {
      const { rows } = await query(
        `INSERT INTO invite_codes (code, max_uses, expires_at, note, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [code, maxUses, expiresAt, note, createdBy],
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') continue; // unique collision — regenerate
      throw err;
    }
  }
  throw new Error('Could not generate a unique invite code');
}

export async function listInviteCodes() {
  const { rows } = await query(
    `SELECT c.*, u.email AS created_by_email
       FROM invite_codes c
       LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.created_at DESC`,
  );
  return rows;
}

export async function revokeInviteCode(code) {
  const { rowCount } = await query(
    `UPDATE invite_codes SET revoked_at = now()
      WHERE code = $1 AND revoked_at IS NULL`,
    [normalizeCode(code)],
  );
  return rowCount > 0;
}

// ---- Waitlist ---------------------------------------------------------------

/**
 * Add an email to the waitlist. Duplicate emails upsert silently (no error) so
 * a resubmission just refreshes the university/updated_at.
 */
export async function addToWaitlist({ email, university = null, source = null }) {
  const e = String(email).trim().toLowerCase();
  const uni = university ? String(university).trim().slice(0, 200) : null;
  await query(
    `INSERT INTO launch_waitlist (email, university, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET university = COALESCE(EXCLUDED.university, launch_waitlist.university),
           updated_at = now()`,
    [e, uni, source ? String(source).slice(0, 60) : null],
  );
  return { email: e };
}

export async function waitlistCount() {
  const { rows } = await query('SELECT count(*)::int AS count FROM launch_waitlist');
  return rows[0].count;
}

export async function waitlistByUniversity() {
  const { rows } = await query(
    `SELECT COALESCE(NULLIF(TRIM(university), ''), 'Unspecified') AS university,
            count(*)::int AS count
       FROM launch_waitlist
      GROUP BY 1
      ORDER BY count DESC, university ASC`,
  );
  return rows;
}
