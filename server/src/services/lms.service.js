/**
 * LMS sync service — provider-agnostic orchestration on top of services/lms/*.
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
import { getProvider, DEFAULT_PROVIDER } from './lms/index.js';
import { env } from '../config/env.js';

/** Public connection status (safe to return to the client — no tokens). */
export function toLmsStatus(row) {
  return {
    connected: Boolean(row.lms_connected),
    provider: row.lms_provider ?? null,
    domain: row.lms_domain ?? null,
    syncedAt: row.lms_synced_at ?? null,
    // Whether the server is even able to do LMS work (key + provider configured).
    available: env.lms.useMock || getProvider(row.lms_provider || DEFAULT_PROVIDER).isConfigured(),
  };
}

export async function getStatus(userId) {
  const { rows } = await query(
    `SELECT lms_connected, lms_provider, lms_domain, lms_synced_at FROM users WHERE id = $1`,
    [userId],
  );
  if (!rows[0]) throw AppError.notFound('User not found');
  return toLmsStatus(rows[0]);
}

/** Build the provider authorize URL the client redirects the user to. */
export function buildAuthUrl(userId, { provider = DEFAULT_PROVIDER, domain }) {
  const p = getProvider(provider);
  if (!p.isConfigured() && !env.lms.useMock) {
    throw new AppError(503, `${provider} is not configured on the server.`);
  }
  // Opaque state for CSRF; the client echoes it back to the callback.
  const state = crypto.randomBytes(16).toString('hex');
  const url = p.buildAuthUrl({ domain, redirectUri: env.lms.redirectUri, state });
  return { url, state, redirectUri: env.lms.redirectUri };
}

/** Exchange the OAuth code for tokens and store them (encrypted). */
export async function connect(userId, { provider = DEFAULT_PROVIDER, domain, code, redirectUri }) {
  const p = getProvider(provider);
  const tokens = await p.exchangeCode({
    domain,
    code,
    redirectUri: redirectUri || env.lms.redirectUri,
  });
  if (!tokens.accessToken) {
    throw AppError.badRequest('Canvas did not return an access token.');
  }
  await query(
    `UPDATE users SET
       lms_provider = $2,
       lms_domain = $3,
       lms_access_token = $4,
       lms_refresh_token = $5,
       lms_token_expires_at = $6,
       lms_connected = true
     WHERE id = $1`,
    [
      userId,
      provider,
      domain ?? null,
      encrypt(tokens.accessToken),
      tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      tokens.expiresAt ?? null,
    ],
  );
  return getStatus(userId);
}

/** Forget the LMS connection and stored tokens. Leaves synced data in place. */
export async function disconnect(userId) {
  await query(
    `UPDATE users SET
       lms_connected = false,
       lms_access_token = NULL,
       lms_refresh_token = NULL,
       lms_token_expires_at = NULL
     WHERE id = $1`,
    [userId],
  );
  return getStatus(userId);
}

