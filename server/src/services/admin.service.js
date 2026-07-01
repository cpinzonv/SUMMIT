/**
 * Admin analytics — aggregate, non-PII counts for the admin dashboard. All
 * queries are read-only; access is gated by the adminOnly middleware.
 */
import { query } from '../config/db.js';

const REFERRAL_LABELS = {
  friend: 'Friend',
  google_search: 'Google Search',
  social_media: 'Social Media',
  school: 'School',
  app_store: 'App Store',
  other: 'Other',
  unknown: 'Unknown',
};
const LMS_LABELS = {
  canvas: 'Canvas',
  blackboard: 'Blackboard',
  google_classroom: 'Google Classroom',
  brightspace: 'Brightspace',
  moodle: 'Moodle',
  sakai: 'Sakai',
};

/** Top-line counts + an approximate average GPA across graded classes. */
export async function overview() {
  const [users, classes, assignments, gpa] = await Promise.all([
    query('SELECT count(*)::int AS n FROM users'),
    query('SELECT count(*)::int AS n FROM classes'),
    query('SELECT count(*)::int AS n FROM assignments'),
    query(`
      WITH class_pct AS (
        SELECT a.class_id,
               SUM(g.points_earned) / NULLIF(SUM(g.points_possible), 0) * 100 AS pct
        FROM grades g JOIN assignments a ON a.id = g.assignment_id
        GROUP BY a.class_id
      )
      SELECT ROUND(AVG(
        CASE
          WHEN pct >= 93 THEN 4.0 WHEN pct >= 90 THEN 3.7 WHEN pct >= 87 THEN 3.3
          WHEN pct >= 83 THEN 3.0 WHEN pct >= 80 THEN 2.7 WHEN pct >= 77 THEN 2.3
          WHEN pct >= 73 THEN 2.0 WHEN pct >= 70 THEN 1.7 WHEN pct >= 67 THEN 1.3
          WHEN pct >= 63 THEN 1.0 WHEN pct >= 60 THEN 0.7 ELSE 0 END
      )::numeric, 2) AS gpa
      FROM class_pct`),
  ]);
  return {
    totalUsers: users.rows[0].n,
    totalClasses: classes.rows[0].n,
    totalAssignments: assignments.rows[0].n,
    avgGPA: gpa.rows[0].gpa == null ? null : Number(gpa.rows[0].gpa),
  };
}

/** Daily signup counts over the last 30 days (sparse — only days with signups). */
export async function signups() {
  const { rows } = await query(`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS date, count(*)::int AS count
    FROM users
    WHERE created_at >= now() - interval '30 days'
    GROUP BY 1 ORDER BY 1`);
  return rows;
}

/** Users grouped by referral source, as a { label: count } map for a bar chart. */
export async function referrals() {
  const { rows } = await query(`
    SELECT COALESCE(referral_source, 'unknown') AS source, count(*)::int AS count
    FROM users GROUP BY 1 ORDER BY count DESC`);
  const out = {};
  for (const r of rows) out[REFERRAL_LABELS[r.source] || r.source] = r.count;
  return out;
}

/** Most active classes + a count of users who created/edited work in the last 24h. */
export async function activity() {
  const { rows: activeClasses } = await query(`
    SELECT c.id, c.name,
           COUNT(DISTINCT a.id)::int AS assignments,
           COUNT(g.id)::int AS grades
    FROM classes c
    LEFT JOIN assignments a ON a.class_id = c.id
    LEFT JOIN grades g ON g.assignment_id = a.id
    GROUP BY c.id
    ORDER BY assignments DESC, grades DESC
    LIMIT 5`);

  const { rows: au } = await query(`
    SELECT count(DISTINCT uid)::int AS n FROM (
      SELECT c.user_id AS uid FROM classes c JOIN assignments a ON a.class_id = c.id
        WHERE a.updated_at >= now() - interval '24 hours'
      UNION
      SELECT n.user_id FROM notes n WHERE n.updated_at >= now() - interval '24 hours'
      UNION
      SELECT c.user_id FROM classes c
        JOIN assignments a ON a.class_id = c.id
        JOIN grades g ON g.assignment_id = a.id
        WHERE g.updated_at >= now() - interval '24 hours'
    ) t`);

  return { activeClasses, activeUsers24h: au[0].n };
}

/** Connected LMS integrations grouped by provider, as a { label: count } map. */
export async function lms() {
  const { rows } = await query(`
    SELECT provider, count(*)::int AS count
    FROM lms_connections WHERE connected = true
    GROUP BY provider ORDER BY count DESC`);
  const out = {};
  for (const r of rows) out[LMS_LABELS[r.provider] || r.provider] = r.count;
  return out;
}

/** Recent Canvas sync-run logs (newest first) for the admin monitoring view. */
export async function syncLogs(limit = 100) {
  const { rows } = await query(
    `SELECT l.id, l.kind, l.status, l.synced_count, l.error_count, l.duration_ms,
            l.message, l.triggered_by, l.created_at, c.name AS class_name
       FROM canvas_sync_logs l
       LEFT JOIN classes c ON c.id = l.class_id
      ORDER BY l.created_at DESC
      LIMIT $1`,
    [Math.min(Number(limit) || 100, 500)],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    syncedCount: r.synced_count,
    errorCount: r.error_count,
    durationMs: r.duration_ms,
    message: r.message,
    triggeredBy: r.triggered_by,
    className: r.class_name,
    createdAt: r.created_at,
  }));
}
