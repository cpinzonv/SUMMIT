import { query, withTransaction } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { letterGrade } from '../utils/grade.js';
import { generateSessionDates } from '../utils/sessions.js';
import { getOwnedClass } from './class.service.js';

const round1 = (n) => Math.round(n * 10) / 10;

// Target percentage for a letter (round thresholds students expect). Numeric
// targets are used as-is.
const LETTER_TARGET = { 'A+': 97, A: 90, 'A-': 90, 'B+': 87, B: 80, 'B-': 80, 'C+': 77, C: 70, 'C-': 70, 'D+': 67, D: 60, 'D-': 60, F: 50 };

function resolveTargetPercent(target) {
  if (typeof target === 'number') return target;
  const s = String(target).trim().toUpperCase();
  if (s in LETTER_TARGET) return LETTER_TARGET[s];
  const n = Number(s.replace('%', ''));
  if (!Number.isNaN(n)) return n;
  throw AppError.badRequest('Enter a target grade like "A", "B+", or 90.');
}

/**
 * "What if?" grade simulation (points-based, matching the class grade model):
 * given a target final grade, work out the average score needed on the remaining
 * (ungraded) assignments. Handles the already-achieved / impossible / all-done
 * edge cases.
 */
export async function simulateGrade(userId, classId, target) {
  const cls = await getOwnedClass(userId, classId); // 404s if not owned
  const targetPercent = resolveTargetPercent(target);

  const { rows: gradedRows } = await query(
    `SELECT COALESCE(SUM(g.points_earned), 0) AS earned,
            COALESCE(SUM(g.points_possible), 0) AS possible
       FROM assignments a JOIN grades g ON g.assignment_id = a.id
      WHERE a.class_id = $1`,
    [classId],
  );
  const earned = Number(gradedRows[0].earned);
  const possible = Number(gradedRows[0].possible);

  const { rows: remainingRows } = await query(
    `SELECT a.id, a.title, a.point_value
       FROM assignments a
       LEFT JOIN grades g ON g.assignment_id = a.id
      WHERE a.class_id = $1 AND g.id IS NULL AND a.point_value IS NOT NULL AND a.point_value > 0
      ORDER BY a.due_date NULLS LAST, a.created_at`,
    [classId],
  );
  const remainingAssignments = remainingRows.map((r) => ({
    id: r.id,
    title: r.title,
    pointValue: Number(r.point_value),
  }));
  const remainingPoints = remainingAssignments.reduce((s, a) => s + a.pointValue, 0);

  const currentPercent = possible > 0 ? round1((earned / possible) * 100) : null;
  const totalPoints = possible + remainingPoints;

  let status;
  let requiredGradeOnRemaining = null;
  if (remainingPoints === 0) {
    status = 'all_done';
  } else {
    const requiredPoints = (targetPercent / 100) * totalPoints - earned;
    const required = round1((requiredPoints / remainingPoints) * 100);
    requiredGradeOnRemaining = required;
    if (required <= 0) status = 'already_achieved';
    else if (required > 100) status = 'impossible';
    else status = 'reachable';
  }

  return {
    className: cls.name,
    currentPercent,
    currentLetter: letterGrade(currentPercent),
    targetGrade: target,
    targetPercent,
    requiredGradeOnRemaining,
    remainingPoints,
    remainingAssignments,
    status,
  };
}

/**
 * Compute a class's current grade. The assignment component is point-based
 * (sum earned / sum possible). When attendance is graded, the final grade is a
 * weighted blend of the assignment percentage and the attendance rate — and if
 * one component has no data yet, the available components are renormalized so a
 * not-yet-graded piece doesn't unfairly drag the grade down. `db` may be a
 * transaction client.
 */
