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
    meetingDays: row.meeting_days ?? [],
    meetingTime: row.meeting_time ?? null,
    attendanceGraded: row.attendance_graded ?? false,
    attendanceWeight: row.attendance_weight == null ? null : Number(row.attendance_weight),
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
        meeting_days, meeting_time, attendance_graded, attendance_weight,
        instructor, instructor_email, location, meeting_times, grading_scheme,
        syllabus_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10,'[]'::jsonb), $11,
             COALESCE($12, false), $13,
             $14,$15,$16,
             COALESCE($17,'[]'::jsonb), COALESCE($18,'[]'::jsonb), $19)
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
      input.meetingDays ? JSON.stringify(input.meetingDays) : null,
      input.meetingTime ?? null,
      input.attendanceGraded ?? null,
      input.attendanceWeight ?? null,
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

// Whitelisted fields for PATCH /api/classes/:id (column mapping).
const CLASS_UPDATABLE = {
  name: 'name',
  description: 'description',
  code: 'code',
  term: 'term',
  color: 'color',
  startDate: 'start_date',
  endDate: 'end_date',
  meetingTime: 'meeting_time',
  attendanceGraded: 'attendance_graded',
  attendanceWeight: 'attendance_weight',
};

/** Partially update a class the user owns (schedule, basic fields). */
export async function updateClass(userId, classId, input) {
  await getOwnedClass(userId, classId);
  const sets = [];
  const values = [];
  let i = 1;
  for (const [field, column] of Object.entries(CLASS_UPDATABLE)) {
    if (field in input) {
      sets.push(`${column} = $${i++}`);
      values.push(input[field] ?? null);
    }
  }
  if ('meetingDays' in input) {
    sets.push(`meeting_days = $${i++}::jsonb`);
    values.push(JSON.stringify(input.meetingDays ?? []));
  }
  if (sets.length === 0) {
    return toPublicClass(await getOwnedClass(userId, classId));
  }
  values.push(classId);
  const { rows } = await query(
    `UPDATE classes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  return toPublicClass(rows[0]);
}

/** List the user's active (non-archived) classes, each with grade + attendance. */
export async function listCurrentClasses(userId) {
  const { rows } = await query(
    `SELECT * FROM classes
     WHERE user_id = $1 AND archived_at IS NULL
     ORDER BY created_at DESC`,
    [userId],
  );
  return Promise.all(
    rows.map(async (row) => {
      const currentGrade = await computeClassGrade(row.id);
      return {
        ...toPublicClass(row),
        currentGrade,
        // Single source of truth: same generated-session rate the grade uses.
        attendanceRate: currentGrade.attendancePercentage,
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

/** Permanently delete a class the user owns (assignments/grades/notes/attendance cascade). */
export async function deleteClass(userId, classId) {
  await getOwnedClass(userId, classId); // 404s if not owned
  await query('DELETE FROM classes WHERE id = $1', [classId]);
}

/**
 * Archive every active class whose end_date is in the past. Returns the list of
 * classes that were archived (id + name), for a "semester ended" notice.
 */
export async function autoArchiveExpired(userId) {
  const { rows } = await query(
    `SELECT id, name FROM classes
     WHERE user_id = $1 AND archived_at IS NULL
       AND end_date IS NOT NULL AND end_date < CURRENT_DATE
     ORDER BY end_date`,
    [userId],
  );
  for (const row of rows) {
    await archiveClass(userId, row.id);
  }
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
