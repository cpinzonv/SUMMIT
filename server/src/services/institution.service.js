/**
 * Institutions (multi-tenancy) — provisioned by a platform super-admin (role
 * 'admin'). Creating one also creates the school's 'institution_admin' user with
 * NO password + a one-time invite token; they set their password via the invite
 * link (see auth.service acceptInvite). Feature tiers are STORED here (Phase 1);
 * app-wide enforcement is Phase 2. Revoke is a hard block (auth.service refuses
 * login + refresh for a revoked institution's users).
 */
import crypto from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { hashToken } from '../utils/jwt.js';

// Feature keys the tiers/toggles cover. Basic = transcription + summaries; Pro =
// everything. Stored on the institution; honored app-wide in Phase 2.
export const FEATURE_KEYS = ['transcription', 'summaries', 'quizzes', 'studyGuides', 'mindMaps', 'podcasts'];
const ALL_ON = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
export const TIER_FEATURES = {
  basic: { ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])), transcription: true, summaries: true },
  pro: { ...ALL_ON },
};

const INVITE_TTL_HOURS = 72;

/** Mint a one-time set-password invite token for a user (only its hash is stored). */
async function mintInvite(client, userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  await client.query(
    `INSERT INTO user_invites (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [userId, hashToken(raw), INVITE_TTL_HOURS],
  );
  return raw;
}

function normalizeFlags(flags) {
  const out = {};
  for (const k of FEATURE_KEYS) out[k] = Boolean(flags?.[k]);
  return out;
}

function deriveStatus(row) {
  if (row.revoked_at) return 'revoked';
  const today = new Date().toISOString().slice(0, 10);
  if (row.contract_end && String(row.contract_end).slice(0, 10) < today) return 'expired';
  if (!row.admin_activated) return 'pending'; // admin hasn't accepted the invite yet
  if (row.contract_start && String(row.contract_start).slice(0, 10) > today) return 'scheduled';
  return 'active';
}

function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    adminEmail: row.admin_email,
    contractStart: row.contract_start ?? null,
    contractEnd: row.contract_end ?? null,
    lmsType: row.lms_type ?? null,
    studentSeats: row.student_seats ?? 0,
    studentCount: row.student_count ?? 0, // live, from the join
    tier: row.tier,
    featureFlags: normalizeFlags(row.feature_flags),
    adminActivated: Boolean(row.admin_activated),
    revokedAt: row.revoked_at ?? null,
    status: deriveStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Selects each institution with its live student count + whether the admin has
// activated (set a password). $N placeholders can filter by a single id.
const SELECT_WITH_COUNTS = `
  SELECT i.*,
    (SELECT count(*) FROM users u WHERE u.institution_id = i.id AND u.role = 'user')::int AS student_count,
    EXISTS (SELECT 1 FROM users a WHERE a.institution_id = i.id AND a.role = 'institution_admin' AND a.password_hash IS NOT NULL) AS admin_activated
  FROM institutions i`;

export async function listInstitutions() {
  const { rows } = await query(`${SELECT_WITH_COUNTS} ORDER BY i.created_at DESC`);
  return rows.map(toPublic);
}

export async function getInstitution(id) {
  const { rows } = await query(`${SELECT_WITH_COUNTS} WHERE i.id = $1`, [id]);
  if (!rows[0]) throw AppError.notFound('Institution not found');
  return toPublic(rows[0]);
}

/**
 * Create an institution + its institution_admin user (no password) + a one-time
 * invite token. Returns the public institution and the RAW invite token (only
 * its hash is stored) so the caller can build the invite link.
 */
export async function createInstitution(creatorId, input) {
  const tier = input.tier === 'pro' ? 'pro' : 'basic';
  // Explicit toggles win; otherwise default from the tier.
  const flags = normalizeFlags(input.featureFlags ?? TIER_FEATURES[tier]);
  const adminEmail = input.adminEmail.trim();

  return withTransaction(async (client) => {
    const dup = await client.query('SELECT 1 FROM users WHERE email = $1', [adminEmail]);
    if (dup.rowCount > 0) throw AppError.conflict('A user with that admin email already exists.');

    const { rows: instRows } = await client.query(
      `INSERT INTO institutions
         (name, admin_email, contract_start, contract_end, lms_type, student_seats, tier, feature_flags, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        input.name.trim(),
        adminEmail,
        input.contractStart ?? null,
        input.contractEnd ?? null,
        input.lmsType ?? null,
        input.studentSeats ?? 0,
        tier,
        JSON.stringify(flags),
        creatorId,
      ],
    );
    const inst = instRows[0];

    // Admin user: no password yet (activates via the invite link).
    const { rows: userRows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, institution_id, auth_method, email_verified)
       VALUES ($1, NULL, $2, 'institution_admin', $3, 'invite', true) RETURNING id`,
      [adminEmail, `${input.name.trim()} Admin`, inst.id],
    );
    const adminUserId = userRows[0].id;

    const rawToken = await mintInvite(client, adminUserId);

    return {
      institution: toPublic({ ...inst, student_count: 0, admin_activated: false }),
      inviteToken: rawToken,
    };
  });
}

const EDITABLE = {
  name: 'name',
  contractStart: 'contract_start',
  contractEnd: 'contract_end',
  lmsType: 'lms_type',
  studentSeats: 'student_seats',
  tier: 'tier',
};

export async function updateInstitution(id, input) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [field, col] of Object.entries(EDITABLE)) {
    if (field in input) {
      sets.push(`${col} = $${i++}`);
      values.push(input[field] ?? null);
    }
  }
  if ('featureFlags' in input) {
    sets.push(`feature_flags = $${i++}`);
    values.push(JSON.stringify(normalizeFlags(input.featureFlags)));
  }
  if (sets.length > 0) {
    values.push(id);
    const { rowCount } = await query(`UPDATE institutions SET ${sets.join(', ')} WHERE id = $${i}`, values);
    if (rowCount === 0) throw AppError.notFound('Institution not found');
  }
  return getInstitution(id);
}

/** Hard revoke (or reinstate) an institution's access. */
export async function setRevoked(id, revoked) {
  const { rowCount } = await query(
    `UPDATE institutions SET revoked_at = ${revoked ? 'now()' : 'NULL'} WHERE id = $1`,
    [id],
  );
  if (rowCount === 0) throw AppError.notFound('Institution not found');
  return getInstitution(id);
}

/**
 * Hard block: throws 403 if the user belongs to a revoked institution. Called
 * from auth.service on login + token refresh. Accepts a user row (with
 * institution_id) or a bare userId.
 */
export async function assertInstitutionActive(userOrId) {
  const institutionId =
    typeof userOrId === 'string'
      ? (await query('SELECT institution_id FROM users WHERE id = $1', [userOrId])).rows[0]?.institution_id
      : userOrId?.institution_id;
  if (!institutionId) return;
  const { rows } = await query('SELECT revoked_at, contract_end FROM institutions WHERE id = $1', [institutionId]);
  const inst = rows[0];
  // NOTE: revoke is a GRACEFUL DOWNGRADE, not a login block — revoked students
  // keep logging in and keep their own data; they just lose plus features (see
  // featureGating.canAccessFeature) and get a warning banner. So revoked_at is
  // deliberately NOT blocked here.
  //
  // Contract-expiry is still a HARD lockout: past the contract end date, the
  // institution's users can no longer log in / refresh.
  if (inst?.contract_end && String(inst.contract_end).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
    throw new AppError(403, 'Your institution’s Summit contract has ended. Contact your administrator.', {
      code: 'institution_expired',
    });
  }
}

/* ---- Roster (institution-admin, tenant-scoped) -------------------------- */

/** Students belonging to one institution. */
export async function listStudents(institutionId) {
  const { rows } = await query(
    `SELECT id, email, full_name AS name, (password_hash IS NOT NULL) AS activated, created_at
       FROM users WHERE institution_id = $1 AND role = 'user'
      ORDER BY created_at DESC`,
    [institutionId],
  );
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, activated: r.activated, createdAt: r.created_at }));
}

/**
 * Bulk-provision student accounts for one institution from a roster. Each new
 * student gets NO password + a one-time invite token (returned so the admin can
 * distribute set-password links). Existing emails are skipped, not overwritten.
 * The seat cap is soft (display only) — over-cap adds still succeed.
 */
export async function addStudents(institutionId, students) {
  return withTransaction(async (client) => {
    const created = [];
    const skipped = [];
    for (const s of students) {
      const email = String(s.email || '').trim().toLowerCase();
      if (!email) continue;
      const dup = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (dup.rowCount > 0) {
        skipped.push({ email, reason: 'already exists' });
        continue;
      }
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, institution_id, auth_method, email_verified)
         VALUES ($1, NULL, $2, 'user', $3, 'invite', true) RETURNING id`,
        [email, s.name?.trim() || email, institutionId],
      );
      const token = await mintInvite(client, rows[0].id);
      created.push({ email, inviteToken: token });
    }
    return { created, skipped };
  });
}
