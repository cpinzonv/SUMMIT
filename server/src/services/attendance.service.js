import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';

function toPublicRecord(row) {
  return {
    id: row.id,
    classId: row.class_id,
    sessionDate: row.session_date,
    status: row.status,
    note: row.note,
  };
}

/**
 * Summarize attendance for a class. Attendance rate counts present + late as
 * attended. `db` may be a transaction client. Used by the class list (rate only)
 * and the class detail page (full breakdown).
 */
export async function computeAttendance(classId, db = { query }) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)                                              AS total,
       COUNT(*) FILTER (WHERE status = 'present')            AS present,
       COUNT(*) FILTER (WHERE status = 'late')               AS late,
       COUNT(*) FILTER (WHERE status = 'absent')             AS absent,
       COUNT(*) FILTER (WHERE status = 'excused')            AS excused,
       COUNT(*) FILTER (WHERE status IN ('present', 'late')) AS attended
     FROM attendance WHERE class_id = $1`,
    [classId],
  );
  const r = rows[0];
  const total = Number(r.total);
  return {
    total,
    present: Number(r.present),
    late: Number(r.late),
    absent: Number(r.absent),
    excused: Number(r.excused),
    rate: total > 0 ? Math.round((Number(r.attended) / total) * 100) : null,
  };
}

/** List a class's sessions (newest first) plus the summary. */
export async function listAttendance(userId, classId) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `SELECT * FROM attendance WHERE class_id = $1 ORDER BY session_date DESC`,
    [classId],
  );
  return {
    records: rows.map(toPublicRecord),
    summary: await computeAttendance(classId),
  };
}

/** Mark (or update) attendance for a session date. Upserts on (class, date). */
export async function markAttendance(userId, classId, { sessionDate, status, note }) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `INSERT INTO attendance (class_id, session_date, status, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (class_id, session_date) DO UPDATE
       SET status = EXCLUDED.status, note = EXCLUDED.note
     RETURNING *`,
    [classId, sessionDate, status, note ?? null],
  );
  return toPublicRecord(rows[0]);
}

export async function deleteAttendance(userId, attendanceId) {
  const { rows } = await query(
    `SELECT a.id FROM attendance a
     JOIN classes c ON c.id = a.class_id
     WHERE a.id = $1 AND c.user_id = $2`,
    [attendanceId, userId],
  );
  if (!rows[0]) throw AppError.notFound('Attendance record not found');
  await query('DELETE FROM attendance WHERE id = $1', [attendanceId]);
}
