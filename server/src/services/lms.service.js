/**
 * LMS sync service — provider-agnostic orchestration on top of services/lms/*.
 *
 * Connections are stored one-per-(user, provider) in the lms_connections table,
 * so a student can link several LMSs at once (Canvas + Blackboard + ...). Every
 * public function therefore takes a `provider` key.
 *
 * Responsibilities:
 *   - connection lifecycle: build auth URL, exchange code, store ENCRYPTED
 *     tokens, report status, disconnect
 *   - access-token validity: transparently refresh once on expiry, else surface
 *     a clear "reconnect" error
 *   - sync: list courses → match/create Summit classes → upsert assignments
 *     (deduped by external id) → optionally fill grades
 *   - per-class import: list a course's assignments and import a chosen subset
 *
 * Course matching: link by (external_source, external_course_id); otherwise
 * adopt an existing unlinked class with the same name/code; otherwise create one.
 */
import crypto from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { getProvider, DEFAULT_PROVIDER, PROVIDER_KEYS } from './lms/index.js';
import { getProviderMeta } from './lms/providers.js';
import { env } from '../config/env.js';

/* ---- Connection status -------------------------------------------------- */

/** Public connection status for one provider (safe for the client — no tokens). */
function toStatus(providerKey, row) {
  const meta = getProviderMeta(providerKey);
  return {
    provider: providerKey,
    label: meta?.label ?? providerKey,
    needsDomain: meta?.needsDomain ?? true,
    connected: Boolean(row?.connected),
    domain: row?.domain ?? null,
    syncedAt: row?.synced_at ?? null,
    // Whether the server can do LMS work for this provider (configured or mock).
    available: getProvider(providerKey).isConfigured(),
  };
}