/** Load + decrypt the connection, or throw a clear 400 if not connected. */
async function requireConnection(userId) {
  const { rows } = await query(
    `SELECT lms_provider, lms_domain, lms_access_token, lms_refresh_token, lms_token_expires_at
     FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row || !row.lms_access_token) {
    throw AppError.badRequest('Connect Canvas in Settings first.', { code: 'lms_not_connected' });
  }
  return {
    provider: row.lms_provider || DEFAULT_PROVIDER,
    domain: row.lms_domain,
    accessToken: decrypt(row.lms_access_token),
    refreshToken: row.lms_refresh_token ? decrypt(row.lms_refresh_token) : null,
  };
}

/**
 * Run `fn(accessToken)`; if the provider reports the token expired, refresh once
 * (persisting the new token) and retry. If we can't refresh, surface a clear
 * "reconnect" error.
 */
async function withValidToken(userId, conn, fn) {
  try {
    return await fn(conn.accessToken);
  } catch (err) {
    if (err?.details?.code !== 'lms_token_expired') throw err;
    if (!conn.refreshToken) {
      throw new AppError(401, 'Your Canvas session expired. Reconnect Canvas in Settings.', {
        code: 'lms_reconnect_required',
      });
    }
    const provider = getProvider(conn.provider);
    let tokens;
    try {
      tokens = await provider.refresh({ domain: conn.domain, refreshToken: conn.refreshToken });
    } catch {
      throw new AppError(401, 'Your Canvas session expired. Reconnect Canvas in Settings.', {
        code: 'lms_reconnect_required',
      });
    }
    await query(
      `UPDATE users SET lms_access_token = $2, lms_token_expires_at = $3 WHERE id = $1`,
      [userId, encrypt(tokens.accessToken), tokens.expiresAt ?? null],
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

/** Full sync: every active course's assignments. Returns a summary tally. */
export async function syncAll(userId) {
  const conn = await requireConnection(userId);
  const provider = getProvider(conn.provider);
  const source = provider.name;

  // 1. Fetch everything from the LMS first (network), refreshing token if needed.
  const courses = await withValidToken(userId, conn, (tok) =>
    provider.listCourses({ domain: conn.domain, accessToken: tok }),
  );
  const fetched = [];
  for (const course of courses) {
    const assignments = await withValidToken(userId, conn, (tok) =>
      provider.listAssignments({ domain: conn.domain, accessToken: tok, externalCourseId: course.externalId }),
    );
    fetched.push({ course, assignments });
  }

  // 2. Persist atomically.
  const tally = { courses: fetched.length, classesCreated: 0, classesMatched: 0, imported: 0, updated: 0, grades: 0 };
  await withTransaction(async (client) => {
    for (const { course, assignments } of fetched) {
      const cls = await matchOrCreateClass(client, userId, source, course, tally);
      for (const a of assignments) await upsertAssignment(client, cls.id, source, a, tally);
    }
  });

  await query(`UPDATE users SET lms_synced_at = now() WHERE id = $1`, [userId]);
  return tally;
}

/** Resolve which external course a Summit class corresponds to (linking if needed). */
async function resolveCourseForClass(userId, conn, provider, cls) {
  const source = provider.name;
  if (cls.external_course_id && cls.external_source === source) {
    return cls.external_course_id;
  }
  // Not linked yet — match against the LMS course list by name/code.
  const courses = await withValidToken(userId, conn, (tok) =>
    provider.listCourses({ domain: conn.domain, accessToken: tok }),
  );
  const match = courses.find(
    (c) =>
      c.name.toLowerCase() === (cls.name || '').toLowerCase() ||
      (c.code && cls.code && c.code.toLowerCase() === cls.code.toLowerCase()),
  );
  if (!match) {
    throw AppError.badRequest(
      `Couldn't find a matching Canvas course for "${cls.name}". Run a full sync from the dashboard, or rename the class to match Canvas.`,
    );
  }
  await query(
    `UPDATE classes SET external_source = $2, external_course_id = $3 WHERE id = $1`,
    [cls.id, source, match.externalId],
  );
  return match.externalId;
}

/** List a class's Canvas assignments, flagging which are already imported. */
export async function listImportableAssignments(userId, cls) {
  const conn = await requireConnection(userId);
  const provider = getProvider(conn.provider);
  const source = provider.name;
  const externalCourseId = await resolveCourseForClass(userId, conn, provider, cls);

  const assignments = await withValidToken(userId, conn, (tok) =>
    provider.listAssignments({ domain: conn.domain, accessToken: tok, externalCourseId }),
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

/** Import a chosen subset of a class's Canvas assignments. */
export async function importAssignments(userId, cls, externalIds) {
  const conn = await requireConnection(userId);
  const provider = getProvider(conn.provider);
  const source = provider.name;
  const externalCourseId = await resolveCourseForClass(userId, conn, provider, cls);

  const all = await withValidToken(userId, conn, (tok) =>
    provider.listAssignments({ domain: conn.domain, accessToken: tok, externalCourseId }),
  );
  const wanted = new Set(externalIds.map(String));
  const selected = all.filter((a) => wanted.has(String(a.externalId)));

  const tally = { imported: 0, updated: 0, grades: 0 };
  await withTransaction(async (client) => {
    for (const a of selected) await upsertAssignment(client, cls.id, source, a, tally);
  });
  return tally;
}
