import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/**
 * Every date between start and end (inclusive) that falls on one of the meeting
 * weekdays. Dates are local-calendar 'YYYY-MM-DD' strings.
 */
function generateSessionDates(startStr, endStr, days) {
  if (!startStr || !endStr || !Array.isArray(days) || days.length === 0) return [];
  const wanted = new Set(days.map((d) => DAY_INDEX[d]).filter((n) => n !== undefined));
  if (wanted.size === 0) return [];

  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  const out = [];
  let guard = 0;
  while (cur <= end && guard < 3000) {
    if (wanted.has(cur.getDay())) out.push(fmt(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out;
}

function summarize(sessions) {
  const counts = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const s of sessions) if (s.status) counts[s.status] += 1;
  // Excused sessions don't count against you; unmarked sessions are ignored.
  const denom = counts.present + counts.late + counts.absent;
  return {
    total: sessions.length,
    marked: counts.present + counts.late + counts.absent + counts.excused,
    ...counts,
    rate: denom > 0 ? Math.round(((counts.present + counts.late) / denom) * 100) : null,
  };
}

/**
 * List the class's auto-generated sessions (from its meeting schedule), each
 * joined with any recorded attendance status, plus a summary and the schedule.
 */
export async function listAttendance(userId, classId) {
  const cls = await getOwnedClass(userId, classId);
  const days = Array.isArray(cls.meeting_days) ? cls.meeting_days : [];
  const dates = generateSessionDates(cls.start_date, cls.end_date, days);

  const { rows } = await query(
    'SELECT id, session_date, status FROM attendance WHERE class_id = $1',
    [classId],
  );
  const byDate = new Map(rows.map((r) => [r.session_date, r]));

  const sessions = dates.map((date) => {
    const rec = byDate.get(date);
    return { sessionDate: date, status: rec?.status ?? null, recordId: rec?.id ?? null };
  });

  return {
    sessions,
    summary: summarize(sessions),
    schedule: {
      startDate: cls.start_date,
      endDate: cls.end_date,
      meetingDays: days,
      meetingTime: cls.meeting_time ?? null,
      configured: dates.length > 0,
    },
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
  const r = rows[0];
  return {
    id: r.id,
    classId: r.class_id,
    sessionDate: r.session_date,
    status: r.status,
    note: r.note,
  };
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
