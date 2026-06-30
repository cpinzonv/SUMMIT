import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { computeClassGrade } from './grade.service.js';

/** Map a classes row to the API shape (camelCase, grouped syllabus data). */
export function toPublicClass(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    code: row.code,
    term: row.term,
    credits: row.credits == null ? null : Number(row.credits),
    color: row.color,
    startDate: row.start_date,
    endDate: row.end_date,
    archivedAt: row.archived_at,
    syllabus: {
      instructor: row.instructor,
      instructorEmail: row.instructor_email,
      location: row.location,
      meetingTimes: row.meeting_times,
      gradingScheme: row.grading_scheme,
      syllabusUrl: row.syllabus_url,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch a class by id, scoped to the owner. Throws 404 if it doesn't exist or
 * belongs to someone else (don't reveal existence to non-owners). Pass a
 * transaction client as `db` to participate in a transaction.
 */
export async function getOwnedClass(userId, classId, db = { query }) {
  const { rows } = await db.query(
    'SELECT * FROM classes WHERE id = $1 AND user_id = $2',
    [classId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Class not found');
  return rows[0];
}

export async function createClass(userId, input) {
  const s = input.syllabus ?? {};
  const { rows } = await query(
    `INSERT INTO classes
       (user_id, name, description, code, term, credits, color, start_date, end_date,
        instructor, instructor_email, location, meeting_times, grading_scheme,
        syllabus_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             COALESCE($13,'[]'::jsonb), COALESCE($14,'[]'::jsonb), $15)
     RETURNING *`,
    [
      userId,
      input.name,
      input.description ?? null,
      input.code ?? null,
      input.term ?? null,
      input.credits ?? null,
      input.color ?? null,
      input.startDate ?? null,
      input.endDate ?? null,
      s.instructor ?? null,
      s.instructorEmail ?? null,
      s.location ?? null,
      s.meetingTimes ? JSON.stringify(s.meetingTimes) : null,
      s.gradingScheme ? JSON.stringify(s.gradingScheme) : null,
      s.syllabusUrl ?? null,
    ],
  );
  return toPublicClass(rows[0]);
}

/** List the user's active (non-archived) classes, each with grade + attendance. */
export async function listCurrentClasses(userId) {
  const { rows } = await query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM attendance a WHERE a.class_id = c.id) AS att_total,
       (SELECT COUNT(*) FROM attendance a
        WHERE a.class_id = c.id AND a.status IN ('present', 'late')) AS att_attended
     FROM classes c
     WHERE c.user_id = $1 AND c.archived_at IS NULL
     ORDER BY c.created_at DESC`,
    [userId],
  );
  return Promise.all(
    rows.map(async (row) => {
      const attTotal = Number(row.att_total);
      return {
        ...toPublicClass(row),
        currentGrade: await computeClassGrade(row.id),
        attendanceRate:
          attTotal > 0
            ? Math.round((Number(row.att_attended) / attTotal) * 100)
            : null,
      };
    }),
  );
}

/**
 * Archive a class: stamp archived_at and write an immutable point-in-time
 * snapshot (class + assignments + grades + final grade) into the archives
 * table. Idempotent — archiving an already-archived class returns its existing
 * archive record.
 */
export async function archiveClass(userId, classId) {
  return withTransaction(async (client) => {
    const cls = await getOwnedClass(userId, classId, client);

    if (cls.archived_at) {
      const { rows } = await client.query(
        `SELECT * FROM archives
         WHERE user_id = $1 AND entity_type = 'class' AND entity_id = $2`,
        [userId, classId],
      );
      return { class: toPublicClass(cls), archive: rows[0] ?? null };
    }

    // Pull assignments + grades for the snapshot.
    const { rows: assignments } = await client.query(
      `SELECT a.*, to_jsonb(g.*) AS grade
       FROM assignments a
       LEFT JOIN grades g ON g.assignment_id = a.id
       WHERE a.class_id = $1
       ORDER BY a.due_date NULLS LAST, a.created_at`,
      [classId],
    );
    const finalGrade = await computeClassGrade(classId, client);

    const { rows: updated } = await client.query(
      `UPDATE classes SET archived_at = now() WHERE id = $1 RETURNING *`,
      [classId],
    );
    const archivedClass = updated[0];

    const snapshot = {
      class: toPublicClass(archivedClass),
      assignments,
      finalGrade,
    };

    const { rows: archiveRows } = await client.query(
      `INSERT INTO archives (user_id, entity_type, entity_id, label, snapshot)
       VALUES ($1, 'class', $2, $3, $4)
       RETURNING *`,
      [
        userId,
        classId,
        archivedClass.code || archivedClass.name,
        JSON.stringify(snapshot),
      ],
    );

    return { class: toPublicClass(archivedClass), archive: archiveRows[0] };
  });
}