/** Status for a single provider. */
export async function getStatus(userId, provider = DEFAULT_PROVIDER) {
  assertKnownProvider(provider);
  const { rows } = await query(
    `SELECT provider, domain, connected, synced_at
       FROM lms_connections WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  return toStatus(provider, rows[0]);
}

/** Status for every registered provider — what the Settings page renders. */
export async function getStatuses(userId) {
  const { rows } = await query(
    `SELECT provider, domain, connected, synced_at FROM lms_connections WHERE user_id = $1`,
    [userId],
  );
  const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
  return PROVIDER_KEYS.map((key) => toStatus(key, byProvider[key]));
}

function assertKnownProvider(provider) {
  if (!PROVIDER_KEYS.includes(provider)) {
    throw AppError.badRequest(`Unsupported LMS provider: ${provider}`);
  }
}

/* ---- Connect / disconnect ----------------------------------------------- */

/** Build the provider authorize URL the client redirects the user to. */
export function buildAuthUrl(userId, provider, { domain } = {}) {
  assertKnownProvider(provider);
  const p = getProvider(provider);
  if (!p.isConfigured()) {
    throw new AppError(503, `${getProviderMeta(provider)?.label ?? provider} is not configured on the server.`);
  }
  // Opaque state for CSRF; the client echoes it back to the callback.
  const state = crypto.randomBytes(16).toString('hex');
  const url = p.buildAuthUrl({ domain, redirectUri: env.lms.redirectUri, state });
  return { url, state, redirectUri: env.lms.redirectUri, provider };
}

/** Exchange the OAuth code for tokens and store them (encrypted), per provider. */
export async function connect(userId, provider, { domain, code, redirectUri } = {}) {
  assertKnownProvider(provider);
  const p = getProvider(provider);
  const label = getProviderMeta(provider)?.label ?? provider;
  const tokens = await p.exchangeCode({
    domain,
    code,
    redirectUri: redirectUri || env.lms.redirectUri,
  });
  if (!tokens.accessToken) {
    throw AppError.badRequest(`${label} did not return an access token.`);
  }
  await query(
    `INSERT INTO lms_connections
       (user_id, provider, domain, access_token, refresh_token, token_expires_at, connected)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       domain = EXCLUDED.domain,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       connected = true`,
    [
      userId,
      provider,
      domain ?? null,
      encrypt(tokens.accessToken),
      tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tokens.expiresAt ?? null,
    ],
  );
  return getStatus(userId, provider);
}

/** Forget one provider's connection + stored tokens. Leaves synced data in place. */
export async function disconnect(userId, provider) {
  assertKnownProvider(provider);
  await query(
    `UPDATE lms_connections SET
       connected = false,
       access_token = NULL,
       refresh_token = NULL,
       token_expires_at = NULL
     WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  return getStatus(userId, provider);
}

/** Load + decrypt a provider connection, or throw a clear 400 if not connected. */
async function requireConnection(userId, provider) {
  assertKnownProvider(provider);
  const { rows } = await query(
    `SELECT provider, domain, access_token, refresh_token, token_expires_at
       FROM lms_connections WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  const row = rows[0];
  const label = getProviderMeta(provider)?.label ?? provider;
  if (!row || !row.access_token) {
    throw AppError.badRequest(`Connect ${label} in Settings first.`, { code: 'lms_not_connected' });
  }
  return {
    provider,
    domain: row.domain,
    accessToken: decrypt(row.access_token),
    refreshToken: row.refresh_token ? decrypt(row.refresh_token) : null,
  };
}

/**
 * Run `fn(accessToken)`; if the provider reports the token expired, refresh once
 * (persisting the new token) and retry. If we can't refresh, surface a clear
 * "reconnect" error.
 */
async function withValidToken(userId, conn, fn) {
  const label = getProviderMeta(conn.provider)?.label ?? conn.provider;
  try {
    return await fn(conn.accessToken);
  } catch (err) {
    if (err?.details?.code !== 'lms_token_expired') throw err;
    if (!conn.refreshToken) {
      throw new AppError(401, `Your ${label} session expired. Reconnect ${label} in Settings.`, {
        code: 'lms_reconnect_required',
      });
    }
    const provider = getProvider(conn.provider);
    let tokens;
    try {
      tokens = await provider.refresh({ domain: conn.domain, refreshToken: conn.refreshToken });
    } catch {
      throw new AppError(401, `Your ${label} session expired. Reconnect ${label} in Settings.`, {
        code: 'lms_reconnect_required',
      });
    }
    await query(
      `UPDATE lms_connections SET access_token = $3, token_expires_at = $4
         WHERE user_id = $1 AND provider = $2`,
      [userId, conn.provider, encrypt(tokens.accessToken), tokens.expiresAt ?? null],
    );
    conn.accessToken = tokens.accessToken;
    return fn(tokens.accessToken);
  }
}

/* ---- Write helpers (run inside a transaction) --------------------------- */

async function matchOrCreateClass(client, userId, source, course, tally) {
  // 1. Already linked to this external course.
  let { rows } = await client.query(
    `SELECT * FROM classes WHERE user_id = $1 AND external_source = $2 AND external_course_id = $3`,
    [userId, source, course.externalId],
  );
  if (rows[0]) return rows[0];

  // 2. Adopt an existing unlinked class with the same name or code.
  ({ rows } = await client.query(
    `SELECT * FROM classes
     WHERE user_id = $1 AND external_course_id IS NULL AND archived_at IS NULL
       AND (lower(name) = lower($2) OR ($3 <> '' AND lower(coalesce(code,'')) = lower($3)))
     ORDER BY created_at LIMIT 1`,
    [userId, course.name, course.code ?? ''],
  ));
  if (rows[0]) {
    const adopted = await client.query(
      `UPDATE classes SET external_source = $2, external_course_id = $3 WHERE id = $1 RETURNING *`,
      [rows[0].id, source, course.externalId],
    );
    tally.classesMatched++;
    return adopted.rows[0];
  }

  // 3. Create a new class.
  const created = await client.query(
    `INSERT INTO classes (user_id, name, code, external_source, external_course_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, course.name, course.code ?? null, source, course.externalId],
  );
  tally.classesCreated++;
  return created.rows[0];
}

async function upsertAssignment(client, classId, source, a, tally) {
  const { rows } = await client.query(
    `SELECT id FROM assignments WHERE class_id = $1 AND external_source = $2 AND external_id = $3`,
    [classId, source, a.externalId],
  );

  let assignmentId;
  if (rows[0]) {
    // Already imported — sync changed fields (e.g. a shifted due date).
    assignmentId = rows[0].id;
    await client.query(
      `UPDATE assignments
       SET title = $2, due_date = $3, point_value = $4,
           description = COALESCE($5, description)
       WHERE id = $1`,
      [assignmentId, a.title, a.dueDate ?? null, a.pointValue ?? null, a.description ?? null],
    );
    tally.updated++;
  } else {
    const ins = await client.query(
      `INSERT INTO assignments
         (class_id, title, due_date, point_value, description, external_source, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [classId, a.title, a.dueDate ?? null, a.pointValue ?? null, a.description ?? null, source, a.externalId],
    );
    assignmentId = ins.rows[0].id;
    tally.imported++;
  }

  // Optionally fill the grade from the LMS submission.
  if (a.grade && a.grade.pointsPossible > 0) {
    await client.query(
      `INSERT INTO grades (assignment_id, points_earned, points_possible)
       VALUES ($1, $2, $3)
       ON CONFLICT (assignment_id)
       DO UPDATE SET points_earned = EXCLUDED.points_earned,
                     points_possible = EXCLUDED.points_possible,
                     graded_at = now()`,
      [assignmentId, a.grade.pointsEarned, a.grade.pointsPossible],
    );
    await client.query(`UPDATE assignments SET status = 'graded' WHERE id = $1`, [assignmentId]);
    tally.grades++;
  }
  return assignmentId;
}

/* ---- Public sync operations --------------------------------------------- */

/** Full sync for one provider: every active course's assignments. Returns a tally. */
export async function syncAll(userId, provider = DEFAULT_PROVIDER) {
  const conn = await requireConnection(userId, provider);
  const resolved = getProvider(provider);
  const source = resolved.name;

  // 1. Fetch everything from the LMS first (network), refreshing token if needed.
  const courses = await withValidToken(userId, conn, (tok) =>
    resolved.listCourses({ domain: conn.domain, accessToken: tok }),
  );
  const fetched = [];
  for (const course of courses) {
    const assignments = await withValidToken(userId, conn, (tok) =>
      resolved.listAssignments({ domain: conn.domain, accessToken: tok, externalCourseId: course.externalId }),
    );
    fetched.push({ course, assignments });
  }

  // 2. Persist atomically.
  const tally = { provider, courses: fetched.length, classesCreated: 0, classesMatched: 0, imported: 0, updated: 0, grades: 0 };
  await withTransaction(async (client) => {
    for (const { course, assignments } of fetched) {
      const cls = await matchOrCreateClass(client, userId, source, course, tally);
      for (const a of assignments) await upsertAssignment(client, cls.id, source, a, tally);
    }
  });

  await query(
    `UPDATE lms_connections SET synced_at = now() WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  return tally;
}

/** Resolve which external course a Summit class corresponds to (linking if needed). */
async function resolveCourseForClass(userId, conn, resolved, cls) {
  const source = resolved.name;
  const label = getProviderMeta(conn.provider)?.label ?? conn.provider;
  if (cls.external_course_id && cls.external_source === source) {
    return cls.external_course_id;
  }
  // Not linked yet — match against the LMS course list by name/code.
  const courses = await withValidToken(userId, conn, (tok) =>
    resolved.listCourses({ domain: conn.domain, accessToken: tok }),
  );
  const match = courses.find(
    (c) =>
      c.name.toLowerCase() === (cls.name || '').toLowerCase() ||
      (c.code && cls.code && c.code.toLowerCase() === cls.code.toLowerCase()),
  );
  if (!match) {
    throw AppError.badRequest(
      `Couldn't find a matching ${label} course for "${cls.name}". Run a full sync, or rename the class to match ${label}.`,
    );
  }
  await query(
    `UPDATE classes SET external_source = $2, external_course_id = $3 WHERE id = $1`,
    [cls.id, source, match.externalId],
  );
  return match.externalId;
}

/** List a class's assignments for a provider, flagging which are already imported. */
export async function listImportableAssignments(userId, provider, cls) {
  const conn = await requireConnection(userId, provider);
  const resolved = getProvider(provider);
  const source = resolved.name;
  const externalCourseId = await resolveCourseForClass(userId, conn, resolved, cls);

  const assignments = await withValidToken(userId, conn, (tok) =>
    resolved.listAssignments({ domain: conn.domain, accessToken: tok, externalCourseId }),
  );

  const { rows } = await query(
    `SELECT external_id FROM assignments WHERE class_id = $1 AND external_source = $2 AND external_id IS NOT NULL`,
    [cls.id, source],
  );
  const imported = new Set(rows.map((r) => r.external_id));

  return assignments.map((a) => ({
    externalId: a.externalId,
    title: a.title,
    dueDate: a.dueDate,
    pointValue: a.pointValue,
    description: a.description,
    hasGrade: Boolean(a.grade),
    alreadyImported: imported.has(a.externalId),
  }));
}

/** Import a chosen subset of a class's assignments for a provider. */
export async function importAssignments(userId, provider, cls, externalIds) {
  const conn = await requireConnection(userId, provider);
  const resolved = getProvider(provider);
  const source = resolved.name;
  const externalCourseId = await resolveCourseForClass(userId, conn, resolved, cls);

  const all = await withValidToken(userId, conn, (tok) =>
    resolved.listAssignments({ domain: conn.domain, accessToken: tok, externalCourseId }),
  );
  const wanted = new Set(externalIds.map(String));
  const selected = all.filter((a) => wanted.has(String(a.externalId)));

  const tally = { provider, imported: 0, updated: 0, grades: 0 };
  await withTransaction(async (client) => {
    for (const a of selected) await upsertAssignment(client, cls.id, source, a, tally);
  });
  return tally;
}