export async function computeClassGrade(classId, db = { query }) {
  const gradeRow = (
    await db.query(
      `SELECT
         COALESCE(SUM(g.points_earned), 0)   AS earned,
         COALESCE(SUM(g.points_possible), 0) AS possible,
         COUNT(g.id)                         AS graded
       FROM assignments a
       JOIN grades g ON g.assignment_id = a.id
       WHERE a.class_id = $1`,
      [classId],
    )
  ).rows[0];

  const clsRow = (
    await db.query(
      `SELECT attendance_graded, attendance_weight, meeting_days, start_date, end_date
       FROM classes WHERE id = $1`,
      [classId],
    )
  ).rows[0];

  const earned = Number(gradeRow.earned);
  const possible = Number(gradeRow.possible);
  const graded = Number(gradeRow.graded);
  const assignmentPct = possible > 0 ? round1((earned / possible) * 100) : null;

  const attendanceGraded = Boolean(clsRow?.attendance_graded);
  const attendanceWeight =
    clsRow?.attendance_weight == null ? null : Number(clsRow.attendance_weight);

  // Count attendance only over the generated session dates — the same set the
  // attendance UI shows — so the rate is consistent everywhere. Excused and
  // unmarked sessions are excluded from the denominator.
  let attendancePct = null;
  {
    const sessionDates = new Set(
      generateSessionDates(
        clsRow?.start_date,
        clsRow?.end_date,
        Array.isArray(clsRow?.meeting_days) ? clsRow.meeting_days : [],
      ),
    );
    if (sessionDates.size > 0) {
      const recs = (
        await db.query(
          `SELECT session_date, status FROM attendance WHERE class_id = $1`,
          [classId],
        )
      ).rows;
      let attended = 0;
      let denom = 0;
      for (const r of recs) {
        if (!sessionDates.has(r.session_date)) continue;
        if (r.status === 'present' || r.status === 'late') {
          attended += 1;
          denom += 1;
        } else if (r.status === 'absent') {
          denom += 1;
        }
      }
      // Integer percent, matching the attendance UI's summary.
      if (denom > 0) attendancePct = Math.round((attended / denom) * 100);
    }
  }

  // Build weighted components, renormalizing over those with data.
  const useAttendance =
    attendanceGraded && attendanceWeight != null && attendanceWeight > 0 && attendancePct != null;
  const components = [];
  if (assignmentPct != null) {
    components.push([assignmentPct, useAttendance ? 100 - attendanceWeight : 100]);
  }
  if (useAttendance) components.push([attendancePct, attendanceWeight]);

  const totalWeight = components.reduce((s, [, w]) => s + w, 0);
  const percentage =
    totalWeight > 0
      ? round1(components.reduce((s, [p, w]) => s + p * w, 0) / totalWeight)
      : null;

  return {
    percentage,
    letter: letterGrade(percentage),
    pointsEarned: earned,
    pointsPossible: possible,
    gradedAssignments: graded,
    assignmentPercentage: assignmentPct,
    attendanceGraded,
    attendanceWeight,
    attendancePercentage: attendancePct,
  };
}

function toPublicGrade(row) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    pointsEarned: Number(row.points_earned),
    pointsPossible: Number(row.points_possible),
    feedback: row.feedback,
    gradedAt: row.graded_at,
  };
}

/**
 * Submit (or update) the grade for an assignment, then recompute the owning
 * class's current grade. points_possible defaults to the assignment's
 * point_value when not supplied. Verifies the assignment belongs to the user.
 */
export async function submitGrade(userId, input) {
  return withTransaction(async (client) => {
    // Ownership + fetch the assignment (and its class) in one guarded query.
    const { rows: aRows } = await client.query(
      `SELECT a.id, a.class_id, a.point_value
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
       WHERE a.id = $1 AND c.user_id = $2`,
      [input.assignmentId, userId],
    );
    const assignment = aRows[0];
    if (!assignment) throw AppError.notFound('Assignment not found');

    const pointsPossible =
      input.pointsPossible ??
      (assignment.point_value != null ? Number(assignment.point_value) : null);

    if (pointsPossible == null) {
      throw AppError.badRequest(
        'pointsPossible is required because the assignment has no point_value',
      );
    }
    if (pointsPossible <= 0) {
      throw AppError.badRequest('pointsPossible must be greater than 0');
    }

    // One grade per assignment — upsert on the unique assignment_id.
    const { rows: gRows } = await client.query(
      `INSERT INTO grades (assignment_id, points_earned, points_possible, feedback)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (assignment_id) DO UPDATE
         SET points_earned   = EXCLUDED.points_earned,
             points_possible = EXCLUDED.points_possible,
             feedback        = EXCLUDED.feedback,
             graded_at       = now()
       RETURNING *`,
      [input.assignmentId, input.pointsEarned, pointsPossible, input.feedback ?? null],
    );

    // Recording a grade marks the assignment graded.
    await client.query(
      `UPDATE assignments SET status = 'graded' WHERE id = $1`,
      [input.assignmentId],
    );

    const classGrade = await computeClassGrade(assignment.class_id, client);

    return {
      grade: toPublicGrade(gRows[0]),
      classId: assignment.class_id,
      classGrade,
    };
  });
}
